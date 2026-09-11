import { stripNonSpeech } from "@feature-dictation/cleanup";
import type { Caption, CaptionWord } from "../types";
import { uid } from "./id";
import { SENTENCE_END } from "./transcriptFormat";

/**
 * Word timing out of whisper.cpp without touching the Rust command.
 *
 * `whisper_transcribe` writes plain `-oj` JSON (one entry per segment, no
 * token list — `-ojf` is not wired). It does forward `maxLen` as `-ml`, and
 * with `-ml 1` whisper.cpp wraps every *token* into a segment of its own,
 * each carrying the token's timestamp from its (experimental, DTW-free)
 * token-timing pass. BPE tokens that start a word begin with a space, so the
 * pieces can be joined back into words with a start and an end each — which
 * is what the Script panel needs to cut a filler and not the word after it.
 *
 * The timing is whisper's heuristic one, good to roughly a tenth of a second;
 * still far better than spreading a ten-second cue evenly over its letters.
 */

export interface WhisperToken {
  text: string;
  /** Seconds. */
  from: number;
  to: number;
}

/** Raw `-oj` JSON as a token list; unlike `parseWhisperJson` it keeps zero-length entries (punctuation). */
export function parseWhisperTokenJson(raw: string): WhisperToken[] {
  const data = JSON.parse(raw) as {
    transcription?: Array<{ offsets?: { from: number; to: number }; text?: string }>;
  };
  return (data.transcription ?? [])
    .filter((seg) => typeof seg.text === "string" && seg.offsets)
    .map((seg) => ({
      text: seg.text ?? "",
      from: (seg.offsets?.from ?? 0) / 1000,
      to: Math.max(seg.offsets?.from ?? 0, seg.offsets?.to ?? 0) / 1000,
    }));
}

/** Whether a `-oj` result was produced with `-ml 1`: nearly every entry is a single word piece. */
export function looksTokenised(tokens: WhisperToken[]): boolean {
  if (tokens.length < 4) return false;
  let single = 0;
  for (const t of tokens) if (t.text.trim().split(/\s+/).length <= 1) single++;
  return single / tokens.length >= 0.9;
}

/** A new word begins after this much silence even when the token has no leading space. */
const WORD_GAP = 0.25;
/** Special markers whisper prints as text. */
const MARKER = /^\s*(?:\[_[A-Z_]+_\]|<\|[^|]*\|>)\s*$/;

const hasLetter = (s: string) => /[\p{L}\p{N}]/u.test(s);

/**
 * Token pieces → words. A token starting with whitespace starts a word;
 * punctuation-only tokens attach to the word before them; a token following
 * a gap of `WORD_GAP`, or one starting a letter after sentence-final
 * punctuation, starts a word too (segment boundaries lose their space).
 */
export function wordsFromTokens(tokens: WhisperToken[]): CaptionWord[] {
  const words: CaptionWord[] = [];
  let current: CaptionWord | null = null;
  let lastTo = -Infinity;
  let lastText = "";
  for (const token of tokens) {
    if (MARKER.test(token.text) || !token.text.trim()) continue;
    const startsSpace = /^\s/.test(token.text);
    const text = token.text.trim();
    const gap = token.from - lastTo;
    const afterSentence = SENTENCE_END.test(lastText) && /^[\p{L}\p{N}]/u.test(text);
    const punctuationOnly = !hasLetter(text);
    // An opening bracket or quote after a space begins something new — a
    // "(music)" tag arrives as " (", "music", ")" and must not glue to the word before it.
    const opens = startsSpace && /^[[({“"'«]/.test(text);
    const startsWord =
      current === null || opens || (!punctuationOnly && (startsSpace || gap >= WORD_GAP || afterSentence));
    if (startsWord) {
      current = { word: text, start: token.from, end: Math.max(token.to, token.from) };
      words.push(current);
    } else if (current) {
      current.word += text;
      current.end = Math.max(current.end, token.to, token.from);
    }
    lastTo = Math.max(lastTo, token.to, token.from);
    lastText = text;
  }
  // No word may be zero-length or run into the next one.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    if (next && w.end > next.start) w.end = next.start;
    if (w.end <= w.start) w.end = next ? Math.min(next.start, w.start + 0.06) : w.start + 0.06;
    if (w.end <= w.start) w.end = w.start + 0.01;
  }
  return dropNonSpeech(words);
}

/** Drops bracketed sound tags that arrived as several pieces: "[BLANK_AUDIO]", "(music)", "[Muzyka]". */
function dropNonSpeech(words: CaptionWord[]): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^[[(]/.test(w.word)) {
      let j = i;
      while (j < words.length && j - i < 5 && !/[\])]$/.test(words[j].word)) j++;
      if (j < words.length && j - i < 5) {
        const joined = words
          .slice(i, j + 1)
          .map((x) => x.word)
          .join(" ");
        if (!stripNonSpeech(joined).trim()) {
          i = j;
          continue;
        }
      }
    }
    if (stripNonSpeech(w.word).trim()) out.push(w);
  }
  return out;
}

export interface CueOptions {
  /** Characters a cue may hold before it breaks — a subtitle line and a half. */
  maxChars?: number;
  /** A pause this long between words breaks a cue. */
  maxGap?: number;
}

/**
 * Words → captions with their words attached. Breaks on sentence-final
 * punctuation, on a pause, or when the cue would grow past `maxChars`, so the
 * result reads like whisper's own cues but every word keeps its time.
 */
export function cuesFromWords(words: CaptionWord[], options: CueOptions = {}): Caption[] {
  const maxChars = options.maxChars ?? 64;
  const maxGap = options.maxGap ?? 0.8;
  const out: Caption[] = [];
  let buffer: CaptionWord[] = [];
  let length = 0;
  const flush = () => {
    if (!buffer.length) return;
    const text = stripNonSpeech(buffer.map((w) => w.word).join(" ")).trim();
    if (text) {
      out.push({
        id: uid("cap"),
        start: buffer[0].start,
        end: Math.max(buffer[0].start, buffer[buffer.length - 1].end),
        text,
        words: buffer,
        style: "subtitle",
      });
    }
    buffer = [];
    length = 0;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (buffer.length && length + w.word.length + 1 > maxChars) flush();
    buffer.push(w);
    length += w.word.length + 1;
    const next = words[i + 1];
    if (SENTENCE_END.test(w.word) || (next && next.start - w.end >= maxGap)) flush();
  }
  flush();
  return out;
}

/** The whole path: raw `-ml 1` JSON → captions with words, or null when the output is not token-shaped. */
export function captionsFromTokenJson(raw: string): Caption[] | null {
  const tokens = parseWhisperTokenJson(raw);
  if (!looksTokenised(tokens)) return null;
  return cuesFromWords(wordsFromTokens(tokens));
}
