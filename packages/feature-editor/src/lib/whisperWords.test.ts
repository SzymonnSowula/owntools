import { describe, expect, it } from "vitest";
import {
  captionsFromTokenJson,
  cuesFromWords,
  looksTokenised,
  parseWhisperTokenJson,
  wordsFromTokens,
  type WhisperToken,
} from "./whisperWords";

/** Whisper's `-oj` shape, one entry per token as `-ml 1` produces it. */
function json(tokens: WhisperToken[]): string {
  return JSON.stringify({
    transcription: tokens.map((t) => ({
      timestamps: { from: "", to: "" },
      offsets: { from: Math.round(t.from * 1000), to: Math.round(t.to * 1000) },
      text: t.text,
    })),
  });
}

const tok = (text: string, from: number, to: number): WhisperToken => ({ text, from, to });

describe("wordsFromTokens", () => {
  it("joins word pieces, attaches punctuation and keeps the word's span", () => {
    const words = wordsFromTokens([
      tok(" Hello", 0.5, 0.8),
      tok(",", 0.8, 0.8),
      tok(" transc", 1.0, 1.2),
      tok("ription", 1.2, 1.5),
      tok(" works", 1.6, 1.9),
      tok(".", 1.9, 1.9),
    ]);
    expect(words.map((w) => w.word)).toEqual(["Hello,", "transcription", "works."]);
    expect(words[0]).toMatchObject({ start: 0.5, end: 0.8 });
    expect(words[1]).toMatchObject({ start: 1.0, end: 1.5 });
    expect(words[2]).toMatchObject({ start: 1.6, end: 1.9 });
  });

  it("starts a new word after a gap or a sentence end even without a leading space", () => {
    const words = wordsFromTokens([tok("First", 0, 0.3), tok(".", 0.3, 0.3), tok("Second", 0.35, 0.6), tok("third", 1.2, 1.4)]);
    expect(words.map((w) => w.word)).toEqual(["First.", "Second", "third"]);
  });

  it("gives a zero-length token a small span that never runs into the next word", () => {
    const words = wordsFromTokens([tok(" a", 1, 1), tok(" b", 1.02, 1.3)]);
    expect(words[0].end).toBeGreaterThan(words[0].start);
    expect(words[0].end).toBeLessThanOrEqual(words[1].start);
  });

  it("drops sound tags that arrived in pieces and whisper's markers", () => {
    const words = wordsFromTokens([
      tok("[_BEG_]", 0, 0),
      tok(" [", 0, 0.1),
      tok("BL", 0.1, 0.2),
      tok("ANK", 0.2, 0.3),
      tok("_AUDIO", 0.3, 0.4),
      tok("]", 0.4, 0.5),
      tok(" Real", 1, 1.3),
      tok(" (", 1.4, 1.5),
      tok("music", 1.5, 1.7),
      tok(")", 1.7, 1.8),
      tok(" words", 2, 2.3),
    ]);
    expect(words.map((w) => w.word)).toEqual(["Real", "words"]);
  });
});

describe("cuesFromWords", () => {
  const words = wordsFromTokens([
    tok(" One", 0, 0.2),
    tok(" two", 0.3, 0.5),
    tok(".", 0.5, 0.5),
    tok(" Three", 0.7, 0.9),
    tok(" four", 2.0, 2.2),
    tok(" five", 2.3, 2.5),
  ]);

  it("breaks on sentence ends and pauses, and each cue keeps its words", () => {
    const cues = cuesFromWords(words);
    expect(cues.map((c) => c.text)).toEqual(["One two.", "Three", "four five"]);
    expect(cues[0]).toMatchObject({ start: 0, end: 0.5, style: "subtitle" });
    expect(cues[0].words!.map((w) => w.word)).toEqual(["One", "two."]);
    expect(cues[2].start).toBe(2.0);
  });

  it("breaks a long run before it grows past the character budget", () => {
    const many = Array.from({ length: 40 }, (_, i) => tok(` word${i}`, i, i + 0.5));
    const cues = cuesFromWords(wordsFromTokens(many), { maxChars: 30, maxGap: 5 });
    expect(cues.length).toBeGreaterThan(5);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(30);
  });
});

describe("the whole path", () => {
  it("turns -ml 1 JSON into captions with words, and refuses ordinary cue JSON", () => {
    const tokenised = json([
      tok(" Hi", 0, 0.2),
      tok(" there", 0.25, 0.5),
      tok(",", 0.5, 0.5),
      tok(" um", 0.7, 0.9),
      tok(",", 0.9, 0.9),
      tok(" welcome", 1.1, 1.5),
      tok(".", 1.5, 1.5),
    ]);
    const captions = captionsFromTokenJson(tokenised)!;
    expect(captions.length).toBe(1);
    expect(captions[0].text).toBe("Hi there, um, welcome.");
    expect(captions[0].words!.length).toBe(4);
    expect(captions[0].words![2]).toMatchObject({ word: "um,", start: 0.7 });

    const cues = json([tok(" Hi there, um, welcome to the show.", 0, 2), tok(" Today we look at cuts.", 2.2, 4), tok(" And more.", 4.1, 5), tok(" Bye now.", 5.1, 6)]);
    expect(looksTokenised(parseWhisperTokenJson(cues))).toBe(false);
    expect(captionsFromTokenJson(cues)).toBeNull();
  });
});
