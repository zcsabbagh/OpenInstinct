import { defineTool } from "eve/tools";
import { z } from "zod";
import { createSchedule } from "@/agent/lib/schedule-store";
import { resolveLinqJobOwner } from "@/lib/linq-target";
import { isValidTimeZone, nextOccurrence } from "@/lib/schedule-time";

// The model is unreliable at converting a wall-clock time to UTC, so this tool
// never takes an absolute timestamp. It takes either a delay (in_seconds) or a
// local clock time + IANA timezone, and does the conversion here.

export default defineTool({
  description:
    "Schedule a reminder message to the user. For a delay ('remind me in 20 minutes', 'in 3 hours') pass in_seconds. For a clock time ('at 3pm', 'every day at 9am') pass at_time as 24-hour HH:MM plus the user's IANA timezone, and set repeat to 'daily' for a recurring one. If you do not know the user's timezone, ask them once before scheduling.",
  inputSchema: z.object({
    task: z
      .string()
      .min(2)
      .max(500)
      .describe(
        "What to remind the user about, in plain words (e.g. 'email Matthew')."
      ),
    in_seconds: z
      .number()
      .int()
      .min(10)
      .max(31_536_000)
      .optional()
      .describe(
        "Fire this many seconds from now. Use for any 'in N minutes/hours/days' request."
      ),
    at_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
      .optional()
      .describe(
        "Local clock time as 24-hour HH:MM. Requires timezone. Fires the next time that clock time occurs."
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        "IANA timezone for at_time, e.g. 'America/Phoenix', 'America/New_York'. Required whenever at_time is set."
      ),
    repeat: z
      .enum(["none", "daily"])
      .default("none")
      .describe("'daily' repeats at_time every day; 'none' fires once."),
  }),
  async execute({ at_time, in_seconds, repeat, task, timezone }, ctx) {
    let firstRunAt: Date;
    let everyMinutes: number | null;

    if (in_seconds != null) {
      if (at_time) {
        throw new Error("Pass either in_seconds or at_time, not both.");
      }
      firstRunAt = new Date(Date.now() + in_seconds * 1_000);
      everyMinutes = null;
    } else if (at_time) {
      if (!timezone) {
        throw new Error(
          "at_time needs a timezone. Ask the user which IANA timezone they are in (e.g. America/Phoenix) and try again."
        );
      }
      if (!isValidTimeZone(timezone)) {
        throw new Error(`"${timezone}" is not a valid IANA timezone.`);
      }
      firstRunAt = nextOccurrence(at_time, timezone);
      everyMinutes = repeat === "daily" ? 1_440 : null;
    } else {
      throw new Error(
        "Provide in_seconds for a delay, or at_time + timezone for a clock time."
      );
    }

    const owner = resolveLinqJobOwner(ctx);
    const result = await createSchedule(owner, {
      task,
      firstRunAt: firstRunAt.toISOString(),
      everyMinutes,
    });
    return { created: true, firesAt: firstRunAt.toISOString(), ...result };
  },
});
