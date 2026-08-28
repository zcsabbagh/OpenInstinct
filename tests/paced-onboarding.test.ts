import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "../db/schema";

// Covers the two pieces of real failure-mode logic this task adds:
// - lib/durable-state.ts's incrementCounter, an atomic Postgres-backed
//   counter that must never lose or duplicate an increment under a race.
// - lib/paced-onboarding.ts's round-threshold + claimOnce guards, which
//   must send each of the round-3 contact card and round-5 Shortcut offer
//   at most once per workspace, even when the round counter jumps past a
//   threshold in one hop (a burst of messages, or a redelivered webhook).
// Deliberately does not assert on the sent copy itself - see
// tests/contact-card.test.ts and tests/shortcut-setup.test.ts, which cover
// formatting without pinning wording.

const MIGRATIONS = [
  "0000_fluffy_the_spike.sql",
  "0001_better-auth.sql",
  "0002_workable_piledriver.sql",
  "0003_spooky_enchantress.sql",
  "0004_sour_masked_marvel.sql",
  "0005_classy_karma.sql",
  // channel_state is created here; the migrations in between (vault_notes,
  // schedules recurrence columns) are additive and unrelated to this table.
  "0008_fast_captain_stacy.sql",
];

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  // Not vi.unstubAllEnvs(): that would also wipe the base required vars
  // tests/setup-env.ts stubs once for the whole file, which nothing here
  // re-stubs per test. Only MOUSE_SHORTCUT_URL is ever touched below, so
  // only it needs resetting - clearing it (emptyStringAsUndefined in
  // lib/env.ts treats "" as unset) keeps later tests independent of
  // whichever test last configured it.
  vi.stubEnv("MOUSE_SHORTCUT_URL", "");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function withDatabase() {
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
}

interface PostedMessage {
  markdown: string;
  attachments?: { data: Uint8Array; mimeType: string; name: string }[];
}

function fakeThread() {
  return {
    post: vi.fn<(message: PostedMessage) => Promise<void>>(() =>
      Promise.resolve()
    ),
  };
}

describe("incrementCounter", () => {
  it("starts at 1 and increments sequentially for the same namespace/key", async () => {
    await withDatabase();
    const { incrementCounter } = await import("@/lib/durable-state");
    expect(await incrementCounter("ns", "a")).toBe(1);
    expect(await incrementCounter("ns", "a")).toBe(2);
    expect(await incrementCounter("ns", "a")).toBe(3);
  });

  it("keeps counters independent across namespace/key pairs", async () => {
    await withDatabase();
    const { incrementCounter } = await import("@/lib/durable-state");
    expect(await incrementCounter("ns-a", "k")).toBe(1);
    expect(await incrementCounter("ns-b", "k")).toBe(1);
    expect(await incrementCounter("ns-a", "k")).toBe(2);
  });

  it("resolves concurrent increments to distinct, gapless values instead of losing one to the race", async () => {
    await withDatabase();
    const { incrementCounter } = await import("@/lib/durable-state");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => incrementCounter("ns", "race"))
    );
    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("nextRound", () => {
  it("counts per workspace independently", async () => {
    await withDatabase();
    const { nextRound } = await import("@/lib/paced-onboarding");
    expect(await nextRound("workspace:a")).toBe(1);
    expect(await nextRound("workspace:a")).toBe(2);
    expect(await nextRound("workspace:b")).toBe(1);
  });
});

describe("sendPacedOnboarding", () => {
  it("sends nothing before round 3", async () => {
    await withDatabase();
    const { sendPacedOnboarding } = await import("@/lib/paced-onboarding");
    const thread = fakeThread();
    await sendPacedOnboarding(thread, "workspace:a", 1);
    await sendPacedOnboarding(thread, "workspace:a", 2);
    expect(thread.post).not.toHaveBeenCalled();
  });

  it("sends the contact card on round 3 and not again on round 4", async () => {
    await withDatabase();
    const { sendPacedOnboarding } = await import("@/lib/paced-onboarding");
    const thread = fakeThread();
    await sendPacedOnboarding(thread, "workspace:a", 3);
    await sendPacedOnboarding(thread, "workspace:a", 4);
    expect(thread.post).toHaveBeenCalledTimes(1);
    const [message] = thread.post.mock.calls[0] ?? [];
    expect(message?.attachments).toHaveLength(1);
  });

  it("sends the contact card only once even when round 3 is reached by two concurrent calls (race / redelivered webhook)", async () => {
    await withDatabase();
    const { sendPacedOnboarding } = await import("@/lib/paced-onboarding");
    const thread = fakeThread();
    await Promise.all([
      sendPacedOnboarding(thread, "workspace:a", 3),
      sendPacedOnboarding(thread, "workspace:a", 3),
    ]);
    expect(thread.post).toHaveBeenCalledTimes(1);
  });

  it("still sends the contact card once when the round counter jumps straight past 3", async () => {
    await withDatabase();
    const { sendPacedOnboarding } = await import("@/lib/paced-onboarding");
    const thread = fakeThread();
    // A burst of messages (or a webhook redelivery collapsing several
    // rounds into one durable increment) can skip a round entirely - the
    // counter never equals exactly 3. A strict equality check would strand
    // the card forever; ">= threshold" still catches it.
    await sendPacedOnboarding(thread, "workspace:a", 4);
    expect(thread.post).toHaveBeenCalledTimes(1);
  });

  it("skips the Shortcut offer without a configured URL, leaving the guard unclaimed for a later message", async () => {
    await withDatabase();
    const { sendPacedOnboarding } = await import("@/lib/paced-onboarding");
    const { claimOnce } = await import("@/lib/durable-state");
    const thread = fakeThread();
    await sendPacedOnboarding(thread, "workspace:a", 5);
    // Only the contact card is sent - no MOUSE_SHORTCUT_URL means the
    // Shortcut offer is skipped entirely, not replaced with manual steps.
    expect(thread.post).toHaveBeenCalledTimes(1);
    // The guard was never claimed, so once a URL is configured a later
    // accepted message can still send the offer.
    expect(await claimOnce("linq-round-shortcut-offer", "workspace:a")).toBe(
      true
    );
  });

  it("sends the Shortcut offer once on round 5 when a Shortcut URL is configured", async () => {
    await withDatabase();
    vi.stubEnv("MOUSE_SHORTCUT_URL", "https://www.icloud.com/shortcuts/abc123");
    const { sendPacedOnboarding } = await import("@/lib/paced-onboarding");
    const thread = fakeThread();
    await sendPacedOnboarding(thread, "workspace:a", 5);
    expect(thread.post).toHaveBeenCalledTimes(2);
    const [, shortcutCall] = thread.post.mock.calls;
    expect(shortcutCall?.[0]?.markdown).toContain(
      "https://www.icloud.com/shortcuts/abc123"
    );

    await sendPacedOnboarding(thread, "workspace:a", 5);
    expect(thread.post).toHaveBeenCalledTimes(2);
  });
});
