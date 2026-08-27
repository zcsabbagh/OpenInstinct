import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveLinqJobOwner } from "@/lib/linq-target";
import { listWebMonitors } from "@/lib/web-monitor";

export default defineTool({
  description: "List the user's active daily web-monitoring jobs.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const owner = resolveLinqJobOwner(ctx);
    return { monitors: await listWebMonitors(owner) };
  },
});
