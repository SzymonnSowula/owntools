import { describe, expect, it } from "vitest";
import { anchorFrom, DEFAULT_GAP, monitorAt, opensDown, pickMonitor, placeWindow, workAreaOf, type Box } from "./geometry";

// 1920×1080 at 100 % with a 48 px taskbar, and a 2560×1440 at 150 % to its left.
const laptop: Box = { x: 0, y: 0, width: 1920, height: 1032 };
const left: Box = { x: -2560, y: 0, width: 2560, height: 1392 };

describe("placeWindow", () => {
  it("puts the bar bottom centre, just above the taskbar", () => {
    const p = placeWindow(laptop, 1, null, { width: 90, height: 28 }, 28);
    expect(p).toEqual({ x: 915, y: 1032 - DEFAULT_GAP - 28, width: 90, height: 28, openDown: false });
  });

  it("grows a widget upwards and keeps the bar row where it was", () => {
    const bar = placeWindow(laptop, 1, null, { width: 420, height: 40 }, 40);
    const withPanel = placeWindow(laptop, 1, null, { width: 420, height: 300 }, 40);
    expect(withPanel.y + withPanel.height).toBe(bar.y + bar.height);
    expect(withPanel.x).toBe(bar.x);
  });

  it("converts logical sizes with the monitor's scale", () => {
    const p = placeWindow(left, 1.5, { monitor: "L", x: 0.5, gap: 10 }, { width: 100, height: 40 }, 40);
    expect(p.width).toBe(150);
    expect(p.height).toBe(60);
    expect(p.x).toBe(-2560 + 1280 - 75);
    expect(p.y).toBe(1392 - 15 - 60);
  });

  it("never leaves the work area", () => {
    const p = placeWindow(laptop, 1, { monitor: null, x: 1, gap: 0 }, { width: 400, height: 300 }, 40);
    expect(p.x + p.width).toBeLessThanOrEqual(laptop.width);
    expect(p.y + p.height).toBeLessThanOrEqual(laptop.height);
    const top = placeWindow(laptop, 1, { monitor: null, x: 0, gap: 5000 }, { width: 400, height: 300 }, 40);
    expect(top.x).toBe(0);
    expect(top.y).toBe(0);
  });

  it("opens widgets downwards when the bar was dragged into the top half", () => {
    const anchor = { monitor: null, x: 0.5, gap: 900 };
    expect(opensDown(laptop, 1, anchor)).toBe(true);
    const bar = placeWindow(laptop, 1, anchor, { width: 420, height: 40 }, 40);
    const withPanel = placeWindow(laptop, 1, anchor, { width: 420, height: 300 }, 40);
    expect(withPanel.openDown).toBe(true);
    expect(withPanel.y).toBe(bar.y);
    expect(opensDown(laptop, 1, null)).toBe(false);
  });
});

describe("anchorFrom", () => {
  it("round-trips a placement", () => {
    const anchor = { monitor: "L", x: 0.3, gap: 64 };
    const p = placeWindow(left, 1.5, anchor, { width: 90, height: 28 }, 28);
    const back = anchorFrom(left, 1.5, p, "L");
    expect(back.monitor).toBe("L");
    expect(back.gap).toBe(64);
    expect(Math.abs(back.x - 0.3)).toBeLessThan(0.001);
  });

  it("clamps a window dragged past the edge", () => {
    const a = anchorFrom(laptop, 1, { x: 1900, y: 1100, width: 90, height: 28 }, null);
    expect(a.x).toBe(1);
    expect(a.gap).toBe(0);
  });
});

describe("monitors", () => {
  const monitors = [
    { name: "\\\\.\\DISPLAY1", scaleFactor: 1, position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
    {
      name: "\\\\.\\DISPLAY2",
      scaleFactor: 1.5,
      position: { x: -2560, y: 0 },
      size: { width: 2560, height: 1440 },
      workArea: { position: { x: -2560, y: 0 }, size: { width: 2560, height: 1392 } },
    },
  ];

  it("finds the named monitor, else the primary", () => {
    expect(pickMonitor(monitors, monitors[0], "\\\\.\\DISPLAY2")?.scaleFactor).toBe(1.5);
    expect(pickMonitor(monitors, monitors[0], "gone")?.name).toBe("\\\\.\\DISPLAY1");
    expect(pickMonitor([], null, null)).toBeNull();
  });

  it("reads the work area, or the whole monitor without one", () => {
    expect(workAreaOf(monitors[1])).toEqual(left);
    expect(workAreaOf(monitors[0])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("finds the monitor under a point", () => {
    expect(monitorAt(monitors, -10, 500)?.name).toBe("\\\\.\\DISPLAY2");
    expect(monitorAt(monitors, 5000, 0)).toBeNull();
  });
});
