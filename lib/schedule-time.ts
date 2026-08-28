// Wall-clock -> UTC conversion for scheduled reminders, with no dependency.
// The model is unreliable at emitting a correct UTC timestamp for a local time,
// so `create_schedule` computes it here from an IANA timezone instead.

export function isValidTimeZone(timezone: string): boolean {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions()
        .timeZone !== ""
    );
  } catch {
    return false;
  }
}

// The next UTC instant at which `hhmm` (24-hour "HH:MM") occurs in `timezone` -
// today if it is still ahead, otherwise tomorrow. `now` is injectable for tests.
export function nextOccurrence(
  hhmm: string,
  timezone: string,
  now = new Date()
): Date {
  const time = hhmm.split(":");
  const hour = Number(time[0]);
  const minute = Number(time[1]);

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-");
  const year = Number(date[0]);
  const month = Number(date[1]);
  const day = Number(date[2]);

  const today = wallTimeToUtc(year, month, day, hour, minute, timezone);
  if (today.getTime() > now.getTime()) return today;
  return wallTimeToUtc(year, month, day + 1, hour, minute, timezone);
}

// A recurrence anchored to a fixed wall-clock time in a fixed timezone, rather
// than a fixed duration. `hour`/`minute` are always the local time of day; the
// remaining fields are populated per `kind`:
//   - "daily": no extra fields.
//   - "weekly": `dayOfWeek` (0 = Sunday .. 6 = Saturday, `Date#getUTCDay`
//     convention - see `weekdayOf` below).
//   - "monthly": `dayOfMonth` (1-31). A month shorter than `dayOfMonth`
//     clamps to that month's last day (e.g. "the 31st" in April fires on the
//     30th), matching the common billing-cycle convention.
//   - "yearly": `month` (1-12) and `dayOfMonth` (1-31), clamped the same way
//     per target year - so "Feb 29" fires on Feb 28 in a non-leap year and
//     back on Feb 29 the next time the year is leap, rather than skipping a
//     year or drifting into March.
export type RepeatKind = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  kind: RepeatKind;
  hour: number;
  minute: number;
  timezone: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  month?: number;
}

const REPEAT_KINDS: readonly RepeatKind[] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

// Narrows a value read back from storage (a plain `text` column) to
// `RepeatKind` without an unsafe cast.
export function isRepeatKind(value: string): value is RepeatKind {
  return (REPEAT_KINDS as readonly string[]).includes(value);
}

// The calendar date `instant` falls on inside `timezone`.
export function civilDateInZone(
  instant: Date,
  timezone: string
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(instant)
    .split("-");
  return {
    year: Number(parts[0]),
    month: Number(parts[1]),
    day: Number(parts[2]),
  };
}

// Calendar-only arithmetic (no timezone involved): a Gregorian date's weekday
// and length-of-month don't depend on where you observe it from, so plain
// `Date.UTC` normalization is exact and DST-safe by construction.
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(
  year: number,
  month: number,
  day: number,
  delta: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function addMonths(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const total = month - 1 + delta;
  return {
    year: year + Math.floor(total / 12),
    month: (((total % 12) + 12) % 12) + 1,
  };
}

// Whether (year, month, day) is a real Gregorian calendar date - i.e. it does
// not overflow (Date.UTC normalizes an out-of-range day/month rather than
// rejecting it, so this checks the round trip instead).
export function isValidCalendarDate(
  year: number,
  month: number,
  day: number
): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

// The next UTC instant `rule` occurs, strictly after `after`.
//
// This is the anchor the drift fix relies on: every candidate is derived from
// `rule`'s fixed hour/minute (and weekday/day-of-month/month), never from
// `after` itself, so a late or delayed check-in never shifts the schedule -
// `after` only selects which occurrence of the fixed wall-clock time is next,
// it is never added to. That also makes a missed window self-healing: if the
// dispatcher was down for hours, `after` = now simply lands past one or more
// candidates, and the loop returns the next future one instead of replaying a
// backlog.
export function nextRecurrence(rule: RecurrenceRule, after: Date): Date {
  const start = civilDateInZone(after, rule.timezone);

  if (rule.kind === "daily") {
    let { year, month, day } = start;
    for (let i = 0; i < 2; i++) {
      const candidate = wallTimeToUtc(
        year,
        month,
        day,
        rule.hour,
        rule.minute,
        rule.timezone
      );
      if (candidate.getTime() > after.getTime()) return candidate;
      ({ year, month, day } = addDays(year, month, day, 1));
    }
  } else if (rule.kind === "weekly") {
    if (rule.dayOfWeek == null) {
      throw new Error("A weekly recurrence needs dayOfWeek.");
    }
    let { year, month, day } = start;
    for (let i = 0; i < 8; i++) {
      if (weekdayOf(year, month, day) === rule.dayOfWeek) {
        const candidate = wallTimeToUtc(
          year,
          month,
          day,
          rule.hour,
          rule.minute,
          rule.timezone
        );
        if (candidate.getTime() > after.getTime()) return candidate;
      }
      ({ year, month, day } = addDays(year, month, day, 1));
    }
  } else if (rule.kind === "monthly") {
    if (rule.dayOfMonth == null) {
      throw new Error("A monthly recurrence needs dayOfMonth.");
    }
    let { year, month } = start;
    for (let i = 0; i < 14; i++) {
      const day = Math.min(rule.dayOfMonth, daysInMonth(year, month));
      const candidate = wallTimeToUtc(
        year,
        month,
        day,
        rule.hour,
        rule.minute,
        rule.timezone
      );
      if (candidate.getTime() > after.getTime()) return candidate;
      ({ year, month } = addMonths(year, month, 1));
    }
  } else {
    if (rule.dayOfMonth == null || rule.month == null) {
      throw new Error("A yearly recurrence needs month and dayOfMonth.");
    }
    let { year } = start;
    for (let i = 0; i < 6; i++) {
      const day = Math.min(rule.dayOfMonth, daysInMonth(year, rule.month));
      const candidate = wallTimeToUtc(
        year,
        rule.month,
        day,
        rule.hour,
        rule.minute,
        rule.timezone
      );
      if (candidate.getTime() > after.getTime()) return candidate;
      year += 1;
    }
  }
  // Unreachable for a valid rule: every branch's loop bound comfortably
  // exceeds the number of candidates it can take to clear `after`.
  throw new Error(
    "Could not compute the next occurrence for this recurrence rule."
  );
}

// Guess the instant as if the wall time were UTC, read it back in the zone, and
// correct by the difference. Handles DST because the offset is read at the
// target instant.
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const seen = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(guess)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  const seenAsUtc = Date.UTC(
    Number(seen.year),
    Number(seen.month) - 1,
    Number(seen.day),
    Number(seen.hour) % 24,
    Number(seen.minute),
    Number(seen.second)
  );
  return new Date(guess.getTime() - (seenAsUtc - guess.getTime()));
}
