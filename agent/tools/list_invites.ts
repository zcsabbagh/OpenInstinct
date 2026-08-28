import { defineTool } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { env } from "@/lib/env";
import {
  countRedeemed,
  INVITE_CAP,
  listInvitesForIssuer,
  remainingInviteQuota,
} from "@/lib/invites";

export default defineTool({
  description:
    "List the invite links the user has created, showing which have been redeemed and how many invites they have left.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const scope = scopeFromPrincipal(caller);

    const rows = await listInvitesForIssuer(scope.workspaceId);
    const redeemedCount = countRedeemed(rows);
    return {
      cap: INVITE_CAP,
      minted: rows.length,
      redeemedCount,
      invitesRemaining: remainingInviteQuota(rows.length),
      invites: rows.map((row) => ({
        link: new URL(`/i/${row.code}`, env.BETTER_AUTH_URL).toString(),
        code: row.code,
        createdAt: row.createdAt,
        redeemed: row.redeemedAt != null,
        redeemedAt: row.redeemedAt,
      })),
    };
  },
});
