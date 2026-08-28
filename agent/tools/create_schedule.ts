import { defineTool } from "eve/tools";
import { z } from "zod";
import { createSchedule } from "@/agent/lib/schedule-store";
import { resolveLinqJobOwner } from "@/lib/linq-target";

export default defineTool({
  description:
    "Schedule a reminder message to the user. Use for 'remind me to X at 3pm' (one-time) or 'text me every day at 9am' (recurring). Convert the time to ISO 8601 with the user's UTC offset. Set every_minutes for a repeating reminder (1440 = daily, 60 = hourly) or leave it null for one-time.",
  inputSchema: z.object({
    task: z
      .string()
      .min(2)
      .max(500)
      .describe(
        "What to remind the user about, in plain words (e.g. 'email Matthew')."
      ),
    first_run_at: z
      .string()
      .describe(
        "When it first fires, ISO 8601 with offset, e.g. 2026-08-28T15:00:00-07:00."
      ),
    every_minutes: z
      .number()
      .int()
      .min(1)
      .max(525_600)
      .nullable()
      .default(null)
      .describe("Repeat interval in minutes, or null for a one-time reminder."),
  }),
  async execute({ every_minutes, first_run_at, task }, ctx) {
    const parsedFirstRun = new Date(first_run_at);
    if (Number.isNaN(parsedFirstRun.getTime())) {
      throw new Error(
        "first_run_at must be a valid ISO 8601 datetime with an offset."
      );
    }
    const owner = resolveLinqJobOwner(ctx);
    const result = await createSchedule(owner, {
      task,
      firstRunAt: parsedFirstRun.toISOString(),
      everyMinutes: every_minutes,
    });
    return { created: true, ...result };
  },
});
