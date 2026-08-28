import { defineTool } from "eve/tools";
import { z } from "zod";
import { listSchedules, rowToRule } from "@/agent/lib/schedule-store";
import { resolveLinqJobOwner } from "@/lib/linq-target";

export default defineTool({
  description: "List the user's scheduled reminders (one-time and recurring).",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const owner = resolveLinqJobOwner(ctx);
    const rows = await listSchedules(owner);
    return {
      schedules: rows.map((row) => ({
        id: row.id,
        task: row.task,
        nextRunAt: row.nextRunAt,
        repeat: rowToRule(row),
        active: row.enabled === 1,
        lastRunAt: row.lastRunAt,
      })),
    };
  },
});
