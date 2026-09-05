import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Segment } from "../types";
import {
  TransitionTracker,
  clampTransitionDuration,
  easeInOut,
  fadeVeilAlpha,
  nextSegmentHasTransition,
  segmentIndexAtTimeline,
  segmentTimelineStart,
  timeToNextCut,
  transitionAt,
} from "./transitions";

const segments: Segment[] = [
  { id: "a", start: 0, end: 4 },
  { id: "b", start: 10, end: 13, transition: { kind: "crossfade", duration: 0.5 } },
  { id: "c", start: 20, end: 20.2, transition: { kind: "dip-black", duration: 1 } },
  { id: "d", start: 30, end: 35 },
];

describe("segment lookup", () => {
  it("maps timeline time to the segment index", () => {
    expect(segmentIndexAtTimeline(segments, 0)).toBe(0);
    expect(segmentIndexAtTimeline(segments, 3.99)).toBe(0);
    expect(segmentIndexAtTimeline(segments, 4)).toBe(1);
    expect(segmentIndexAtTimeline(segments, 7.1)).toBe(2);
    expect(segmentIndexAtTimeline(segments, 99)).toBe(3);
    expect(segmentIndexAtTimeline([], 1)).toBe(-1);
  });

  it("knows where each segment starts on the timeline", () => {
    expect(segmentTimelineStart(segments, 0)).toBe(0);
    expect(segmentTimelineStart(segments, 1)).toBe(4);
    expect(segmentTimelineStart(segments, 2)).toBe(7);
    expect(segmentTimelineStart(segments, 3)).toBeCloseTo(7.2);
  });
});

describe("transitionAt", () => {
  it("is null in the first segment and after the window", () => {
    expect(transitionAt(segments, 1)).toBeNull();
    expect(transitionAt(segments, 4.6)).toBeNull();
  });

  it("reports progress inside the window", () => {
    const win = transitionAt(segments, 4.25);
    expect(win?.index).toBe(1);
    expect(win?.transition.kind).toBe("crossfade");
    expect(win?.progress).toBeCloseTo(0.5);
  });

  it("caps the window at the segment's own length", () => {
    // Segment c is 0.2 s long but asks for a 1 s dip.
    expect(transitionAt(segments, 7.1)?.progress).toBeCloseTo(0.5);
    expect(transitionAt(segments, 7.25)).toBeNull();
  });

  it("ignores cuts without a transition", () => {
    expect(transitionAt(segments, 7.3)).toBeNull();
  });
});

describe("snapshot timing helpers", () => {
  it("counts down to the next cut", () => {
    expect(timeToNextCut(segments, 3.9)).toBeCloseTo(0.1);
    expect(timeToNextCut(segments, 4)).toBeCloseTo(3);
  });

  it("knows whether the upcoming segment blends", () => {
    expect(nextSegmentHasTransition(segments, 1)).toBe(true);
    expect(nextSegmentHasTransition(segments, 7.1)).toBe(false);
    expect(nextSegmentHasTransition(segments, 8)).toBe(false);
  });
});

describe("curves", () => {
  it("eases with flat ends", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });

  it("clamps durations", () => {
    expect(clampTransitionDuration(0)).toBe(0.2);
    expect(clampTransitionDuration(9)).toBe(1.5);
    expect(clampTransitionDuration(Number.NaN)).toBe(0.5);
  });

  it("fades the ends of the timeline", () => {
    expect(fadeVeilAlpha(0, 10, 1, 1)).toBe(1);
    expect(fadeVeilAlpha(0.5, 10, 1, 1)).toBeCloseTo(0.5);
    expect(fadeVeilAlpha(5, 10, 1, 1)).toBe(0);
    expect(fadeVeilAlpha(9.75, 10, 1, 1)).toBeCloseTo(0.75);
    expect(fadeVeilAlpha(3, 10, 0, 0)).toBe(0);
  });
});

describe("TransitionTracker", () => {
  beforeAll(() => {
    // jsdom has no 2D context; the tracker only ever draws one image into it.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as HTMLCanvasElement["getContext"];
  });

  const T = { kind: "crossfade" as const, duration: 0.5 };
  /** Clips shorter than the transition, a cut every few tenths — the flickering case. */
  const quick: Segment[] = [
    { id: "a", start: 0, end: 1.2 },
    { id: "b", start: 5, end: 5.4, transition: T },
    { id: "c", start: 9, end: 9.3, transition: T },
    { id: "d", start: 12, end: 13, transition: T },
  ];

  /** Plays the timeline the way the preview does: begin, draw, snapshot. */
  function play(segments: Segment[], from: number, to: number) {
    const tracker = new TransitionTracker();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const frames: { t: number; on: boolean; outgoing: CanvasImageSource | null }[] = [];
    for (let i = 0; from + i / 60 <= to; i++) {
      const t = from + i / 60;
      const active = tracker.begin(segments, t);
      tracker.end(canvas, segments, t);
      frames.push({ t, on: Boolean(active), outgoing: active?.outgoing ?? null });
    }
    return frames;
  }

  it("blends without dropping out, even when the next cut arrives mid-transition", () => {
    const frames = play(quick, 0.9, 2.35);
    // 1.2 → 2.4 is covered by back-to-back transitions; every frame in it must blend.
    const inside = frames.filter((f) => f.t > 1.21 && f.t < 2.39);
    expect(inside.length).toBeGreaterThan(60);
    expect(inside.every((f) => f.on)).toBe(true);
    // And nothing blends before the first cut.
    expect(frames.filter((f) => f.t < 1.19).every((f) => !f.on)).toBe(true);
  });

  it("keeps the frame it is blending while capturing the one for the next cut", () => {
    const frames = play(quick, 1.15, 1.65).filter((f) => f.on);
    const first = frames[0].outgoing;
    const during = frames.filter((f) => f.t < 1.59);
    const lastOfThatTransition = during[during.length - 1];
    // Same object throughout one transition: a single buffer would have been
    // overwritten by the snapshot taken for the following cut.
    expect(lastOfThatTransition?.outgoing).toBe(first);
    // The next transition blends a different frame.
    expect(frames[frames.length - 1]?.outgoing).not.toBe(first);
  });

  it("never uses more than two buffers", () => {
    const created: HTMLCanvasElement[] = [];
    const real = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = real(tag);
      if (tag === "canvas") created.push(el as HTMLCanvasElement);
      return el;
    }) as typeof document.createElement);
    play(quick, 0.9, 2.9);
    spy.mockRestore();
    // One is the frame being drawn into by the test itself.
    expect(created.length).toBeLessThanOrEqual(3);
  });

  it("ignores a snapshot left over from an earlier pass over the timeline", () => {
    const tracker = new TransitionTracker();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    // Capture just before the cut at 1.2, then scrub far away and come back.
    tracker.end(canvas, quick, 1.15);
    expect(tracker.begin(quick, 1.25)).not.toBeNull();
    tracker.reset();
    expect(tracker.begin(quick, 1.25)).toBeNull();
  });
});
