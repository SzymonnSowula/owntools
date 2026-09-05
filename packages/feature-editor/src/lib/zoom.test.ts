import { describe, expect, it } from "vitest";
import type { CursorSample, ZoomClip } from "../types";
import { anchorFor, cameraPath, generateZoomKeyframes, getZoomTransform, sampleCursorAt, viewWindow } from "./zoom";

/**
 * The take that found the bug: a maximized 2560×1392 window and a click on
 * the account button in its bottom-left corner (x = 113, y = 1365). Using
 * that click as the scale anchor — clamped to 0.9 — showed 0.41–0.95 of the
 * frame: the click, and the menu it opened, sat below the shot.
 */
const WINDOW = { x: 0, y: 0, width: 2560, height: 1392 };
const CLICK = { x: 113 / 2560, y: 1365 / 1392 };

function clip(over: Partial<ZoomClip> = {}): ZoomClip {
  return {
    id: "z",
    start: 0,
    end: 10,
    scale: 1.85,
    x: 0.5,
    y: 0.5,
    easing: "ease-in-out",
    followCursor: false,
    source: "auto",
    ...over,
  };
}

describe("anchorFor", () => {
  it("keeps a centred point centred", () => {
    expect(anchorFor(0.5, 1.85)).toBeCloseTo(0.5, 6);
  });

  it("centres the view on an interior point", () => {
    const view = viewWindow(anchorFor(0.7, 1.85), 1.85);
    expect((view.start + view.end) / 2).toBeCloseTo(0.7, 6);
  });

  it("frames a point near an edge with the edge, never past it", () => {
    expect(anchorFor(CLICK.y, 1.85)).toBe(1);
    expect(anchorFor(CLICK.x, 1.85)).toBe(0);
    const view = viewWindow(1, 1.85);
    expect(view.end).toBeCloseTo(1, 6);
    expect(view.start).toBeGreaterThanOrEqual(0);
    expect(CLICK.y).toBeLessThanOrEqual(view.end);
  });

  it("is the whole frame at scale 1", () => {
    expect(anchorFor(0.9, 1)).toBe(0.5);
    expect(viewWindow(anchorFor(0.9, 1), 1)).toEqual({ start: 0, end: 1 });
  });

  it("keeps every point in shot and the view inside the frame", () => {
    for (let s = 1; s <= 3; s += 0.05) {
      for (let p = 0; p <= 1; p += 0.05) {
        const view = viewWindow(anchorFor(p, s), s);
        expect(view.start).toBeGreaterThanOrEqual(-1e-9);
        expect(view.end).toBeLessThanOrEqual(1 + 1e-9);
        expect(p).toBeGreaterThanOrEqual(view.start - 1e-9);
        expect(p).toBeLessThanOrEqual(view.end + 1e-9);
      }
    }
  });
});

describe("getZoomTransform", () => {
  it("keeps a click in the bottom-left corner in shot at full zoom", () => {
    const t = getZoomTransform([clip(CLICK)], 5, [], WINDOW);
    expect(t.scale).toBeCloseTo(1.85, 6);
    const ys = viewWindow(t.y, t.scale);
    expect(ys.end).toBeCloseTo(1, 6);
    expect(CLICK.y).toBeLessThanOrEqual(ys.end);
    expect(viewWindow(t.x, t.scale).start).toBeCloseTo(0, 6);
  });

  it("is what the old anchor clamp could not do", () => {
    // Anchor 0.9, where the generator used to clamp a corner click.
    expect(viewWindow(0.9, 1.85).end).toBeLessThan(CLICK.y);
  });

  it("shows the whole frame outside a clip and stays flush with the edge while easing in", () => {
    const z = clip({ start: 2, end: 8, ...CLICK });
    expect(getZoomTransform([z], 0, [], WINDOW)).toEqual({ scale: 1, x: 0.5, y: 0.5 });
    const mid = getZoomTransform([z], 2.3, [], WINDOW);
    expect(mid.scale).toBeGreaterThan(1);
    expect(mid.scale).toBeLessThan(1.85);
    expect(viewWindow(mid.y, mid.scale).end).toBeCloseTo(1, 6);
  });

  it("follows the cursor without leaving the frame", () => {
    const cursor: CursorSample[] = Array.from({ length: 300 }, (_, i) => ({
      t: i * 0.033,
      x: 2500,
      y: 1380,
      down: false,
    }));
    const t = getZoomTransform([clip({ followCursor: true })], 5, cursor, WINDOW);
    const view = viewWindow(t.x, t.scale);
    expect(view.end).toBeLessThanOrEqual(1 + 1e-9);
    expect(view.start).toBeGreaterThan(0.2);
  });
});

