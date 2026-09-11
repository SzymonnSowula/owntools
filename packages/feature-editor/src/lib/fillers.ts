import type { Segment, TimeRange } from "../types";
import { isCutAt, mergeRanges } from "./segments";
import { GUARD, flattenWords, stamp, type FlatWord, type Sentence } from "./transcriptEdit";

/**
 * Filler words and stutters, found with their timings and a reason each, as
 * candidates for the person to confirm. Conservative on purpose: "um" is
 * never a word, but "like" and "you know" are, so those only qualify in the
 * positions where they are almost always noise — and they arrive unticked.
 * English and Polish rules run together; neither list fires on the other
 * language's speech.
 */

export type FillerKind = "sound" | "phrase" | "stutter";

export interface FillerCandidate {
  /** Stable across re-analysis: kind + the start stamp. */
  id: string;
  kind: FillerKind;
  /** As spoken, e.g. "um," or "you know" or "the". */
  text: string;
  /** The words to remove, source time. For a stutter the span runs up to the second word. */
  start: number;
  end: number;
  /** The neighbouring words' bounds, so a cut can keep its distance from them. */
  prevEnd: number | null;
  nextStart: number | null;
  sentenceId: string;
  /** Inclusive word indices inside the sentence. */
  wordFrom: number;
  wordTo: number;
  reason: string;
  /** Pre-ticked in the review list. */
  confident: boolean;
  /** Whether the words carry whisper's own timing or an estimate spread over the cue. */
  timed: boolean;
  /** A few words either side, for the review row. */
  before: string;
  after: string;
}

/** Hesitation sounds, EN and PL, with their elongations: um, umm, uh, uhm, erm, hmm, mmm, yyy, eee, ehm, yhm… */
const SOUND = /^(?:u+m+|u+h+m*|e+r+m*|h+m+|m{2,}|y{2,}|e{2,}m*|y+h+m*|y+m+|e+h+m*)$/;

/** "you know" followed by one of these is a real clause ("you know what I mean"). */
const YOU_KNOW_CONTINUERS = new Set(["what", "that", "how", "the", "if", "when", "who", "where", "why", "about", "it", "this", "them", "him", "her", "me", "us"]);

/** "I mean" after one of these is a clause ("what I mean", "if I mean it"). */
const I_MEAN_CLAUSE_PREV = new Set(["what", "if", "do", "did", "that's", "thats", "is", "this", "which", "whatever"]);

/** "like" after one of these is the verb or "look like", not a filler. */
const LIKE_VERB_PREV = new Set([
  "i", "you", "we", "they", "he", "she", "it", "would", "d", "to", "really", "just", "dont", "don't", "not",
  "feel", "feels", "felt", "look", "looks", "looked", "looking", "sound", "sounds", "seem", "seems", "something",
  "anything", "things", "stuff", "much", "more", "be", "was", "were", "is", "are", "people", "nothing",
]);

/** Doubles that are emphasis, not a stutter. */
const DOUBLE_OK = new Set(["very", "really", "so", "no", "yes", "bye", "ha", "ok", "okay", "bardzo", "nie", "tak", "już", "dobrze", "many", "much", "далее"]);

const PUNCT_BREAK = /[,;:–—-]$/;

/** Gap needed on both sides of "like" / "jakby" when the punctuation does not mark it. */
const PAUSE_BEFORE = 0.25;
const PAUSE_AFTER = 0.12;
/** Same word twice within this is a stutter. */
const STUTTER_GAP = 0.6;
/** Silence taken with a filler on each side, before the neighbour guard applies. */
const PAD = 0.06;

function idFor(kind: FillerKind, start: number): string {
  return `${kind}:${stamp(start)}`;
}

function context(flat: FlatWord[], from: number, to: number): { before: string; after: string } {
  const before = flat.slice(Math.max(0, from - 3), from).map((f) => f.word.text).join(" ");
  const after = flat.slice(to + 1, to + 4).map((f) => f.word.text).join(" ");
  return { before, after };
}

