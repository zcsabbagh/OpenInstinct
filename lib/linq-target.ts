/* oxlint-disable typescript/no-unsafe-assignment -- SerializedThread resolves through a transitive Chat SDK module the linter cannot see; the shape is validated at delivery time by eve. */
import type { ChatSdkReceiveTarget } from "eve/channels/chat-sdk";
import type { SessionAuthContext, SessionContext } from "eve/context";

// Shared plumbing for delivering a proactive message back to the Linq
// conversation a background job (web monitor, schedule) was created from.
//
// `agent/channels/linq.ts` stashes the serialized Chat SDK thread and the
// sender handle in the session auth attributes at inbound time. A job row
// copies those, and the dispatcher / webhook rebuilds the delivery target and a
// caller auth from them.

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
