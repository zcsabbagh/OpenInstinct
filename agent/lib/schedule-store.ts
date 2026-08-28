import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { db, schedules } from "@/db";
import type { RecurrenceRule } from "@/lib/schedule-time";
import { isRepeatKind, nextRecurrence } from "@/lib/schedule-time";
import type { LinqJobOwner } from "@/lib/linq-target";

// Storage adapter for user-created reminders / recurring nudges. The eve-facing
// contract is: create/list/cancel for the tools, and claimDue/complete/release
// for the one-minute dispatcher (agent/schedules/dynamic.ts).
//
// Recurrence is a wall-clock anchor (`RecurrenceRule` from `lib/schedule-time`),
// not a fixed interval: `completeRun` always re-derives the next run from the
// rule's fixed hour/minute (and weekday/day-of-month/month) via
// `nextRecurrence`, never by adding an interval to the actual fire time. That
// is what keeps a recurring reminder pinned to its original wall-clock time
// instead of drifting later on every late or quantized dispatcher tick.

export type ScheduleRow = typeof schedules.$inferSelect;

export interface CreateScheduleInput {
  task: string;
  firstRunAt: string; // ISO 8601 with offset
  // null => one-time. Set => recurring, anchored to this wall-clock rule.
  recurrence: RecurrenceRule | null;
}

export type RecurrenceFields = Pick<
  ScheduleRow,
  | "repeatKind"
  | "timezone"
  | "anchorHour"
  | "anchorMinute"
  | "repeatDayOfWeek"
  | "repeatDayOfMonth"
  | "repeatMonth"
>;

export function rowToRule(row: RecurrenceFields): RecurrenceRule | null {
  if (
    row.repeatKind == null ||
    row.timezone == null ||
    row.anchorHour == null ||
    row.anchorMinute == null
  ) {
    return null;
  }
  if (!isRepeatKind(row.repeatKind)) {
    throw new Error(
      `Unrecognized repeat_kind "${row.repeatKind}" in schedules row.`
    );
  }
  return {
    kind: row.repeatKind,
    hour: row.anchorHour,
    minute: row.anchorMinute,
    timezone: row.timezone,
    ...(row.repeatDayOfWeek != null ? { dayOfWeek: row.repeatDayOfWeek } : {}),
    ...(row.repeatDayOfMonth != null
      ? { dayOfMonth: row.repeatDayOfMonth }
      : {}),
    ...(row.repeatMonth != null ? { month: row.repeatMonth } : {}),
  };
}

export async function createSchedule(
  owner: LinqJobOwner,
  input: CreateScheduleInput
): Promise<{
  id: string;
  nextRunAt: string;
  recurrence: RecurrenceRule | null;
}> {
  const id = randomUUID();
  const rule = input.recurrence;
  await db.insert(schedules).values({
    id,
    workspaceId: owner.workspaceId,
    ownerPrincipalId: owner.ownerPrincipalId,
    authenticator: owner.authenticator,
    issuer: owner.issuer,
    linqThread: owner.linqThread,
    ownerHandle: owner.ownerHandle,
    task: input.task,
    nextRunAt: input.firstRunAt,
    everyMinutes: null,
    repeatKind: rule?.kind ?? null,
    timezone: rule?.timezone ?? null,
    anchorHour: rule?.hour ?? null,
    anchorMinute: rule?.minute ?? null,
    repeatDayOfWeek: rule?.dayOfWeek ?? null,
    repeatDayOfMonth: rule?.dayOfMonth ?? null,
    repeatMonth: rule?.month ?? null,
    enabled: 1,
    createdAt: new Date().toISOString(),
  });
  return {
    id,
    nextRunAt: input.firstRunAt,
    recurrence: rule,
  };
}

export function listSchedules(owner: Pick<LinqJobOwner, "workspaceId">) {
  return db
    .select({
      id: schedules.id,
      task: schedules.task,
      nextRunAt: schedules.nextRunAt,
      repeatKind: schedules.repeatKind,
      timezone: schedules.timezone,
      anchorHour: schedules.anchorHour,
      anchorMinute: schedules.anchorMinute,
      repeatDayOfWeek: schedules.repeatDayOfWeek,
      repeatDayOfMonth: schedules.repeatDayOfMonth,
      repeatMonth: schedules.repeatMonth,
      enabled: schedules.enabled,
      lastRunAt: schedules.lastRunAt,
    })
    .from(schedules)
    .where(eq(schedules.workspaceId, owner.workspaceId))
    .orderBy(desc(schedules.createdAt));
}

export async function cancelSchedule(
  owner: Pick<LinqJobOwner, "workspaceId">,
  id: string
): Promise<boolean> {
  const deleted = await db
    .delete(schedules)
    .where(
      and(eq(schedules.id, id), eq(schedules.workspaceId, owner.workspaceId))
    )
    .returning({ id: schedules.id });
  return deleted.length > 0;
}

// One UPDATE ... RETURNING leases every due, unclaimed row atomically. Overlapping
// dispatcher ticks re-evaluate the WHERE against committed lease state, so they
// never claim the same row.
export async function claimDue(options: {
  now: Date;
  leaseForMs: number;
}): Promise<ScheduleRow[]> {
  const nowIso = options.now.toISOString();
  const leaseExpiresAt = new Date(
    options.now.getTime() + options.leaseForMs
  ).toISOString();
  return db
    .update(schedules)
    .set({ leaseToken: randomUUID(), leaseExpiresAt })
    .where(
      and(
        eq(schedules.enabled, 1),
        lte(schedules.nextRunAt, nowIso),
        or(
          isNull(schedules.leaseExpiresAt),
          lt(schedules.leaseExpiresAt, nowIso)
        )
      )
    )
    .returning();
}

// Pure decision at the heart of `completeRun`: null means "one-time, disable
// it"; otherwise the next run instant. Exported (and DB-free) so the
// recurrence behavior - the drift fix in particular - can be unit tested
// directly instead of only through a live database.
//
// Anchored to the rule's fixed wall-clock time, not to the row's stale
// `nextRunAt` or how late `now` is relative to it: every candidate
// `nextRecurrence` returns is derived from the rule itself, so a late or
// quantized dispatcher tick never shifts the schedule. Passing `now` (not the
// stale `nextRunAt`) as the lower bound is also what makes a long dispatcher
// outage resolve to the next future occurrence instead of a backlog of missed
// ones.
export function computeNextRunAt(
  row: RecurrenceFields,
  now: Date
): Date | null {
  const rule = rowToRule(row);
  return rule == null ? null : nextRecurrence(rule, now);
}

export async function completeRun(row: ScheduleRow): Promise<void> {
  const now = new Date();
  const next = computeNextRunAt(row, now);
  if (next == null) {
    await db
      .update(schedules)
      .set({
        enabled: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        lastRunAt: now.toISOString(),
      })
      .where(eq(schedules.id, row.id));
    return;
  }
  const nextRunAt = next.toISOString();
  await db
    .update(schedules)
    .set({
      nextRunAt,
      leaseToken: null,
      leaseExpiresAt: null,
      lastRunAt: now.toISOString(),
    })
    .where(eq(schedules.id, row.id));
}

export async function releaseRun(
  row: ScheduleRow,
  retryAt: Date
): Promise<void> {
  await db
    .update(schedules)
    .set({
      nextRunAt: retryAt.toISOString(),
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(eq(schedules.id, row.id));
}
