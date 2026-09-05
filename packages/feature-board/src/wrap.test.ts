import { describe, expect, it } from "vitest";
import { appendWrapped, wrapLimit, wrapWords } from "./wrap";

describe("wrapWords", () => {
  it("breaks at word boundaries within the limit", () => {
    expect(wrapWords("one two three four five", 9)).toBe("one two\nthree\nfour five");
  });

  it("collapses whitespace and keeps short text on one line", () => {
    expect(wrapWords("  hello   from  dictation ", 52)).toBe("hello from dictation");
  });

  it("gives an over-long word its own line", () => {
    expect(wrapWords("a supercalifragilistic b", 8)).toBe("a\nsupercalifragilistic\nb");
  });

  it("returns an empty string for nothing", () => {
    expect(wrapWords("   ", 10)).toBe("");
  });
});

describe("appendWrapped", () => {
  it("continues the last line and re-wraps only that line", () => {
    expect(appendWrapped("first line\nsecond", "and more words here", 12)).toBe(
      "first line\nsecond and\nmore words\nhere",
    );
  });

  it("starts fresh when the box is empty", () => {
    expect(appendWrapped("", "hello there", 52)).toBe("hello there");
    expect(appendWrapped("keep\n", "next", 52)).toBe("keep\nnext");
  });
});

describe("wrapLimit", () => {
  it("scales with the font size", () => {
    expect(wrapLimit(20)).toBe(52);
    expect(wrapLimit(16)).toBe(65);
    expect(wrapLimit(36)).toBe(29);
    expect(wrapLimit(200)).toBe(20);
  });
});
