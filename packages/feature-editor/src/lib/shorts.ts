import type { Chapter, Segment } from "../types";
import type { FillerCandidate } from "./fillers";
import { sourceToTimeline } from "./segments";
import { chapterTitleFromWords } from "./chapters";
import { sentenceCutState, stamp, type Sentence } from "./transcriptEdit";

/**
 * Short clips out of a long take: 20–60 s stretches that start on a sentence,
 * scored for what makes a clip watchable on its own — it opens a chapter, the
 * speech is dense, it ends on a pause, it asks a question — and the top five
 * come back with the reason spelled out. Lengths are measured on the cut
 * timeline, so a clip that spans a cut is as long as the viewer will see it.
 */

export interface ShortCandidate {
  id: string;
  /** Source time of the first and last sentence. */
  start: number;
  end: number;
  /** The same on the cut timeline — what the export dialog receives. */
  tlStart: number;
  tlEnd: number;
  /** Timeline seconds. */
  duration: number;
  score: number;
  reason: string;
  /** Opening words, for the card. */
  title: string;
  wordsPerSecond: number;
  chapterStart: boolean;
}

export interface FindShortsOptions {
  min?: number;
  max?: number;
  count?: number;
  /** Fillers inside a clip count against it. */
  fillers?: FillerCandidate[];
  /** Length the score is happiest with. */
  ideal?: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function findShorts(
  sentences: Sentence[],
  segments: Segment[],
  chapters: Chapter[] = [],
  options: FindShortsOptions = {},
): ShortCandidate[] {
  const min = options.min ?? 20;
  const max = options.max ?? 60;
  const count = options.count ?? 5;
  const ideal = options.ideal ?? 38;
  const kept = sentences.filter((s) => sentenceCutState(s, segments) !== "cut");
  if (!kept.length) return [];

  const tl = (t: number) => sourceToTimeline(t, segments);
  const rate = median(kept.map((s) => s.words.length / Math.max(0.3, s.end - s.start)));
  const chapterAt = (t: number) => chapters.some((c) => Math.abs(c.start - t) < 0.5);
  const fillersIn = (a: number, b: number) => (options.fillers ?? []).filter((f) => f.start >= a && f.end <= b).length;

  const candidates: ShortCandidate[] = [];
  for (let i = 0; i < kept.length; i++) {
    const first = kept[i];
    const prev = kept[i - 1];
    const pauseBefore = prev ? first.start - prev.end : Infinity;
    let best: ShortCandidate | null = null;
    let words = 0;
    for (let j = i; j < kept.length; j++) {
      const last = kept[j];
      words += last.words.length;
      const duration = tl(last.end) - tl(first.start);
      if (duration > max) break;
      if (duration < min) continue;
      const next = kept[j + 1];
      const pauseAfter = next ? next.start - last.end : Infinity;
      const density = words / Math.max(1, duration);
      const reasons: string[] = [];
      let score = 0;

      const dens = Math.min(1.6, rate > 0 ? density / rate : 1);
      score += dens;
      if (dens >= 1.05) reasons.push(`dense speech (${density.toFixed(1)} words/s)`);

      if (chapterAt(first.start)) {
        score += 0.5;
        reasons.push("opens a chapter");
      } else if (pauseBefore >= 1 || i === 0) {
        score += 0.25;
        reasons.push(i === 0 ? "the very start" : "starts after a pause");
      }
      if (pauseAfter >= 0.6 || j === kept.length - 1) {
        score += 0.25;
        reasons.push("ends on a pause");
      }
      if (/[.!?…]["'”’)]*$/.test(last.text)) score += 0.15;
      if (first.text.includes("?")) {
        score += 0.2;
        reasons.push("asks a question");
      }
      if (/\d/.test(first.text)) score += 0.1;
      score -= (0.2 * Math.abs(duration - ideal)) / 22;
      const fillers = fillersIn(first.start, last.end);
      if (fillers) {
        score -= Math.min(0.4, 0.08 * fillers);
        reasons.push(`${fillers} filler${fillers === 1 ? "" : "s"} inside`);
      }

      if (!best || score > best.score) {
        best = {
          id: `short:${stamp(first.start)}`,
          start: first.start,
          end: last.end,
          tlStart: tl(first.start),
          tlEnd: tl(last.end),
          duration,
          score,
          reason: reasons.join(" · ") || "a self-contained stretch",
          title: chapterTitleFromWords(first.words) || first.text.slice(0, 48),
          wordsPerSecond: density,
          chapterStart: chapterAt(first.start),
        };
      }
    }
    if (best) candidates.push(best);
  }

  // Non-maximum suppression: two clips that mostly overlap are one idea.
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const out: ShortCandidate[] = [];
  for (const c of candidates) {
    const clash = out.some((k) => {
      const overlap = Math.min(c.tlEnd, k.tlEnd) - Math.max(c.tlStart, k.tlStart);
      return overlap > 0.4 * Math.min(c.duration, k.duration);
    });
    if (!clash) out.push(c);
    if (out.length >= count) break;
  }
  return out;
}
