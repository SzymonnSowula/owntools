import { describe, expect, it } from "vitest";
import type { CursorSample, DisplaySources, MonitorInfo, Project } from "../types";
import {
  captureRectSuspect,
  confirmCaptureMatch,
  matchCaptureSource,
  reconcileCaptureRect,
} from "./captureSources";
import {
  captureRectAt,
  estimateCaptureRect,
  fitVideoOnMonitor,
  normalizeCursor,
  sameShape,
  zoomRect,
} from "./cursorMap";

/**
 * The numbers here are from the desk that found the bug: a 2560×1440 main
 * screen at the origin and a 1920×1080 one placed to its left, so the virtual
 * desktop runs from x = -1920 and is 4480 wide. Dividing a pointer position by
 * that 4480 — which is what the editor used to do — puts the cursor most of a
 * screen away from where it was.
 */
const MAIN: MonitorInfo = {
  id: "monitor:0",
  name: "Display 1",
  x: 0,
  y: 0,
  width: 2560,
  height: 1440,
  scale: 1,
  primary: true,
};
const LEFT: MonitorInfo = {
  id: "monitor:1",
  name: "Display 2",
  x: -1920,
  y: 217,
  width: 1920,
  height: 1080,
  scale: 1,
  primary: false,
};
/** A maximized window on the main screen: the work area above a 48 px taskbar. */
const MAXIMIZED = { x: 0, y: 0, width: 2560, height: 1392 };

const VIRTUAL = { x: -1920, y: 0, width: 4480, height: 1440 };

function sources(over: Partial<DisplaySources> = {}): DisplaySources {
  return {
    monitors: [MAIN, LEFT],
    windows: [
      { id: "1001", title: "Chrome — owntools", ...MAXIMIZED, foreground: true },
      { id: "1002", title: "Notes", x: 100, y: 100, width: 800, height: 600, foreground: false },
    ],
    virtualScreen: VIRTUAL,
    ...over,
  };
}

describe("normalizeCursor", () => {
  const videoAspect = 1920 / 1044;

  it("measures against the recorded window, not the whole desktop", () => {
    // A pointer near the top right of a maximized window.
    const p = normalizeCursor(2176, 403, MAXIMIZED, videoAspect);
    expect(p.nx).toBeCloseTo(0.85, 3);
    expect(p.ny).toBeCloseTo(0.29, 2);
    expect(p.inside).toBe(true);
    // What the old code did: the same point over the virtual desktop.
    expect(2176 / VIRTUAL.width).toBeCloseTo(0.486, 3);
  });

  it("handles a screen placed left of the primary, where x is negative", () => {
    const p = normalizeCursor(-960, 757, LEFT, 1920 / 1080);
    expect(p.nx).toBeCloseTo(0.5, 5);
    expect(p.ny).toBeCloseTo(0.5, 5);
    expect(p.inside).toBe(true);
  });

  it("reports a pointer that was on another screen", () => {
    expect(normalizeCursor(-500, 600, MAIN, 16 / 9).inside).toBe(false);
    expect(normalizeCursor(1280, 720, MAIN, 16 / 9).inside).toBe(true);
    // Just outside still counts: the pointer may sit on the very edge.
    expect(normalizeCursor(2565, 720, MAIN, 16 / 9).inside).toBe(true);
  });

  it("applies the manual nudge in frame space", () => {
    const base = normalizeCursor(1280, 720, MAIN, 16 / 9);
    const moved = normalizeCursor(1280, 720, MAIN, 16 / 9, { dx: 0.1, dy: -0.05, scale: 1 });
    expect(moved.nx).toBeCloseTo(base.nx + 0.1, 5);
    expect(moved.ny).toBeCloseTo(base.ny - 0.05, 5);

    // Spread pushes away from the centre, and leaves the centre itself put.
    const centre = normalizeCursor(1280, 720, MAIN, 16 / 9, { dx: 0, dy: 0, scale: 1.2 });
    expect(centre.nx).toBeCloseTo(0.5, 5);
    const corner = normalizeCursor(2560, 1440, MAIN, 16 / 9, { dx: 0, dy: 0, scale: 1.2 });
    expect(corner.nx).toBeCloseTo(1.1, 5);
  });

  it("letterboxes when the surface no longer matches the video's shape", () => {
    // A window resized mid-take: 4:3 content inside a 16:9 frame.
    const rect = { x: 0, y: 0, width: 1600, height: 1200 };
    const p = normalizeCursor(1600, 600, rect, 16 / 9);
    expect(p.nx).toBeLessThan(1);
    expect(p.nx).toBeCloseTo(0.5 + 0.5 * ((4 / 3) / (16 / 9)), 5);
    expect(p.ny).toBeCloseTo(0.5, 5);
  });
});

