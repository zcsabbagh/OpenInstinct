import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "../db/schema";

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

describe("invite code generation", () => {
  it("mints URL-safe eight-character codes with no ambiguous characters", async () => {
    const { generateInviteCode, isInviteCode } = await import("@/lib/invites");
    for (let i = 0; i < 100; i += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[a-z2-9]{8}$/u);
      expect(code).not.toMatch(/[01ilo]/u);
      expect(isInviteCode(code)).toBe(true);
    }
  });

  it("does not collide across a large sample", async () => {
    const { generateInviteCode } = await import("@/lib/invites");
    const codes = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) codes.add(generateInviteCode());
    expect(codes.size).toBe(20_000);
  });
});

describe("invite quota and redemption arithmetic", () => {
  it("caps mints at five", async () => {
    const { INVITE_CAP, isAtInviteCap, remainingInviteQuota } =
      await import("@/lib/invites");
    expect(INVITE_CAP).toBe(5);
    expect(remainingInviteQuota(0)).toBe(5);
    expect(remainingInviteQuota(4)).toBe(1);
    expect(remainingInviteQuota(5)).toBe(0);
    expect(remainingInviteQuota(9)).toBe(0);
    expect(isAtInviteCap(4)).toBe(false);
    expect(isAtInviteCap(5)).toBe(true);
  });

  it("counts only redeemed rows", async () => {
    const { countRedeemed } = await import("@/lib/invites");
    expect(
      countRedeemed([
        { redeemedAt: null },
        { redeemedAt: "2026-01-01T00:00:00.000Z" },
        { redeemedAt: null },
        { redeemedAt: "2026-02-02T00:00:00.000Z" },
      ])
    ).toBe(2);
    expect(countRedeemed([])).toBe(0);
  });
});

describe("invite store", () => {
  it("enforces the cap per issuer and counts redemptions", async () => {
    const invites = await withDatabase();

    const issuer = {
      issuerWorkspaceId: "workspace:alice",
      issuerPrincipalId: "better-auth:alice",
    };

    const minted: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await invites.mintInvite(issuer);
      minted.push(result.code);
    }
    expect(new Set(minted).size).toBe(5);
    await expect(invites.mintInvite(issuer)).rejects.toThrow(/maximum of 5/u);

    // A different issuer has their own budget.
    await expect(
      invites.mintInvite({
        issuerWorkspaceId: "workspace:bob",
        issuerPrincipalId: "better-auth:bob",
      })
    ).resolves.toMatchObject({ remaining: 4 });

    expect(await invites.anyInvitesExist()).toBe(true);
    expect(await invites.isHandleInvited("+12125550123")).toBe(false);

    const [firstCode = ""] = minted;
    expect(await invites.redeemInvite(firstCode, "+12125550123")).toBe(
      "redeemed"
    );
    expect(await invites.redeemInvite(firstCode, "+12125550999")).toBe(
      "already-redeemed"
    );
    expect(await invites.redeemInvite("zzzzzzzz", "+12125550123")).toBe(
      "not-found"
    );
    expect(await invites.isHandleInvited("+12125550123")).toBe(true);

    const rows = await invites.listInvitesForIssuer("workspace:alice");
    expect(rows).toHaveLength(5);
    expect(invites.countRedeemed(rows)).toBe(1);
  }, 20_000);
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

  return import("@/lib/invites");
}
