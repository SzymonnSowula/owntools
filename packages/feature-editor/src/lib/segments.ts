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

export function segmentAtTimeline(timeline: number, segments: Segment[]): Segment | undefined {
  let t = Math.max(0, timeline);
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (t < dur || t === dur) return seg;
    t -= dur;
  }
  return segments[segments.length - 1];
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
