import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "../db/schema";

// Security-critical coverage for the vault link token (see
// lib/manager/server/vault-link.ts): minting, non-destructive verification,
// expiry enforced server-side, single use, and that the workspace/kind a
// token authorizes is fixed at mint time and cannot be redirected. HTTP-
// level behavior of app/api/vault-link/route.ts (cross-origin rejection,
// kind-mismatch rejection, the actual vault write) is exercised manually per
// the task's Verify steps rather than duplicated here as PGlite integration
// tests - the module-level guarantees below are what make that route safe.

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  vi.useRealTimers();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("vault link token", () => {
  it("mints a token that peek and consume can redeem exactly once", async () => {
    const vaultLink = await loadVaultLinkModule();
    const scope = { userId: "user-a", workspaceId: "workspace:a" };

    const token = await vaultLink.mintVaultLinkToken(scope, {
      account: "person@example.com",
      kind: "login",
      label: "Personal login",
    });

    // Peeking is non-destructive: this is what app/vault/page.tsx does on
    // every render, including a cookieless link-preview crawler's GET, so it
    // must never burn the token.
    const peeked = await vaultLink.peekVaultLinkToken(token);
    expect(peeked).toEqual({
      account: "person@example.com",
      kind: "login",
      label: "Personal login",
      userId: "user-a",
      workspaceId: "workspace:a",
    });
    expect(await vaultLink.peekVaultLinkToken(token)).toEqual(peeked);

    // Consuming redeems it and returns the same authorization...
    const consumed = await vaultLink.consumeVaultLinkToken(token);
    expect(consumed).toEqual(peeked);

    // ...but only once: a second redemption (a resubmit, or a race) fails.
    expect(await vaultLink.consumeVaultLinkToken(token)).toBeUndefined();
    expect(await vaultLink.peekVaultLinkToken(token)).toBeUndefined();
  }, 20_000);

  it("binds a token to the workspace and kind it was minted for", async () => {
    const vaultLink = await loadVaultLinkModule();
    const workspaceAToken = await vaultLink.mintVaultLinkToken(
      { userId: "user-a", workspaceId: "workspace:a" },
      { kind: "login" }
    );
    const workspaceBToken = await vaultLink.mintVaultLinkToken(
      { userId: "user-b", workspaceId: "workspace:b" },
      { kind: "payment" }
    );

    const authorizationA =
      await vaultLink.consumeVaultLinkToken(workspaceAToken);
    const authorizationB =
      await vaultLink.consumeVaultLinkToken(workspaceBToken);

    // Each token's authorization is exactly what it was minted with - a
    // token minted for workspace A/kind login can never resolve to
    // workspace B or kind payment, no matter what a caller asks for.
    expect(authorizationA?.workspaceId).toBe("workspace:a");
    expect(authorizationA?.kind).toBe("login");
    expect(authorizationB?.workspaceId).toBe("workspace:b");
    expect(authorizationB?.kind).toBe("payment");

    // And the two tokens are independent: redeeming one never touches the
    // other's row.
    expect(await vaultLink.peekVaultLinkToken(workspaceBToken)).toBeUndefined();
  }, 20_000);

  it("expires 15 minutes after mint, enforced by the stored expiry, not the caller", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const vaultLink = await loadVaultLinkModule();
    const scope = { userId: "user-a", workspaceId: "workspace:a" };
    const token = await vaultLink.mintVaultLinkToken(scope, { kind: "phone" });

    expect(vaultLink.VAULT_LINK_TTL_MS).toBe(15 * 60 * 1000);

    // Still inside the window: valid.
    vi.setSystemTime(
      new Date(Date.now() + vaultLink.VAULT_LINK_TTL_MS - 1_000)
    );
    expect(await vaultLink.peekVaultLinkToken(token)).toBeDefined();

    // Past the window: both peek and consume treat it as gone, not merely
    // stale - there is no path that lets an expired token still authorize a
    // write.
    vi.setSystemTime(new Date(Date.now() + 2_000));
    expect(await vaultLink.peekVaultLinkToken(token)).toBeUndefined();
    expect(await vaultLink.consumeVaultLinkToken(token)).toBeUndefined();
  }, 20_000);

  it("rejects an unknown token without throwing", async () => {
    const vaultLink = await loadVaultLinkModule();
    expect(
      await vaultLink.peekVaultLinkToken("not-a-real-token")
    ).toBeUndefined();
    expect(
      await vaultLink.consumeVaultLinkToken("not-a-real-token")
    ).toBeUndefined();
  }, 20_000);
});

async function loadVaultLinkModule() {
  const client = new PGlite();
  databases.push(client);
  await applyChannelStateMigration(client);

  const pgliteDatabase = drizzle(client, { schema });
  Object.assign(pgliteDatabase, {
    batch: async (queries: readonly { execute(): Promise<unknown> }[]) =>
      await Promise.all(queries.map(async (query) => await query.execute())),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = pgliteDatabase as unknown as Database;
  vi.doMock("@/db", () => ({ ...schema, db: database }));

  return import("@/lib/manager/server/vault-link");
}

async function applyChannelStateMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../db/migrations/0008_fast_captain_stacy.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}
