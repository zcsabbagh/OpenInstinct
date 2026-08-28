import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { cancelSchedule } from "@/agent/lib/schedule-store";
import { resolveLinqJobOwner } from "@/lib/linq-target";

export default defineTool({
  description:
    "Cancel and delete one of the user's scheduled reminders. Get the id from list_schedules.",
  inputSchema: z.object({ id: z.string().min(1) }),
  approval: always(),
  async execute({ id }, ctx) {
    const owner = resolveLinqJobOwner(ctx);
    return { cancelled: await cancelSchedule(owner, id) };
  },
});
