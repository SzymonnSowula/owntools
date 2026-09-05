import { describe, expect, it } from "vitest";
import {
  formatWeekTitle,
  fromIso,
  isPastSlot,
  monthGrid,
  moveToDay,
  nextDefaultSlot,
  parseHm,
  relativeTime,
  roundToStep,
  slotDate,
  toIso,
  weekRange,
} from "./time";

describe("time helpers", () => {
  it("round-trips ISO with the local offset", () => {
    const d = new Date(2026, 3, 6, 9, 30, 0);
    const iso = toIso(d);
    expect(iso.startsWith("2026-04-06T09:30:00")).toBe(true);
    expect(/[+-]\d{2}:\d{2}$/.test(iso)).toBe(true);
    expect(fromIso(iso)?.getTime()).toBe(d.getTime());
    expect(fromIso("nope")).toBeNull();
    expect(fromIso(null)).toBeNull();
  });

  it("builds Monday- and Sunday-first weeks", () => {
    const wed = new Date(2026, 3, 8);
    const mon = weekRange(wed, 1);
    expect(mon.days[0]!.getDay()).toBe(1);
    expect(mon.days[0]!.getDate()).toBe(6);
    expect(mon.days).toHaveLength(7);
    const sun = weekRange(wed, 0);
    expect(sun.days[0]!.getDay()).toBe(0);
    expect(formatWeekTitle(mon.start, mon.end)).toBe("April 6 – 12, 2026");
    const cross = weekRange(new Date(2025, 11, 31), 1);
    expect(formatWeekTitle(cross.start, cross.end)).toBe("Dec 29, 2025 – Jan 4, 2026");
  });

  it("pads the month grid to whole weeks", () => {
    const rows = monthGrid(new Date(2026, 1, 1), 1);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(row).toHaveLength(7);
    expect(rows[0]![0]!.getDay()).toBe(1);
  });

  it("moves and rounds times", () => {
    const src = new Date(2026, 3, 6, 14, 37);
    const moved = moveToDay(src, new Date(2026, 3, 9));
    expect([moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([9, 14, 37]);
    expect(roundToStep(src).getMinutes()).toBe(35);
    expect(roundToStep(new Date(2026, 3, 6, 14, 33), 15).getMinutes()).toBe(30);
    expect(slotDate(new Date(2026, 3, 6, 23, 59), 9, 15).getHours()).toBe(9);
  });

  it("knows what is past and how far away things are", () => {
    const now = new Date(2026, 3, 6, 10, 30);
    expect(isPastSlot(now, 9, now)).toBe(true);
    expect(isPastSlot(now, 10, now)).toBe(false);
    expect(relativeTime(new Date(2026, 3, 6, 10, 45), now)).toBe("in 15 min");
    expect(relativeTime(new Date(2026, 3, 6, 8, 20), now)).toBe("2 h ago");
    expect(relativeTime(new Date(2026, 3, 7, 9, 0), now)).toBe("tomorrow 9:00 am");
    expect(parseHm("09:00")).toEqual([9, 0]);
    expect(parseHm("25:00")).toBeNull();
    const slot = nextDefaultSlot(new Date(2026, 3, 6, 10, 31));
    expect(slot.getMinutes() % 15).toBe(0);
    expect(slot.getTime()).toBeGreaterThan(new Date(2026, 3, 6, 10, 45).getTime() - 1);
  });
});
