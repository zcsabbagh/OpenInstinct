import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  nextOccurrence,
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