describe("generateZoomKeyframes", () => {
  it("no longer pushes a corner click away from the corner", () => {
    const samples: CursorSample[] = [];
    for (let i = 0; i < 200; i++) {
      samples.push({ t: i * 0.033, x: 113 + (i % 3), y: 1365 + (i % 2), down: i >= 60 && i < 64 });
    }
    const clips = generateZoomKeyframes(samples, WINDOW);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips[0].x).toBeLessThan(0.1);
    expect(clips[0].y).toBeGreaterThan(0.9);
  });
});

describe("camera", () => {
  const still = (x: number, y: number, from: number, to: number, out: CursorSample[]) => {
    for (let t = from; t < to; t += 1 / 30) out.push({ t, x, y, down: false });
  };
  const inShot = (t: number, z: { scale: number; x: number; y: number }, c: CursorSample) => {
    const vx = viewWindow(z.x, z.scale);
    const vy = viewWindow(z.y, z.scale);
    const px = c.x / WINDOW.width;
    const py = c.y / WINDOW.height;
    expect(px, `x at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(vx.start - 0.01);
    expect(px, `x at ${t.toFixed(2)}`).toBeLessThanOrEqual(vx.end + 0.01);
    expect(py, `y at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(vy.start - 0.01);
    expect(py, `y at ${t.toFixed(2)}`).toBeLessThanOrEqual(vy.end + 0.01);
  };

  it("keeps a flicking cursor in shot on every frame", () => {
    const cursor: CursorSample[] = [];
    still(300, 1200, 0, 3, cursor);
    still(2300, 200, 3.1, 6, cursor);
    const clips = [clip({ x: 300 / 2560, y: 1200 / 1392, followCursor: true, end: 6 })];
    for (let t = 0; t <= 6; t += 1 / 60) inShot(t, getZoomTransform(clips, t, cursor, WINDOW), sampleCursorAt(cursor, t)!);
  });

  it("leaves the camera alone while the cursor is on another screen", () => {
    const cursor: CursorSample[] = [];
    still(1280, 700, 0, 2, cursor);
    still(-1000, 700, 2, 8, cursor);
    const clips = [clip({ followCursor: true, end: 8 })];
    const before = getZoomTransform(clips, 1.9, cursor, WINDOW);
    const after = getZoomTransform(clips, 5, cursor, WINDOW);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(after.scale).toBeCloseTo(before.scale, 3);
  });

  it("does not move for small motion inside the dead zone", () => {
    const cursor: CursorSample[] = [];
    still(1280, 700, 0, 2, cursor);
    still(1430, 780, 2, 5, cursor);
    const clips = [clip({ followCursor: true, end: 6 })];
    const a = getZoomTransform(clips, 1.9, cursor, WINDOW);
    const b = getZoomTransform(clips, 4.5, cursor, WINDOW);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
  });

  it("widens the shot while the cursor sweeps across the screen, then comes back", () => {
    const cursor: CursorSample[] = [];
    still(300, 700, 0, 3, cursor);
    for (let t = 3; t < 3.6; t += 1 / 30) cursor.push({ t, x: 300 + (t - 3) * 3333, y: 700, down: false });
    still(2300, 700, 3.6, 8, cursor);
    const clips = [clip({ x: 300 / 2560, followCursor: true, end: 8 })];
    const rest = getZoomTransform(clips, 2.5, cursor, WINDOW).scale;
    const sweep = getZoomTransform(clips, 3.5, cursor, WINDOW).scale;
    const settled = getZoomTransform(clips, 7, cursor, WINDOW).scale;
    expect(rest).toBeCloseTo(1.85, 3);
    expect(sweep).toBeLessThan(rest - 0.1);
    expect(settled).toBeCloseTo(rest, 1);
    for (let t = 0; t <= 8; t += 1 / 60) inShot(t, getZoomTransform(clips, t, cursor, WINDOW), sampleCursorAt(cursor, t)!);
  });

  it("holds the zoom while the pointer rests, then lets go", () => {
    const samples: CursorSample[] = [];
    still(800, 600, 0, 5.5, samples);
    for (let t = 5.5; t < 9; t += 1 / 30) samples.push({ t, x: 800 + (t - 5.5) * 400, y: 600 + (t - 5.5) * 300, down: false });
    const clips = generateZoomKeyframes(samples, WINDOW);
    expect(clips.length).toBe(1);
    expect(clips[0].start).toBeLessThan(0.1);
    expect(clips[0].end).toBeGreaterThan(5.5);
    expect(clips[0].end).toBeLessThan(8.5);
  });

  it("solves the path once per clip list", () => {
    const cursor: CursorSample[] = [];
    still(1280, 700, 0, 3, cursor);
    const clips = [clip({ followCursor: true })];
    expect(cameraPath(clips, cursor, WINDOW)).toBe(cameraPath(clips, cursor, WINDOW));
    expect(cameraPath([...clips], cursor, WINDOW)).not.toBe(cameraPath(clips, cursor, WINDOW));
  });
});
