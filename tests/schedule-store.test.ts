import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  rowToRule,
  type RecurrenceFields,
} from "@/agent/lib/schedule-store";

// computeNextRunAt/rowToRule are the DB-free core of `completeRun` (see
// `agent/lib/schedule-store.ts`): mapping a persisted row to a
// `RecurrenceRule` and deriving the next run instant from it. Exercised here
// directly, without a database, against the stored-row shape rather than the
// in-memory `RecurrenceRule` type tested in `tests/schedule-time.test.ts`.

const oneTimeRow: RecurrenceFields = {
  repeatKind: null,
  timezone: null,
  anchorHour: null,
  anchorMinute: null,
  repeatDayOfWeek: null,
  repeatDayOfMonth: null,
  repeatMonth: null,
};

const dailyRow: RecurrenceFields = {
  repeatKind: "daily",
  timezone: "America/Phoenix",
  anchorHour: 9,
  anchorMinute: 0,
  repeatDayOfWeek: null,
  repeatDayOfMonth: null,
  repeatMonth: null,
};

const weeklyRow: RecurrenceFields = {
  repeatKind: "weekly",
  timezone: "America/Phoenix",
  anchorHour: 9,
  anchorMinute: 0,
  repeatDayOfWeek: 1, // Monday
  repeatDayOfMonth: null,
  repeatMonth: null,
};

const monthlyRow: RecurrenceFields = {
  repeatKind: "monthly",
  timezone: "America/Phoenix",
  anchorHour: 9,
  anchorMinute: 0,
  repeatDayOfWeek: null,
  repeatDayOfMonth: 31,
  repeatMonth: null,
};

const yearlyRow: RecurrenceFields = {
  repeatKind: "yearly",
  timezone: "America/Phoenix",
  anchorHour: 9,
  anchorMinute: 0,
  repeatDayOfWeek: null,
  repeatDayOfMonth: 29,
  repeatMonth: 2,
};

describe("rowToRule", () => {
  it("returns null for a one-time row (repeatKind null)", () => {
    expect(rowToRule(oneTimeRow)).toBeNull();
  });

  it("rebuilds a RecurrenceRule per kind, omitting fields the kind does not use", () => {
    expect(rowToRule(dailyRow)).toEqual({
      kind: "daily",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
    });
    expect(rowToRule(weeklyRow)).toEqual({
      kind: "weekly",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
      dayOfWeek: 1,
    });
    expect(rowToRule(monthlyRow)).toEqual({
      kind: "monthly",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
      dayOfMonth: 31,
    });
    expect(rowToRule(yearlyRow)).toEqual({
      kind: "yearly",
      hour: 9,
      minute: 0,
      timezone: "America/Phoenix",
      dayOfMonth: 29,
      month: 2,
    });
  });
});

describe("computeNextRunAt", () => {
  it("returns null for a one-time row - the caller disables it instead of rescheduling", () => {
    expect(computeNextRunAt(oneTimeRow, new Date())).toBeNull();
  });

  it("re-anchors a daily row to its fixed wall-clock time regardless of how late `now` is", () => {
    // Due at 2026-08-28 09:00 Phoenix (16:00Z); "now" is over an hour late.
    const now = new Date("2026-08-28T17:30:00.000Z");
    const next = computeNextRunAt(dailyRow, now);
    expect(next?.toISOString()).toBe("2026-08-29T16:00:00.000Z");
  });

  it("re-anchors a weekly row to the next matching weekday", () => {
    const now = new Date("2026-08-26T12:00:00.000Z"); // a Wednesday
    const next = computeNextRunAt(weeklyRow, now);
    expect(next?.toISOString()).toBe("2026-08-31T16:00:00.000Z"); // next Monday
  });
});
