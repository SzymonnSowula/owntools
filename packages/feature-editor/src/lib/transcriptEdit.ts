import type { Caption, Segment, TimeRange } from "../types";
import { isCutAt, mergeRanges, sourceToTimeline } from "./segments";
import { SENTENCE_END } from "./transcriptFormat";

/**
 * The transcript as a second timeline.
 *
 * `project.captions` is the transcript: whisper's cues, each with its words
 * when the take was transcribed with word timing (`lib/whisperWords.ts`), or
 * without them when it was typed, edited, or transcribed the old way. This
 * module turns those cues into sentences with per-word times — interpolated
 * from character offsets where whisper gave none, the same way
 * `transcriptFormat.ts` does — and maps a selection of sentences back to the
 * source-time ranges the segments model cuts. Everything here is in *source*
 * time; `timelineRange` converts for display.
 */

export interface Word {
  start: number;
  end: number;
  text: string;
  /** True when whisper timed this word itself; false when it was spread across the cue. */
  timed: boolean;
}

export interface Sentence {
  /** Derived from the start time, so it is stable across re-analysis. */
  id: string;
  start: number;
  end: number;
  text: string;
  words: Word[];
  /** True when every word in it is measured rather than estimated. */
  timed: boolean;
}

/** A pause this long between two words ends a sentence, whatever the punctuation says. */
export const PAUSE_SPLIT = 1.2;
/** Never cut closer than this to a neighbouring word. */
export const GUARD = 0.04;
/** A transcript without punctuation still has to break somewhere. */
const MAX_SENTENCE_CHARS = 240;
/** The pause after a removed sentence goes with it when it is shorter than this. */
const ABSORB_PAUSE = 1.5;
/** How much trailing silence a cut takes at the end of the take or before a long pause. */
const TAIL = 0.25;
/** Lead-in kept before a "keep only" range so the first word is not clipped. */
const LEAD = 0.12;

/** Milliseconds in base 36 — the same stamp the sound-effect plan uses for its ids. */
export function stamp(seconds: number): string {
  return Math.round(Math.max(0, seconds) * 1000).toString(36);
}

/**
 * Lowercase, trimmed of surrounding punctuation, inner apostrophes and
 * hyphens kept: "That's," → "that's". Used for comparisons only.
 */
export function normalizeToken(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/** Lowercase without diacritics, for a search box that should find "wlasnie" in "właśnie". */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/Ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

function wordsSane(words: NonNullable<Caption["words"]>): boolean {
  let last = -Infinity;
  for (const w of words) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end < w.start) return false;
    if (w.start < last - 0.25) return false;
    last = w.start;
  }
  return true;
}

/**
 * The words of one cue. Whisper's own word times when they are there and
 * plausible; otherwise each word's time is interpolated from its character
 * offset in the cue, which is honest about being an estimate (`timed: false`).
 */
export function wordsFromCaption(caption: Caption): Word[] {
  const start = caption.start;
  const end = Math.max(caption.start, caption.end);
  const given = caption.words;
  if (given && given.length && wordsSane(given)) {
    const out: Word[] = [];
    for (const w of given) {
      const text = w.word.trim();
      if (!text) continue;
      out.push({ start: w.start, end: Math.max(w.end, w.start), text, timed: true });
    }
    if (out.length) return out;
  }
  const text = caption.text.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const chars = text.length;
  const span = end - start;
  const at = (offset: number) => (chars ? start + (span * offset) / chars : start);
  const out: Word[] = [];
  let offset = 0;
  for (const piece of text.split(" ")) {
    out.push({ start: at(offset), end: at(offset + piece.length), text: piece, timed: false });
    offset += piece.length + 1;
  }
  return out;
}

function makeSentence(words: Word[], used: Map<string, number>): Sentence {
  const first = words[0];
  const last = words[words.length - 1];
  const base = `s${stamp(first.start)}`;
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return {
    id: n ? `${base}-${n + 1}` : base,
    start: first.start,
    end: Math.max(first.start, last.end),
    text: words.map((w) => w.text).join(" "),
    words,
    timed: words.every((w) => w.timed),
  };
}

/**
 * Cues → sentences. A sentence ends on sentence-final punctuation, on a pause
 * of `PAUSE_SPLIT` or more (whisper often returns no punctuation at all), or
 * when it has grown past `MAX_SENTENCE_CHARS`. Overlapping cues are put in time
 * order first — a caption typed at the playhead can sit on top of a spoken one.
 */
export function sentencesFromCaptions(captions: Caption[]): Sentence[] {
  const words: Word[] = [];
  for (const c of [...captions].sort((a, b) => a.start - b.start)) words.push(...wordsFromCaption(c));
  words.sort((a, b) => a.start - b.start);

  const out: Sentence[] = [];
  const used = new Map<string, number>();
  let buffer: Word[] = [];
  let length = 0;
  const flush = () => {
    if (buffer.length) out.push(makeSentence(buffer, used));
    buffer = [];
    length = 0;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    buffer.push(w);
    length += w.text.length + 1;
    const next = words[i + 1];
    const pause = next ? next.start - w.end : Infinity;
    if (SENTENCE_END.test(w.text) || length >= MAX_SENTENCE_CHARS || pause >= PAUSE_SPLIT) flush();
  }
  flush();
  return out;
}

