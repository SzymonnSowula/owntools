import { describe, expect, it } from "vitest";
import { formatBytes, formatWhen, monthLabel } from "./format";

describe("formatBytes", () => {
  it("keeps zero as a plain 0 B and scales up", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(3.4 * 1024)).toBe("3.4 KB");
    expect(formatBytes(200 * 1024)).toBe("200 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12.0 MB");
    expect(formatBytes(1.2 * 1024 ** 3)).toBe("1.20 GB");
  });
});

describe("formatWhen", () => {
  const now = new Date(2026, 8, 11, 14, 30).getTime();
  it("speaks relative for the recent past and by clock further back", () => {
    expect(formatWhen(now - 10_000, now)).toBe("just now");
    expect(formatWhen(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(formatWhen(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(formatWhen(new Date(2026, 8, 11, 7, 5).getTime(), now)).toBe("today 07:05");
    expect(formatWhen(new Date(2026, 8, 10, 9, 15).getTime(), now)).toBe("yesterday 09:15");
    expect(formatWhen(new Date(2026, 8, 3, 14, 2).getTime(), now)).toBe("3 Sep 14:02");
    expect(formatWhen(new Date(2025, 8, 3, 14, 2).getTime(), now)).toBe("3 Sep 2025 14:02");
  });
});

describe("monthLabel", () => {
  const now = new Date(2026, 8, 11).getTime();
  it("names the two months the picker offers and spells out any other", () => {
    expect(monthLabel("2026-09", now)).toBe("this month");
    expect(monthLabel("2026-08", now)).toBe("last month");
    expect(monthLabel("2026-03", now)).toBe("March 2026");
  });
});
