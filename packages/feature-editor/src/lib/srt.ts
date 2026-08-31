import type { Caption, Segment } from "../types";
import { sourceToTimeline } from "./segments";

/** Formats seconds as an SRT timestamp: "HH:MM:SS,mmm". */
export function formatSrtTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const ms = Math.round((total % 1) * 1000);
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** Renders timed text items as an SRT document (1-indexed blocks). */
export function segmentsToSrt(items: { start: number; end: number; text: string }[]): string {
  return items
    .map(
      (item, i) =>
        `${i + 1}\n${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}\n${item.text.trim()}\n`,
    )
    .join("\n");
}

/**
 * Converts captions (in SOURCE time) into an SRT document in TIMELINE time.
 * Captions fully outside the kept segments are dropped; partially overlapping
 * ones are clamped to the segment bounds.
 */
export function captionsToSrt(captions: Caption[], segments: Segment[]): string {
  const items: { start: number; end: number; text: string }[] = [];
  for (const caption of captions) {
    const overlapping = segments.filter(
      (seg) => seg.end > caption.start && seg.start < caption.end,
    );
    if (!overlapping.length) continue;
    const first = overlapping[0];
    const last = overlapping[overlapping.length - 1];
    const clampedStart = Math.max(caption.start, first.start);
    const clampedEnd = Math.min(caption.end, last.end);
    if (clampedEnd <= clampedStart) continue;
    items.push({
      start: sourceToTimeline(clampedStart, segments),
      end: sourceToTimeline(clampedEnd, segments),
      text: caption.text,
    });
  }
  items.sort((a, b) => a.start - b.start);
  return segmentsToSrt(items);
}
