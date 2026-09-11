import { hashOf } from "../merge";
import { isRecord } from "./adapter";
import { folderAdapter } from "./folderCollection";

/**
 * Meetings: `<AppData>/meet/<id>/` with `meeting.json`, `transcript.md` and
 * `notes.md`. **`audio.wav` and `segments/` never travel** — the recording is
 * the one large, private thing in the folder and the transcript is what the
 * other device needs. The value fingerprints the text files by content, so
 * a copy is not mistaken for an edit.
 */

export const MEET_ROOT = "meet";
export const MEET_EXCLUDE = ["audio.wav", "segments"];

export interface MeetItem {
  id: string;
  title: string;
  /** From meeting.json when it has one (ms or ISO), else absent. */
  updatedAt?: number;
  /** Fingerprint of meeting.json. */
  meeting: string;
  /** Text files by name and size, sorted. */
  files: Array<{ name: string; bytes: number }>;
}

function toMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}

export const meetAdapter = folderAdapter<MeetItem>({
  id: "meet",
  label: "Meetings",
  detail: "meeting notes and transcripts; the audio recording stays on the device that made it",
  appRoot: MEET_ROOT,
  syncRoot: "meet",
  exclude: MEET_EXCLUDE,
  async describe(ctx, entry) {
    const text = await ctx.backend.appReadText(`${MEET_ROOT}/${entry.name}/meeting.json`);
    if (text === null) return null;
    let meta: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) meta = parsed;
    } catch {
      /* fingerprint still works */
    }
    const files = (await ctx.backend.appScan(`${MEET_ROOT}/${entry.name}`))
      .filter((f) => !f.isDir && !MEET_EXCLUDE.includes(f.name))
      .map((f) => ({ name: f.name, bytes: f.bytes }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const item: MeetItem = {
      id: entry.name,
      title: typeof meta.title === "string" && meta.title ? meta.title : "Meeting",
      meeting: hashOf(text),
      files,
    };
    const updatedAt = toMs(meta.updatedAt);
    if (updatedAt !== undefined) item.updatedAt = updatedAt;
    return item;
  },
  nameOf: (v) => v.title,
});
