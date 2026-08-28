/* oxlint-disable typescript/no-unsafe-assignment -- SerializedThread resolves through a transitive Chat SDK module the linter cannot see; the shape is validated at delivery time by eve. */
import type { ChatSdkReceiveTarget } from "eve/channels/chat-sdk";
import type { SessionAuthContext, SessionContext } from "eve/context";
import { z } from "zod";
import { getState, putState } from "@/lib/durable-state";

// Shared plumbing for delivering a proactive message back to the Linq
// conversation a background job (web monitor, schedule) was created from.
//
// `agent/channels/linq.ts` stashes the serialized Chat SDK thread and the
// sender handle in the session auth attributes at inbound time. A job row
// copies those, and the dispatcher / webhook rebuilds the delivery target and a
// caller auth from them.
//
// `saveDurableLinqTarget` / `loadDurableLinqTarget` below persist that same
// owner shape per workspace (not per job), in `channel_state` (see
// `lib/durable-state.ts`). A job row only exists once the user has created a
// reminder or monitor; code that needs to reach a workspace's Linq thread
// before any job exists - like announcing that Google Workspace just
// connected - reads this instead.

export interface LinqJobOwner {
  workspaceId: string;
  ownerPrincipalId: string;
  authenticator: string;
  issuer: string | null;
  linqThread: string | null;
  ownerHandle: string | null;
}

function attr(
  attributes: Readonly<Record<string, string | readonly string[]>>,
  key: string
): string | null {
  const value = attributes[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolveLinqJobOwner(ctx: SessionContext): LinqJobOwner {
  const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
  if (caller?.principalType !== "user") {
    throw new Error("An authenticated Linq user is required.");
  }
  const workspaceId = attr(caller.attributes, "workspaceId");
  if (!workspaceId) throw new Error("The session is missing a workspace id.");

  return {
    workspaceId,
    ownerPrincipalId: caller.principalId,
    authenticator: caller.authenticator,
    issuer: caller.issuer ?? null,
    linqThread: attr(caller.attributes, "linqThread"),
    ownerHandle: attr(caller.attributes, "ownerHandle"),
  };
}

export function buildLinqReceiveTarget(job: {
  linqThread: string | null;
}): ChatSdkReceiveTarget {
  if (!job.linqThread) {
    throw new Error("No Linq delivery target was captured for this job.");
  }
  return {
    thread: JSON.parse(job.linqThread) as ChatSdkReceiveTarget["thread"],
  };
}

export function buildJobAuth(job: {
  workspaceId: string;
  authenticator: string;
  issuer: string | null;
  ownerPrincipalId: string;
}): SessionAuthContext {
  return {
    attributes: { workspaceId: job.workspaceId },
    authenticator: job.authenticator,
    ...(job.issuer ? { issuer: job.issuer } : {}),
    principalId: job.ownerPrincipalId,
    principalType: "user",
  };
}

const DURABLE_LINQ_TARGET_NAMESPACE = "linq-target";

// Field-for-field validation of the durable record against `LinqJobOwner`;
// keep this in sync if that interface changes.
const linqJobOwnerSchema = z.object({
  authenticator: z.string().min(1),
  issuer: z.string().nullable(),
  linqThread: z.string().nullable(),
  ownerHandle: z.string().nullable(),
  ownerPrincipalId: z.string().min(1),
  workspaceId: z.string().min(1),
});

/**
 * Persists `owner` as the workspace's current Linq delivery target, keyed by
 * `owner.workspaceId` in `channel_state`. Call this on every accepted
 * inbound Linq message (see `agent/channels/linq.ts`) so the latest thread
 * is always on file - a single upsert per message, keyed on the table's
 * primary key.
 */
export async function saveDurableLinqTarget(
  owner: LinqJobOwner
): Promise<void> {
  await putState(
    DURABLE_LINQ_TARGET_NAMESPACE,
    owner.workspaceId,
    JSON.stringify(owner)
  );
}

/**
 * Reads the delivery target saved by `saveDurableLinqTarget` for
 * `workspaceId`, or `null` if the workspace has never sent an inbound Linq
 * message, or the stored record fails validation (treated as absent rather
 * than thrown, since a corrupt row should never crash a caller).
 */
export async function loadDurableLinqTarget(
  workspaceId: string
): Promise<LinqJobOwner | null> {
  const raw = await getState(DURABLE_LINQ_TARGET_NAMESPACE, workspaceId);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = linqJobOwnerSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
