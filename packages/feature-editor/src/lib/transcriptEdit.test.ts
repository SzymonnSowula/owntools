import { describe, expect, it } from "vitest";
import type { Caption, Segment } from "../types";
import { FIXTURE_CAPTIONS, FIXTURE_CAPTIONS_PLAIN, FIXTURE_DURATION, LINES, lineStarting } from "./fixtures/transcript90";
import { cutSourceRanges } from "./segments";
import {
  GUARD,
  cutRangesForSentences,
  foldForSearch,
  keepRangesForSentences,
  normalizeToken,
  searchSentences,
  sentenceCutState,
  sentenceIndexAt,
  sentencesFromCaptions,
  wordIndexAt,
  wordsFromCaption,
} from "./transcriptEdit";

describe("wordsFromCaption", () => {
  it("uses whisper's own word times when the cue has them", () => {
    const words = wordsFromCaption(FIXTURE_CAPTIONS[0]);
    expect(words.every((w) => w.timed)).toBe(true);
    expect(words.map((w) => w.text)).toEqual(FIXTURE_CAPTIONS[0].words!.map((w) => w.word));
  });

  it("interpolates from character offsets, the transcriptFormat way, when there are none", () => {
    const cue: Caption = { id: "c", start: 10, end: 12, text: "one three fivefive", style: "subtitle" };
    const words = wordsFromCaption(cue);
    expect(words.map((w) => w.text)).toEqual(["one", "three", "fivefive"]);
    expect(words.every((w) => !w.timed)).toBe(true);
    expect(words[0].start).toBe(10);
    expect(words[2].end).toBeCloseTo(12, 5);
    // Longer words get more of the cue.
    expect(words[2].end - words[2].start).toBeGreaterThan(words[0].end - words[0].start);
    // In order and non-overlapping.
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end);
  });

  it("falls back to interpolation when the stored words are nonsense", () => {
    const cue: Caption = {
      id: "c",
      start: 0,
      end: 2,
      text: "a b",
      words: [{ word: "a", start: 5, end: 1 }],
      style: "subtitle",
    };
    expect(wordsFromCaption(cue).every((w) => !w.timed)).toBe(true);
  });
});

describe("sentencesFromCaptions", () => {
  it("rebuilds one sentence per spoken line from six-word cues", () => {
    const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);
    expect(sentences.length).toBe(LINES.length);
    expect(sentences.map((s) => s.text)).toEqual(LINES.map((l) => l.text));
    expect(sentences.every((s) => s.timed)).toBe(true);
    // Sentence bounds are the first and last word.
    const retake = lineStarting("So the first thing you need to do is open");
    const s = sentences.find((x) => x.text.startsWith("So the first thing you need to do is open"))!;
    expect(s.start).toBeCloseTo(retake.start, 6);
    expect(s.end).toBeCloseTo(retake.end, 6);
  });

  it("gives the same sentences from cues without word timing, marked as estimated", () => {
    const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS_PLAIN);
    expect(sentences.map((s) => s.text)).toEqual(LINES.map((l) => l.text));
    expect(sentences.every((s) => !s.timed)).toBe(true);
  });

  it("splits on a long pause even without punctuation, and on length", () => {
    const captions: Caption[] = [
      { id: "a", start: 0, end: 2, text: "no punctuation here", style: "subtitle" },
      { id: "b", start: 3.5, end: 5, text: "after a pause", style: "subtitle" },
      { id: "c", start: 5.1, end: 6, text: "right after", style: "subtitle" },
    ];
    const sentences = sentencesFromCaptions(captions);
    expect(sentences.map((s) => s.text)).toEqual(["no punctuation here", "after a pause right after"]);
    const wall: Caption = { id: "w", start: 0, end: 60, text: Array(120).fill("word").join(" "), style: "subtitle" };
    expect(sentencesFromCaptions([wall]).length).toBeGreaterThan(1);
  });

  it("puts overlapping cues in time order and keeps ids unique and stable", () => {
    const captions: Caption[] = [
      { id: "later", start: 5, end: 6, text: "Second.", style: "subtitle" },
      { id: "first", start: 1, end: 2, text: "First.", style: "subtitle" },
      { id: "dup", start: 1, end: 2, text: "Also first.", style: "subtitle" },
    ];
    const a = sentencesFromCaptions(captions);
    const b = sentencesFromCaptions(captions);
    expect(a.map((s) => s.text)).toEqual(["First.", "Also first.", "Second."]);
    expect(new Set(a.map((s) => s.id)).size).toBe(3);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });
});

