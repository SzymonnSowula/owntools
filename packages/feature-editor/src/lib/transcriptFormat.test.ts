import { describe, expect, it } from "vitest";
import {
  GROUPINGS,
  formatStamp,
  groupTranscript,
  transcriptToText,
  type TimedText,
} from "./transcriptFormat";

/**
 * Whisper-like cues: short chunks whose boundaries ignore sentences — the first
 * sentence ends in the middle of cue two. The last cue is whitespace only.
 */
const CUES: TimedText[] = [
  { start: 0, end: 2, text: "Hello everyone and" },
  { start: 2, end: 4, text: "welcome back.  Today we" },
  { start: 4, end: 6, text: "ship the thing." },
  { start: 6, end: 7, text: "   " },
];

describe("groupTranscript", () => {
  it("offers exactly the three grouping modes", () => {
    expect(GROUPINGS.map((g) => g.value).sort()).toEqual(["lines", "paragraph", "sentences"]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    for (const mode of ["lines", "sentences", "paragraph"] as const) {
      expect(groupTranscript([], mode)).toEqual([]);
      expect(groupTranscript([{ start: 0, end: 1, text: "  " }], mode)).toEqual([]);
    }
  });

  it("lines: one block per cue, whitespace normalised, empty cues dropped", () => {
    expect(groupTranscript(CUES, "lines")).toEqual([
      { start: 0, end: 2, text: "Hello everyone and" },
      { start: 2, end: 4, text: "welcome back. Today we" },
      { start: 4, end: 6, text: "ship the thing." },
    ]);
  });

  it("paragraph: one block spanning the spoken cues", () => {
    expect(groupTranscript(CUES, "paragraph")).toEqual([
      { start: 0, end: 6, text: "Hello everyone and welcome back. Today we ship the thing." },
    ]);
  });

  it("sentences: merges cues until a sentence ends and interpolates the split time", () => {
    const out = groupTranscript(CUES, "sentences");
    expect(out.map((b) => b.text)).toEqual([
      "Hello everyone and welcome back.",
      "Today we ship the thing.",
    ]);
    // The boundary falls inside cue two (2 s – 4 s, 22 characters): "welcome
    // back." ends at character 13, "Today" starts at character 14.
    expect(out[0].start).toBe(0);
    expect(out[0].end).toBeCloseTo(2 + (2 * 13) / 22, 6);
    expect(out[1].start).toBeCloseTo(2 + (2 * 14) / 22, 6);
    expect(out[1].end).toBe(6);
    expect(out[0].end).toBeGreaterThan(2);
    expect(out[0].end).toBeLessThanOrEqual(out[1].start);
    expect(out[1].start).toBeLessThan(4);
  });

  it("sentences: a closing quote or bracket after the full stop belongs to the sentence", () => {
    const out = groupTranscript(
      [{ start: 0, end: 5, text: 'She said "stop." And we (finally) did.' }],
      "sentences",
    );
    expect(out.map((b) => b.text)).toEqual(['She said "stop."', "And we (finally) did."]);
  });

  it("sentences: flushes long unpunctuated speech instead of one wall of text", () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i % 10}`);
    const out = groupTranscript([{ start: 0, end: 60, text: words.join(" ") }], "sentences");
    expect(out.length).toBeGreaterThan(1);
    for (const block of out) expect(block.text.length).toBeLessThanOrEqual(260);
    expect(out.map((b) => b.text).join(" ")).toBe(words.join(" "));
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].end);
    }
    expect(out[0].start).toBe(0);
    expect(out[out.length - 1].end).toBe(60);
  });
});

describe("formatStamp / transcriptToText", () => {
  it("formats seconds as [HH:MM:SS]", () => {
    expect(formatStamp(0)).toBe("[00:00:00]");
    expect(formatStamp(59.4)).toBe("[00:00:59]");
    expect(formatStamp(3661.25)).toBe("[01:01:01]");
  });

  it("renders one block per line, optionally prefixed with its start stamp", () => {
    const blocks = groupTranscript(CUES, "sentences");
    expect(transcriptToText(blocks, false)).toBe(
      "Hello everyone and welcome back.\nToday we ship the thing.",
    );
    expect(transcriptToText(blocks, true)).toBe(
      "[00:00:00] Hello everyone and welcome back.\n[00:00:03] Today we ship the thing.",
    );
  });
});
