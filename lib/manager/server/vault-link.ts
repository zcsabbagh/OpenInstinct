import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { peek, put, take } from "@/lib/durable-state";
import { vaultSetupKindSchema } from "..";

// Capability link for adding one vault item, texted to the user by Mouse.
//
// The token is a random, unguessable 256-bit value - not a signed, stateful
// claim about who the recipient is. It carries no data of its own; the
// `channel_state` row it names (via `lib/durable-state.ts`'s namespaced
// put/peek/take) is the sole source of truth for who minted it, which
// workspace it can write to, and which vault kind it is good for. That
// row's `expiresAt` is enforced server-side by `take`/`peek`, never by the
// client.
//
// This is deliberately not a signed JWT-style stateless token. Single-use
// enforcement needs a server-side record no matter what the token looks
// like - a stateless token still needs a "have I seen this jti" table to be
// single-use - so the usual reason to prefer stateless (skip the DB
// round-trip) doesn't apply here. Once state is required anyway, an opaque
// token stored in the table already built for small short-lived records
// makes single-use trivial (one atomic DELETE ... RETURNING) and keeps the
// URL short, with no HMAC/signature code to get right.
const NAMESPACE = "vault-link";

// The link must stop working 15 minutes after Mouse sends it. Kept as a
// named constant, not inlined, because the window is a product choice (see
// the tool description in agent/tools/request_vault_setup.ts) that may need
// to change independent of the token plumbing around it.
export const VAULT_LINK_TTL_MS = 15 * 60 * 1000;

const vaultLinkPayloadSchema = z.object({
  account: z.string(),
  kind: vaultSetupKindSchema,
  label: z.string(),
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
});

export type VaultLinkPayload = z.infer<typeof vaultLinkPayloadSchema>;

/**
 * Mints a single-use, workspace- and kind-scoped vault link token for
 * `scope`. Returns the opaque token to embed in the URL.
 */
export async function mintVaultLinkToken(
  scope: AccessScope,
  request: {
    readonly account?: string;
    readonly kind: VaultLinkPayload["kind"];
    readonly label?: string;
  }
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const payload: VaultLinkPayload = {
    account: request.account ?? "",
    kind: request.kind,
    label: request.label ?? "",
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  };
  await put(NAMESPACE, token, JSON.stringify(payload), {
    ttlMs: VAULT_LINK_TTL_MS,
  });
  return token;
}

/**
 * Non-destructive check: does `token` still name a live, unexpired link?
 * Safe to call on every page render, including an automated link-preview
 * fetch, because it never consumes the token.
 */
export async function peekVaultLinkToken(
  token: string
): Promise<VaultLinkPayload | undefined> {
  return parsePayload(await peek(NAMESPACE, token));
}

/**
 * Atomically redeems `token`: if it is still live, removes it (so it can
 * never be redeemed again) and returns the scope/kind it authorizes. Call
 * this only at the moment of a successful write, never on render - see the
 * module comment above.
 */
export async function consumeVaultLinkToken(
  token: string
): Promise<VaultLinkPayload | undefined> {
  return parsePayload(await take(NAMESPACE, token));
}

function parsePayload(raw: string | undefined): VaultLinkPayload | undefined {
  if (raw === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = vaultLinkPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
