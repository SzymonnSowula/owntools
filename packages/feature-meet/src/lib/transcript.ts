import type { ActionItem, Meeting, MeetingSegment, Speaker } from "../types";
import { dateLabel, formatClock, formatDuration, wordCount } from "./format";

/**
 * meeting.json ⇄ Markdown. The JSON is the record; `transcript.md` and
 * `notes.md` next to it are for people (and agents) who open the folder —
 * a plain dialog with times, readable without the app.
 */

export function speakerLabel(source: Speaker): "you" | "them" {
  return source === "mic" ? "you" : "them";
}

export function speakerFromLabel(label: string): Speaker | null {
  const l = label.trim().toLowerCase();
  if (l === "you" || l === "mic") return "mic";
  if (l === "them" || l === "system") return "system";
  return null;
}

function sourcesLabel(sources: Speaker[]): string {
  const parts: string[] = [];
  if (sources.includes("mic")) parts.push("you (mic)");
  if (sources.includes("system")) parts.push("them (system audio)");
  return parts.join(" + ") || "no sources";
}

/** One transcript line: `**[m:ss] you:** text`. */
export function transcriptLine(seg: MeetingSegment): string {
  return `**[${formatClock(seg.startMs)}] ${speakerLabel(seg.source)}:** ${seg.text.trim()}`;
}

/** The dialog only, in order — what `transcript.md` holds. */
export function transcriptMarkdown(meeting: Meeting): string {
  const head = [
    `# ${meeting.title}`,
    "",
    `${dateLabel(meeting.startedAt)} · ${formatDuration(meeting.durationMs)} · ${sourcesLabel(meeting.sources)}`,
    "",
    "## Transcript",
    "",
  ];
  const lines = sortedSegments(meeting.segments)
    .filter((s) => s.text.trim())
    .map(transcriptLine);
  if (!lines.length) lines.push("_No speech was transcribed._");
  return [...head, ...lines, ""].join("\n");
}

/** What `notes.md` holds: the person's own notes during the call. */
export function notesMarkdown(meeting: Meeting): string {
  const body = meeting.notes.trim() || "_No notes._";
  return `# ${meeting.title} — notes\n\n${body}\n`;
}

function actionLine(item: ActionItem): string {
  const owner = item.owner ? ` _(${item.owner})_` : "";
  return `- [ ] ${item.text.trim()}${owner}`;
}

/** Summary, decisions and to-dos — empty string when there is no summary yet. */
export function summaryMarkdown(meeting: Meeting): string {
  if (!meeting.summary && !meeting.decisions?.length && !meeting.actionItems?.length) return "";
  const out: string[] = [];
  if (meeting.summary) out.push("## Summary", "", meeting.summary.trim(), "");
  if (meeting.decisions?.length) out.push("## Decisions", "", ...meeting.decisions.map((d) => `- ${d.trim()}`), "");
  if (meeting.actionItems?.length) out.push("## Action items", "", ...meeting.actionItems.map(actionLine), "");
  return out.join("\n");
}

/** The whole meeting as one document — the "Save Markdown" export. */
export function meetingMarkdown(meeting: Meeting): string {
  const segments = sortedSegments(meeting.segments).filter((s) => s.text.trim());
  const words = segments.reduce((n, s) => n + wordCount(s.text), 0);
  const out: string[] = [
    `# ${meeting.title}`,
    "",
    `${dateLabel(meeting.startedAt)} · ${formatDuration(meeting.durationMs)} · ${sourcesLabel(meeting.sources)} · ${words} words`,
    "",
  ];
  const summary = summaryMarkdown(meeting);
  if (summary) out.push(summary);
  if (meeting.notes.trim()) out.push("## Notes", "", meeting.notes.trim(), "");
  out.push("## Transcript", "");
  if (segments.length) out.push(...segments.map(transcriptLine));
  else out.push("_No speech was transcribed._");
  out.push("");
  return out.join("\n");
}

/** Plain text of the dialog for the model: `you: …` / `them: …`, one per line. */
export function transcriptPlain(segments: MeetingSegment[]): string {
  return sortedSegments(segments)
    .filter((s) => s.text.trim())
    .map((s) => `[${formatClock(s.startMs)}] ${speakerLabel(s.source)}: ${s.text.trim()}`)
    .join("\n");
}

