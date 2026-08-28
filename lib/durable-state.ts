import { and, eq, gt, isNull, or } from "drizzle-orm";
import { channelState, db } from "@/db";

// Durable, Postgres-backed replacement for the bookkeeping a Chat SDK channel
// normally keeps in an in-memory `StateAdapter` (see
// `node_modules/eve/docs/channels/chat-sdk.mdx`). eve's `linqChannel` wrapper
// (`agent/channels/linq.ts`) hardcodes `createMemoryState()` internally with
// no config option to override it - checked against both the installed eve
// version and the latest release - so the Chat SDK state that normally
// survives a restart cannot be swapped from application code for this
// channel. This module owns the slice of that problem application code can
// still reach: idempotent, namespaced "claim once" rows backed by the
// Postgres this project already runs (no new vendor, no new env var).
//
// The `channel_state` table's namespace/key/value shape is intentionally
// generic: it is meant to double as the pending human-in-the-loop
// request map ({requestId, sessionId, threadId}) a later change adds for the
// iMessage channel, so that feature can reuse this table without a schema
// change.

/**
 * Atomically claims `key` within `namespace`. Returns `true` the first time a
 * given namespace/key pair is claimed, `false` on every later call - useful
 * for making an at-least-once delivery (like a redelivered webhook) idempotent.
 *
 * `ttlMs`, when supplied, only marks the row eligible for future pruning; a
 * claim is never released early, since a message id (for example) should
 * never legitimately be reclaimed.
 */
export async function claimOnce(
  namespace: string,
  key: string,
  options?: { ttlMs?: number }
): Promise<boolean> {
  const now = new Date();
  const expiresAt = options?.ttlMs
    ? new Date(now.getTime() + options.ttlMs).toISOString()
    : null;
  const inserted = await db
    .insert(channelState)
    .values({
      namespace,
      key,
      createdAt: now.toISOString(),
      expiresAt,
    })
    .onConflictDoNothing({
      target: [channelState.namespace, channelState.key],
    })
    .returning({ key: channelState.key });
  return inserted.length > 0;
}

/**
 * Stores `value` under `key` within `namespace`, expiring after `ttlMs`.
 * Unlike `claimOnce`, this does not check for an existing row first - callers
 * that mint a fresh, unguessable `key` (a random capability token, for
 * example) don't need the conflict check and get a clearer failure if a
 * collision ever does happen.
 */
export async function put(
  namespace: string,
  key: string,
  value: string,
  options: { ttlMs: number }
): Promise<void> {
  const now = new Date();
  await db.insert(channelState).values({
    namespace,
    key,
    value,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + options.ttlMs).toISOString(),
  });
}

/**
 * Reads the value stored under `key` within `namespace` without consuming
 * it. Returns `undefined` when the row is missing or has expired. Use this
 * for checks that must not have a side effect - such as a link-preview
 * crawler's GET, which must not burn a single-use token meant for the
 * person the link was sent to.
 */
export async function peek(
  namespace: string,
  key: string
): Promise<string | undefined> {
  const nowIso = new Date().toISOString();
  const [row] = await db
    .select({ expiresAt: channelState.expiresAt, value: channelState.value })
    .from(channelState)
    .where(
      and(eq(channelState.namespace, namespace), eq(channelState.key, key))
    );
  if (!row) return undefined;
  if (row.expiresAt !== null && row.expiresAt <= nowIso) return undefined;
  return row.value ?? undefined;
}

/**
 * Atomically removes and returns the value stored under `key` within
 * `namespace`, but only if it has not expired. The delete-and-return happens
 * in one statement, so two concurrent callers racing to consume the same key
 * can never both succeed - the second gets `undefined`. Use this to enforce
 * single use of a capability token at the moment it is redeemed.
 */
export async function take(
  namespace: string,
  key: string
): Promise<string | undefined> {
  const nowIso = new Date().toISOString();
  const [row] = await db
    .delete(channelState)
    .where(
      and(
        eq(channelState.namespace, namespace),
        eq(channelState.key, key),
        or(isNull(channelState.expiresAt), gt(channelState.expiresAt, nowIso))
      )
    )
    .returning({ value: channelState.value });
  return row?.value ?? undefined;
}

/**
 * Upserts `value` for `namespace`/`key`. Unlike `claimOnce`, this always
 * writes the latest value - for state that legitimately changes over time
 * (like a workspace's current Linq delivery target), not a fact that should
 * only ever be set once.
 */
export async function putState(
  namespace: string,
  key: string,
  value: string,
  options?: { ttlMs?: number }
): Promise<void> {
  const now = new Date();
  const expiresAt = options?.ttlMs
    ? new Date(now.getTime() + options.ttlMs).toISOString()
    : null;
  await db
    .insert(channelState)
    .values({
      namespace,
      key,
      value,
      createdAt: now.toISOString(),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [channelState.namespace, channelState.key],
      set: { value, expiresAt },
    });
}

/**
 * Reads the value written by `putState` for `namespace`/`key`, or `null`
 * when no row exists or its `expiresAt` has passed. An expired row is left
 * in place rather than deleted here; `channel_state_expires_idx` exists for
 * a future pruning job.
 */
export async function getState(
  namespace: string,
  key: string
): Promise<string | null> {
  const [row] = await db
    .select({ value: channelState.value, expiresAt: channelState.expiresAt })
    .from(channelState)
    .where(
      and(eq(channelState.namespace, namespace), eq(channelState.key, key))
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt <= new Date().toISOString()) return null;
  return row.value;
}
