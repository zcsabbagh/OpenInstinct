import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { isValidTimeZone } from "@/lib/schedule-time";
import {
  getUserTimezonePref,
  setUserTimezoneFromSource,
  type TimezonePref,
} from "@/lib/user-prefs";
import {
  GOOGLE_WORKSPACE_CONNECTOR,
  googleWorkspaceTokenParams,
} from "./config";
import { googleWorkspaceClient, type GoogleWorkspaceClient } from "./server";

// Google exposes the account's declared timezone two ways: the primary
// calendar resource's `timeZone` field (`calendars.get('primary')`), and the
// Calendar Settings API (`users/me/settings/timezone`). We use the Settings
// endpoint: it's exactly the "Time zone" the user set in Calendar's General
// settings - the single account-wide preference this feature wants - rather
// than a per-calendar attribute that (in principle, if rarely in practice)
// could be overridden independently of it via `calendars.update`. It's also
// a one-field response instead of the full calendar resource.
const CALENDAR_TIMEZONE_SETTING_URL =
  "https://www.googleapis.com/calendar/v3/users/me/settings/timezone";

const calendarTimezoneSettingSchema = z.object({ value: z.string().min(1) });

// Re-check an already-synced Calendar timezone at most this often. The
// account setting the Settings API reports almost never changes - someone
// updates it when they permanently relocate, not on every trip - so a daily
// re-check is generous, not stingy.
const CALENDAR_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Bounds retries when a sync attempt doesn't end in a stored value (API
// hiccup, transient token issue, or the source is "browser" and we tried but
// Google's answer matched nothing worth writing). Without this, a persistent
// failure would otherwise mean an HTTP round trip to Google on every single
// inbound message, which is exactly the hot-path cost the caller must avoid.
// Same shape as `recentOnboardingPrompts` in agent/channels/linq.ts.
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;
const recentSyncAttempts = new Map<string, number>();

function claimSyncAttempt(workspaceId: string): boolean {
  const now = Date.now();
  const last = recentSyncAttempts.get(workspaceId);
  if (last !== undefined && now - last < RETRY_COOLDOWN_MS) return false;
  recentSyncAttempts.set(workspaceId, now);
  if (recentSyncAttempts.size > 500) {
    for (const [key, at] of recentSyncAttempts) {
      if (now - at > RETRY_COOLDOWN_MS) recentSyncAttempts.delete(key);
    }
  }
  return true;
}

// Whether a Calendar sync is worth attempting at all, given what's already on
// file. This is the gate that keeps the Calendar API off the hot path: once a
// workspace has a fresh `google_calendar` value, or an explicit `user_stated`
// one, most calls short-circuit here on a value already held in memory by the
// caller - no DB read and no HTTP call.
function shouldAttemptCalendarTimezoneSync(pref: TimezonePref | null): boolean {
  if (!pref?.timezone || !pref.source) return true;
  // A value the user explicitly stated outranks Calendar (see
  // lib/user-prefs.ts) and a sync would never be allowed to overwrite it, so
  // don't spend an API call finding that out.
  if (pref.source === "user_stated") return false;
  // The browser is the lowest-ranked source; always worth trying to upgrade
  // it to the authoritative one.
  if (pref.source === "browser") return true;
  // Already google_calendar - only worth re-checking once it could plausibly
  // be stale.
  const updatedAt = pref.updatedAt ? Date.parse(pref.updatedAt) : Number.NaN;
  if (Number.isNaN(updatedAt)) return true;
  return Date.now() - updatedAt >= CALENDAR_REFRESH_INTERVAL_MS;
}

async function fetchPrimaryCalendarTimezone(
  scope: AccessScope,
  client: GoogleWorkspaceClient,
  fetchImpl: typeof fetch
): Promise<string | null> {
  try {
    // No `forceRefresh`: this only runs once a caller has already confirmed
    // the connection is live (typically via `getGoogleWorkspaceConnection`,
    // which does force-refresh), so a cached token is fine here.
    const { token } = await client.getTokenResponse(
      GOOGLE_WORKSPACE_CONNECTOR,
      googleWorkspaceTokenParams(scope.userId)
    );
    const response = await fetchImpl(CALENDAR_TIMEZONE_SETTING_URL, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = calendarTimezoneSettingSchema.safeParse(body);
    return parsed.success ? parsed.data.value : null;
  } catch (error) {
    console.warn("[google-workspace] calendar timezone sync failed:", error);
    return null;
  }
}

/**
 * Best-effort, gated sync of the user's timezone from Google Calendar's
 * Settings API into `workspace_prefs`. Callers should already know the
 * connection state (from `getGoogleWorkspaceConnection`) and the current
 * timezone pref (from `getUserTimezonePref`) - both are cheap and often
 * already in hand at the call site - so this function does no DB or network
 * work beyond the writes described here.
 *
 * Returns the synced timezone when it was fetched and applied (i.e. it won
 * under `setUserTimezoneFromSource`'s precedence), otherwise null - including
 * when the sync was skipped, rate-limited, or Google's answer lost to a
 * higher-ranked source already on file.
 */
export async function syncGoogleCalendarTimezoneIfDue(
  scope: AccessScope,
  connectionState: "connected" | "disconnected" | "unavailable",
  pref: TimezonePref | null,
  client: GoogleWorkspaceClient = googleWorkspaceClient,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  if (connectionState !== "connected") return null;
  if (!shouldAttemptCalendarTimezoneSync(pref)) return null;
  if (!claimSyncAttempt(scope.workspaceId)) return null;

  const timezone = await fetchPrimaryCalendarTimezone(scope, client, fetchImpl);
  if (!timezone || !isValidTimeZone(timezone)) return null;

  const applied = await setUserTimezoneFromSource(
    scope.workspaceId,
    timezone,
    "google_calendar"
  );
  return applied ? timezone : null;
}

/**
 * Convenience wrapper for one-off call sites (e.g. right after the user
 * finishes connecting Google) that have a scope and connection state but
 * haven't already loaded the current pref.
 */
export async function syncGoogleCalendarTimezone(
  scope: AccessScope,
  connectionState: "connected" | "disconnected" | "unavailable"
): Promise<string | null> {
  const pref = await getUserTimezonePref(scope.workspaceId);
  return syncGoogleCalendarTimezoneIfDue(scope, connectionState, pref);
}
