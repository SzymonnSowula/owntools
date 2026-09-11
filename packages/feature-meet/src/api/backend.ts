import type { AudioDevices, EngineInfo, Meeting, MeetLang, Speaker } from "../types";

/**
 * Everything meet asks of the machine: the audio capture (Rust,
 * `audio_capture.rs`, contract §3), the speech engine (dictate's
 * `transcribeBlob`) and the meeting folders under `<AppData>/meet/`. One
 * implementation talks to Tauri (`tauri.ts`); the other (`demo.ts`) replays
 * a scripted call so the browser preview and `pnpm dev` show the whole tool.
 * The UI never knows which one it got.
 */

export interface CaptureVad {
  thresholdDb?: number;
  minSpeechMs?: number;
  hangoverMs?: number;
  maxSegmentMs?: number;
  padMs?: number;
}

export interface CaptureStart {
  /** Caller-chosen, e.g. "meet:<id>"; every event carries it back. */
  session: string;
  sources: Speaker[];
  /** Endpoint id from `devices().inputs`; the default when omitted. */
  micDevice?: string;
  /** Relative to AppData; created; segments + archive land here. */
  dir: string;
  /** Default true: write `<dir>/audio.wav` (48 kHz stereo, L = mic, R = system). */
  archive?: boolean;
  vad?: CaptureVad;
}

export interface CaptureStop {
  wavPath: string | null;
  durationMs: number;
  segments: number;
}

export interface SegmentEvent {
  session: string;
  source: Speaker;
  startMs: number;
  endMs: number;
  /** 16 kHz mono PCM16 WAV in `<dir>/segments/`. */
  path: string;
}

export interface LevelEvent {
  session: string;
  mic: number;
  system: number;
}

export interface CaptureErrorEvent {
  session: string;
  message: string;
}

export interface MeetBackend {
  devices(): Promise<AudioDevices>;
  start(opts: CaptureStart): Promise<void>;
  pause(session: string): Promise<void>;
  resume(session: string): Promise<void>;
  stop(session: string): Promise<CaptureStop>;
  onSegment(cb: (e: SegmentEvent) => void): () => void;
  onLevel(cb: (e: LevelEvent) => void): () => void;
  onError(cb: (e: CaptureErrorEvent) => void): () => void;

  /** One segment WAV → text; "" when the engine heard nothing. */
  transcribe(path: string, lang: MeetLang): Promise<string>;
  engine(): Promise<EngineInfo>;

  /** `meet/<id>`, relative to AppData — what `start` takes as `dir`. */
  meetingDir(id: string): string;
  /** Absolute path of that folder, for the finished event and the export. */
  absoluteDir(id: string): Promise<string>;
  listMeetings(): Promise<Meeting[]>;
  readMeeting(id: string): Promise<Meeting | null>;
  /** Writes meeting.json, transcript.md and notes.md. */
  writeMeeting(meeting: Meeting): Promise<void>;
  deleteMeeting(id: string): Promise<void>;
  /** Drops audio.wav and the segments once the transcript is written. */
  removeAudio(id: string): Promise<void>;
  /** A URL an `<audio>` element can play, null without an archive. */
  audioUrl(id: string): Promise<string | null>;
  reveal(id: string): Promise<void>;
}
