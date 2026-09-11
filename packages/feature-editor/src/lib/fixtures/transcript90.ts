import type { Caption, CaptionWord, Segment } from "../../types";

/**
 * A ~90 s screen-recording narration, as whisper would hand it back with word
 * timing: fillers ("um", "uh", "hmm", "you know", "like,", "I mean"), one
 * retake (the "So the first thing…" sentence aborted and restarted), two
 * stutters ("the the", "that's, that's") and three pauses of 1.5 s or more.
 * Word times come from a simple speaking-rate model so the numbers are
 * deterministic and the tests can reason about them.
 */

interface Line {
  text: string;
  /** Silence before this sentence; the default is a breath. */
  gapBefore?: number;
}

export const LINES: Line[] = [
  { text: "Hi everyone, um, today I want to show you how the new export dialog works." },
  { text: "It's, like, the fastest way to get a clip out of a recording." },
  { text: "So the first thing you need to do is...", gapBefore: 0.5 },
  { text: "So the first thing you need to do is open the settings panel on the right.", gapBefore: 0.5 },
  { text: "You know, most people never find it." },
  { text: "Let's fix that." },
  { text: "Uh, here we have the the look tab with backgrounds and wallpapers.", gapBefore: 1.9 },
  { text: "Pick one, adjust the padding, and the preview updates live." },
  { text: "I mean, that part is obvious." },
  { text: "What about the camera bubble?" },
  { text: "It sits in any corner, um, and you can round it or make it a circle." },
  { text: "Nothing to configure, it just follows the recording." },
  { text: "Now the interesting part: the cursor.", gapBefore: 2.3 },
  { text: "Every click gets a ripple and the zoom follows where you point." },
  { text: "Hmm, let me show you on a real example." },
  { text: "Watch the top left menu when I click it." },
  { text: "There, the whole view moves with the pointer." },
  { text: "Okay so that's the cursor." },
  { text: "Finally, export.", gapBefore: 1.6 },
  { text: "Choose sixteen by nine or vertical, thirty or sixty frames, and hit save." },
  { text: "The MP4 lands in your downloads in a few seconds." },
  { text: "Uh, that's, that's it for today." },
  { text: "Thanks for watching, and see you in the next one." },
];

const BREATH = 0.35;
const WORD_GAP = 0.05;
const COMMA_PAUSE = 0.18;

function wordDuration(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}']/gu, "").length;
  return 0.12 + 0.04 * Math.max(1, letters);
}

export interface TimedLine {
  start: number;
  end: number;
  words: CaptionWord[];
}

/** Every line with its words timed, sequentially from 0. */
export function timedLines(lines: Line[] = LINES): TimedLine[] {
  const out: TimedLine[] = [];
  let t = 0;
  for (const line of lines) {
    t += line.gapBefore ?? BREATH;
    const words: CaptionWord[] = [];
    for (const piece of line.text.split(/\s+/)) {
      const start = t;
      const end = start + wordDuration(piece);
      words.push({ word: piece, start, end });
      t = end + WORD_GAP + (/[,;:]$/.test(piece) ? COMMA_PAUSE : 0);
    }
    out.push({ start: words[0].start, end: words[words.length - 1].end, words });
  }
  return out;
}

/**
 * Whisper-shaped cues: a sentence is split into cues of at most six words, each
 * cue carrying its words. `withWords: false` gives the same cues without word
 * timing, the shape of a transcript made before word timing existed.
 */
export function fixtureCaptions(withWords = true): Caption[] {
  const out: Caption[] = [];
  let n = 0;
  for (const line of timedLines()) {
    for (let i = 0; i < line.words.length; i += 6) {
      const words = line.words.slice(i, i + 6);
      out.push({
        id: `cap_${++n}`,
        start: words[0].start,
        end: words[words.length - 1].end,
        text: words.map((w) => w.word).join(" "),
        ...(withWords ? { words } : {}),
        style: "subtitle",
      });
    }
  }
  return out;
}

export const FIXTURE_CAPTIONS: Caption[] = fixtureCaptions(true);
export const FIXTURE_CAPTIONS_PLAIN: Caption[] = fixtureCaptions(false);
export const FIXTURE_DURATION = Math.ceil(FIXTURE_CAPTIONS[FIXTURE_CAPTIONS.length - 1].end + 1);
export const FIXTURE_SEGMENTS: Segment[] = [{ id: "seg_all", start: 0, end: FIXTURE_DURATION }];

/** The timed line whose text starts with `prefix`. */
export function lineStarting(prefix: string): TimedLine {
  const lines = timedLines();
  const index = LINES.findIndex((l) => l.text.startsWith(prefix));
  if (index < 0) throw new Error(`no fixture line starts with "${prefix}"`);
  return lines[index];
}