function candidate(
  flat: FlatWord[],
  from: number,
  to: number,
  kind: FillerKind,
  reason: string,
  confident: boolean,
): FillerCandidate {
  const first = flat[from];
  const last = flat[to];
  const prev = flat[from - 1]?.word ?? null;
  const next = flat[to + 1]?.word ?? null;
  const words = flat.slice(from, to + 1);
  const end =
    kind === "stutter" && next ? Math.max(last.word.end, next.start - GUARD) : Math.max(first.word.start, last.word.end);
  return {
    id: idFor(kind, first.word.start),
    kind,
    text: words.map((f) => f.word.text).join(" "),
    start: first.word.start,
    end,
    prevEnd: prev ? prev.end : null,
    nextStart: next ? next.start : null,
    sentenceId: first.sentenceId,
    wordFrom: first.wordIndex,
    wordTo: last.sentenceId === first.sentenceId ? last.wordIndex : first.sentenceLength - 1,
    reason,
    confident,
    timed: words.every((f) => f.word.timed),
    ...context(flat, from, to),
  };
}

/** "like" / "jakby" set off by commas, dashes, or (when the words are timed) by a pause on both sides. */
function isolated(flat: FlatWord[], i: number): boolean {
  const w = flat[i];
  if (w.wordIndex === 0 || w.wordIndex === w.sentenceLength - 1) return false;
  const prev = flat[i - 1];
  const next = flat[i + 1];
  if (!prev || !next) return false;
  if (PUNCT_BREAK.test(prev.word.text) || PUNCT_BREAK.test(w.word.text)) return true;
  if (!w.word.timed) return false;
  return w.word.start - prev.word.end >= PAUSE_BEFORE && next.word.start - w.word.end >= PAUSE_AFTER;
}

interface PhraseRule {
  words: string[];
  reason: string;
  /** Whether this occurrence qualifies; `i` is the index of the first word in `flat`. */
  ok: (flat: FlatWord[], i: number) => boolean;
}

const midSentence = (flat: FlatWord[], i: number, len: number) => {
  const first = flat[i];
  const last = flat[i + len - 1];
  return first.wordIndex > 0 && last.sentenceId === first.sentenceId && last.wordIndex < first.sentenceLength - 1;
};
const commaAfter = (flat: FlatWord[], i: number, len: number) => PUNCT_BREAK.test(flat[i + len - 1].word.text);
const startsSentence = (flat: FlatWord[], i: number) => flat[i].wordIndex === 0;
const norm = (flat: FlatWord[], i: number) => flat[i]?.norm ?? "";

const PHRASES: PhraseRule[] = [
  {
    words: ["you", "know"],
    reason: "“you know” as an aside",
    ok: (flat, i) =>
      (startsSentence(flat, i) && commaAfter(flat, i, 2)) ||
      (midSentence(flat, i, 2) && !YOU_KNOW_CONTINUERS.has(norm(flat, i + 2))),
  },
  {
    words: ["i", "mean"],
    reason: "“I mean” as an aside",
    ok: (flat, i) =>
      (startsSentence(flat, i) && commaAfter(flat, i, 2)) ||
      (midSentence(flat, i, 2) && !I_MEAN_CLAUSE_PREV.has(norm(flat, i - 1))),
  },
  {
    words: ["no", "więc"],
    reason: "“no więc” opening a thought",
    ok: (flat, i) => startsSentence(flat, i) || (flat[i].word.timed && flat[i].word.start - (flat[i - 1]?.word.end ?? -Infinity) >= 0.4),
  },
  {
    words: ["znaczy", "się"],
    reason: "“znaczy się” as an aside",
    ok: (flat, i) => !["to", "co"].includes(norm(flat, i - 1)),
  },
  {
    words: ["znaczy"],
    reason: "“znaczy” as an aside",
    ok: (flat, i) => !["to", "co", "nic", "wiele", "dużo", "coś", "które", "który", "która"].includes(norm(flat, i - 1)),
  },
];

export interface FindFillersOptions {
  /** Candidate ids already accepted — never proposed again. */
  exclude?: string[];
  /** With the kept clips, candidates already on the cutting-room floor are skipped. */
  segments?: Segment[];
}

