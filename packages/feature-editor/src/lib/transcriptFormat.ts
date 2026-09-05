import { formatSrtTime } from "./srt";

/** A block of transcript text with its source-time bounds. */
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

/**
 * How raw whisper segments get regrouped before they're written out.
 * - `lines`      keeps whisper's own chunks (one short line per cue)
 * - `sentences`  merges chunks until a sentence ends (nicer subtitles + text)
 * - `paragraph`  collapses everything into one flowing block
 */
export type TranscriptGrouping = "lines" | "sentences" | "paragraph";

export const GROUPINGS: { value: TranscriptGrouping; label: string; hint: string }[] = [
  { value: "lines", label: "One line per cue", hint: "Keeps whisper's short chunks, one per line." },
  {
    value: "sentences",
    label: "Full sentences",
    hint: "Merges chunks until a sentence ends — best for subtitles.",
  },
  { value: "paragraph", label: "One paragraph", hint: "Collapses everything into one block." },
];

/** Sentence-final punctuation, optionally followed by a closing quote/bracket. */
const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/;

/**
 * Safety valve for transcripts without punctuation (whisper often returns
 * none): flush a sentence once it grows past this, so "Full sentences" never
 * degenerates into a single unreadable wall of text.
 */
const MAX_SENTENCE_CHARS = 240;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function push(out: TimedText[], buffer: TimedText[]): void {
  if (!buffer.length) return;
  const text = clean(buffer.map((b) => b.text).join(" "));
  if (text) {
    out.push({ start: buffer[0].start, end: buffer[buffer.length - 1].end, text });
  }
  buffer.length = 0;
}

/**
 * Splits cues into words, interpolating each word's time from its character
 * offset inside the cue. Sentences rarely line up with whisper's chunk
 * boundaries ("…helpful. So let's go…" is one cue), so sentence grouping has
 * to work below cue granularity to keep its timestamps honest.
 */
function toWords(items: TimedText[]): TimedText[] {
  const words: TimedText[] = [];
  for (const item of items) {
    const span = Math.max(0, item.end - item.start);
    const chars = item.text.length;
    let offset = 0;
    for (const word of item.text.split(" ")) {
      const at = (o: number) => (chars ? item.start + (span * o) / chars : item.start);
      words.push({ start: at(offset), end: at(offset + word.length), text: word });
      offset += word.length + 1;
    }
  }
  return words;
}

/** Regroups timed chunks according to `mode`; empty chunks are dropped. */
export function groupTranscript(items: TimedText[], mode: TranscriptGrouping): TimedText[] {
  const source = items.map((i) => ({ ...i, text: clean(i.text) })).filter((i) => i.text);
  if (!source.length) return [];

  if (mode === "lines") return source;

  if (mode === "paragraph") {
    return [
      {
        start: source[0].start,
        end: source[source.length - 1].end,
        text: source.map((i) => i.text).join(" "),
      },
    ];
  }

  const out: TimedText[] = [];
  const buffer: TimedText[] = [];
  let length = 0;
  for (const word of toWords(source)) {
    buffer.push(word);
    length += word.text.length + 1;
    if (SENTENCE_END.test(word.text) || length >= MAX_SENTENCE_CHARS) {
      push(out, buffer);
      length = 0;
    }
  }
  push(out, buffer);
  return out;
}

/** Formats seconds as a plain-text timestamp: "[HH:MM:SS]". */
export function formatStamp(seconds: number): string {
  return `[${formatSrtTime(seconds).slice(0, 8)}]`;
}

/** Renders grouped blocks as plain text, optionally stamped with start times. */
export function transcriptToText(items: TimedText[], timestamps: boolean): string {
  if (!timestamps) return items.map((i) => i.text).join("\n");
  return items.map((i) => `${formatStamp(i.start)} ${i.text}`).join("\n");
}