describe("playhead lookups", () => {
  const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);

  it("finds the sentence and word under a source time", () => {
    const line = lineStarting("What about the camera bubble?");
    const idx = sentenceIndexAt(sentences, line.words[2].start + 0.01);
    expect(sentences[idx].text).toBe("What about the camera bubble?");
    expect(wordIndexAt(sentences[idx], line.words[2].start + 0.01)).toBe(2);
    // Before the first word there is nothing.
    expect(sentenceIndexAt(sentences, -1)).toBe(-1);
    // Past the last word of a sentence and its grace, no word is active.
    expect(wordIndexAt(sentences[idx], line.end + 1)).toBe(-1);
  });
});

describe("cut state", () => {
  const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);

  it("reports kept, cut and partial against the segments", () => {
    const target = sentences[5];
    const whole: Segment[] = [{ id: "a", start: 0, end: FIXTURE_DURATION }];
    expect(sentenceCutState(target, whole)).toBe("kept");
    const gone = cutSourceRanges(whole, [{ start: target.start - 0.02, end: target.end + 0.02 }]);
    expect(sentenceCutState(target, gone)).toBe("cut");
    const half = cutSourceRanges(whole, [{ start: target.start - 0.02, end: target.words[1].end }]);
    expect(sentenceCutState(target, half)).toBe("partial");
  });
});

describe("cutRangesForSentences", () => {
  const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);

  it("takes the pause after a mid-take sentence with it, never touching its neighbours", () => {
    const target = sentences[7];
    const prev = sentences[6];
    const next = sentences[8];
    const [range] = cutRangesForSentences(sentences, [target.id], FIXTURE_DURATION);
    expect(range.start).toBeCloseTo(target.start - GUARD, 6);
    expect(range.start).toBeGreaterThanOrEqual(prev.end);
    expect(range.end).toBeCloseTo(next.start - GUARD, 6);
    // The pause before stays, so exactly one pause remains after the cut.
    expect(range.start).toBeGreaterThan(prev.end);
  });

  it("leaves a long pause mostly alone and takes a short tail at the end of the take", () => {
    // "Let's fix that." is followed by a 1.9 s pause.
    const before = sentences.find((s) => s.text === "Let's fix that.")!;
    const [range] = cutRangesForSentences(sentences, [before.id], FIXTURE_DURATION);
    expect(range.end).toBeLessThanOrEqual(before.end + 0.25 + 1e-6);
    expect(range.end).toBeGreaterThan(before.end);
    const last = sentences[sentences.length - 1];
    const [tail] = cutRangesForSentences(sentences, [last.id], FIXTURE_DURATION);
    expect(tail.end).toBeCloseTo(Math.min(FIXTURE_DURATION, last.end + 0.25), 6);
  });

  it("merges neighbouring sentences into one range and keeps separate runs apart", () => {
    const ids = [sentences[2].id, sentences[3].id, sentences[9].id];
    const ranges = cutRangesForSentences(sentences, ids, FIXTURE_DURATION);
    expect(ranges.length).toBe(2);
    expect(ranges[0].start).toBeCloseTo(sentences[2].start - GUARD, 6);
    expect(ranges[0].end).toBeCloseTo(sentences[4].start - GUARD, 6);
    expect(ranges[1].start).toBeCloseTo(sentences[9].start - GUARD, 6);
  });

  it("cutting a sentence through the segments removes its words and only its words", () => {
    const whole: Segment[] = [{ id: "a", start: 0, end: FIXTURE_DURATION }];
    const target = sentences[10];
    const segments = cutSourceRanges(whole, cutRangesForSentences(sentences, [target.id], FIXTURE_DURATION));
    expect(sentenceCutState(target, segments)).toBe("cut");
    expect(sentenceCutState(sentences[9], segments)).toBe("kept");
    expect(sentenceCutState(sentences[11], segments)).toBe("kept");
  });
});

describe("keepRangesForSentences", () => {
  const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);

  it("keeps the run with a lead-in and a tail that stay clear of the neighbours", () => {
    const [range] = keepRangesForSentences(sentences, [sentences[4].id, sentences[5].id]);
    expect(range.start).toBeGreaterThanOrEqual(sentences[3].end);
    expect(range.start).toBeLessThan(sentences[4].start);
    expect(range.end).toBeGreaterThan(sentences[5].end);
    expect(range.end).toBeLessThanOrEqual(sentences[6].start);
  });
});

describe("search and normalisation", () => {
  it("normalises tokens for comparison and folds diacritics for search", () => {
    expect(normalizeToken("That's,")).toBe("that's");
    expect(normalizeToken("“Hello”")).toBe("hello");
    expect(normalizeToken("...")).toBe("");
    expect(foldForSearch("Właśnie Żółć")).toBe("wlasnie zolc");
    const sentences = sentencesFromCaptions(FIXTURE_CAPTIONS);
    const hits = searchSentences(sentences, "CURSOR");
    expect(hits.size).toBe(2);
    // "Watch the top left menu…" and "Thanks for watching…", found through a typo with a diacritic.
    expect(searchSentences(sentences, "wątch").size).toBe(2);
    expect(searchSentences(sentences, "").size).toBe(0);
  });
});
