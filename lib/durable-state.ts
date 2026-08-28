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
