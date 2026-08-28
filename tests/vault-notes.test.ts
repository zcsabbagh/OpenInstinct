import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("vault notes store", () => {
  it("round-trips values, filters by category and label, and isolates workspaces", async () => {
    const vault = await loadVaultService();
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    const bob = { userId: "bob", workspaceId: "workspace:bob" };

    const flyer = await vault.createVaultNote(alice, {
      category: "loyalty",
      label: "United MileagePlus number",
      value: "UA123456",
    });
    await vault.createVaultNote(alice, {
      category: "travel",
      label: "Known Traveler Number",
      value: "KTN987654",
    });
    await vault.createVaultNote(bob, {
      category: "loyalty",
      label: "Delta SkyMiles number",
      value: "DL555000",
    });

    // write + read round-trip: the plaintext value comes back
    const all = await vault.listVaultNotes(alice);
    expect(all).toHaveLength(2);
    expect(all.map((note) => note.value)).toContain("UA123456");

    // category filter
    const loyalty = await vault.listVaultNotes(alice, { category: "loyalty" });
    expect(loyalty.map((note) => note.label)).toEqual([
      "United MileagePlus number",
    ]);

    // label substring filter (case-insensitive)
    const known = await vault.listVaultNotes(alice, {
      query: "known traveler",
    });
    expect(known.map((note) => note.value)).toEqual(["KTN987654"]);

    // workspace scoping: bob cannot see alice's notes and vice versa
    const bobNotes = await vault.listVaultNotes(bob);
    expect(bobNotes.map((note) => note.value)).toEqual(["DL555000"]);
    expect(
      await vault.listVaultNotes(bob, { category: "loyalty" })
    ).toHaveLength(1);

    // workspace scoping: bob cannot delete alice's note
    expect(await vault.deleteVaultNote(bob, flyer.id)).toBe(false);
    expect(await vault.listVaultNotes(alice)).toHaveLength(2);

    // owner can delete
    expect(await vault.deleteVaultNote(alice, flyer.id)).toBe(true);
    expect(await vault.listVaultNotes(alice)).toHaveLength(1);
  }, 15_000);
});

async function loadVaultService() {
  const client = new PGlite();
  databases.push(client);
  await applyVaultNotesMigration(client);

  const pgliteDatabase = drizzle(client, { schema });
  Object.assign(pgliteDatabase, {
    batch: async (queries: readonly { execute(): Promise<unknown> }[]) =>
      await Promise.all(queries.map(async (query) => await query.execute())),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = pgliteDatabase as unknown as Database;
  vi.doMock("@/db", () => ({ ...schema, db: database }));

  return import("@/db/services/vault");
}

async function applyVaultNotesMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../db/migrations/0006_heavy_centennial.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}
