import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { db, schedules } from "@/db";
import type { LinqJobOwner } from "@/lib/linq-target";

// Storage adapter for user-created reminders / recurring nudges. The eve-facing
// contract is: create/list/cancel for the tools, and claimDue/complete/release
// for the one-minute dispatcher (agent/schedules/dynamic.ts).

export type ScheduleRow = typeof schedules.$inferSelect;

export interface CreateScheduleInput {
  task: string;
  firstRunAt: string; // ISO 8601 with offset
  everyMinutes: number | null;
}

export async function createSchedule(
  owner: LinqJobOwner,
  input: CreateScheduleInput
): Promise<{ id: string; nextRunAt: string; everyMinutes: number | null }> {
  const id = randomUUID();
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
    everyMinutes: input.everyMinutes,
    enabled: 1,
    createdAt: new Date().toISOString(),
  });
  return {
    id,
    nextRunAt: input.firstRunAt,
    everyMinutes: input.everyMinutes,
  };
}

export function listSchedules(owner: Pick<LinqJobOwner, "workspaceId">) {
  return db
    .select({
      id: schedules.id,
      task: schedules.task,
      nextRunAt: schedules.nextRunAt,
      everyMinutes: schedules.everyMinutes,
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

export async function completeRun(row: ScheduleRow): Promise<void> {
  const now = new Date();
  if (row.everyMinutes == null) {
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
  const base = Math.max(now.getTime(), Date.parse(row.nextRunAt));
  const nextRunAt = new Date(base + row.everyMinutes * 60_000).toISOString();
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
