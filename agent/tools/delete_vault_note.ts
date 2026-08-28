import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { deleteVaultNote } from "@/db/services/vault";

export default defineTool({
  description:
    "Delete one saved personal detail. Get the id from list_vault_notes.",
  inputSchema: z.object({ id: z.string().min(1) }),
  approval: always(),
  async execute({ id }, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    return { deleted: await deleteVaultNote(scopeFromPrincipal(caller), id) };
  },
});
