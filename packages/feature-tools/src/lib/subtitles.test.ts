import { describe, expect, it } from "vitest";
import {
  detectSubtitleFormat,
  flattenCues,
  parseSrt,
  parseSubtitles,
  parseTimestamp,
  parseVtt,
  shiftTimes,
  stripCueMarkup,
  toVtt,
} from "./subtitles";

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there,
<i>General</i> Kenobi.

2
00:00:04,000 --> 00:00:06,000
{\\an8}Second cue

3
00:00:07,000 --> 00:00:08,000

`;

const VTT = `WEBVTT
Kind: captions
Language: en

NOTE this is a comment
that spans lines

STYLE
::cue { color: lime }

intro
00:01.000 --> 00:03.500 align:start position:0%
<v Speaker>Hello there,</v>
<c.yellow>General</c> Kenobi.

00:00:04.000 --> 00:00:06.000
Second cue
`;

describe("parseTimestamp", () => {
  it("reads srt commas, vtt dots and short forms", () => {
    expect(parseTimestamp("00:01:02,500")).toBeCloseTo(62.5, 6);
    expect(parseTimestamp("01:02.5")).toBeCloseTo(62.5, 6);
    expect(parseTimestamp("1:02:03.250")).toBeCloseTo(3723.25, 6);
    expect(parseTimestamp("nope")).toBeNull();
  });
});

describe("stripCueMarkup", () => {
  it("removes tags and positioning codes", () => {
    expect(stripCueMarkup("<i>General</i> <b>Kenobi</b>")).toBe("General Kenobi");
    expect(stripCueMarkup("{\\an8}Up top")).toBe("Up top");
    expect(stripCueMarkup("<v Speaker>Hi</v> &amp; bye")).toBe("Hi & bye");
  });
});

describe("parseSrt", () => {
  it("reads cues, keeps line breaks, skips empty ones", () => {
    const cues = parseSrt(SRT);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: "Hello there,\nGeneral Kenobi." },
      { start: 4, end: 6, text: "Second cue" },
    ]);
  });

  it("copes with CRLF and a BOM", () => {
    const cues = parseSrt(`﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n\r\n`);
    expect(cues).toEqual([{ start: 1, end: 2, text: "Hi" }]);
  });
});

describe("parseVtt", () => {
  it("skips the header, NOTE and STYLE blocks and cue settings", () => {
    const cues = parseVtt(VTT);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: "Hello there,\nGeneral Kenobi." },
      { start: 4, end: 6, text: "Second cue" },
    ]);
  });
});

describe("parseSubtitles", () => {
  it("detects the format and refuses plain text", () => {
    expect(detectSubtitleFormat(VTT)).toBe("vtt");
    expect(detectSubtitleFormat(SRT)).toBe("srt");
    expect(parseSubtitles(SRT).format).toBe("srt");
    expect(() => parseSubtitles("just some prose")).toThrow(/srt or \.vtt/);
  });
});

describe("toVtt", () => {
  it("writes a header and dotted timestamps, round-tripping through parseVtt", () => {
    const cues = parseSrt(SRT);
    const vtt = toVtt(cues);
    expect(vtt.startsWith("WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\nHello there,\nGeneral Kenobi.\n")).toBe(true);
    expect(parseVtt(vtt)).toEqual(cues);
  });
});

describe("shiftTimes / flattenCues", () => {
  it("shifts both ends and clamps at zero", () => {
    const cues = shiftTimes([{ start: 1, end: 3, text: "a" }], -2);
    expect(cues).toEqual([{ start: 0, end: 1, text: "a" }]);
    expect(shiftTimes([{ start: 1, end: 3, text: "a" }], 0.5)[0].start).toBeCloseTo(1.5, 6);
  });

  it("flattens line breaks into spaces", () => {
    expect(flattenCues([{ start: 0, end: 1, text: "Hello,\nworld" }])[0].text).toBe("Hello, world");
  });
});