describe("captureRectAt", () => {
  const project = {
    captureRect: MAXIMIZED,
    surfaceTrack: [
      { t: 0, ...MAXIMIZED },
      { t: 5, x: 300, y: 120, width: 1200, height: 800 },
    ],
  } as Pick<Project, "captureRect" | "surfaceTrack">;

  it("follows a window that was moved mid-take", () => {
    expect(captureRectAt(project, 1)).toEqual(MAXIMIZED);
    expect(captureRectAt(project, 6)?.x).toBe(300);
  });

  it("falls back to the static rectangle without a track", () => {
    expect(captureRectAt({ captureRect: MAXIMIZED }, 99)).toEqual(MAXIMIZED);
    expect(captureRectAt({ captureRect: undefined }, 0)).toBeNull();
  });
});

describe("estimateCaptureRect", () => {
  const track = (x: number, y: number, n = 50): CursorSample[] =>
    Array.from({ length: n }, (_, i) => ({ t: i * 0.033, x: x + i, y: y + (i % 7), down: false }));

  it("recovers a maximized window from an old take's cursor track", () => {
    // Exactly the shape the broken recordings have: video 1920×1044 on a
    // 2560×1440 screen — a window filling the work area above the taskbar.
    const guess = estimateCaptureRect(
      { cursor: track(600, 300), videoWidth: 1920, videoHeight: 1044 },
      [MAIN, LEFT],
    );
    expect(guess?.source).toBe("estimated");
    expect(guess?.rect).toEqual({ x: 0, y: 0, width: 2560, height: 1392 });
  });

  it("takes the whole screen when the shapes agree", () => {
    const guess = estimateCaptureRect(
      { cursor: track(600, 300), videoWidth: 1920, videoHeight: 1080 },
      [MAIN, LEFT],
    );
    expect(guess?.source).toBe("monitor");
    expect(guess?.rect).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
  });

  it("picks the screen the pointer was actually on", () => {
    const guess = estimateCaptureRect(
      { cursor: track(-1500, 400), videoWidth: 1920, videoHeight: 1080 },
      [MAIN, LEFT],
    );
    expect(guess?.rect.x).toBe(-1920);
  });

  it("gives up rather than guess when the take wandered across screens", () => {
    const mixed = [...track(600, 300, 30), ...track(-1500, 400, 30)];
    expect(estimateCaptureRect({ cursor: mixed, videoWidth: 1920, videoHeight: 1080 }, [MAIN, LEFT])).toBeNull();
    expect(estimateCaptureRect({ cursor: [], videoWidth: 1920, videoHeight: 1080 }, [MAIN])).toBeNull();
  });
});

describe("matchCaptureSource", () => {
  it("matches a full-screen take to the screen it came from", () => {
    const m = matchCaptureSource({ surface: "monitor", width: 1920, height: 1080 }, sources());
    expect(m?.source).toBe("monitor");
    expect(m?.confidence).toBe("exact");
    expect(m?.rect.x).toBe(-1920);
  });

  it("matches a downscaled screen by its shape", () => {
    // A 2560×1440 screen handed back as 1920×1080 by the browser.
    const m = matchCaptureSource({ surface: "monitor", width: 1920, height: 1080 }, sources({ monitors: [MAIN] }));
    expect(m?.rect).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
    expect(m?.confidence).toBe("likely");
  });

  it("matches a window take to the window, and remembers it for tracking", () => {
    const m = matchCaptureSource({ surface: "window", width: 1920, height: 1044 }, sources());
    expect(m?.source).toBe("window");
    expect(m?.windowId).toBe("1001");
    expect(m?.rect).toEqual(MAXIMIZED);
  });

  it("separates identical screens by where the pointer was", () => {
    const twin: MonitorInfo = { ...LEFT, id: "monitor:2", name: "Display 3", x: 2560, y: 0 };
    const m = matchCaptureSource(
      { surface: "monitor", width: 1920, height: 1080 },
      sources({ monitors: [LEFT, twin] }),
      { x: 3000, y: 500 },
    );
    expect(m?.rect.x).toBe(2560);
  });

  it("refuses a browser tab, which has no place on the desktop", () => {
    expect(matchCaptureSource({ surface: "browser", width: 1920, height: 969 }, sources())).toBeNull();
  });

  it("returns nothing when no candidate has the right shape", () => {
    expect(matchCaptureSource({ surface: "monitor", width: 1000, height: 1000 }, sources())).toBeNull();
    expect(matchCaptureSource({ surface: "monitor", width: 1920, height: 1080 }, null)).toBeNull();
  });
});