/** Index of the sentence the playhead is in (the last one that has started), or -1 before the first. */
export function sentenceIndexAt(sentences: Sentence[], source: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].start <= source) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Index of the word being spoken at `source` inside a sentence, or -1 between words / after the end. */
export function wordIndexAt(sentence: Sentence, source: number): number {
  const words = sentence.words;
  let found = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= source) found = i;
    else break;
  }
  if (found < 0) return -1;
  const w = words[found];
  const next = words[found + 1];
  const until = next ? next.start : w.end + 0.15;
  return source < until ? found : -1;
}

/** A word is on the floor when its middle is — cut edges never fall inside a word by construction. */
export function wordIsCut(word: Word, segments: Segment[]): boolean {
  return isCutAt((word.start + word.end) / 2, segments);
}

export type CutState = "kept" | "cut" | "partial";

export function sentenceCutState(sentence: Sentence, segments: Segment[]): CutState {
  let cut = 0;
  for (const w of sentence.words) if (wordIsCut(w, segments)) cut++;
  if (cut === 0) return "kept";
  return cut === sentence.words.length ? "cut" : "partial";
}

/** One word per entry across the whole transcript, with where it came from. */
export interface FlatWord {
  word: Word;
  norm: string;
  sentenceId: string;
  sentenceIndex: number;
  wordIndex: number;
  sentenceLength: number;
}

export function flattenWords(sentences: Sentence[]): FlatWord[] {
  const out: FlatWord[] = [];
  sentences.forEach((s, sentenceIndex) => {
    s.words.forEach((word, wordIndex) => {
      out.push({
        word,
        norm: normalizeToken(word.text),
        sentenceId: s.id,
        sentenceIndex,
        wordIndex,
        sentenceLength: s.words.length,
      });
    });
  });
  return out;
}

interface Run {
  first: Sentence;
  last: Sentence;
  prev: Sentence | undefined;
  next: Sentence | undefined;
}

/** Selected sentences grouped into runs of neighbours, in time order. */
function runs(sentences: Sentence[], ids: Iterable<string>): Run[] {
  const set = new Set(ids);
  const out: Run[] = [];
  let i = 0;
  while (i < sentences.length) {
    if (!set.has(sentences[i].id)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < sentences.length && set.has(sentences[j + 1].id)) j++;
    out.push({ first: sentences[i], last: sentences[j], prev: sentences[i - 1], next: sentences[j + 1] });
    i = j + 1;
  }
  return out;
}

/**
 * What to remove so the selected sentences are gone and speech still flows:
 * from just before the first word (never into the sentence before) to just
 * before the next sentence's first word, so the pause *after* the removed run
 * goes with it and exactly one pause remains. Before a long pause or at the
 * end of the take, the cut takes only a short tail of the silence.
 */
export function cutRangesForSentences(sentences: Sentence[], ids: Iterable<string>, duration = 0): TimeRange[] {
  const clampEnd = (t: number) => (duration > 0 ? Math.min(duration, t) : t);
  const out: TimeRange[] = [];
  for (const run of runs(sentences, ids)) {
    const start = Math.max(run.prev ? run.prev.end : 0, run.first.start - GUARD, 0);
    let end: number;
    if (run.next) {
      const gap = run.next.start - run.last.end;
      end =
        gap <= ABSORB_PAUSE
          ? Math.max(run.last.end, run.next.start - GUARD)
          : clampEnd(run.last.end + Math.min(TAIL, gap / 2));
    } else {
      end = clampEnd(run.last.end + TAIL);
    }
    if (end > start) out.push({ start, end });
  }
  return mergeRanges(out);
}

/**
 * What to keep so only the selected sentences remain: each run with a short
 * lead-in and tail, neither reaching into a neighbouring sentence.
 */
export function keepRangesForSentences(sentences: Sentence[], ids: Iterable<string>): TimeRange[] {
  const out: TimeRange[] = [];
  for (const run of runs(sentences, ids)) {
    const start = Math.max(0, run.prev ? Math.max(run.prev.end, run.first.start - LEAD) : run.first.start - LEAD);
    const end = run.next ? Math.min(run.next.start, run.last.end + TAIL) : run.last.end + TAIL;
    if (end > start) out.push({ start, end });
  }
  return mergeRanges(out);
}

/** The source range spanned by words `from`..`to` (inclusive) of one sentence. */
export function sourceRangeOfWords(words: Word[], from: number, to: number): TimeRange {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(words.length - 1, Math.max(from, to));
  return { start: words[a].start, end: Math.max(words[a].start, words[b].end) };
}

/** Seconds of speech the selected sentences hold (not counting pauses between them). */
export function selectedSeconds(sentences: Sentence[], ids: Iterable<string>): number {
  const set = new Set(ids);
  let total = 0;
  for (const s of sentences) if (set.has(s.id)) total += Math.max(0, s.end - s.start);
  return total;
}

/** A source range on the cut timeline — what the viewer will see. */
export function timelineRange(range: TimeRange, segments: Segment[]): TimeRange {
  return { start: sourceToTimeline(range.start, segments), end: sourceToTimeline(range.end, segments) };
}

/** Ids of the sentences whose text contains the query, diacritics and case aside. */
export function searchSentences(sentences: Sentence[], query: string): Set<string> {
  const q = foldForSearch(query.trim());
  const out = new Set<string>();
  if (!q) return out;
  for (const s of sentences) if (foldForSearch(s.text).includes(q)) out.add(s.id);
  return out;
}
