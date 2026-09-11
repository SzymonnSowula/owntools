import { describe, expect, it } from "vitest";
import { dayLabel, defaultTitle, firstLine, formatClock, formatDuration, meetingId, wordCount } from "./format";

describe("formatClock", () => {
  it("prints minutes and seconds, hours only when needed", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(4_000)).toBe("0:04");
    expect(formatClock(247_000)).toBe("4:07");
    expect(formatClock(3_735_000)).toBe("1:02:15");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("formatDuration", () => {
  it("rounds to the unit a person would say", () => {
    expect(formatDuration(35_000)).toBe("35 s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05 min");
    expect(formatDuration(2 * 3600_000)).toBe("2 h");
    expect(formatDuration(2 * 3600_000 + 59_800)).toBe("2 h 01 min");
  });
});

describe("defaultTitle", () => {
  it("names a call by weekday and time", () => {
    // Thursday 2026-09-10 14:32 local.
    expect(defaultTitle(new Date(2026, 8, 10, 14, 32))).toBe("Call · Thu 14:32");
    expect(defaultTitle(new Date(2026, 8, 13, 9, 5))).toBe("Call · Sun 09:05");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 8, 11, 18, 0);
  it("says today and yesterday, then the date", () => {
    expect(dayLabel(new Date(2026, 8, 11, 9, 0), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 8, 10, 23, 59), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 8, 7, 10, 0), now)).toMatch(/Monday.*7.*September/);
  });
});

describe("text helpers", () => {
  it("counts words and clips a first line", () => {
    expect(wordCount("  one two\nthree ")).toBe(3);
    expect(wordCount("")).toBe(0);
    expect(firstLine("\n\nWe agreed on the plan.\nMore.")).toBe("We agreed on the plan.");
    expect(firstLine("x".repeat(200), 20)).toHaveLength(20);
    expect(firstLine(undefined)).toBe("");
  });

  it("makes time-sortable folder ids", () => {
    const a = meetingId(new Date(2026, 8, 11, 14, 32, 5));
    expect(a).toMatch(/^20260911-143205-[a-z0-9]{4}$/);
    const b = meetingId(new Date(2026, 8, 11, 14, 32, 6));
    expect(b > a).toBe(true);
  });
});
