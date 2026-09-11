import type { Segment, TimeRange } from "../types";
import { isCutAt, mergeRanges } from "./segments";
import { GUARD, flattenWords, stamp, type FlatWord, type Sentence } from "./transcriptEdit";

/**
 * Retakes: the speaker stumbles, stops, and says the sentence again. In the
 * transcript that is a run of words that comes back a few seconds later —
 * an n-gram of `minWords` normalised words recurring within `window` seconds.
 * The earlier attempt is the one to lose: the proposal cuts from its first
 * word to the first word of the second attempt, so whatever was said in
 * between (the abort, an "okay so") goes with it.
 *
 * A phrase said twice on purpose looks the same to this, which is why every
 * candidate is confirmed by a person; the ones with a long gap or a lot of
 * other words in between arrive unticked.
 */

export interface RetakeCandidate {
  /** Stable across re-analysis: stamp of the first attempt's start. */
  id: string;
  /** The repeated words, as first spoken. */
  phrase: string;
  /** How many words matched. */
  words: number;
  /** The first attempt's matched span, source time. */
  firstStart: number;
  firstEnd: number;
  /** Where the second attempt begins. */
  secondStart: number;
  /** The proposed cut. */
  cutStart: number;
  cutEnd: number;
  /** Seconds between the end of the first matched span and the second attempt. */
  gap: number;
  /** Words spoken between the two attempts (the abort). */
  between: number;
  sentenceId: string;
  reason: string;
  confident: boolean;
  timed: boolean;
}

export interface FindRetakesOptions {
  /** Seconds within which a repeat counts as a retake. */
  window?: number;
  /** Words that have to match. */
  minWords?: number;
  exclude?: string[];
  segments?: Segment[];
}

/** Retakes this quick, with this little in between, are almost never intentional. */
const CONFIDENT_GAP = 6;
const CONFIDENT_BETWEEN = 12;

function fmtSeconds(s: number): string {
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

function build(flat: FlatWord[], i: number, j: number, length: number): RetakeCandidate {
  const first = flat[i].word;
  const firstEnd = flat[i + length - 1].word.end;
  const second = flat[j].word;
  const prev = flat[i - 1]?.word;
  const gap = Math.max(0, second.start - firstEnd);
  const between = Math.max(0, j - (i + length));
  const cutStart = Math.max(0, prev ? Math.max(prev.end, first.start - GUARD) : first.start - GUARD);
  const cutEnd = Math.max(cutStart + 0.02, second.start - GUARD);
  const later = second.start - first.start;
  return {
    id: `retake:${stamp(first.start)}`,
    phrase: flat
      .slice(i, i + length)
      .map((f) => f.word.text)
      .join(" "),
    words: length,
    firstStart: first.start,
    firstEnd,
    secondStart: second.start,
    cutStart,
    cutEnd,
    gap,
    between,
    sentenceId: flat[i].sentenceId,
    reason:
      between > 0
        ? `${length} words said again ${fmtSeconds(later)} later, after ${between} other ${between === 1 ? "word" : "words"}`
        : `${length} words said again ${fmtSeconds(later)} later`,
    confident: gap <= CONFIDENT_GAP && between <= CONFIDENT_BETWEEN,
    timed: flat.slice(i, j + 1).every((f) => f.word.timed),
  };
}

export function findRetakes(sentences: Sentence[], options: FindRetakesOptions = {}): RetakeCandidate[] {
  const window = options.window ?? 20;
  const minWords = options.minWords ?? 4;
  const exclude = new Set(options.exclude ?? []);
  const flat = flattenWords(sentences).filter((f) => f.norm.length > 0);
  const n = flat.length;
  if (n < minWords * 2) return [];

  const positions = new Map<string, number[]>();
  for (let i = 0; i + minWords <= n; i++) {
    const key = flat
      .slice(i, i + minWords)
      .map((f) => f.norm)
      .join(" ");
    const list = positions.get(key);
    if (list) list.push(i);
    else positions.set(key, [i]);
  }

  const raw: RetakeCandidate[] = [];
  for (const list of positions.values()) {
    if (list.length < 2) continue;
    for (let a = 0; a + 1 < list.length; a++) {
      const i = list[a];
      const j = list[a + 1];
      // Overlapping repetition ("the the the the") is a stutter, not a retake.
      if (j < i + minWords) continue;
      if (flat[j].word.start - flat[i].word.start > window) continue;
      let length = minWords;
      while (i + length < j && j + length < n && flat[i + length].norm === flat[j + length].norm) length++;
      raw.push(build(flat, i, j, length));
    }
  }

  // Nested matches (the same repeat seen from its second word on) overlap the
  // longer one; keep the longest, then the earliest.
  raw.sort((a, b) => b.words - a.words || a.cutStart - b.cutStart);
  const kept: RetakeCandidate[] = [];
  for (const c of raw) {
    if (kept.some((k) => c.cutStart < k.cutEnd && c.cutEnd > k.cutStart)) continue;
    kept.push(c);
  }

  return kept
    .filter((c) => !exclude.has(c.id))
    .filter((c) => !options.segments || !isCutAt((c.cutStart + c.cutEnd) / 2, options.segments))
    .sort((a, b) => a.cutStart - b.cutStart);
}

/** The source ranges to cut for accepted retakes. */
export function retakeRanges(candidates: RetakeCandidate[]): TimeRange[] {
  return mergeRanges(candidates.map((c) => ({ start: c.cutStart, end: c.cutEnd })));
}

export function retakeSeconds(candidates: RetakeCandidate[]): number {
  return retakeRanges(candidates).reduce((sum, r) => sum + (r.end - r.start), 0);
}
