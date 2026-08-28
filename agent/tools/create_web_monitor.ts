import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveLinqJobOwner } from "@/lib/linq-target";
import { createWebMonitor, MONITOR_CAP } from "@/lib/web-monitor";

export default defineTool({
  description: `Start a daily web-monitoring job for the user. Exa searches the web once a day for the query and the user is messaged when new results appear (concert announcements, launches, price drops, new papers). Use for open-ended 'let me know when...' requests. One job per distinct thing to watch. The user can have at most ${String(
    MONITOR_CAP
  )} active monitors; past that this fails and you should offer to delete one with delete_web_monitor.`,
  inputSchema: z.object({
    query: z
      .string()
      .min(3)
      .max(400)
      .describe("What to watch for, as a natural search query."),
    label: z
      .string()
      .max(120)
      .optional()
      .describe("Optional short label to show the user."),
  }),
  async execute({ query }, ctx) {
    const owner = resolveLinqJobOwner(ctx);
    const { id, nextCheckAt } = await createWebMonitor(owner, query);
    return {
      created: true,
      id,
      query,
      nextCheck: nextCheckAt,
      cadence: "daily",
    };
  },
});