const LINE_RE = /^\*\*\[(\d+):(\d{2})(?::(\d{2}))?\]\s+(you|them):\*\*\s?(.*)$/;

/**
 * Reads the dialog back out of `transcript.md`. Times come back at second
 * precision (that is all the file carries); `endMs` is the next line's start
 * or the start plus a second for the last one.
 */
export function parseTranscriptMarkdown(md: string): MeetingSegment[] {
  const out: MeetingSegment[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const m = LINE_RE.exec(raw.trim());
    if (!m) continue;
    const [, a, b, c, who, text] = m;
    const startMs = c !== undefined
      ? (Number(a) * 3600 + Number(b) * 60 + Number(c)) * 1000
      : (Number(a) * 60 + Number(b)) * 1000;
    const source = speakerFromLabel(who);
    if (!source) continue;
    out.push({ source, startMs, endMs: startMs + 1000, text: text.trim() });
  }
  for (let i = 0; i + 1 < out.length; i += 1) {
    if (out[i + 1].startMs > out[i].startMs) out[i].endMs = out[i + 1].startMs;
  }
  return out;
}

export function sortedSegments(segments: MeetingSegment[]): MeetingSegment[] {
  return [...segments].sort((a, b) => a.startMs - b.startMs || (a.source === "mic" ? -1 : 1));
}

/**
 * Puts a segment in its place by time. Two segments from the *same* source
 * at the same start are the same utterance (a re-delivery) and merge.
 */
export function insertSegment<T extends MeetingSegment>(list: T[], seg: T): T[] {
  const same = list.findIndex((s) => s.source === seg.source && s.startMs === seg.startMs);
  if (same >= 0) {
    const next = list.slice();
    next[same] = { ...next[same], ...seg };
    return next;
  }
  const next = list.slice();
  let i = next.length;
  while (i > 0 && next[i - 1].startMs > seg.startMs) i -= 1;
  next.splice(i, 0, seg);
  return next;
}

const SPEAKERS: Speaker[] = ["mic", "system"];

function isSpeaker(v: unknown): v is Speaker {
  return typeof v === "string" && (SPEAKERS as string[]).includes(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** A meeting.json read back from disk: tolerant of missing fields, strict on shape. */
export function normalizeMeeting(raw: unknown): Meeting | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const segments: MeetingSegment[] = Array.isArray(r.segments)
    ? r.segments
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .filter((s) => isSpeaker(s.source))
        .map((s) => ({
          source: s.source as Speaker,
          startMs: num(s.startMs),
          endMs: num(s.endMs, num(s.startMs)),
          text: str(s.text),
        }))
    : [];
  const sources = Array.isArray(r.sources) ? r.sources.filter(isSpeaker) : [];
  const actionItems: ActionItem[] | undefined = Array.isArray(r.actionItems)
    ? r.actionItems
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof a.text === "string")
        .map((a) => ({ text: a.text as string, ...(a.owner === "you" || a.owner === "them" ? { owner: a.owner } : {}) }))
    : undefined;
  const decisions = Array.isArray(r.decisions) ? r.decisions.filter((d): d is string => typeof d === "string") : undefined;
  const startedAt = str(r.startedAt);
  return {
    id,
    title: str(r.title) || "Call",
    startedAt: startedAt && !Number.isNaN(Date.parse(startedAt)) ? startedAt : new Date(0).toISOString(),
    durationMs: num(r.durationMs),
    sources,
    segments: sortedSegments(segments),
    notes: str(r.notes),
    ...(typeof r.summary === "string" ? { summary: r.summary } : {}),
    ...(decisions ? { decisions } : {}),
    ...(actionItems ? { actionItems } : {}),
    ...(typeof r.audio === "boolean" ? { audio: r.audio } : {}),
  };
}

/** Case-insensitive search over title, transcript, notes and summary. */
export function meetingMatches(meeting: Meeting, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (meeting.title.toLowerCase().includes(q)) return true;
  if (meeting.summary?.toLowerCase().includes(q)) return true;
  if (meeting.notes.toLowerCase().includes(q)) return true;
  return meeting.segments.some((s) => s.text.toLowerCase().includes(q));
}
