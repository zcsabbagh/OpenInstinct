import { defineTool } from "eve/tools";
import { z } from "zod";
import { createSchedule } from "@/agent/lib/schedule-store";
import { resolveLinqJobOwner } from "@/lib/linq-target";
import {
  civilDateInZone,
  isValidCalendarDate,
  isValidTimeZone,
  nextOccurrence,
  nextRecurrence,
  weekdayOf,
  type RecurrenceRule,
} from "@/lib/schedule-time";
import { getUserTimezone, setUserTimezone } from "@/lib/user-prefs";

// The model is unreliable at converting a wall-clock time to UTC, so this tool
// never takes an absolute timestamp. It takes either a delay (in_seconds) or a
// local clock time + IANA timezone, and does the conversion here. A recurring
// reminder is stored as a wall-clock anchor (hour/minute, plus weekday /
// day-of-month / month) rather than a fixed interval - see
// `lib/schedule-time.ts` `RecurrenceRule` - so it never drifts off its
// original time and can express weekly/monthly/yearly, not just a fixed
// number of minutes.

const ON_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function parseOnDate(onDate: string): {
  year: number;
  month: number;
  day: number;
} {
  // ON_DATE_PATTERN already guarantees this exact "YYYY-MM-DD" shape, so
  // fixed-offset slicing is safe and needs no array-index assertions.
  const year = Number(onDate.slice(0, 4));
  const month = Number(onDate.slice(5, 7));
  const day = Number(onDate.slice(8, 10));
  if (month < 1 || month > 12) {
    throw new Error(`on_date "${onDate}" has an invalid month.`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`on_date "${onDate}" has an invalid day.`);
  }
  return { year, month, day };
}

export default defineTool({
  description:
    "Schedule a reminder message to the user. For a delay ('remind me in 20 minutes', 'in 3 hours') pass in_seconds. For a clock time ('at 3pm', 'every day at 9am') pass at_time as 24-hour HH:MM plus the user's IANA timezone. If you do not know the user's timezone, ask them once before scheduling. Set repeat to make it recurring: 'daily', 'weekly', 'monthly', or 'yearly' (requires at_time, not in_seconds). For weekly/monthly/yearly, pass on_date as the anchor calendar date (YYYY-MM-DD) whenever the user names or implies a specific day - e.g. 'every Monday' (compute that date's next Monday), 'every month on the 1st' (compute this month's or next month's 1st), 'every year on March 5'. If the user does not name a day, omit on_date and it defaults to the date this reminder first fires on. 'every month on the 31st' clamps to the last day of shorter months; 'every year on Feb 29' clamps to Feb 28 in non-leap years.",
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
        "Fire this many seconds from now. Use for any 'in N minutes/hours/days' request. Only for a one-time reminder (repeat must be 'none' or omitted)."
      ),
    at_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
      .optional()
      .describe(
        "Local clock time as 24-hour HH:MM. Requires timezone. Fires the next time that clock time occurs, then (if repeat is set) every following occurrence of that same clock time."
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        "IANA timezone for at_time, e.g. 'America/Phoenix', 'America/New_York'. Required whenever at_time is set."
      ),
    repeat: z
      .enum(["none", "daily", "weekly", "monthly", "yearly"])
      .default("none")
      .describe(
        "'none' fires once. 'daily' repeats every day. 'weekly' repeats on one weekday. 'monthly' repeats on one day of the month. 'yearly' repeats on one month+day. All repeating kinds require at_time; combine with on_date to name the day."
      ),
    on_date: z
      .string()
      .regex(ON_DATE_PATTERN)
      .optional()
      .describe(
        "Anchor calendar date as YYYY-MM-DD, in `timezone`. For 'weekly' it supplies the weekday, for 'monthly' the day-of-month, for 'yearly' the month and day. Ignored for 'none' and 'daily'. Omit to default to the date the reminder first fires on."
      ),
  }),
  async execute({ at_time, in_seconds, on_date, repeat, task, timezone }, ctx) {
    const owner = resolveLinqJobOwner(ctx);
    let firstRunAt: Date;
    let recurrence: RecurrenceRule | null;

    if (in_seconds != null) {
      if (at_time) {
        throw new Error("Pass either in_seconds or at_time, not both.");
      }
      if (repeat !== "none") {
        throw new Error(
          "in_seconds is only for a one-time delay. A recurring reminder needs at_time (+ timezone) so it has a wall-clock time to repeat at."
        );
      }
      firstRunAt = new Date(Date.now() + in_seconds * 1_000);
      recurrence = null;
    } else if (at_time) {
      const zone = timezone ?? (await getUserTimezone(owner.workspaceId));
      if (!zone) {
        throw new Error(
          "at_time needs a timezone and none is on file. Ask the user which IANA timezone they are in (e.g. America/Phoenix), then call this again with it."
        );
      }
      if (!isValidTimeZone(zone)) {
        throw new Error(`"${zone}" is not a valid IANA timezone.`);
      }
      if (timezone) await setUserTimezone(owner.workspaceId, timezone);

      const [hourStr, minuteStr] = at_time.split(":");
      const hour = Number(hourStr);
      const minute = Number(minuteStr);

      if (repeat === "none") {
        firstRunAt = nextOccurrence(at_time, zone);
        recurrence = null;
      } else {
        const kind = repeat;
        let anchor: { year: number; month: number; day: number };
        if (on_date) {
          anchor = parseOnDate(on_date);
          if (
            kind === "weekly" &&
            !isValidCalendarDate(anchor.year, anchor.month, anchor.day)
          ) {
            throw new Error(
              `on_date "${on_date}" is not a real calendar date - a weekly reminder needs a real date to read the weekday off of.`
            );
          }
        } else {
          // No explicit date: anchor to the date this reminder would first
          // fire on (today, or tomorrow if at_time has already passed today).
          anchor = civilDateInZone(nextOccurrence(at_time, zone), zone);
        }

        const rule: RecurrenceRule = {
          kind,
          hour,
          minute,
          timezone: zone,
          ...(kind === "weekly"
            ? { dayOfWeek: weekdayOf(anchor.year, anchor.month, anchor.day) }
            : {}),
          ...(kind === "monthly" || kind === "yearly"
            ? { dayOfMonth: anchor.day }
            : {}),
          ...(kind === "yearly" ? { month: anchor.month } : {}),
        };
        recurrence = rule;
        // Always derive the first run the same way every later run is derived
        // (nextRecurrence from "now"), so a same-day anchor that has already
        // passed today rolls forward correctly instead of firing in the past.
        firstRunAt = nextRecurrence(rule, new Date());
      }
    } else {
      throw new Error(
        "Provide in_seconds for a delay, or at_time (+ timezone) for a clock time."
      );
    }

    const result = await createSchedule(owner, {
      task,
      firstRunAt: firstRunAt.toISOString(),
      recurrence,
    });
    return { created: true, firesAt: firstRunAt.toISOString(), ...result };
  },
});
