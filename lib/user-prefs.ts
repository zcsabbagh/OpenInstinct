import { eq, isNull, sql } from "drizzle-orm";
import { db, workspacePrefs } from "@/db";

// Every writer of workspace_prefs.timezone (the browser reporter, the
// set_timezone tool, create_schedule's side-effect capture, and the Google
// Calendar sync) funnels through `setUserTimezoneFromSource` below so
// precedence is enforced in exactly one place instead of re-litigated at each
// call site.
export type TimezoneSource = "browser" | "google_calendar" | "user_stated";

const TIMEZONE_SOURCES: readonly TimezoneSource[] = [
  "browser",
  "google_calendar",
  "user_stated",
];

function isTimezoneSource(value: string | null): value is TimezoneSource {
  return (
    value !== null && (TIMEZONE_SOURCES as readonly string[]).includes(value)
  );
}

// Higher rank wins. Google Calendar is the user's declared, stable
// preference - it doesn't move just because their phone did - so it outranks
// the browser, which only ever reports the device's *current* zone and would
// otherwise silently drag a "9am daily" reminder across the world on a trip.
// An explicit statement in chat ("I'm in Chicago") outranks both: it's a
// deliberate, timestamped act, and the user should always be able to
// override what Calendar or the browser inferred just by saying so.
const TIMEZONE_SOURCE_RANK: Record<TimezoneSource, number> = {
  browser: 1,
  google_calendar: 2,
  user_stated: 3,
};

export interface TimezonePref {
  readonly timezone: string | null;
  readonly source: TimezoneSource | null;
  readonly updatedAt: string | null;
}

export async function getUserTimezonePref(
  workspaceId: string
): Promise<TimezonePref | null> {
  const [row] = await db
    .select({
      timezone: workspacePrefs.timezone,
      timezoneSource: workspacePrefs.timezoneSource,
      updatedAt: workspacePrefs.updatedAt,
    })
    .from(workspacePrefs)
    .where(eq(workspacePrefs.workspaceId, workspaceId))
    .limit(1);
  if (!row) return null;
  return {
    source: isTimezoneSource(row.timezoneSource) ? row.timezoneSource : null,
    timezone: row.timezone,
    updatedAt: row.updatedAt,
  };
}

export async function getUserTimezone(
  workspaceId: string
): Promise<string | null> {
  const pref = await getUserTimezonePref(workspaceId);
  return pref?.timezone ?? null;
}

// Writes `timezone` with provenance `source`, but only when `source` is at
// least as authoritative as whatever is already on file - a lower-ranked
// source (e.g. the browser) must never clobber a higher-ranked one (e.g. a
// value the user just stated) that's already stored. The rank comparison is
// evaluated inside the UPSERT's WHERE clause so it is atomic: there's no
// read-then-write race between two writers landing at once. A brand-new row
// (no existing conflict) always inserts, since there's nothing yet to
// outrank. Returns whether the write actually applied.
export async function setUserTimezoneFromSource(
  workspaceId: string,
  timezone: string,
  source: TimezoneSource
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  const rank = TIMEZONE_SOURCE_RANK[source];
  const [row] = await db
    .insert(workspacePrefs)
    .values({ timezone, timezoneSource: source, updatedAt, workspaceId })
    .onConflictDoUpdate({
      set: { timezone, timezoneSource: source, updatedAt },
      setWhere: sql`${rank} >= case ${workspacePrefs.timezoneSource}
        when 'user_stated' then 3
        when 'google_calendar' then 2
        when 'browser' then 1
        else 0 end`,
      target: workspacePrefs.workspaceId,
    })
    .returning({ workspaceId: workspacePrefs.workspaceId });
  return row !== undefined;
}

export async function hasBeenIntroduced(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ introducedAt: workspacePrefs.introducedAt })
    .from(workspacePrefs)
    .where(eq(workspacePrefs.workspaceId, workspaceId))
    .limit(1);
  return row?.introducedAt != null;
}

/**
 * Durably claims the one-time intro for a workspace. Returns true exactly once
 * per workspace, even across cold starts and concurrent turns, so the staged
 * intro in `agent/channels/linq.ts` is sent a single time.
 */
export async function claimIntroduction(workspaceId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(workspacePrefs)
    .values({ workspaceId, introducedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: workspacePrefs.workspaceId,
      set: { introducedAt: now, updatedAt: now },
      setWhere: isNull(workspacePrefs.introducedAt),
    })
    .returning({ introducedAt: workspacePrefs.introducedAt });
  return row?.introducedAt === now;
}