describe("zoomRect", () => {
  it("prefers the recorded rectangle and falls back to the stored screen size", () => {
    const base = { captureRect: MAXIMIZED, screenWidth: 4480, screenHeight: 1440 } as Project;
    expect(zoomRect(base)).toEqual(MAXIMIZED);
    const legacy = { screenWidth: 4480, screenHeight: 1440, videoWidth: 1920, videoHeight: 1044 } as Project;
    expect(zoomRect(legacy)).toEqual({ x: 0, y: 0, width: 4480, height: 1440 });
  });
});

describe("fitVideoOnMonitor", () => {
  it("anchors a window's shape at the screen's top-left", () => {
    expect(fitVideoOnMonitor(MAIN, 2560, 1392)).toEqual(MAXIMIZED);
    expect(fitVideoOnMonitor(MAIN, 1920, 1044)).toEqual(MAXIMIZED);
  });

  it("keeps the whole screen when the shapes agree", () => {
    expect(fitVideoOnMonitor(MAIN, 1920, 1080)).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
    expect(sameShape(2560, 1440, 1920, 1080)).toBe(true);
    expect(sameShape(2560, 1440, 2560, 1392)).toBe(false);
  });
});

/**
 * The take that found this: a window capture whose track, asked right after
 * the picker closed, reported the screen's 2560×1440 — a track reports its
 * source's format until the first frame arrives — while the file on disk
 * turned out 2560×1392, the work area a maximized window fills.
 */
describe("confirmCaptureMatch", () => {
  const early = matchCaptureSource({ surface: "window", width: 2560, height: 1440 }, sources());

  it("starts from the wrong surface", () => {
    expect(early?.source).toBe("monitor");
  });

  it("matches again with the file's real size", () => {
    const fixed = confirmCaptureMatch(early, "window", { width: 2560, height: 1392 }, sources(), { x: 900, y: 700 });
    expect(fixed?.source).toBe("window");
    expect(fixed?.rect).toEqual(MAXIMIZED);
    expect(fixed?.windowId).toBe("1001");
  });

  it("keeps a match whose shape the file confirms", () => {
    const m = matchCaptureSource({ surface: "monitor", width: 2560, height: 1440 }, sources());
    expect(confirmCaptureMatch(m, "monitor", { width: 1920, height: 1080 }, sources(), null)).toBe(m);
    expect(confirmCaptureMatch(m, "monitor", { width: 0, height: 0 }, sources(), null)).toBe(m);
  });
});

describe("reconcileCaptureRect", () => {
  const track = (x: number, y: number, n = 50): CursorSample[] =>
    Array.from({ length: n }, (_, i) => ({ t: i * 0.033, x: x + i, y: y + (i % 7), down: false }));
  const recorded = {
    captureRect: { x: 0, y: 0, width: 2560, height: 1440 },
    captureSource: "monitor" as const,
    captureLabel: "\\.\DISPLAY4 · 2560×1440",
    captureSurface: "window" as const,
    cursor: track(600, 300),
    videoWidth: 2560,
    videoHeight: 1392,
  };

  it("flags a screen rectangle on a window-shaped video, and nothing else", () => {
    expect(captureRectSuspect(recorded)).toBe(true);
    expect(captureRectSuspect({ ...recorded, videoHeight: 1440 })).toBe(false);
    expect(captureRectSuspect({ ...recorded, captureSource: "manual" })).toBe(false);
    expect(captureRectSuspect({ ...recorded, captureSource: "estimated" })).toBe(false);
  });

  it("finds the window that is still open", () => {
    const fixed = reconcileCaptureRect(recorded, sources());
    expect(fixed?.source).toBe("window");
    expect(fixed?.rect).toEqual(MAXIMIZED);
  });

  it("falls back to a maximized window on the stored screen", () => {
    const fixed = reconcileCaptureRect(recorded, sources({ windows: [] }));
    expect(fixed?.source).toBe("estimated");
    expect(fixed?.rect).toEqual(MAXIMIZED);
    expect(fixed?.label).toBe("a window on Display 1 · 2560×1392");
    // No screen list at all (the browser preview): the stored label names the screen.
    expect(reconcileCaptureRect(recorded, null)?.label).toBe("a window on \\.\DISPLAY4 · 2560×1392");
  });

  it("does not hand a window take to a same-shaped screen", () => {
    // A 16:9 window whose window has since closed: the 1920×1080 screen is not it.
    const closed = { ...recorded, videoWidth: 1600, videoHeight: 900 };
    expect(reconcileCaptureRect(closed, sources({ windows: [] }))).toBeNull();
  });

  it("gives up on a small window rather than guess", () => {
    const small = { ...recorded, videoWidth: 1200, videoHeight: 800 };
    expect(reconcileCaptureRect(small, sources({ windows: [] }))).toBeNull();
  });
});
