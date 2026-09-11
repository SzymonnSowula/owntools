import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir, readDir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { dictationReady, dictationStatus, transcribeBlob } from "@feature-dictation/engine";
import { meetingMarkdownFiles } from "./files";
import type { CaptureErrorEvent, CaptureStart, CaptureStop, LevelEvent, MeetBackend, SegmentEvent } from "./backend";
import { normalizeMeeting } from "../lib/transcript";
import type { AudioDevices, EngineInfo, Meeting, MeetLang } from "../types";

const ROOT = "meet";
const appData = { baseDir: BaseDirectory.AppData };

function on<T>(name: string, cb: (payload: T) => void): () => void {
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void listen<T>(name, (event) => cb(event.payload)).then((un) => {
    if (disposed) un();
    else unlisten = un;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

async function readJson(rel: string): Promise<unknown> {
  const bytes = await readFile(rel, appData);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function writeText(rel: string, text: string): Promise<void> {
  await writeFile(rel, new TextEncoder().encode(text), appData);
}

async function readMeetingAt(id: string): Promise<Meeting | null> {
  const rel = `${ROOT}/${id}/meeting.json`;
  try {
    if (!(await exists(rel, appData))) return null;
    const meeting = normalizeMeeting(await readJson(rel));
    if (!meeting) return null;
    // The flag in the file is what the writer believed; the disk is the truth.
    const audio = await exists(`${ROOT}/${id}/audio.wav`, appData);
    return { ...meeting, audio };
  } catch {
    return null;
  }
}

export const tauriBackend: MeetBackend = {
  devices: () => invoke<AudioDevices>("audio_capture_devices"),
  start: (opts: CaptureStart) => invoke<void>("audio_capture_start", { ...opts }),
  pause: (session) => invoke<void>("audio_capture_pause", { session }),
  resume: (session) => invoke<void>("audio_capture_resume", { session }),
  stop: (session) => invoke<CaptureStop>("audio_capture_stop", { session }),
  onSegment: (cb) => on<SegmentEvent>("audio-capture-segment", cb),
  onLevel: (cb) => on<LevelEvent>("audio-capture-level", cb),
  onError: (cb) => on<CaptureErrorEvent>("audio-capture-error", cb),

  async transcribe(path: string, lang: MeetLang) {
    const bytes = await readFile(path);
    const blob = new Blob([bytes as BlobPart], { type: "audio/wav" });
    // A file, not a dictation take: spellings from the vocabulary apply, the
    // rolling session context and the phrase replacements do not.
    return transcribeBlob(blob, lang, false, false, { ignoreSessionContext: true });
  },

  async engine(): Promise<EngineInfo> {
    const status = await dictationStatus();
    return {
      ready: dictationReady(status),
      parakeet: !!status && status.parakeet.runtime && status.parakeet.models.length > 0,
      whisper: !!status && status.engine && status.model,
    };
  },

  meetingDir: (id) => `${ROOT}/${id}`,

  async absoluteDir(id) {
    return join(await appDataDir(), ROOT, id);
  },

  async listMeetings() {
    if (!(await exists(ROOT, appData))) return [];
    const entries = await readDir(ROOT, appData);
    const meetings = await Promise.all(
      entries.filter((e) => e.isDirectory).map((e) => readMeetingAt(e.name)),
    );
    return meetings
      .filter((m): m is Meeting => m !== null)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  },

  readMeeting: readMeetingAt,

  async writeMeeting(meeting) {
    const dir = `${ROOT}/${meeting.id}`;
    if (!(await exists(dir, appData))) await mkdir(dir, { ...appData, recursive: true });
    const files = meetingMarkdownFiles(meeting);
    await writeText(`${dir}/meeting.json`, JSON.stringify(meeting, null, 2));
    await writeText(`${dir}/transcript.md`, files.transcript);
    await writeText(`${dir}/notes.md`, files.notes);
  },

  async deleteMeeting(id) {
    const dir = `${ROOT}/${id}`;
    if (await exists(dir, appData)) await remove(dir, { ...appData, recursive: true });
  },

  async removeAudio(id) {
    for (const rel of [`${ROOT}/${id}/audio.wav`, `${ROOT}/${id}/segments`]) {
      if (await exists(rel, appData)) await remove(rel, { ...appData, recursive: true });
    }
  },

  async audioUrl(id) {
    const rel = `${ROOT}/${id}/audio.wav`;
    if (!(await exists(rel, appData))) return null;
    // The asset protocol streams and seeks; a Blob URL would mean reading a
    // 700 MB hour-long archive into memory first.
    return convertFileSrc(await join(await appDataDir(), rel));
  },

  async reveal(id) {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    const dir = await join(await appDataDir(), ROOT, id);
    const file = await join(dir, "meeting.json");
    await revealItemInDir((await exists(`${ROOT}/${id}/meeting.json`, appData)) ? file : dir);
  },
};
