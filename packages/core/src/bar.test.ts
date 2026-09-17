import { beforeEach, describe, expect, it } from "vitest";
import {
  BAR_SETTINGS_KEY,
  DEFAULT_BAR_SETTINGS,
  focusActive,
  focusClockMs,
  focusProgress,
  focusTickPhase,
  formatClock,
  formatMinutes,
  getBarSettings,
  IDLE_BAR_STATE,
  meetElapsedMs,
  meetTickPhase,
  normalizeBarSettings,
  setBarSettings,
  type BarFocusState,
} from "./bar";

const focus = (patch: Partial<BarFocusState>): BarFocusState => ({ ...IDLE_BAR_STATE.focus, ...patch });

describe("bar settings", () => {
  beforeEach(() => localStorage.clear());

  it("starts switched on, at the default spot", () => {
    expect(getBarSettings()).toEqual(DEFAULT_BAR_SETTINGS);
  });

  it("reads back what was written, and hands out the same object until it changes", () => {
    setBarSettings({ enabled: false, anchor: { monitor: "A", x: 0.25, gap: 40 } });
    const first = getBarSettings();
    expect(first.enabled).toBe(false);
    expect(first.anchor).toEqual({ monitor: "A", x: 0.25, gap: 40 });
    expect(getBarSettings()).toBe(first);
    setBarSettings({ introduced: true });
    expect(getBarSettings()).not.toBe(first);
    expect(getBarSettings().enabled).toBe(false);
  });

  it("repairs whatever is stored", () => {
    localStorage.setItem(BAR_SETTINGS_KEY, "{not json");
    expect(getBarSettings()).toEqual(DEFAULT_BAR_SETTINGS);
    expect(normalizeBarSettings({ enabled: "yes", anchor: { x: 7, gap: -3 }, focusMinutes: 9999 })).toEqual({
      enabled: true,
      anchor: { monitor: null, x: 1, gap: 0 },
      introduced: false,
      focusMinutes: 240,
    });
    expect(normalizeBarSettings({ anchor: { x: "0.5" } }).anchor).toBeNull();
  });
});

describe("focus clock", () => {
  it("counts down from endAt while running and holds while paused", () => {
    const running = focus({ running: true, endAt: 10_000 + 90_000, durationMs: 25 * 60_000, remainingMs: 90_000 });
    expect(focusClockMs(running, 10_000)).toBe(90_000);
    expect(focusClockMs(running, 200_000)).toBe(0);
    const paused = focus({ remainingMs: 60_000, durationMs: 25 * 60_000 });
    expect(focusClockMs(paused, 123)).toBe(60_000);
    expect(focusActive(paused)).toBe(true);
  });

  it("counts up for a stopwatch", () => {
    const sw = focus({ stopwatch: true, running: true, startedAt: 1_000 });
    expect(focusClockMs(sw, 61_000)).toBe(60_000);
    expect(focusProgress(sw, 61_000)).toBe(0);
  });

  it("is not active before a session starts or after a reset", () => {
    expect(focusActive(focus({ remainingMs: 25 * 60_000, durationMs: 25 * 60_000 }))).toBe(false);
    expect(focusActive(IDLE_BAR_STATE.focus)).toBe(false);
  });

  it("reports progress through a countdown", () => {
    const f = focus({ running: true, endAt: 50_000, durationMs: 100_000 });
    expect(focusProgress(f, 0)).toBe(0.5);
    expect(focusProgress(f, 250)).toBeCloseTo(0.5025);
  });

  it("shows whole seconds: a countdown rounds up, a stopwatch down", () => {
    const start = 1_000_000;
    const countdown = focus({ running: true, endAt: start + 25 * 60_000, durationMs: 25 * 60_000 });
    // 25:00 when it starts, 24:59 a moment later, 0:01 until the very end.
    expect(formatClock(focusClockMs(countdown, start))).toBe("25:00");
    expect(formatClock(focusClockMs(countdown, start + 1))).toBe("25:00");
    expect(formatClock(focusClockMs(countdown, start + 1_000))).toBe("24:59");
    expect(formatClock(focusClockMs(countdown, start + 25 * 60_000 - 400))).toBe("0:01");
    expect(formatClock(focusClockMs(countdown, start + 25 * 60_000))).toBe("0:00");
    const sw = focus({ stopwatch: true, running: true, startedAt: start });
    expect(formatClock(focusClockMs(sw, start + 59_999))).toBe("0:59");
  });

  it("ticks on the second boundaries of the running clock", () => {
    expect(focusTickPhase(focus({ running: true, endAt: 123_456 }))).toBe(123_456);
    expect(focusTickPhase(focus({ running: true, stopwatch: true, startedAt: 777 }))).toBe(777);
    expect(focusTickPhase(focus({ running: false, endAt: 123_456 }))).toBeNull();
  });
});

describe("meeting clock", () => {
  it("runs on from the last phase change only while recording", () => {
    const at = 1_000_000;
    expect(meetElapsedMs({ phase: "recording", elapsedMs: 5_000, at, error: null }, at + 2_000)).toBe(7_000);
    expect(meetElapsedMs({ phase: "paused", elapsedMs: 5_000, at, error: null }, at + 2_000)).toBe(5_000);
    expect(meetElapsedMs({ phase: "recording", elapsedMs: 5_400, at, error: null }, at + 500)).toBe(5_000);
    expect(meetTickPhase({ phase: "recording", elapsedMs: 5_400, at, error: null })).toBe(at - 5_400);
    expect(meetTickPhase({ phase: "paused", elapsedMs: 5_400, at, error: null })).toBeNull();
  });
});

describe("formatting", () => {
  it("writes clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(18 * 60_000 + 32_000)).toBe("18:32");
    expect(formatClock(3_727_000)).toBe("1:02:07");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("writes minutes, rounding what is left up", () => {
    expect(formatMinutes(30_000)).toBe("<1 min");
    expect(formatMinutes(18 * 60_000 + 1)).toBe("19 min");
    expect(formatMinutes(60 * 60_000)).toBe("1 h");
    expect(formatMinutes(65 * 60_000)).toBe("1 h 5 min");
  });
});
