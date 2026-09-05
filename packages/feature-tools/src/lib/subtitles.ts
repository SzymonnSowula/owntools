import type { TimedText } from "@feature-editor/lib/transcriptFormat";

/**
 * SubRip (.srt) and WebVTT (.vtt) in and out. Cues keep their line breaks in
 * `text` so .srt ↔ .vtt round-trips; flatten them (`flattenCues`) before
 * regrouping into prose.
 */

export type SubtitleFormat = "srt" | "vtt";

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})|(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const ARROW_RE = /-->/;

export function detectSubtitleFormat(text: string): SubtitleFormat | null {
  const head = text.replace(/^﻿/, "").trimStart();
  if (/^WEBVTT/.test(head)) return "vtt";
  if (ARROW_RE.test(head)) return "srt";
  return null;
}

/** "00:01:02,500" / "01:02.500" → seconds; null when it is not a timestamp. */
export function parseTimestamp(input: string): number | null {
  const m = input.trim().match(TIME_RE);
  if (!m) return null;
  const ms = (frac: string) => Number(frac.padEnd(3, "0")) / 1000;
  if (m[1] !== undefined) {
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms(m[4]);
  }
  return Number(m[5]) * 60 + Number(m[6]) + ms(m[7]);
}

/** Drops <i>/<b>/<c.class>/<v Name> tags and ASS-style {\an8} positioning. */
export function stripCueMarkup(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function parseBlocks(text: string, format: SubtitleFormat): TimedText[] {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = body.split(/\n[ \t]*\n+/);
  const out: TimedText[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    const timeAt = lines.findIndex((l) => ARROW_RE.test(l));
    if (timeAt < 0) continue;
    if (format === "vtt" && timeAt === 0 && /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const [left, right = ""] = lines[timeAt].split(ARROW_RE);
    const start = parseTimestamp(left);
    const end = parseTimestamp(right);
    if (start === null || end === null) continue;
    const cueText = lines
      .slice(timeAt + 1)
      .map(stripCueMarkup)
      .filter((l) => l.length > 0)
      .join("\n");
    if (!cueText) continue;
    out.push({ start, end: Math.max(end, start), text: cueText });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function parseSrt(text: string): TimedText[] {
  return parseBlocks(text, "srt");
}

export function parseVtt(text: string): TimedText[] {
  return parseBlocks(text, "vtt");
}

/** Parses either format; throws when the file has no cues at all. */
export function parseSubtitles(text: string): { format: SubtitleFormat; cues: TimedText[] } {
  const format = detectSubtitleFormat(text);
  if (!format) throw new Error("No subtitle cues found — expected an .srt or .vtt file.");
  const cues = parseBlocks(text, format);
  if (!cues.length) throw new Error("The file has no readable cues.");
  return { format, cues };
}

function vttStamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(rest, 3)}`;
}

export function toVtt(items: TimedText[]): string {
  const cues = items.map((it, i) => `${i + 1}\n${vttStamp(it.start)} --> ${vttStamp(it.end)}\n${it.text}\n`);
  return `WEBVTT\n\n${cues.join("\n")}`;
}

/** Moves every cue by `seconds` (negative = earlier); nothing goes below zero. */
export function shiftTimes(items: TimedText[], seconds: number): TimedText[] {
  if (!seconds) return items;
  return items.map((it) => {
    const start = Math.max(0, it.start + seconds);
    const end = Math.max(start, it.end + seconds);
    return { start, end, text: it.text };
  });
}

/** Line breaks inside cues become spaces, for regrouping into sentences or a paragraph. */
export function flattenCues(items: TimedText[]): TimedText[] {
  return items.map((it) => ({ ...it, text: it.text.replace(/\s*\n\s*/g, " ") }));
}
