import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { ToolContext } from "eve/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { isValidTimeZone } from "@/lib/schedule-time";
import * as schema from "../db/schema";

// Root cause (agent/channels/linq.ts, agent/tools/create_schedule.ts): the
// only writer of workspace_prefs.timezone was create_schedule, and only when
// the model happened to pass one while scheduling. These tests cover the two
// new writers - the browser-report endpoint's persistence path
// (app/api/timezone/route.ts, exercised here at the lib/user-prefs level it
// calls) and the set_timezone tool - and the IANA validation both reuse from
// lib/schedule-time instead of a parallel check.

const MIGRATIONS = [
  "0000_fluffy_the_spike.sql",
  "0001_better-auth.sql",
  "0002_workable_piledriver.sql",
  "0003_spooky_enchantress.sql",
  "0004_sour_masked_marvel.sql",
  "0005_classy_karma.sql",
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
    const { getUserTimezone, setUserTimezone } =
      await import("@/lib/user-prefs");

    await setUserTimezone("workspace:alice", "America/Chicago");
    expect(await getUserTimezone("workspace:alice")).toBe("America/Chicago");

    // A later report (e.g. the user travels) overwrites cleanly.
    await setUserTimezone("workspace:alice", "America/Los_Angeles");
    expect(await getUserTimezone("workspace:alice")).toBe(
      "America/Los_Angeles"
    );
  }, 15_000);

  it("keeps workspaces isolated", async () => {
    await setUpDatabase();
    const { getUserTimezone, setUserTimezone } =
      await import("@/lib/user-prefs");

    await setUserTimezone("workspace:alice", "America/Chicago");
    expect(await getUserTimezone("workspace:bob")).toBeNull();
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
    const { getUserTimezone } = await import("@/lib/user-prefs");
    const { default: setTimezoneTool } =
      await import("@/agent/tools/set_timezone");

    const result = await setTimezoneTool.execute(
      { timezone: "America/Chicago" },
      fakeCtx("workspace:dave")
    );
    expect(result).toEqual({ saved: true, timezone: "America/Chicago" });
    expect(await getUserTimezone("workspace:dave")).toBe("America/Chicago");
  }, 15_000);
});
