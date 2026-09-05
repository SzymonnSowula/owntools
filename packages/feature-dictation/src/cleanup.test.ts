import { describe, expect, it } from "vitest";
import { applyVocabulary, cleanTranscript, joinDictation, stripNonSpeech } from "./cleanup";

describe("stripNonSpeech", () => {
  it("removes bracketed and parenthesised sound tags", () => {
    expect(stripNonSpeech("[BLANK_AUDIO]")).toBe("");
    expect(stripNonSpeech("Hello [MUSIC] world")).toBe("Hello world");
    expect(stripNonSpeech("(music) let's begin (applause)")).toBe("let's begin");
    expect(stripNonSpeech("Dobra, (muzyka) zaczynamy [śmiech]")).toBe("Dobra, zaczynamy");
    expect(stripNonSpeech("<noise> testing")).toBe("testing");
  });

  it("removes ♪ lyric markers and *action* tags", () => {
    expect(stripNonSpeech("♪ la la la ♪ and then I said")).toBe("and then I said");
    expect(stripNonSpeech("*sighs* okay")).toBe("okay");
  });

  it("keeps ordinary parenthetical speech", () => {
    expect(stripNonSpeech("we ship (hopefully) on Monday")).toBe("we ship (hopefully) on Monday");
  });

  it("drops whole-line subtitle hallucinations, Polish and English", () => {
    const raw = [
      "Pierwsze zdanie.",
      "Napisy stworzone przez społeczność Amara.org",
      "Drugie zdanie.",
      "Subtitles by the Amara.org community",
      "Thanks for watching!",
      "Thank you.",
      "Zapraszam do subskrypcji!",
      "Trzecie zdanie.",
    ].join("\n");
    expect(stripNonSpeech(raw)).toBe("Pierwsze zdanie.\nDrugie zdanie.\nTrzecie zdanie.");
  });

  it("only drops a hallucination when it is the whole line", () => {
    const line = "Thanks for watching the demo, now let's start.";
    expect(stripNonSpeech(line)).toBe(line);
  });

  it("drops blank lines and collapses runs of spaces", () => {
    expect(stripNonSpeech("one   two\n\n\nthree")).toBe("one two\nthree");
  });
});

describe("cleanTranscript", () => {
  it("returns an empty string when nothing but noise was heard", () => {
    expect(cleanTranscript("")).toBe("");
    expect(cleanTranscript("[BLANK_AUDIO]")).toBe("");
    expect(cleanTranscript("(muzyka)\nThank you.\n")).toBe("");
  });

  it("collapses a word repeated three or more times, leaves a double alone", () => {
    expect(cleanTranscript("tak tak tak tak tak, dobrze")).toBe("tak tak, dobrze");
    expect(cleanTranscript("no no, I mean it")).toBe("no no, I mean it");
  });

  it("collapses the same sentence repeated in a loop", () => {
    expect(cleanTranscript("I went home. I went home. I went home. Then I slept.")).toBe(
      "I went home. Then I slept.",
    );
    // Case and punctuation don't make it a different sentence.
    expect(cleanTranscript("Okay. okay! OKAY.")).toBe("Okay.");
  });

  it("fixes the stray space whisper leaves before punctuation", () => {
    expect(cleanTranscript("Hello , world . How are you ?")).toBe("Hello, world. How are you?");
    expect(cleanTranscript("see ( below )")).toBe("see (below)");
  });

  it("rewrites vocabulary to its canonical spelling, including the one-break variant", () => {
    const vocabulary = ["shipshape", "Tauri"];
    expect(cleanTranscript("ship shape is built with tauri", { vocabulary })).toBe(
      "shipshape is built with Tauri",
    );
    expect(cleanTranscript("Ship-shape, Shipshape and SHIPSHAPE", { vocabulary })).toBe(
      "shipshape, shipshape and shipshape",
    );
  });

  it("capitalises the first letter with sentenceCase", () => {
    expect(cleanTranscript("hello world.")).toBe("hello world.");
    expect(cleanTranscript("hello world.", { sentenceCase: true })).toBe("Hello world.");
    expect(cleanTranscript("łódź jest piękna.", { sentenceCase: true })).toBe("Łódź jest piękna.");
  });

  it("cleans a realistic take end to end", () => {
    const raw = [
      "[BLANK_AUDIO]",
      "So the ship shape launch is ready , I think.",
      "(muzyka)",
      "I think. I think. I think.",
      "Napisy stworzone przez społeczność Amara.org",
      "",
    ].join("\n");
    expect(cleanTranscript(raw, { vocabulary: ["shipshape"], sentenceCase: true })).toBe(
      "So the shipshape launch is ready, I think. I think.",
    );
  });
});

describe("applyVocabulary", () => {
  it("leaves words that merely contain a term alone", () => {
    expect(applyVocabulary("shipshaped hulls", ["shipshape"])).toBe("shipshaped hulls");
  });

  it("matches multi-word terms as a whole and ignores entries shorter than two characters", () => {
    expect(applyVocabulary("we use claude code daily", ["Claude Code"])).toBe(
      "we use Claude Code daily",
    );
    expect(applyVocabulary("a b c", ["a", " ", ""])).toBe("a b c");
  });

  it("is a no-op without vocabulary", () => {
    expect(applyVocabulary("ship shape", [])).toBe("ship shape");
  });
});

describe("joinDictation", () => {
  it("capitalises the very first take", () => {
    expect(joinDictation("", "hello there")).toBe("Hello there");
    expect(joinDictation("   ", "hello")).toBe("Hello");
  });

  it("adds the missing space and leaves the casing alone mid-sentence", () => {
    expect(joinDictation("first part", "and more")).toBe(" and more");
    expect(joinDictation("first part ", "and more")).toBe("and more");
  });

  it("starts a new sentence after sentence-final punctuation", () => {
    expect(joinDictation("First sentence.", "second one")).toBe(" Second one");
    expect(joinDictation("Really?", "yes")).toBe(" Yes");
    expect(joinDictation("Wait…", "okay")).toBe(" Okay");
    expect(joinDictation("Done. ", "next")).toBe("Next");
  });

  it("returns an empty string for an empty take", () => {
    expect(joinDictation("anything", "")).toBe("");
  });
});
