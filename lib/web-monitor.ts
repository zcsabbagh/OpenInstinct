import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, webMonitors } from "@/db";
import { exaSearch, type ExaResult } from "@/lib/exa";
import type { LinqJobOwner } from "@/lib/linq-target";

// A web monitor is a saved Exa search. On creation we run it once and record
// every current URL as "seen", so the first real alert only carries genuinely
// new results. The daily dispatcher (agent/schedules/web-monitors.ts) re-runs
// each due search, diffs against seen URLs, and messages the user on a hit.
//
// Plain Exa search ranks by relevance, not recency: a stable query keeps
// returning the same evergreen top results forever. URL-dedup alone would
// degrade this into a monitor that alerts once and then goes silent even
// when the underlying page changes. `monitorSearch` fixes that at the
// source by asking Exa for only results published within the trailing
// window (`startPublishedDate`), so the *candidate set* itself is recency
// filtered, not just the diff against what we've already shown the user.

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SEEN_CAP = 400;
const MONITOR_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;
/** Active monitors allowed per workspace. */
export const MONITOR_CAP = 10;

export type WebMonitorRow = typeof webMonitors.$inferSelect;

/** A URL the monitor has already surfaced, plus the published date Exa last reported for it (null when Exa had none). */
export interface SeenItem {
  url: string;
  publishedDate: string | null;
}

/** Runs a monitor's saved query, restricted to results published in the trailing lookback window. */
export function monitorSearch(
  query: string,
  numResults = 10
): Promise<ExaResult[]> {
  return exaSearch(query, numResults, {
    startPublishedDate: new Date(
      Date.now() - MONITOR_LOOKBACK_MS
    ).toISOString(),
  });
}

export function isAtMonitorCap(activeCount: number): boolean {
  return activeCount >= MONITOR_CAP;
}

async function countActiveMonitors(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webMonitors)
    .where(eq(webMonitors.workspaceId, workspaceId));
  return row?.count ?? 0;
}

export async function createWebMonitor(
  owner: LinqJobOwner,
  query: string
): Promise<{ id: string; nextCheckAt: string }> {
  const activeCount = await countActiveMonitors(owner.workspaceId);
  if (isAtMonitorCap(activeCount)) {
    throw new Error(
      `The user already has ${String(MONITOR_CAP)} active web monitors, which is the limit. Tell them they're at the limit, use list_web_monitors to show what's running, and offer to delete one with delete_web_monitor before creating a new one.`
    );
  }

  let seed: SeenItem[] = [];
  try {
    seed = (await monitorSearch(query)).map((result) => ({
      url: result.url,
      publishedDate: result.publishedDate ?? null,
    }));
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
  currentResults: readonly Pick<ExaResult, "url" | "publishedDate">[]
): Promise<void> {
  // A Map preserves each URL's original insertion position, so an
  // already-seen URL that reappears keeps its old slot (matching the prior
  // Set-based behavior) while its recorded published date is refreshed to
  // whatever Exa reports this run.
  const merged = new Map(
    parseSeen(row.seenItemIds).map((item) => [item.url, item.publishedDate])
  );
  for (const result of currentResults) {
    merged.set(result.url, result.publishedDate ?? null);
  }
  const seen: SeenItem[] = [...merged.entries()]
    .slice(-SEEN_CAP)
    .map(([url, publishedDate]) => ({ url, publishedDate }));

  await db
    .update(webMonitors)
    .set({
      seenItemIds: JSON.stringify(seen),
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

function readSeenEntry(entry: unknown): SeenItem | null {
  if (typeof entry === "string") return { url: entry, publishedDate: null };
  if (typeof entry !== "object" || entry === null) return null;
  if (!("url" in entry) || typeof entry.url !== "string") return null;
  const publishedDate = "publishedDate" in entry ? entry.publishedDate : null;
  return {
    url: entry.url,
    publishedDate: typeof publishedDate === "string" ? publishedDate : null,
  };
}

/** Parses `seenItemIds`. Accepts both the current `SeenItem[]` shape and the
 * plain `string[]` of URLs written before published-date tracking existed,
 * so rows created pre-migration keep working without a data migration. */
export function parseSeen(value: string): SeenItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const items: SeenItem[] = [];
    for (const entry of parsed) {
      const item = readSeenEntry(entry);
      if (item) items.push(item);
    }
    return items;
  } catch {
    return [];
  }
}

// Re-announcement: if a page we've already alerted on is edited with
// genuinely new information (a tour page adds a date), URL-dedup alone
// never re-alerts. The only cheap, low-noise signal available from plain
// Exa search results is `publishedDate` advancing past what we recorded
// last time - title/content-hash aren't in the response, and re-alerting
// on title changes alone is noisy (cosmetic copy edits, A/B'd headlines).
// So: a URL re-alerts only when both the previously recorded date and the
// new date are present *and* the new one is strictly later. A URL with no
// recorded date, or whose date does not advance, does not re-alert - that
// is a real limitation (a silent content edit on a page Exa never dates
// will not be caught), accepted because every cheaper alternative was
// noisier than the miss it prevents.
export function selectFreshResults(
  seenItemIdsJson: string,
  results: readonly ExaResult[]
): ExaResult[] {
  const seen = new Map(
    parseSeen(seenItemIdsJson).map((item) => [item.url, item.publishedDate])
  );
  return results.filter((result) => {
    if (!seen.has(result.url)) return true;
    const priorDate = seen.get(result.url);
    if (!priorDate || !result.publishedDate) return false;
    return (
      new Date(result.publishedDate).getTime() > new Date(priorDate).getTime()
    );
  });
}
