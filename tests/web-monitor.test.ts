import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { ExaResult, ExaSearchOptions } from "@/lib/exa";
import type * as exaModule from "@/lib/exa";
import type { LinqJobOwner } from "@/lib/linq-target";
import * as schema from "../db/schema";

type ExaSearchFn = (
  query: string,
  numResults?: number,
  options?: ExaSearchOptions
) => Promise<ExaResult[]>;

const MIGRATIONS = [
  "0000_fluffy_the_spike.sql",
  "0001_better-auth.sql",
  "0002_workable_piledriver.sql",
  "0003_spooky_enchantress.sql",
  "0004_sour_masked_marvel.sql",
  "0005_classy_karma.sql",
  "0006_heavy_centennial.sql",
];

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.doUnmock("@/lib/exa");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

function owner(workspaceId: string): LinqJobOwner {
  return {
    workspaceId,
    ownerPrincipalId: `better-auth:${workspaceId}`,
    authenticator: "linq",
    issuer: null,
    linqThread: null,
    linqThreadId: null,
    ownerHandle: null,
  };
}

function result(url: string, publishedDate: string | null): ExaResult {
  return { url, title: url, publishedDate, text: null };
}

describe("parseSeen", () => {
  it("reads the current {url, publishedDate} shape", async () => {
    const { parseSeen } = await import("@/lib/web-monitor");
    expect(
      parseSeen(
        JSON.stringify([
          {
            url: "https://a.example",
            publishedDate: "2026-01-01T00:00:00.000Z",
          },
        ])
      )
    ).toEqual([
      { url: "https://a.example", publishedDate: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("is backward compatible with the pre-migration plain string[] shape", async () => {
    const { parseSeen } = await import("@/lib/web-monitor");
    expect(
      parseSeen(JSON.stringify(["https://a.example", "https://b.example"]))
    ).toEqual([
      { url: "https://a.example", publishedDate: null },
      { url: "https://b.example", publishedDate: null },
    ]);
  });

  it("returns an empty array for malformed or unexpected JSON", async () => {
    const { parseSeen } = await import("@/lib/web-monitor");
    expect(parseSeen("not json")).toEqual([]);
    expect(parseSeen('{"not":"an array"}')).toEqual([]);
    expect(parseSeen("[1, 2, 3]")).toEqual([]);
  });
});

describe("isAtMonitorCap", () => {
  it("caps at MONITOR_CAP (10)", async () => {
    const { MONITOR_CAP, isAtMonitorCap } = await import("@/lib/web-monitor");
    expect(MONITOR_CAP).toBe(10);
    expect(isAtMonitorCap(9)).toBe(false);
    expect(isAtMonitorCap(10)).toBe(true);
    expect(isAtMonitorCap(11)).toBe(true);
  });
});

describe("selectFreshResults (dedup + re-announcement)", () => {
  it("treats a never-seen URL as fresh", async () => {
    const { selectFreshResults } = await import("@/lib/web-monitor");
    const fresh = selectFreshResults("[]", [
      result("https://new.example", "2026-08-20T00:00:00.000Z"),
    ]);
    expect(fresh.map((r) => r.url)).toEqual(["https://new.example"]);
  });

  it("does not re-alert an unchanged seen URL", async () => {
    const { selectFreshResults } = await import("@/lib/web-monitor");
    const seen = JSON.stringify([
      { url: "https://a.example", publishedDate: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(
      selectFreshResults(seen, [
        result("https://a.example", "2026-08-01T00:00:00.000Z"),
      ])
    ).toEqual([]);
  });

  it("re-alerts when the published date genuinely advances (a tour page adds a date)", async () => {
    const { selectFreshResults } = await import("@/lib/web-monitor");
    const seen = JSON.stringify([
      { url: "https://a.example", publishedDate: "2026-08-01T00:00:00.000Z" },
    ]);
    const fresh = selectFreshResults(seen, [
      result("https://a.example", "2026-08-20T00:00:00.000Z"),
    ]);
    expect(fresh.map((r) => r.url)).toEqual(["https://a.example"]);
  });

  it("never re-alerts on a stale or earlier published date", async () => {
    const { selectFreshResults } = await import("@/lib/web-monitor");
    const seen = JSON.stringify([
      { url: "https://a.example", publishedDate: "2026-08-20T00:00:00.000Z" },
    ]);
    expect(
      selectFreshResults(seen, [
        result("https://a.example", "2026-08-01T00:00:00.000Z"),
      ])
    ).toEqual([]);
  });

  it("does not re-alert when either side is missing a published date (avoids noise)", async () => {
    const { selectFreshResults } = await import("@/lib/web-monitor");
    const seenNoDate = JSON.stringify([
      { url: "https://a.example", publishedDate: null },
    ]);
    expect(
      selectFreshResults(seenNoDate, [
        result("https://a.example", "2026-08-20T00:00:00.000Z"),
      ])
    ).toEqual([]);

    const seenWithDate = JSON.stringify([
      { url: "https://b.example", publishedDate: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(
      selectFreshResults(seenWithDate, [result("https://b.example", null)])
    ).toEqual([]);
  });

  it("is backward compatible with pre-migration plain string[] seen data (no baseline date, so it never re-alerts)", async () => {
    const { selectFreshResults } = await import("@/lib/web-monitor");
    const seen = JSON.stringify(["https://a.example"]);
    expect(
      selectFreshResults(seen, [
        result("https://a.example", "2026-08-20T00:00:00.000Z"),
      ])
    ).toEqual([]);
  });
});

describe("monitorSearch", () => {
  it("restricts Exa to results published within the trailing lookback window", async () => {
    const exaSearchMock = vi.fn<ExaSearchFn>(async () => []);
    const { monitors } = await withDatabase(exaSearchMock);

    await monitors.monitorSearch("j cole bay area shows");

    expect(exaSearchMock).toHaveBeenCalledTimes(1);
    const call = exaSearchMock.mock.calls[0];
    expect(call?.[0]).toBe("j cole bay area shows");
    expect(call?.[1]).toBe(10);
    const startPublishedDate = call?.[2]?.startPublishedDate;
    expect(typeof startPublishedDate).toBe("string");
    // Roughly a week back, not some huge or empty window.
    const ageMs = Date.now() - new Date(startPublishedDate ?? "").getTime();
    expect(ageMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1_000);
    expect(ageMs).toBeLessThan(8 * 24 * 60 * 60 * 1_000);
  }, 20_000);
});

describe("web monitor store", () => {
  it("enforces the per-workspace cap on create with an actionable error, and isolates workspaces", async () => {
    const exaSearchMock = vi.fn<ExaSearchFn>(async () => []);
    const { monitors } = await withDatabase(exaSearchMock);

    const alice = owner("workspace:alice");
    for (let i = 0; i < 10; i += 1) {
      await monitors.createWebMonitor(alice, `watch #${String(i)}`);
    }
    await expect(
      monitors.createWebMonitor(alice, "one too many")
    ).rejects.toThrow(/already has 10 active web monitors/u);

    // A different workspace has its own budget.
    const bobsMonitor = await monitors.createWebMonitor(
      owner("workspace:bob"),
      "bob's first monitor"
    );
    expect(typeof bobsMonitor.id).toBe("string");
  }, 20_000);

  it("seeds seenItemIds on creation, and a same-day rerun surfaces nothing", async () => {
    const seedResults: ExaResult[] = [
      result("https://a.example", "2026-08-20T00:00:00.000Z"),
      result("https://b.example", null),
    ];
    const exaSearchMock = vi.fn<ExaSearchFn>(async () => seedResults);
    const { database, monitors } = await withDatabase(exaSearchMock);

    const alice = owner("workspace:alice");
    const { id } = await monitors.createWebMonitor(alice, "watch this");

    const row = await getRow(database, id);
    expect(monitors.parseSeen(row.seenItemIds)).toEqual([
      { url: "https://a.example", publishedDate: "2026-08-20T00:00:00.000Z" },
      { url: "https://b.example", publishedDate: null },
    ]);

    // The dispatcher re-running the identical top results on day one must not
    // dump them at the user as "new".
    expect(monitors.selectFreshResults(row.seenItemIds, seedResults)).toEqual(
      []
    );
  }, 20_000);

  it("alerts only on genuinely new or updated results, and records them as seen", async () => {
    const exaSearchMock = vi.fn<ExaSearchFn>(async () => []);
    const { database, monitors } = await withDatabase(exaSearchMock);

    const alice = owner("workspace:alice");
    const { id } = await monitors.createWebMonitor(alice, "watch this");
    let row = await getRow(database, id);
    expect(monitors.parseSeen(row.seenItemIds)).toEqual([]);

    const dayTwoResults: ExaResult[] = [
      result("https://a.example", "2026-08-25T00:00:00.000Z"), // brand new
      result("https://b.example", null), // brand new, no date
    ];
    expect(
      monitors
        .selectFreshResults(row.seenItemIds, dayTwoResults)
        .map((r) => r.url)
    ).toEqual(["https://a.example", "https://b.example"]);
    await monitors.completeMonitorCheck(row, dayTwoResults);

    row = await getRow(database, id);
    expect(monitors.parseSeen(row.seenItemIds)).toEqual([
      { url: "https://a.example", publishedDate: "2026-08-25T00:00:00.000Z" },
      { url: "https://b.example", publishedDate: null },
    ]);

    // Day three: a's page is updated (later date) -> re-alerts. b is
    // unchanged and c is brand new.
    const dayThreeResults: ExaResult[] = [
      result("https://a.example", "2026-08-27T00:00:00.000Z"),
      result("https://b.example", null),
      result("https://c.example", "2026-08-27T00:00:00.000Z"),
    ];
    expect(
      monitors
        .selectFreshResults(row.seenItemIds, dayThreeResults)
        .map((r) => r.url)
        .sort()
    ).toEqual(["https://a.example", "https://c.example"]);
    await monitors.completeMonitorCheck(row, dayThreeResults);

    row = await getRow(database, id);
    expect(monitors.parseSeen(row.seenItemIds)).toEqual([
      { url: "https://a.example", publishedDate: "2026-08-27T00:00:00.000Z" },
      { url: "https://b.example", publishedDate: null },
      { url: "https://c.example", publishedDate: "2026-08-27T00:00:00.000Z" },
    ]);

    // Running the exact same day-three results again alerts on nothing.
    expect(
      monitors.selectFreshResults(row.seenItemIds, dayThreeResults)
    ).toEqual([]);
  }, 20_000);
});

async function getRow(database: Database, id: string) {
  const [row] = await database
    .select()
    .from(schema.webMonitors)
    .where(eq(schema.webMonitors.id, id));
  if (!row) throw new Error(`web monitor ${id} not found`);
  return row;
}

async function withDatabase(exaSearchMock: ExaSearchFn) {
  const client = new PGlite();
  databases.push(client);
  for (const name of MIGRATIONS) {
    const sqlText = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }

  const pgliteDatabase = drizzle(client, { schema });
  Object.assign(pgliteDatabase, {
    batch: async (queries: readonly { execute(): Promise<unknown> }[]) =>
      await Promise.all(queries.map(async (query) => await query.execute())),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = pgliteDatabase as unknown as Database;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("@/lib/exa", async () => {
    const actual = await vi.importActual<typeof exaModule>("@/lib/exa");
    return { ...actual, exaSearch: exaSearchMock };
  });

  const monitors = await import("@/lib/web-monitor");
  return { database, monitors };
}
