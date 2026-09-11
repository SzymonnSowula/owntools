/**
 * meet — the shapes shared by the store, the backends and the files on disk.
 *
 * A meeting is a folder: `<AppData>/meet/<id>/` with `meeting.json` (this
 * `Meeting`), `transcript.md`, `notes.md`, `audio.wav` (unless the person
 * chose not to keep it) and `segments/` (the per-utterance WAVs the live
 * transcript was made from).
 */

/** Which side of the call a stretch of speech came from. */
export type Speaker = "mic" | "system";

export interface MeetingSegment {
  source: Speaker;
  /** Milliseconds of recording time (paused time excluded). */
  startMs: number;
  endMs: number;
  text: string;
}

export interface ActionItem {
  text: string;
  owner?: "you" | "them";
}

export interface MeetingSummary {
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
}

export interface Meeting {
  id: string;
  title: string;
  /** ISO timestamp of the start. */
  startedAt: string;
  durationMs: number;
  sources: Speaker[];
  segments: MeetingSegment[];
  notes: string;
  summary?: string;
  decisions?: string[];
  actionItems?: ActionItem[];
  /** `audio.wav` is on disk. */
  audio?: boolean;
}

/** Live-only: a line the transcript shows before its text has arrived. */
export interface LiveLine extends MeetingSegment {
  /** Waiting for the engine. */
  pending?: boolean;
}

export type Sensitivity = "low" | "normal" | "high";
export type MeetLang = "auto" | "en" | "pl";

export interface MeetSettings {
  mic: boolean;
  system: boolean;
  /** Endpoint id from `audio_capture_devices`; "" = the default. */
  micDevice: string;
  sensitivity: Sensitivity;
  /** Keep `audio.wav` after the meeting is written. */
  keepAudio: boolean;
  /** Language hint for whisper (Parakeet ignores it). */
  lang: MeetLang;
}

export const DEFAULT_MEET_SETTINGS: MeetSettings = {
  mic: true,
  system: true,
  micDevice: "",
  sensitivity: "normal",
  keepAudio: true,
  lang: "auto",
};

/** What the VAD's `thresholdDb` is for each sensitivity step. */
export const SENSITIVITY_DB: Record<Sensitivity, number> = {
  low: -36,
  normal: -42,
  high: -48,
};

export interface AudioDevice {
  id: string;
  name: string;
  default: boolean;
}

export interface AudioDevices {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

/** What the speech engines can do right now (from dictate's status). */
export interface EngineInfo {
  /** Something can transcribe. */
  ready: boolean;
  parakeet: boolean;
  whisper: boolean;
}
