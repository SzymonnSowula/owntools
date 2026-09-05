import { describe, expect, it } from "vitest";
import {
  groupTextItems,
  pagesToMarkdown,
  pagesToText,
  parsePageRange,
  type PdfTextItem,
} from "./pdfText";

/** A line of text as pdf.js would hand it over: one run per word, spaces between. */
function line(words: string[], y: number, opts: { x?: number; size?: number } = {}): PdfTextItem[] {
  const size = opts.size ?? 10;
  let x = opts.x ?? 50;
  const items: PdfTextItem[] = [];
  words.forEach((word, i) => {
    const width = word.length * size * 0.5;
    items.push({ str: word, x, y, width, height: size, eol: false });
    x += width;
    if (i < words.length - 1) {
      items.push({ str: " ", x, y, width: size * 0.25, height: 0, eol: false });
      x += size * 0.25;
    }
  });
  items[items.length - 1].eol = true;
  return items;
}

describe("groupTextItems", () => {
  it("joins runs into lines and lines into a paragraph", () => {
    const items = [
      ...line(["The", "quick", "brown"], 700),
      ...line(["fox", "jumps."], 688),
    ];
    expect(groupTextItems(items)).toEqual([{ text: "The quick brown fox jumps.", heading: false }]);
  });

  it("starts a new paragraph at a blank-line gap", () => {
    const items = [
      ...line(["First", "paragraph", "line"], 700),
      ...line(["continues", "here."], 688),
      ...line(["Second", "one."], 660),
    ];
    expect(groupTextItems(items).map((p) => p.text)).toEqual([
      "First paragraph line continues here.",
      "Second one.",
    ]);
  });

  it("marks larger lines as headings and keeps them separate", () => {
    const items = [
      ...line(["Chapter", "One"], 720, { size: 18 }),
      ...line(["Body", "text", "starts"], 700),
      ...line(["and", "goes", "on."], 688),
    ];
    expect(groupTextItems(items)).toEqual([
      { text: "Chapter One", heading: true },
      { text: "Body text starts and goes on.", heading: false },
    ]);
  });

  it("de-hyphenates words split across lines", () => {
    const items = [...line(["clear", "informa-"], 700), ...line(["tion", "flows"], 688)];
    expect(groupTextItems(items)[0].text).toBe("clear information flows");
  });

  it("treats a jump back up the page as a new column", () => {
    const items = [
      ...line(["left", "column"], 700),
      ...line(["ends", "here."], 688),
      ...line(["right", "column"], 700, { x: 320 }),
    ];
    expect(groupTextItems(items).map((p) => p.text)).toEqual(["left column ends here.", "right column"]);
  });

  it("returns nothing for a page without text", () => {
    expect(groupTextItems([])).toEqual([]);
    expect(groupTextItems([{ str: " ", x: 0, y: 0, width: 2, height: 0, eol: true }])).toEqual([]);
  });
});

describe("parsePageRange", () => {
  it("expands ranges, sorts, dedupes and clamps", () => {
    expect(parsePageRange("", 3)).toEqual([1, 2, 3]);
    expect(parsePageRange("1-3, 7", 10)).toEqual([1, 2, 3, 7]);
    expect(parsePageRange("5 2 2-3", 10)).toEqual([2, 3, 5]);
    expect(parsePageRange("8-20", 10)).toEqual([8, 9, 10]);
    expect(parsePageRange("3-1", 10)).toEqual([1, 2, 3]);
  });

  it("rejects nonsense and out-of-range input", () => {
    expect(() => parsePageRange("a-b", 3)).toThrow(/not a page/);
    expect(() => parsePageRange("9", 3)).toThrow(/3 pages/);
  });
});

describe("pagesToText / pagesToMarkdown", () => {
  const pages = [
    { number: 1, paragraphs: [{ text: "Title", heading: true }, { text: "Body.", heading: false }] },
    { number: 2, paragraphs: [{ text: "More.", heading: false }] },
  ];

  it("writes paragraphs with optional page markers", () => {
    expect(pagesToText(pages, { pageBreaks: false })).toBe("Title\n\nBody.\n\nMore.");
    expect(pagesToText(pages, { pageBreaks: true })).toBe("Title\n\nBody.\n\n--- page 2 ---\n\nMore.");
  });

  it("turns headings into ## and page breaks into rules", () => {
    expect(pagesToMarkdown(pages, { pageBreaks: true })).toBe("## Title\n\nBody.\n\n---\n\nMore.");
  });
});
