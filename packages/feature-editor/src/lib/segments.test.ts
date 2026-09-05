import { describe, expect, it } from "vitest";
import type { Segment } from "../types";
import {
  isJumpCut,
  playbackStep,
  segmentAtTimeline,
  sourceToTimeline,
  splitSegment,
  timelineDuration,
  timelineToSource,
} from "./segments";

/** What a plain split leaves behind: two clips that still run back to back. */
const split: Segment[] = [
  { id: "a", start: 0, end: 3 },
  { id: "b", start: 3, end: 6 },
];

/** A cut with material removed between the clips. */
const trimmed: Segment[] = [
  { id: "a", start: 0, end: 3 },
  { id: "b", start: 10, end: 14 },
];

describe("segmentAtTimeline", () => {
  it("hands a boundary to the clip that is starting, not the one that ended", () => {
    expect(segmentAtTimeline(2.99, split)?.id).toBe("a");
    // Exactly on the cut: the old behaviour returned "a", so playback kept
    // asking to jump across the same cut every frame.
    expect(segmentAtTimeline(3, split)?.id).toBe("b");
    expect(segmentAtTimeline(3.01, split)?.id).toBe("b");
  });

  it("stays on the last clip past the end", () => {
    expect(segmentAtTimeline(99, split)?.id).toBe("b");
    expect(segmentAtTimeline(6, split)?.id).toBe("b");
  });
});

describe("playbackStep", () => {
  it("never seeks across a plain split — the recording runs straight on", () => {
    // Approaching the cut, on it, and just past it.
    for (const [timeline, source] of [
      [2.9, 2.9],
      [2.995, 2.995],
      [3, 3],
      [3.02, 3.02],
    ] as const) {
      expect(playbackStep(split, timeline, source)).toEqual({ action: "continue" });
    }
  });

  it("seeks once when the cut is a real jump, then leaves it alone", () => {
    expect(playbackStep(trimmed, 2.5, 2.5)).toEqual({ action: "continue" });
    expect(playbackStep(trimmed, 2.995, 2.995)).toEqual({ action: "seek", to: 10 });
    // The frame after the seek lands: the playhead has not been updated yet,
    // and asking again would restart the seek and stall the video.
    expect(playbackStep(trimmed, 2.995, 10)).toEqual({ action: "continue" });
    // Playhead caught up.
    expect(playbackStep(trimmed, 3, 10)).toEqual({ action: "continue" });
  });

  it("stops at the end of the last clip", () => {
    expect(playbackStep(split, 5, 5)).toEqual({ action: "continue" });
    expect(playbackStep(split, 5.9, 5.99)).toEqual({ action: "stop" });
    expect(playbackStep([], 0, 0)).toEqual({ action: "stop" });
  });

  it("advances a whole split take without a single seek", () => {
    // 3 s of footage cut into four clips, played frame by frame.
    const clips: Segment[] = [
      { id: "a", start: 0, end: 0.8 },
      { id: "b", start: 0.8, end: 1.5 },
      { id: "c", start: 1.5, end: 2.2 },
      { id: "d", start: 2.2, end: 3 },
    ];
    let seeks = 0;
    let stopped = false;
    for (let source = 0; source <= 3; source += 1 / 60) {
      const step = playbackStep(clips, sourceToTimeline(source, clips), source);
      if (step.action === "seek") seeks++;
      if (step.action === "stop") stopped = true;
    }
    expect(seeks).toBe(0);
    expect(stopped).toBe(true);
  });
});

describe("isJumpCut", () => {
  it("tells a real jump from a split of one continuous stretch", () => {
    expect(isJumpCut(split, 1)).toBe(false);
    expect(isJumpCut(trimmed, 1)).toBe(true);
    // The first clip has nothing before it.
    expect(isJumpCut(split, 0)).toBe(false);
  });
});

describe("time mapping stays continuous across a split", () => {
  it("maps source to timeline and back without a step at the cut", () => {
    expect(sourceToTimeline(2.99, split)).toBeCloseTo(2.99, 5);
    expect(sourceToTimeline(3, split)).toBeCloseTo(3, 5);
    expect(sourceToTimeline(3.01, split)).toBeCloseTo(3.01, 5);
    expect(timelineToSource(3.01, split)).toBeCloseTo(3.01, 5);
    expect(timelineDuration(split)).toBe(6);
    expect(timelineDuration(trimmed)).toBe(7);
  });

  it("splitSegment leaves the halves joined", () => {
    const out = splitSegment([{ id: "a", start: 0, end: 6 }], 3, "new");
    expect(out).toHaveLength(2);
    expect(out[0].end).toBe(3);
    expect(out[1].start).toBe(3);
    expect(isJumpCut(out, 1)).toBe(false);
  });
});
