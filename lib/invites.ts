import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  chats,
  db,
  invites,
  schedules,
  vaultItems,
  webMonitors,
  workspacePrefs,
} from "@/db";

// Invite-link front door. Each existing user can mint up to `INVITE_CAP` links
// (total, redeemed or not). Redemption records the invitee's normalized handle
// so the Linq gate in `agent/channels/linq.ts` can let them through.

export const INVITE_CAP = 5;

// URL-safe, unambiguous alphabet: no 0/o, 1/l/i. 8 chars => 31^8 ≈ 8.5e11.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;
const CODE_PATTERN = /^[a-z2-9]{8}$/u;
const MINT_ATTEMPTS = 5;

export type InviteRow = typeof invites.$inferSelect;

export type RedeemInviteResult = "redeemed" | "already-redeemed" | "not-found";

export function generateInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    code += CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length);
  }
  return code;
}

export function isInviteCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

/** Links the caller may still mint. */
export function remainingInviteQuota(mintedCount: number): number {
  return Math.max(0, INVITE_CAP - mintedCount);
}

export function isAtInviteCap(mintedCount: number): boolean {
  return mintedCount >= INVITE_CAP;
}

/** How many of the caller's links have actually been redeemed. */
export function countRedeemed(
  rows: readonly Pick<InviteRow, "redeemedAt">[]
): number {
  return rows.filter((row) => row.redeemedAt != null).length;
}

async function countMintedByIssuer(issuerWorkspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invites)
    .where(eq(invites.issuerWorkspaceId, issuerWorkspaceId));
  return row?.count ?? 0;
}

export async function mintInvite(issuer: {
  issuerWorkspaceId: string;
  issuerPrincipalId: string;
}): Promise<{ code: string; createdAt: string; remaining: number }> {
  const mintedCount = await countMintedByIssuer(issuer.issuerWorkspaceId);
  if (isAtInviteCap(mintedCount)) {
    throw new Error(
      `You have already created the maximum of ${String(INVITE_CAP)} invites.`
    );
  }

  const createdAt = new Date().toISOString();
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
    const code = generateInviteCode();
    const [inserted] = await db
      .insert(invites)
      .values({
        code,
        issuerWorkspaceId: issuer.issuerWorkspaceId,
        issuerPrincipalId: issuer.issuerPrincipalId,
        createdAt,
      })
      .onConflictDoNothing({ target: invites.code })
      .returning({ code: invites.code });
    if (inserted) {
      return {
        code: inserted.code,
        createdAt,
        remaining: remainingInviteQuota(mintedCount + 1),
      };
    }
  }
  throw new Error("Could not generate a unique invite code. Try again.");
}

export function listInvitesForIssuer(
  issuerWorkspaceId: string
): Promise<InviteRow[]> {
  return db
    .select()
    .from(invites)
    .where(eq(invites.issuerWorkspaceId, issuerWorkspaceId))
    .orderBy(sql`${invites.createdAt} desc`);
}

export async function getInvite(code: string): Promise<InviteRow | undefined> {
  const [row] = await db
    .select()
    .from(invites)
    .where(eq(invites.code, code))
    .limit(1);
  return row;
}

/**
 * Marks an invite redeemed by `handle` (a normalized E.164 phone). Idempotent
 * per code: a second redemption of the same code reports `already-redeemed`.
 */
export async function redeemInvite(
  code: string,
  handle: string
): Promise<RedeemInviteResult> {
  const existing = await getInvite(code);
  if (!existing) return "not-found";
  if (existing.redeemedAt != null) return "already-redeemed";

  const [updated] = await db
    .update(invites)
    .set({ redeemedAt: new Date().toISOString(), redeemedByHandle: handle })
    .where(and(eq(invites.code, code), isNull(invites.redeemedAt)))
    .returning({ code: invites.code });
  return updated ? "redeemed" : "already-redeemed";
}

/** Fail-open signal: with no invites minted anywhere, the gate stays open. */
export async function anyInvitesExist(): Promise<boolean> {
  const [row] = await db.select({ code: invites.code }).from(invites).limit(1);
  return row != null;
}

export async function isHandleInvited(handle: string): Promise<boolean> {
  const [row] = await db
    .select({ code: invites.code })
    .from(invites)
    .where(eq(invites.redeemedByHandle, handle))
    .limit(1);
  return row != null;
}

/**
 * True when the workspace already has any first-party footprint: a saved
 * timezone/intro flag, a chat, a reminder, a monitor, or a vault item. Used so
 * the gate never locks out someone who was already using Mouse before the gate
 * was switched on.
 */
export async function workspaceHasActivity(
  workspaceId: string
): Promise<boolean> {
  const probes = await Promise.all([
    db
      .select({ id: workspacePrefs.workspaceId })
      .from(workspacePrefs)
      .where(eq(workspacePrefs.workspaceId, workspaceId))
      .limit(1),
    db
      .select({ id: chats.sessionId })
      .from(chats)
      .where(eq(chats.workspaceId, workspaceId))
      .limit(1),
    db
      .select({ id: schedules.id })
      .from(schedules)
      .where(eq(schedules.workspaceId, workspaceId))
      .limit(1),
    db
      .select({ id: webMonitors.id })
      .from(webMonitors)
      .where(eq(webMonitors.workspaceId, workspaceId))
      .limit(1),
    db
      .select({ id: vaultItems.id })
      .from(vaultItems)
      .where(eq(vaultItems.workspaceId, workspaceId))
      .limit(1),
  ]);
  return probes.some((rows) => rows.length > 0);
}
