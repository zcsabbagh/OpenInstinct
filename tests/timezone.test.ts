import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { ConnectTokenResponse } from "@vercel/connect";
import { drizzle } from "drizzle-orm/pglite";
import type { ToolContext } from "eve/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { GoogleWorkspaceClient } from "@/lib/google-workspace/server";
import { isValidTimeZone } from "@/lib/schedule-time";
import * as schema from "../db/schema";

// Root cause (agent/channels/linq.ts, agent/tools/create_schedule.ts): the
// only writer of workspace_prefs.timezone was create_schedule, and only when
// the model happened to pass one while scheduling. These tests cover every
// writer that funnels through `setUserTimezoneFromSource`
// (lib/user-prefs.ts) - the browser-report endpoint's persistence path
// (app/api/timezone/route.ts), the set_timezone tool, and the Google
// Calendar sync (lib/google-workspace/calendar-timezone.ts) - the precedence
// rule between them, and the IANA validation all of them reuse from
// lib/schedule-time instead of a parallel check.

const MIGRATIONS = [
  "0000_fluffy_the_spike.sql",
  "0001_better-auth.sql",
  "0002_workable_piledriver.sql",
  "0003_spooky_enchantress.sql",
  "0004_sour_masked_marvel.sql",
  "0005_classy_karma.sql",
  "0009_awesome_kang.sql",
];

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function setUpDatabase() {
  const client = new PGlite();
  databases.push(client);
  for (const migration of MIGRATIONS) {
    const sql = await readFile(
      new URL(`../db/migrations/${migration}`, import.meta.url),
      "utf8"
    );
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }

  const pgliteDatabase = drizzle(client, { schema });
  Object.assign(pgliteDatabase, {
    batch: async (queries: readonly { execute(): Promise<unknown> }[]) =>
      await Promise.all(queries.map(async (query) => await query.execute())),
  });
  // Production uses Neon's Drizzle adapter. PGlite exposes compatible
  // PostgreSQL query builders and this test supplies Neon's batch hook.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = pgliteDatabase as unknown as Database;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
}

describe("IANA timezone validation", () => {
  it("accepts real IANA zones and rejects everything else", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Not/A/Zone")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("timezone persistence", () => {
  it("starts unset, and is nagged about until something writes it", async () => {
    await setUpDatabase();
    const { getUserTimezone } = await import("@/lib/user-prefs");
    expect(await getUserTimezone("workspace:new")).toBeNull();
  }, 15_000);

  it("persists a browser-reported timezone (app/api/timezone's write path)", async () => {
    await setUpDatabase();
    const { getUserTimezone, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/Chicago",
      "browser"
    );
    expect(await getUserTimezone("workspace:alice")).toBe("America/Chicago");

    // A later report from the same source (e.g. the user travels, before
    // Google Calendar is connected) overwrites cleanly.
    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/Los_Angeles",
      "browser"
    );
    expect(await getUserTimezone("workspace:alice")).toBe(
      "America/Los_Angeles"
    );
  }, 15_000);

  it("keeps workspaces isolated", async () => {
    await setUpDatabase();
    const { getUserTimezone, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/Chicago",
      "browser"
    );
    expect(await getUserTimezone("workspace:bob")).toBeNull();
  }, 15_000);
});

