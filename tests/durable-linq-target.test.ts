import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { LinqJobOwner } from "@/lib/linq-target";
import * as schema from "../db/schema";

// Covers the two pieces of real logic this task adds: the generic
// putState/getState upsert-and-read primitive channel_state now supports
// alongside claimOnce (lib/durable-state.ts), and the per-workspace Linq
// delivery target built on top of it (lib/linq-target.ts). Both back the
// idempotency guard in lib/google-connect-notify.ts that stops the
// post-connect message from ever sending twice. Deliberately does not
// assert on the message copy itself - that wording will change and pinning
// it here would only add maintenance cost.

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

function owner(workspaceId: string, thread: string | null): LinqJobOwner {
  return {
    authenticator: "linq",
    issuer: null,
    linqThread: thread,
    ownerHandle: "+12125550123",
    ownerPrincipalId: `linq:${workspaceId}`,
    workspaceId,
  };
}

describe("putState / getState", () => {
  it("returns null for a key that was never written", async () => {
    await withDatabase();
    const { getState } = await import("@/lib/durable-state");
    expect(await getState("ns", "missing")).toBeNull();
  });

  it("round-trips a written value", async () => {
    await withDatabase();
    const { getState, putState } = await import("@/lib/durable-state");
    await putState("ns", "a", "hello");
    expect(await getState("ns", "a")).toBe("hello");
  });

  it("overwrites on a second write to the same key, unlike claimOnce", async () => {
    await withDatabase();
    const { getState, putState } = await import("@/lib/durable-state");
    await putState("ns", "a", "first");
    await putState("ns", "a", "second");
    expect(await getState("ns", "a")).toBe("second");
  });

  it("treats an expired row as absent", async () => {
    await withDatabase();
    const { getState, putState } = await import("@/lib/durable-state");
    await putState("ns", "a", "stale", { ttlMs: -1_000 });
    expect(await getState("ns", "a")).toBeNull();
  });

  it("keeps namespaces independent for the same key", async () => {
    await withDatabase();
    const { getState, putState } = await import("@/lib/durable-state");
    await putState("ns-a", "same-key", "from a");
    await putState("ns-b", "same-key", "from b");
    expect(await getState("ns-a", "same-key")).toBe("from a");
    expect(await getState("ns-b", "same-key")).toBe("from b");
  });
});

describe("claimOnce", () => {
  it("claims a key exactly once", async () => {
    await withDatabase();
    const { claimOnce } = await import("@/lib/durable-state");
    expect(await claimOnce("ns", "key-1")).toBe(true);
    expect(await claimOnce("ns", "key-1")).toBe(false);
    expect(await claimOnce("ns", "key-1")).toBe(false);
  });

  it("does not let one namespace's claim block another's identical key", async () => {
    await withDatabase();
    const { claimOnce } = await import("@/lib/durable-state");
    expect(await claimOnce("ns-a", "same-key")).toBe(true);
    expect(await claimOnce("ns-b", "same-key")).toBe(true);
  });
});

describe("saveDurableLinqTarget / loadDurableLinqTarget", () => {
  it("returns null for a workspace that has never sent an inbound message", async () => {
    await withDatabase();
    const { loadDurableLinqTarget } = await import("@/lib/linq-target");
    expect(await loadDurableLinqTarget("workspace:new")).toBeNull();
  });

  it("round-trips a saved target", async () => {
    await withDatabase();
    const { loadDurableLinqTarget, saveDurableLinqTarget } =
      await import("@/lib/linq-target");
    const target = owner("workspace:a", JSON.stringify({ id: "thread-1" }));
    await saveDurableLinqTarget(target);
    expect(await loadDurableLinqTarget("workspace:a")).toEqual(target);
  });

  it("keeps the latest thread when a workspace texts in again", async () => {
    await withDatabase();
    const { loadDurableLinqTarget, saveDurableLinqTarget } =
      await import("@/lib/linq-target");
    await saveDurableLinqTarget(
      owner("workspace:a", JSON.stringify({ id: "thread-old" }))
    );
    await saveDurableLinqTarget(
      owner("workspace:a", JSON.stringify({ id: "thread-new" }))
    );
    const loaded = await loadDurableLinqTarget("workspace:a");
    expect(loaded?.linqThread).toBe(JSON.stringify({ id: "thread-new" }));
  });

  it("keeps two workspaces' targets independent", async () => {
    await withDatabase();
    const { loadDurableLinqTarget, saveDurableLinqTarget } =
      await import("@/lib/linq-target");
    await saveDurableLinqTarget(owner("workspace:a", "thread-a"));
    await saveDurableLinqTarget(owner("workspace:b", "thread-b"));
    expect((await loadDurableLinqTarget("workspace:a"))?.linqThread).toBe(
      "thread-a"
    );
    expect((await loadDurableLinqTarget("workspace:b"))?.linqThread).toBe(
      "thread-b"
    );
  });

  it("treats a corrupted stored record as absent instead of throwing", async () => {
    await withDatabase();
    const { putState } = await import("@/lib/durable-state");
    const { loadDurableLinqTarget } = await import("@/lib/linq-target");
    await putState("linq-target", "workspace:bad", "not json");
    expect(await loadDurableLinqTarget("workspace:bad")).toBeNull();

    await putState(
      "linq-target",
      "workspace:missing-fields",
      JSON.stringify({ workspaceId: "workspace:missing-fields" })
    );
    expect(await loadDurableLinqTarget("workspace:missing-fields")).toBeNull();
  });
});
