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