describe("timezone source precedence", () => {
  it("lets a new workspace's first write through regardless of source", async () => {
    await setUpDatabase();
    const { getUserTimezonePref, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await expect(
      setUserTimezoneFromSource("workspace:new", "America/Chicago", "browser")
    ).resolves.toBe(true);
    expect(await getUserTimezonePref("workspace:new")).toMatchObject({
      source: "browser",
      timezone: "America/Chicago",
    });
  }, 15_000);

  it("lets Google Calendar upgrade a browser-sourced value", async () => {
    await setUpDatabase();
    const { getUserTimezonePref, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/Chicago",
      "browser"
    );
    await expect(
      setUserTimezoneFromSource(
        "workspace:alice",
        "America/New_York",
        "google_calendar"
      )
    ).resolves.toBe(true);
    expect(await getUserTimezonePref("workspace:alice")).toMatchObject({
      source: "google_calendar",
      timezone: "America/New_York",
    });
  }, 15_000);

  it("does not let the browser clobber a Google Calendar value", async () => {
    await setUpDatabase();
    const { getUserTimezonePref, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/New_York",
      "google_calendar"
    );
    // The device is somewhere else mid-trip - the browser still reports it,
    // but it must not win.
    await expect(
      setUserTimezoneFromSource("workspace:alice", "Asia/Tokyo", "browser")
    ).resolves.toBe(false);
    expect(await getUserTimezonePref("workspace:alice")).toMatchObject({
      source: "google_calendar",
      timezone: "America/New_York",
    });
  }, 15_000);

  it("does not let Google Calendar clobber a value the user explicitly stated", async () => {
    await setUpDatabase();
    const { getUserTimezonePref, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/Chicago",
      "user_stated"
    );
    await expect(
      setUserTimezoneFromSource(
        "workspace:alice",
        "America/New_York",
        "google_calendar"
      )
    ).resolves.toBe(false);
    expect(await getUserTimezonePref("workspace:alice")).toMatchObject({
      source: "user_stated",
      timezone: "America/Chicago",
    });
  }, 15_000);

  it("always lets an explicit statement win, even over Google Calendar", async () => {
    await setUpDatabase();
    const { getUserTimezonePref, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/New_York",
      "google_calendar"
    );
    await expect(
      setUserTimezoneFromSource(
        "workspace:alice",
        "America/Chicago",
        "user_stated"
      )
    ).resolves.toBe(true);
    expect(await getUserTimezonePref("workspace:alice")).toMatchObject({
      source: "user_stated",
      timezone: "America/Chicago",
    });
  }, 15_000);

  it("lets a source refresh its own previous value", async () => {
    await setUpDatabase();
    const { getUserTimezonePref, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");

    await setUserTimezoneFromSource(
      "workspace:alice",
      "America/New_York",
      "google_calendar"
    );
    await expect(
      setUserTimezoneFromSource(
        "workspace:alice",
        "Europe/London",
        "google_calendar"
      )
    ).resolves.toBe(true);
    expect(await getUserTimezonePref("workspace:alice")).toMatchObject({
      source: "google_calendar",
      timezone: "Europe/London",
    });
  }, 15_000);
});

describe("set_timezone tool", () => {
  function fakeCtx(workspaceId: string) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stand-in for eve's ToolContext; the tool only reads ctx.session.auth via resolveLinqJobOwner
    return {
      session: {
        auth: {
          current: {
            principalType: "user",
            principalId: `better-auth:${workspaceId}`,
            authenticator: "linq",
            issuer: null,
            attributes: { workspaceId },
          },
          initiator: undefined,
        },
      },
    } as unknown as ToolContext;
  }

  it("rejects an invalid timezone without writing anything", async () => {
    await setUpDatabase();
    const { getUserTimezone } = await import("@/lib/user-prefs");
    const { default: setTimezoneTool } =
      await import("@/agent/tools/set_timezone");

    await expect(
      setTimezoneTool.execute(
        { timezone: "Mars/Olympus_Mons" },
        fakeCtx("workspace:carol")
      )
    ).rejects.toThrow(/not a valid IANA timezone/);
    expect(await getUserTimezone("workspace:carol")).toBeNull();
  }, 15_000);

  it("saves a valid timezone the user stated in chat", async () => {
    await setUpDatabase();
    const { getUserTimezone, getUserTimezonePref } =
      await import("@/lib/user-prefs");
    const { default: setTimezoneTool } =
      await import("@/agent/tools/set_timezone");

    const result = await setTimezoneTool.execute(
      { timezone: "America/Chicago" },
      fakeCtx("workspace:dave")
    );
    expect(result).toEqual({ saved: true, timezone: "America/Chicago" });
    expect(await getUserTimezone("workspace:dave")).toBe("America/Chicago");
    expect(await getUserTimezonePref("workspace:dave")).toMatchObject({
      source: "user_stated",
    });
  }, 15_000);

  it("outranks an existing Google Calendar value", async () => {
    await setUpDatabase();
    const { getUserTimezonePref, setUserTimezoneFromSource } =
      await import("@/lib/user-prefs");
    const { default: setTimezoneTool } =
      await import("@/agent/tools/set_timezone");

    await setUserTimezoneFromSource(
      "workspace:erin",
      "America/New_York",
      "google_calendar"
    );
    await setTimezoneTool.execute(
      { timezone: "America/Chicago" },
      fakeCtx("workspace:erin")
    );
    expect(await getUserTimezonePref("workspace:erin")).toMatchObject({
      source: "user_stated",
      timezone: "America/Chicago",
    });
  }, 15_000);
});

describe("Google Calendar timezone sync", () => {
  function fakeClient(
    result: ConnectTokenResponse | Error
  ): GoogleWorkspaceClient {
    return {
      async getTokenResponse() {
        if (result instanceof Error) throw result;
        return result;
      },
      revokeToken: () => Promise.resolve(),
      async startAuthorization() {
        return {
          request: "request",
          url: "https://example.com",
          verifier: "v",
        };
      },
    };
  }

  const scope = { userId: "better-auth:frank", workspaceId: "workspace:frank" };
  const tokenResponse: ConnectTokenResponse = {
    connector: { id: "id", type: "oauth", uid: "google/test" },
    expiresAt: Date.now() + 60_000,
    token: "token",
  };

  function jsonResponse(body: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }

  it("does nothing when Google isn't connected", async () => {
    await setUpDatabase();
    const { getUserTimezonePref } = await import("@/lib/user-prefs");
    const { syncGoogleCalendarTimezoneIfDue } =
      await import("@/lib/google-workspace/calendar-timezone");

    const fetchImpl = vi.fn<typeof fetch>();
    const result = await syncGoogleCalendarTimezoneIfDue(
      scope,
      "disconnected",
      null,
      fakeClient(tokenResponse),
      fetchImpl
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await getUserTimezonePref(scope.workspaceId)).toBeNull();
  }, 15_000);

  it("fetches and stores the Calendar Settings timezone when nothing is on file", async () => {
    await setUpDatabase();
    const { getUserTimezonePref } = await import("@/lib/user-prefs");
    const { syncGoogleCalendarTimezoneIfDue } =
      await import("@/lib/google-workspace/calendar-timezone");

    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ value: "America/Denver" })
    );
    const result = await syncGoogleCalendarTimezoneIfDue(
      scope,
      "connected",
      null,
      fakeClient(tokenResponse),
      fetchImpl
    );
    expect(result).toBe("America/Denver");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/users/me/settings/timezone",
      expect.anything()
    );
    expect(await getUserTimezonePref(scope.workspaceId)).toMatchObject({
      source: "google_calendar",
      timezone: "America/Denver",
    });
  }, 15_000);

  it("skips the API call entirely once an explicit statement is on file", async () => {
    await setUpDatabase();
    const { setUserTimezoneFromSource, getUserTimezonePref } =
      await import("@/lib/user-prefs");
    const { syncGoogleCalendarTimezoneIfDue } =
      await import("@/lib/google-workspace/calendar-timezone");

    await setUserTimezoneFromSource(
      scope.workspaceId,
      "America/Chicago",
      "user_stated"
    );
    const pref = await getUserTimezonePref(scope.workspaceId);
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ value: "Asia/Tokyo" })
    );

    const result = await syncGoogleCalendarTimezoneIfDue(
      scope,
      "connected",
      pref,
      fakeClient(tokenResponse),
      fetchImpl
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await getUserTimezonePref(scope.workspaceId)).toMatchObject({
      source: "user_stated",
      timezone: "America/Chicago",
    });
  }, 15_000);

  it("skips a fresh Google Calendar value instead of re-fetching every call", async () => {
    await setUpDatabase();
    const { setUserTimezoneFromSource, getUserTimezonePref } =
      await import("@/lib/user-prefs");
    const { syncGoogleCalendarTimezoneIfDue } =
      await import("@/lib/google-workspace/calendar-timezone");

    await setUserTimezoneFromSource(
      scope.workspaceId,
      "America/Denver",
      "google_calendar"
    );
    const pref = await getUserTimezonePref(scope.workspaceId);
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ value: "Asia/Tokyo" })
    );

    const result = await syncGoogleCalendarTimezoneIfDue(
      scope,
      "connected",
      pref,
      fakeClient(tokenResponse),
      fetchImpl
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  }, 15_000);

  it("re-checks a stale Google Calendar value", async () => {
    await setUpDatabase();
    const { getUserTimezonePref } = await import("@/lib/user-prefs");
    const { syncGoogleCalendarTimezoneIfDue } =
      await import("@/lib/google-workspace/calendar-timezone");

    const staleUpdatedAt = new Date(
      Date.now() - 25 * 60 * 60 * 1000
    ).toISOString();
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ value: "Asia/Tokyo" })
    );

    const result = await syncGoogleCalendarTimezoneIfDue(
      scope,
      "connected",
      {
        source: "google_calendar",
        timezone: "America/Denver",
        updatedAt: staleUpdatedAt,
      },
      fakeClient(tokenResponse),
      fetchImpl
    );
    expect(result).toBe("Asia/Tokyo");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await getUserTimezonePref(scope.workspaceId)).toMatchObject({
      source: "google_calendar",
      timezone: "Asia/Tokyo",
    });
  }, 15_000);

  it("discards a non-IANA value Google returns instead of storing garbage", async () => {
    await setUpDatabase();
    const { getUserTimezonePref } = await import("@/lib/user-prefs");
    const { syncGoogleCalendarTimezoneIfDue } =
      await import("@/lib/google-workspace/calendar-timezone");

    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ value: "Not/A/Zone" })
    );
    const result = await syncGoogleCalendarTimezoneIfDue(
      scope,
      "connected",
      null,
      fakeClient(tokenResponse),
      fetchImpl
    );
    expect(result).toBeNull();
    expect(await getUserTimezonePref(scope.workspaceId)).toBeNull();
  }, 15_000);

  it("fails soft when the token fetch throws", async () => {
    await setUpDatabase();
    const { getUserTimezonePref } = await import("@/lib/user-prefs");
    const { syncGoogleCalendarTimezoneIfDue } =
      await import("@/lib/google-workspace/calendar-timezone");

    const fetchImpl = vi.fn<typeof fetch>();
    const result = await syncGoogleCalendarTimezoneIfDue(
      scope,
      "connected",
      null,
      fakeClient(new Error("no valid token")),
      fetchImpl
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await getUserTimezonePref(scope.workspaceId)).toBeNull();
  }, 15_000);
});
