import { defineTool } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { env } from "@/lib/env";
import { INVITE_CAP, mintInvite } from "@/lib/invites";

export default defineTool({
  description: `Mint an invite link the user can share so someone new can start using Mouse. Each user can create at most ${String(
    INVITE_CAP
  )} invites total. Returns a link to give to the invitee.`,
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const scope = scopeFromPrincipal(caller);

    const { code, remaining } = await mintInvite({
      issuerWorkspaceId: scope.workspaceId,
      issuerPrincipalId: scope.userId,
    });
    const link = new URL(`/i/${code}`, env.BETTER_AUTH_URL).toString();
    return { link, code, invitesRemaining: remaining };
  },
});
