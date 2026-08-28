import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { resolveLinqJobOwner } from "@/lib/linq-target";
import { deleteWebMonitor } from "@/lib/web-monitor";

export default defineTool({
  description:
    "Stop and delete one of the user's daily web-monitoring jobs. Get the id from list_web_monitors.",
  inputSchema: z.object({ id: z.string().min(1) }),
  approval: always(),
  async execute({ id }, ctx) {
    const owner = resolveLinqJobOwner(ctx);
    return { deleted: await deleteWebMonitor(owner, id) };
  },
});
