import { defineTool } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { listVaultNotes } from "@/db/services/vault";

export default defineTool({
  description:
    "Recall the non-secret personal details the user has saved with save_to_vault_note - loyalty and frequent-flyer numbers, Known Traveler Number, membership IDs, travel preferences. Returns the actual values. Check this before a booking or other multi-step task so you can fill known identifiers without asking again. This store never holds passwords, card numbers, or other secrets.",
  inputSchema: z.object({
    category: z
      .string()
      .max(60)
      .optional()
      .describe("Only return notes whose category matches exactly."),
    query: z
      .string()
      .max(120)
      .optional()
      .describe("Only return notes whose label contains this text."),
  }),
  async execute({ category, query }, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const notes = await listVaultNotes(scopeFromPrincipal(caller), {
      category,
      query,
    });
    return {
      notes: notes.map((note) => ({
        id: note.id,
        label: note.label,
        value: note.value,
        category: note.category,
        updatedAt: note.updatedAt,
      })),
    };
  },
});
