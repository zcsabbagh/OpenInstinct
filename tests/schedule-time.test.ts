import { describe, expect, it } from "vitest";
import {
  isValidCalendarDate,
  isValidTimeZone,
  nextOccurrence,
  nextRecurrence,
  type RecurrenceRule,
  wallTimeToUtc,
} from "@/lib/schedule-time";

describe("schedule-time", () => {
  it("converts a wall-clock time in a fixed-offset zone to UTC", () => {
    // America/Phoenix is UTC-7 year round.
    expect(
      wallTimeToUtc(2026, 8, 28, 17, 19, "America/Phoenix").toISOString()
    ).toBe("2026-08-29T00:19:00.000Z");
  });

  it("handles US daylight saving", () => {
    // 2026-01-15 is standard time in New York (UTC-5).
    expect(
      wallTimeToUtc(2026, 1, 15, 9, 0, "America/New_York").toISOString()
    ).toBe("2026-01-15T14:00:00.000Z");
    // 2026-07-15 is daylight time (UTC-4).
    expect(
      wallTimeToUtc(2026, 7, 15, 9, 0, "America/New_York").toISOString()
    ).toBe("2026-07-15T13:00:00.000Z");
  });

  it("picks today when the time is still ahead, tomorrow when it has passed", () => {
    const now = new Date("2026-08-28T18:00:00.000Z"); // 11:00 in Phoenix
    expect(nextOccurrence("15:00", "America/Phoenix", now).toISOString()).toBe(
      "2026-08-28T22:00:00.000Z"
    );
    expect(nextOccurrence("09:00", "America/Phoenix", now).toISOString()).toBe(
      "2026-08-29T16:00:00.000Z"
    );
  });

  it("validates IANA zones", () => {
    expect(isValidTimeZone("America/Phoenix")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});

// The local HH:MM `ms` (a UTC instant) reads as inside `timezone`. Read-only
// formatting, used to assert the recurrence stayed pinned to its wall-clock
// anchor - never used to derive a scheduling decision.
function localHhMm(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

describe("nextRecurrence", () => {
  describe("daily", () => {
    const rule: RecurrenceRule = {
      kind: "daily",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
    };

    it("returns today's occurrence when it is still ahead", () => {
      const after = new Date("2026-08-28T15:00:00.000Z"); // 08:00 Phoenix
      expect(nextRecurrence(rule, after).toISOString()).toBe(
        "2026-08-28T16:00:00.000Z"
      );
    });

    it("rolls to tomorrow once today's occurrence has passed", () => {
      const after = new Date("2026-08-28T16:00:00.000Z"); // exactly 09:00 Phoenix
      expect(nextRecurrence(rule, after).toISOString()).toBe(
        "2026-08-29T16:00:00.000Z"
      );
    });

    it("carries the wall-clock time across the US spring-forward transition", () => {
      const nyRule: RecurrenceRule = {
        kind: "daily",
        hour: 9,
        minute: 0,
        timezone: "America/New_York",
      };
      // 2026-03-08 02:00 EST -> 03:00 EDT. Firing right at 2026-03-07 09:00 EST
      // must roll to 2026-03-08 09:00 EDT, one hour less of a UTC gap.
      const after = new Date("2026-03-07T14:00:00.000Z");
      expect(nextRecurrence(nyRule, after).toISOString()).toBe(
        "2026-03-08T13:00:00.000Z"
      );
    });

    it("carries the wall-clock time across the US fall-back transition", () => {
      const nyRule: RecurrenceRule = {
        kind: "daily",
        hour: 9,
        minute: 0,
        timezone: "America/New_York",
      };
      // 2026-11-01 02:00 EDT -> 01:00 EST. Firing right at 2026-10-31 09:00
      // EDT must roll to 2026-11-01 09:00 EST, one hour more of a UTC gap.
      const after = new Date("2026-10-31T13:00:00.000Z");
      expect(nextRecurrence(nyRule, after).toISOString()).toBe(
        "2026-11-01T14:00:00.000Z"
      );
    });

    it("resolves to the next future occurrence after a multi-day outage, not a backlog", () => {
      // The dispatcher last ran normally for 2026-08-27 09:00 Phoenix, then
      // stayed down through 2026-08-28's occurrence entirely, coming back at
      // 2026-08-29 10:00 Phoenix (17:00Z).
      const after = new Date("2026-08-29T17:00:00.000Z");
      const next = nextRecurrence(rule, after);
      // Only ever one instant back, and it is the next future one - never
      // 2026-08-27 or 2026-08-28 (both already in the past), and never more
      // than one candidate.
      expect(next.getTime()).toBeGreaterThan(after.getTime());
      expect(next.toISOString()).toBe("2026-08-30T16:00:00.000Z");
    });
  });

  describe("weekly", () => {
    // 2026-08-24 and 2026-08-31 are both Mondays; dayOfWeek 1 = Monday.
    const rule: RecurrenceRule = {
      kind: "weekly",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
      dayOfWeek: 1,
    };

    it("returns this week's weekday when it is still ahead", () => {
      const after = new Date("2026-08-24T15:00:00.000Z"); // Mon 08:00 Phoenix
      expect(nextRecurrence(rule, after).toISOString()).toBe(
        "2026-08-24T16:00:00.000Z"
      );
    });

    it("rolls to next week once this week's weekday has passed", () => {
      const after = new Date("2026-08-24T16:30:00.000Z"); // Mon 09:30 Phoenix
      expect(nextRecurrence(rule, after).toISOString()).toBe(
        "2026-08-31T16:00:00.000Z"
      );
    });

    it("finds the next matching weekday from a day that is not it", () => {
      const after = new Date("2026-08-26T12:00:00.000Z"); // Wednesday
      expect(nextRecurrence(rule, after).toISOString()).toBe(
        "2026-08-31T16:00:00.000Z"
      );
    });
  });

  describe("monthly", () => {
    // "The 31st" in a shorter month clamps to that month's last day.
    const rule: RecurrenceRule = {
      kind: "monthly",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
      dayOfMonth: 31,
    };

    it("fires on the 31st in a 31-day month", () => {
      const after = new Date("2026-03-01T00:00:00.000Z");
      expect(nextRecurrence(rule, after).toISOString()).toBe(
        "2026-03-31T16:00:00.000Z"
      );
    });

    it("clamps to the 30th in a 30-day month, then returns to the 31st the next time the month is long enough", () => {
      // Just after March 31's occurrence.
      const afterMarch = new Date("2026-03-31T16:30:00.000Z");
      const april = nextRecurrence(rule, afterMarch);
      expect(april.toISOString()).toBe("2026-04-30T16:00:00.000Z");

      const may = nextRecurrence(rule, april);
      expect(may.toISOString()).toBe("2026-05-31T16:00:00.000Z");
    });
  });

  describe("yearly", () => {
    // Feb 29 clamps to Feb 28 in a non-leap year and lands back on Feb 29 the
    // next time the year is leap, rather than skipping a year or drifting
    // into March.
    const rule: RecurrenceRule = {
      kind: "yearly",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
      month: 2,
      dayOfMonth: 29,
    };

    it("clamps to Feb 28 in a non-leap year", () => {
      const after = new Date("2026-01-01T00:00:00.000Z"); // 2026 is not leap
      expect(nextRecurrence(rule, after).toISOString()).toBe(
        "2026-02-28T16:00:00.000Z"
      );
    });

    it("bounces back to Feb 29 the next time the year is leap", () => {
      const afterFeb2026 = new Date("2026-02-28T16:30:00.000Z");
      const feb2027 = nextRecurrence(rule, afterFeb2026); // 2027 is not leap
      expect(feb2027.toISOString()).toBe("2027-02-28T16:00:00.000Z");

      const afterFeb2027 = new Date(feb2027.getTime() + 60_000);
      const feb2028 = nextRecurrence(rule, afterFeb2027); // 2028 is leap
      expect(feb2028.toISOString()).toBe("2028-02-29T16:00:00.000Z");
    });
  });

  it("throws a clear error for an incomplete rule instead of silently misfiring", () => {
    const now = new Date("2026-08-24T15:00:00.000Z");
    expect(() =>
      nextRecurrence(
        { kind: "weekly", hour: 9, minute: 0, timezone: "America/Phoenix" },
        now
      )
    ).toThrow(/dayOfWeek/);
    expect(() =>
      nextRecurrence(
        { kind: "monthly", hour: 9, minute: 0, timezone: "America/Phoenix" },
        now
      )
    ).toThrow(/dayOfMonth/);
    expect(() =>
      nextRecurrence(
        {
          kind: "yearly",
          hour: 9,
          minute: 0,
          timezone: "America/Phoenix",
          dayOfMonth: 29,
        },
        now
      )
    ).toThrow(/month/);
  });
});

describe("isValidCalendarDate", () => {
  it("accepts real dates, including a leap day in a leap year", () => {
    expect(isValidCalendarDate(2026, 8, 27)).toBe(true);
    expect(isValidCalendarDate(2028, 2, 29)).toBe(true);
  });

  it("rejects a date that overflows its month", () => {
    expect(isValidCalendarDate(2026, 2, 29)).toBe(false); // 2026 is not leap
    expect(isValidCalendarDate(2026, 4, 31)).toBe(false); // April has 30 days
  });
});

describe("recurring reminder drift (regression)", () => {
  // Reproduces the dispatcher's real behavior: `agent/schedules/dynamic.ts`
  // ticks on a 1-minute cron, so a due row can only be picked up at a minute
  // boundary at or after it becomes due, and the row is written back some
  // seconds after that. The pre-fix formula was
  // `base = Math.max(now, nextRunAt); next = base + everyMinutes * 60_000`
  // (see git history of `agent/lib/schedule-store.ts` `completeRun` before
  // this fix) - carrying forward the actual (already-quantized-late) fire
  // instant instead of the original anchor. That makes drift a ratchet, not
  // mere jitter: once a fire lands even 1ms past a minute boundary, the next
  // one can only be caught on the following minute boundary, so the row is
  // permanently at least a full minute later than its predecessor. It is kept
  // here, reproduced verbatim, purely as the documented "old" behavior this
  // regression test proves the fix no longer exhibits.
  function oldRatchetNextMs(nowMs: number, dueMs: number): number {
    const everyMinutesMs = 24 * 60 * 60_000; // "daily" was always 1440 minutes
    const base = Math.max(nowMs, dueMs);
    return base + everyMinutesMs;
  }

  // One dispatcher cycle for a due row: the earliest minute boundary at or
  // after `dueMs` (the cron tick), plus a bit of execution/write latency.
  function simulateFire(dueMs: number, writeDelayMs: number): number {
    const tickMs = Math.ceil(dueMs / 60_000) * 60_000;
    return tickMs + writeDelayMs;
  }

  const timezone = "America/Phoenix";
  const rule: RecurrenceRule = { kind: "daily", hour: 9, minute: 0, timezone };

  it("keeps the wall-clock anchor exactly at 09:00 after 30 late, quantized fires - the pre-fix formula does not", () => {
    // A spread of realistic execution/write latencies (seconds), reused
    // cyclically so the simulation is deterministic.
    const writeDelaysMs = [1_000, 47_000, 3_000, 22_000, 8_000, 55_000, 14_000];

    let fixedDueMs = wallTimeToUtc(2026, 1, 1, 9, 0, timezone).getTime();
    let oldDueMs = fixedDueMs;

    for (let day = 0; day < 30; day++) {
      // day % writeDelaysMs.length is always in range; the fallback only
      // satisfies noUncheckedIndexedAccess.
      const writeDelayMs = writeDelaysMs[day % writeDelaysMs.length] ?? 1_000;

      const fixedFireMs = simulateFire(fixedDueMs, writeDelayMs);
      fixedDueMs = nextRecurrence(rule, new Date(fixedFireMs)).getTime();

      const oldFireMs = simulateFire(oldDueMs, writeDelayMs);
      oldDueMs = oldRatchetNextMs(oldFireMs, oldDueMs);
    }

    // The fix: still exactly 09:00 local on day 30, thirty late fires later.
    expect(localHhMm(fixedDueMs, timezone)).toBe("09:00");

    // The bug this reproduces, kept as a live contrast so the regression is
    // legible: the old formula has ratcheted forward by then, nowhere near
    // 09:00 any more (about +29 minutes/30 days, matching the measured
    // quantization-ratchet rate of roughly one minute of drift per day).
    expect(localHhMm(oldDueMs, timezone)).not.toBe("09:00");
    const driftMinutes = (oldDueMs - fixedDueMs) / 60_000;
    expect(driftMinutes).toBeGreaterThan(10);
  });
});
