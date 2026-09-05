import type { Segment } from "../types";

export function timelineDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

export function sourceToTimeline(source: number, segments: Segment[]): number {
  let t = 0;
  for (const seg of segments) {
    if (source < seg.start) return t;
    if (source <= seg.end) return t + (source - seg.start);
    t += seg.end - seg.start;
  }
  return t;
}

export function timelineToSource(timeline: number, segments: Segment[]): number {
  let t = Math.max(0, timeline);
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (t <= dur) return seg.start + t;
    t -= dur;
  }
  const last = segments[segments.length - 1];
  return last ? last.end : 0;
}

/**
 * The clip playing at a timeline time. Exactly on a boundary the time belongs
 * to the clip that is *starting* — it used to return the one that had just
 * ended, which made playback ask to jump across the same cut on every frame.
 */
export function segmentAtTimeline(timeline: number, segments: Segment[]): Segment | undefined {
  let t = Math.max(0, timeline);
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (t < dur) return seg;
    t -= dur;
  }
  return segments[segments.length - 1];
}

/** Clips joined this closely in the recording are one continuous stretch. */
const JOIN_EPSILON = 0.02;

export interface PlaybackStep {
  action: "continue" | "seek" | "stop";
  /** Where to move the video, for "seek". */
  to?: number;
}

/**
 * What playback should do right now, given where the video is and where the
 * playhead is.
 *
 * The important case is the one a plain split creates: two clips that still
 * run back to back in the recording. There is nothing to jump to — the video
 * just keeps rolling. Seeking anyway is expensive (a MediaRecorder file has no
 * seek index, so landing on a frame means decoding up to it) and, because a
 * seek leaves the video exactly where the jump was triggered, it asks to be
 * repeated on the very next frame. That loop is what froze and strobed the
 * picture at every cut.
 */
export function playbackStep(
  segments: Segment[],
  timelineTime: number,
  source: number,
): PlaybackStep {
  const seg = segmentAtTimeline(timelineTime, segments);
  if (!seg) return { action: "stop" };
  const next = segments[segments.indexOf(seg) + 1];

  if (!next) {
    // Ending a hair early: the last clip usually ends at the file's own end,
    // and waiting for a frame past it would hang.
    return source >= seg.end - 0.03 ? { action: "stop" } : { action: "continue" };
  }
  if (source < seg.end - 0.01) return { action: "continue" };
  // Contiguous clips: let the recording run on rather than jump to where it is.
  if (Math.abs(next.start - seg.end) <= JOIN_EPSILON) return { action: "continue" };
  // A jump that has already landed.
  if (Math.abs(source - next.start) <= JOIN_EPSILON) return { action: "continue" };
  return { action: "seek", to: next.start };
}

/** Whether a cut is a real jump in the recording, or just a split of one stretch. */
export function isJumpCut(segments: Segment[], index: number): boolean {
  const previous = segments[index - 1];
  const seg = segments[index];
  if (!previous || !seg) return false;
  return Math.abs(seg.start - previous.end) > JOIN_EPSILON;
}

export function splitSegment(segments: Segment[], sourceTime: number, newId: string): Segment[] {
  const next = segments.flatMap((seg) => {
    if (sourceTime <= seg.start + 0.04 || sourceTime >= seg.end - 0.04) return [seg];
    if (sourceTime > seg.start && sourceTime < seg.end) {
      return [
        { ...seg, end: sourceTime },
        { id: newId, start: sourceTime, end: seg.end },
      ];
    }
    return [seg];
  });
  return next;
}

export function removeSegment(segments: Segment[], id: string): Segment[] {
  return segments.filter((s) => s.id !== id);
}

export function updateSegment(segments: Segment[], id: string, patch: Partial<Segment>): Segment[] {
  return segments.map((s) => (s.id === id ? { ...s, ...patch } : s));
}
