import type { SessionAuthContext, SessionContext } from "eve/context";

// Shared plumbing for delivering a proactive message back to the Linq
// conversation a background job (web monitor, schedule) was created from.
//
// `agent/channels/linq.ts` stashes the serialized Chat SDK thread, its id, and
// the sender handle in the session auth attributes at inbound time. A job row
// copies those, and the dispatcher / webhook rebuilds the delivery target and a
// caller auth from them.

export interface LinqJobOwner {
  workspaceId: string;
  ownerPrincipalId: string;
  authenticator: string;
  issuer: string | null;
  linqThread: string | null;
  linqThreadId: string | null;
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
    linqThreadId: attr(caller.attributes, "linqThreadId"),
    ownerHandle: attr(caller.attributes, "ownerHandle"),
  };
}

// ChatSdkReceiveTarget = { adapterName?, thread?: SerializedThread, threadId? }
export function buildLinqReceiveTarget(owner: {
  linqThread: string | null;
  linqThreadId: string | null;
}): { adapterName?: string; thread?: unknown; threadId?: string } {
  if (owner.linqThread) {
    try {
      return { thread: JSON.parse(owner.linqThread) as unknown };
    } catch {
      // fall through to the id form
    }
  }
  if (owner.linqThreadId) {
    return { adapterName: "linq", threadId: owner.linqThreadId };
  }
  throw new Error("No Linq delivery target was captured for this job.");
}

export function buildJobAuth(owner: LinqJobOwner): SessionAuthContext {
  return {
    attributes: { workspaceId: owner.workspaceId },
    authenticator: owner.authenticator,
    ...(owner.issuer ? { issuer: owner.issuer } : {}),
    principalId: owner.ownerPrincipalId,
    principalType: "user",
  };
}
