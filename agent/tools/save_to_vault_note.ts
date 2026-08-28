import { defineTool } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { createVaultNote } from "@/db/services/vault";

export default defineTool({
  description:
    "Save a non-secret personal detail the user volunteered in chat so you can recall it later in a booking or multi-step task. Use for loyalty and frequent-flyer numbers, Known Traveler Number / TSA PreCheck, Global Entry, membership and rewards IDs, and travel preferences (seat, meal, home airport). Do NOT use for passwords, card numbers, CVVs, SSNs, API keys, OAuth tokens, or anything that would be a security problem to store in plain text - those go through request_vault_setup instead. Values are returned to you later by list_vault_notes.",
  inputSchema: z.object({
    label: z
      .string()
      .min(2)
      .max(120)
      .describe(
        "What this is, in plain words (e.g. 'United MileagePlus number', 'Known Traveler Number', 'preferred seat')."
      ),
    value: z
      .string()
      .min(1)
      .max(500)
      .describe("The identifier or preference exactly as the user gave it."),
    category: z
      .string()
      .max(60)
      .optional()
      .describe(
        "Optional free-text grouping, e.g. 'travel', 'loyalty', 'airline', 'hotel'."
      ),
  }),
  async execute({ category, label, value }, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const note = await createVaultNote(scopeFromPrincipal(caller), {
      category,
      label,
      value,
    });
    return {
      saved: true,
      id: note.id,
      label: note.label,
      category: note.category,
    };
  },
});
