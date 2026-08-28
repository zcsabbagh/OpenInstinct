import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { db, webMonitors } from "@/db";
import { exaSearch } from "@/lib/exa";
import type { LinqJobOwner } from "@/lib/linq-target";

// A web monitor is a saved Exa search. On creation we run it once and record
// every current URL as "seen", so the first real alert only carries genuinely
// new results. The daily dispatcher (agent/schedules/web-monitors.ts) re-runs
// each due search, diffs against seen URLs, and messages the user on a hit.

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SEEN_CAP = 400;

export type WebMonitorRow = typeof webMonitors.$inferSelect;

export async function createWebMonitor(
  owner: LinqJobOwner,
  query: string
): Promise<{ id: string; nextCheckAt: string }> {
  let seed: string[] = [];
  try {
    seed = (await exaSearch(query, 10)).map((result) => result.url);
  } catch {
    // A transient search failure shouldn't block creating the monitor; the
    // first daily run will seed instead.
  }

  const id = randomUUID();
  const now = new Date();
  const nextCheckAt = new Date(now.getTime() + CHECK_INTERVAL_MS).toISOString();
  await db.insert(webMonitors).values({
    id,
    workspaceId: owner.workspaceId,
    ownerPrincipalId: owner.ownerPrincipalId,
    authenticator: owner.authenticator,
    issuer: owner.issuer,
    linqThread: owner.linqThread,
    ownerHandle: owner.ownerHandle,
    query,
    seenItemIds: JSON.stringify(seed),
    nextCheckAt,
    createdAt: now.toISOString(),
  });
  return { id, nextCheckAt };
}

export function listWebMonitors(owner: Pick<LinqJobOwner, "workspaceId">) {
  return db
    .select({
      id: webMonitors.id,
      query: webMonitors.query,
      lastCheckedAt: webMonitors.lastCheckedAt,
      createdAt: webMonitors.createdAt,
    })
    .from(webMonitors)
    .where(eq(webMonitors.workspaceId, owner.workspaceId))
    .orderBy(desc(webMonitors.createdAt));
}

export async function deleteWebMonitor(
  owner: Pick<LinqJobOwner, "workspaceId">,
  id: string
): Promise<boolean> {
  const deleted = await db
    .delete(webMonitors)
    .where(
      and(
        eq(webMonitors.id, id),
        eq(webMonitors.workspaceId, owner.workspaceId)
      )
    )
    .returning({ id: webMonitors.id });
  return deleted.length > 0;
}

// One UPDATE ... RETURNING leases every due, unclaimed monitor.
export function claimDueMonitors(options: {
  now: Date;
  leaseForMs: number;
}): Promise<WebMonitorRow[]> {
  const nowIso = options.now.toISOString();
  const leaseExpiresAt = new Date(
    options.now.getTime() + options.leaseForMs
  ).toISOString();
  return db
    .update(webMonitors)
    .set({ leaseToken: randomUUID(), leaseExpiresAt })
    .where(
      and(
        lte(webMonitors.nextCheckAt, nowIso),
        or(
          isNull(webMonitors.leaseExpiresAt),
          lt(webMonitors.leaseExpiresAt, nowIso)
        )
      )
    )
    .returning();
}

export async function completeMonitorCheck(
  row: WebMonitorRow,
  currentUrls: string[]
): Promise<void> {
  const merged = [
    ...new Set([...parseSeen(row.seenItemIds), ...currentUrls]),
  ].slice(-SEEN_CAP);
  await db
    .update(webMonitors)
    .set({
      seenItemIds: JSON.stringify(merged),
      nextCheckAt: new Date(Date.now() + CHECK_INTERVAL_MS).toISOString(),
      leaseToken: null,
      leaseExpiresAt: null,
      lastCheckedAt: new Date().toISOString(),
    })
    .where(eq(webMonitors.id, row.id));
}

export async function releaseMonitorCheck(
  row: WebMonitorRow,
  retryAt: Date
): Promise<void> {
  await db
    .update(webMonitors)
    .set({
      nextCheckAt: retryAt.toISOString(),
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(eq(webMonitors.id, row.id));
}

export function parseSeen(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
