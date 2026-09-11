import type { Segment, TimeRange } from "../types";
import { uid } from "./id";

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

/** Pieces shorter than this are not worth keeping — a few frames of a word. */
export const MIN_PIECE = 0.15;

/** Sorted, non-overlapping copy of `ranges`; empty and inverted ones dropped, touching ones joined. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1e-6) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/**
 * Whether a source time is on the cutting-room floor — inside no kept clip.
 * A hair of tolerance so a word ending exactly on a cut still counts as kept.
 */
export function isCutAt(source: number, segments: Segment[], epsilon = 1e-3): boolean {
  for (const seg of segments) {
    if (source >= seg.start - epsilon && source <= seg.end + epsilon) return false;
  }
  return true;
}

/** Whether every part of the range is already cut. */
export function isRangeCut(range: TimeRange, segments: Segment[]): boolean {
  return !segments.some((seg) => seg.end > range.start + 1e-3 && seg.start < range.end - 1e-3);
}

function pieceList(segments: Segment[], pieces: Map<Segment, TimeRange[]>): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const kept = (pieces.get(seg) ?? []).filter((p) => p.end - p.start >= MIN_PIECE);
    if (kept.length === 1 && kept[0].start === seg.start && kept[0].end === seg.end) {
      out.push(seg);
      continue;
    }
    kept.forEach((p, i) => {
      // The first piece keeps the clip's identity — its id (so a selection
      // survives) and its transition, which leads into it from the clip before.
      out.push(i === 0 ? { ...seg, start: p.start, end: p.end } : { id: uid("seg"), start: p.start, end: p.end });
    });
  }
  return out;
}

/**
 * Takes source-time ranges out of the kept clips: the text-based "Cut". The
 * sound-effect plan keys on source time, so a click that sat at 12.4 s in the
 * recording is still the same sound after the sentence before it is gone.
 */
export function cutSourceRanges(segments: Segment[], ranges: TimeRange[]): Segment[] {
  const cuts = mergeRanges(ranges);
  const pieces = new Map<Segment, TimeRange[]>();
  for (const seg of segments) {
    let current: TimeRange[] = [{ start: seg.start, end: seg.end }];
    for (const cut of cuts) {
      const next: TimeRange[] = [];
      for (const p of current) {
        if (cut.end <= p.start || cut.start >= p.end) {
          next.push(p);
          continue;
        }
        if (cut.start > p.start) next.push({ start: p.start, end: cut.start });
        if (cut.end < p.end) next.push({ start: cut.end, end: p.end });
      }
      current = next;
    }
    pieces.set(seg, current);
  }
  return pieceList(segments, pieces);
}

/** Keeps only what overlaps `ranges` — "Keep only" on a selection of sentences. */
export function keepOnlySourceRanges(segments: Segment[], ranges: TimeRange[]): Segment[] {
  const keep = mergeRanges(ranges);
  const pieces = new Map<Segment, TimeRange[]>();
  for (const seg of segments) {
    const kept: TimeRange[] = [];
    for (const k of keep) {
      const start = Math.max(seg.start, k.start);
      const end = Math.min(seg.end, k.end);
      if (end > start) kept.push({ start, end });
    }
    pieces.set(seg, kept);
  }
  return pieceList(segments, pieces);
}

/**
 * The clips that make up a stretch of the *cut timeline*, as a new segment
 * list whose own timeline starts at 0 — how a short clip is exported: slice
 * the segments, then render exactly as the whole video would be. The first
 * piece drops its transition (there is nothing before it to blend from).
 */
export function sliceSegmentsToTimelineRange(segments: Segment[], range: TimeRange): Segment[] {
  const out: Segment[] = [];
  let t = 0;
  for (const seg of segments) {
    const dur = Math.max(0, seg.end - seg.start);
    const from = Math.max(range.start, t);
    const to = Math.min(range.end, t + dur);
    if (to - from > 1e-6) {
      const piece: Segment = { ...seg, start: seg.start + (from - t), end: seg.start + (to - t) };
      if (!out.length) delete piece.transition;
      out.push(piece);
    }
    t += dur;
  }
  return out;
}