export function findFillers(sentences: Sentence[], options: FindFillersOptions = {}): FillerCandidate[] {
  const flat = flattenWords(sentences);
  const exclude = new Set(options.exclude ?? []);
  const used = new Set<number>();
  const out: FillerCandidate[] = [];
  const take = (c: FillerCandidate, from: number, to: number) => {
    for (let k = from; k <= to; k++) used.add(k);
    if (exclude.has(c.id)) return;
    if (options.segments && isCutAt((c.start + Math.min(c.end, flat[to].word.end)) / 2, options.segments)) return;
    out.push(c);
  };

  // 1. Hesitation sounds — the clear cases.
  for (let i = 0; i < flat.length; i++) {
    const n = flat[i].norm;
    if (n.length >= 2 && SOUND.test(n)) take(candidate(flat, i, i, "sound", "hesitation sound", true), i, i);
  }

  // 2. Phrases, longest first at each position.
  for (let i = 0; i < flat.length; i++) {
    if (used.has(i)) continue;
    for (const rule of PHRASES) {
      const len = rule.words.length;
      if (i + len > flat.length) continue;
      let match = true;
      for (let k = 0; k < len; k++) {
        if (used.has(i + k) || flat[i + k].norm !== rule.words[k]) {
          match = false;
          break;
        }
      }
      if (!match || !rule.ok(flat, i)) continue;
      take(candidate(flat, i, i + len - 1, "phrase", rule.reason, false), i, i + len - 1);
      break;
    }
  }

  // 3. "like" and "jakby" only between pauses or commas.
  for (let i = 0; i < flat.length; i++) {
    if (used.has(i)) continue;
    const n = flat[i].norm;
    if (n === "like") {
      if (isolated(flat, i) && !LIKE_VERB_PREV.has(norm(flat, i - 1))) {
        take(candidate(flat, i, i, "phrase", "“like” between pauses", false), i, i);
      }
    } else if (n === "jakby") {
      if (isolated(flat, i)) take(candidate(flat, i, i, "phrase", "“jakby” between pauses", false), i, i);
    }
  }

  // 4. Stutters: the same word twice in a row, the second one stays.
  for (let i = 0; i + 1 < flat.length; i++) {
    if (used.has(i) || used.has(i + 1)) continue;
    const a = flat[i];
    const b = flat[i + 1];
    if (!a.norm || a.norm !== b.norm || !/\p{L}/u.test(a.norm) || DOUBLE_OK.has(a.norm)) continue;
    if (b.word.start - a.word.end > STUTTER_GAP) continue;
    take(candidate(flat, i, i, "stutter", "repeated word — the second one stays", true), i, i);
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Two ranges this close hold nothing but guards — no word is that short — so they are one cut. */
const SLIVER = 0.1;

/**
 * The source ranges to cut for a set of accepted candidates: each filler with
 * a little of the silence around it, but never within `GUARD` of the
 * neighbouring word, so a cut can not clip the word before or after.
 * Fillers said back to back ("so um uh") come out as one range.
 */
export function removeFillerRanges(candidates: FillerCandidate[]): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const c of candidates) {
    let start = Math.max(0, c.start - PAD);
    if (c.prevEnd !== null) start = Math.max(start, c.prevEnd + GUARD);
    let end = c.end + PAD;
    if (c.nextStart !== null) end = Math.min(end, c.nextStart - GUARD);
    if (end - start < 0.02) {
      // Neighbours so tight the guards collide: take the filler's own span only.
      start = c.start;
      end = Math.max(c.end, c.start + 0.02);
    }
    ranges.push({ start, end });
  }
  const merged = mergeRanges(ranges);
  const out: TimeRange[] = [];
  for (const r of merged) {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= SLIVER) last.end = r.end;
    else out.push({ ...r });
  }
  return out;
}

/** Seconds the accepted candidates would remove. */
export function fillerSeconds(candidates: FillerCandidate[]): number {
  return removeFillerRanges(candidates).reduce((sum, r) => sum + (r.end - r.start), 0);
}
