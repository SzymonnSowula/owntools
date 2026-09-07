import { describe, expect, it } from "vitest";
import {
  applyReplacements,
  applyVocabulary,
  cleanTranscript,
  joinDictation,
  phrasePattern,
  removeFillers,
  stripNonSpeech,
} from "./cleanup";

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

describe("applyReplacements", () => {
  const rules = [
    { spoken: "my email address", replacement: "anna@shipshape.app" },
    { spoken: "super whisper", replacement: "Superwhisper" },
    { spoken: "my sign-off", replacement: "Best regards,\nAnna" },
  ];

  it("swaps the spoken phrase for the text, keeping the punctuation around it", () => {
    expect(applyReplacements("You can reach me at my email address.", rules)).toBe(
      "You can reach me at anna@shipshape.app.",
    );
    expect(applyReplacements("My Email Address, then a comma", rules)).toBe(
      "anna@shipshape.app, then a comma",
    );
  });

  it("tolerates whisper's own spellings: hyphens and broken words", () => {
    expect(applyReplacements("send it to my e-mail address", rules)).toBe("send it to anna@shipshape.app");
    expect(applyReplacements("I use superwhisper and Super-Whisper", rules)).toBe(
      "I use Superwhisper and Superwhisper",
    );
  });

  it("never matches inside another word and inserts the text verbatim", () => {
    expect(applyReplacements("supermy email addresses", rules)).toBe("supermy email addresses");
    expect(applyReplacements("my sign-off", rules)).toBe("Best regards,\nAnna");
    expect(applyReplacements("costs $5", [{ spoken: "five", replacement: "$5 & more" }])).toBe("costs $5");
    expect(applyReplacements("costs five", [{ spoken: "five", replacement: "$5 & more" }])).toBe(
      "costs $5 & more",
    );
  });

  it("lets a longer phrase win when the rules come longest-first", () => {
    const both = [
      { spoken: "my work email", replacement: "work@x.dev" },
      { spoken: "my email", replacement: "home@x.dev" },
    ];
    expect(applyReplacements("my work email and my email", both)).toBe("work@x.dev and home@x.dev");
  });

  it("keeps short tokens strict", () => {
    // "2FA" is three characters: no optional breaks, so "2 FA" stays.
    expect(phrasePattern("2FA").test("turn on 2 FA")).toBe(false);
    expect(phrasePattern("2FA").test("turn on 2fa")).toBe(true);
  });
});

describe("removeFillers", () => {
  it("drops hesitation sounds and repairs the sentence around them", () => {
    expect(removeFillers("Um, so we ship on Monday, uh, I think.")).toBe("So we ship on Monday, I think.");
    expect(removeFillers("Yyy no więc, eee, zaczynamy.")).toBe("No więc, zaczynamy.");
    expect(removeFillers("Okay. Hmm, next point. mm")).toBe("Okay. Next point.");
  });

  it("leaves real words alone", () => {
    expect(removeFillers("The album is called Umma")).toBe("The album is called Umma");
    expect(removeFillers("no, well, like I said")).toBe("no, well, like I said");
  });
});

describe("cleanTranscript with the vocabulary", () => {
  it("applies spellings, sentence case and replacements in that order", () => {
    const text = cleanTranscript("my email address is not ship shape", {
      vocabulary: ["shipshape"],
      replacements: [{ spoken: "my email address", replacement: "anna@shipshape.app" }],
      sentenceCase: true,
    });
    expect(text).toBe("anna@shipshape.app is not shipshape");
  });

  it("still applies the vocabulary with hallucination cleanup off", () => {
    expect(
      cleanTranscript("[BLANK_AUDIO] ship shape. ship shape.", {
        hallucinations: false,
        vocabulary: ["shipshape"],
      }),
    ).toBe("[BLANK_AUDIO] shipshape. shipshape.");
  });

  it("removes fillers before capitalising", () => {
    expect(cleanTranscript("um so the launch is ready", { removeFillers: true, sentenceCase: true })).toBe(
      "So the launch is ready",
    );
  });
});
