import { isTauri } from "@core/env";
import {
  blobToWhisperWav,
  DICTATION_MIC_CONSTRAINTS,
  preferredRecorderMime,
} from "@core/audio";
import { cleanTranscript, stripNonSpeech } from "./cleanup";

// ---------------------------------------------------------------------------
// Pinned artifacts
//
// Everything we download is pinned to an exact byte count and SHA-256, and the
// Rust downloader refuses to install a file that does not match. The engine
// gets executed and the models get loaded, so a corrupt or swapped download
// must never end up in AppData under a good name.
// ---------------------------------------------------------------------------

/** Pinned whisper.cpp Windows build (release b4938). */
export const ENGINE = {
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip",
  bytes: 8361840,
  sha256: "c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d",
  /** Where the archive lands (relative to AppData) before it is unpacked. */
  zip: "whisper/whisper-bin-x64.zip",
} as const;

/**
 * Models come from one pinned revision of ggerganov/whisper.cpp — never `main`,
 * because the checksums below belong to these exact files.
 */
export const MODEL_BASE_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/";

/** "148 MB", "1.6 GB" — decimal units, the way the download pages quote them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}

export interface WhisperModel {
  id: string;
  file: string;
  label: string;
  /** Exact size of the pinned file, in bytes. */
  bytes: number;
  /** Hex SHA-256 of the pinned file. */
  sha256: string;
  /** Download size for the picker, derived from `bytes`. */
  size: string;
  note: string;
}

function defineModel(model: Omit<WhisperModel, "size">): WhisperModel {
  return { ...model, size: formatBytes(model.bytes) };
}

/**
 * Accuracy ladder. `large-v3-turbo` is the one that actually understands
 * inflected languages, accents and jargon; base is only there because it is
 * small enough to try dictation on a slow machine.
 */
export const WHISPER_MODELS: WhisperModel[] = [
  defineModel({
    id: "base",
    file: "ggml-base.bin",
    label: "Base",
    bytes: 147951465,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    note: "Fastest, weakest. English-only dictation at a push.",
  }),
  defineModel({
    id: "small",
    file: "ggml-small.bin",
    label: "Small",
    bytes: 487601967,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    note: "Noticeably better on non-English speech, still light.",
  }),
  defineModel({
    id: "large-v3-turbo-q5",
    file: "ggml-large-v3-turbo-q5_0.bin",
    label: "Large v3 turbo (compressed)",
    bytes: 574041195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    note: "Recommended — large-model accuracy, quantised so it stays fast on CPU.",
  }),
  defineModel({
    id: "large-v3-turbo",
    file: "ggml-large-v3-turbo.bin",
    label: "Large v3 turbo",
    bytes: 1624555275,
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    note: "Best quality. Wants a fast machine and plenty of RAM.",
  }),
];

export const DEFAULT_MODEL_FILE = "ggml-large-v3-turbo-q5_0.bin";

export function modelByFile(file: string): WhisperModel | undefined {
  return WHISPER_MODELS.find((m) => m.file === file);
}

/** Download URL of a model file at the pinned revision. */
export function modelUrl(file: string): string {
  return `${MODEL_BASE_URL}${file}`;
}

export interface DictationStatus {
  engine: boolean;
  model: boolean;
  dir: string;
  /** Installed model filenames, best first. */
  models: string[];
}

export type DictationLang = "auto" | "en" | "pl";
export type DictationQuality = "fast" | "balanced" | "accurate";

export interface DictationSettings {
  lang: DictationLang;
  /** Model filename; empty = let the backend pick the best installed one. */
  model: string;
  quality: DictationQuality;
  /** Names, product terms, jargon — fed to whisper and used to fix spelling. */
  vocabulary: string;
  /** Free-form sentence or two about what you dictate about. */
  context: string;
  /** Carry the previous few sentences into the next take. */
  useSessionContext: boolean;
  /** Drop `[BLANK_AUDIO]`, subtitle boilerplate and repetition loops. */
  cleanup: boolean;
}

const SETTINGS_KEY = "suite-dictation-settings";
const LEGACY_LANG_KEY = "suite-dictation-lang";

export const DEFAULT_SETTINGS: DictationSettings = {
  lang: "auto",
  model: "",
  quality: "balanced",
  vocabulary: "",
  context: "",
  useSessionContext: true,
  cleanup: true,
};

/** Beam search / best-of per preset — whisper's own default is 5 / 5. */
const QUALITY_PRESETS: Record<DictationQuality, { beamSize: number; bestOf: number }> = {
  fast: { beamSize: 1, bestOf: 1 },
  balanced: { beamSize: 5, bestOf: 5 },
  accurate: { beamSize: 8, bestOf: 8 },
};

export function getDictationSettings(): DictationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DictationSettings>) };
    const legacy = localStorage.getItem(LEGACY_LANG_KEY);
    if (legacy === "en" || legacy === "pl" || legacy === "auto") {
      return { ...DEFAULT_SETTINGS, lang: legacy };
    }
  } catch {
    /* corrupt or unavailable storage — fall through to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveDictationSettings(patch: Partial<DictationSettings>): DictationSettings {
  const next = { ...getDictationSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    localStorage.setItem(LEGACY_LANG_KEY, next.lang);
  } catch {
    /* */
  }
  return next;
}

export function getDictationLang(): DictationLang {
  return getDictationSettings().lang;
}

export function setDictationLang(lang: DictationLang): void {
  saveDictationSettings({ lang });
}

/** Vocabulary field (commas or newlines) → terms. */
export function vocabularyTerms(settings = getDictationSettings()): string[] {
  return settings.vocabulary
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Rolling context
//
// whisper decodes each take in isolation, so the second half of a thought comes
// out cold. Feeding the tail of what was just dictated back in as the initial
// prompt is what keeps names, tense and terminology consistent between takes.
// ---------------------------------------------------------------------------

const CONTEXT_LIMIT = 420;
let sessionContext = "";

export function pushDictationContext(text: string): void {
  const merged = `${sessionContext} ${text}`.replace(/\s+/g, " ").trim();
  sessionContext = merged.length > CONTEXT_LIMIT ? merged.slice(-CONTEXT_LIMIT) : merged;
}

export function getDictationContext(): string {
  return sessionContext;
}

export function clearDictationContext(): void {
  sessionContext = "";
}

/** Vocabulary + standing context + what was just said, capped for whisper. */
export function buildPrompt(
  settings = getDictationSettings(),
  extra?: string,
): string {
  const parts: string[] = [];
  const terms = vocabularyTerms(settings);
  if (terms.length) parts.push(`${terms.join(", ")}.`);
  const context = settings.context.trim();
  if (context) parts.push(context);
  if (extra?.trim()) parts.push(extra.trim());
  if (settings.useSessionContext && sessionContext) parts.push(sessionContext);

  const prompt = parts.join(" ").replace(/\s+/g, " ").trim();
  // whisper keeps ~224 tokens of prompt; trim from the front so the vocabulary,
  // which sits at the head, is the last thing to go.
  return prompt.length > 880 ? prompt.slice(0, 880) : prompt;
}

export async function dictationStatus(): Promise<DictationStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const status = await invoke<DictationStatus>("dictation_status");
  return { ...status, models: status.models ?? [] };
}

/**
 * Whether the app owns Ctrl+Shift+Space system-wide. `false` means another
 * application registered the combination first, so dictation from other apps
 * will not start until it lets go; `null` outside Tauri.
 */
export async function dictationHotkeyRegistered(): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("dictation_hotkey_registered");
  } catch {
    return null;
  }
}

export type DictationTarget = "main" | "other";

/**
 * Where a transcript should go: `"main"` when the app's own main window is in
 * front (its text fields and the board take the words directly, see
 * `insert.ts`), `"other"` for any other application, which gets them typed.
 */
export async function dictationTarget(): Promise<DictationTarget> {
  if (!isTauri()) return "other";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string>("dictation_target")) === "main" ? "main" : "other";
  } catch {
    return "other";
  }
}

export async function removeModel(file: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("dictation_remove_model", { name: file });
}

// ---------------------------------------------------------------------------
// Install
//
// Downloads run in Rust (`download_file`): streamed to `<file>.part`, resumed
// with an HTTP Range request if a previous attempt was interrupted, checked
// against the pinned SHA-256 and only then renamed into place. A 1.6 GB model
// never sits in the webview's memory, and a half-downloaded one is never
// visible as installed.
// ---------------------------------------------------------------------------

export interface InstallProgress {
  step: "engine" | "model";
  loaded: number;
  total: number;
}

/**
 * `installDictation` rejects with this when the download was paused through
 * `cancelInstall()`. Nothing is lost: the partial file stays on disk and the
 * next `installDictation` call for the same model resumes where it stopped.
 */
export class InstallCancelled extends Error {
  constructor() {
    super("Download paused.");
    this.name = "InstallCancelled";
  }
}

export function isInstallCancelled(err: unknown): err is InstallCancelled {
  return (
    err instanceof InstallCancelled ||
    (err instanceof Error && err.name === "InstallCancelled")
  );
}

/** Mirrors `DownloadRequest` in `src-tauri/src/downloader.rs`. */
interface DownloadRequest {
  /** Caller-chosen id; progress events and `download_cancel` use it. */
  id: string;
  url: string;
  /** Destination relative to the app data folder. */
  dest: string;
  sha256?: string;
  /** Progress-bar total when the server sends no Content-Length. */
  expectedSize?: number;
}

interface DownloadProgressPayload {
  id: string;
  loaded: number;
  total: number;
}

const DOWNLOAD_PROGRESS_EVENT = "download-progress";
/** The rejection string `download_file` uses after `download_cancel`. */
const DOWNLOAD_CANCELLED = "cancelled";

/** Ids of the downloads currently running in Rust, for `cancelInstall`. */
const inflight = new Set<string>();
/** Set by `cancelInstall`; `installDictation` checks it between steps. */
let cancelRequested = false;

/** Resolves with the absolute path of the finished file. */
async function downloadToAppData(
  request: DownloadRequest,
  onProgress: (loaded: number, total: number) => void,
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<DownloadProgressPayload>(DOWNLOAD_PROGRESS_EVENT, (event) => {
    if (event.payload.id === request.id) onProgress(event.payload.loaded, event.payload.total);
  });
  inflight.add(request.id);
  try {
    if (cancelRequested) throw new InstallCancelled();
    return await invoke<string>("download_file", { request });
  } catch (err) {
    if (isInstallCancelled(err) || err === DOWNLOAD_CANCELLED) throw new InstallCancelled();
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    inflight.delete(request.id);
    unlisten();
  }
}

/**
 * Pauses the running install. The in-flight download stops at its next chunk
 * (the `.part` file stays on disk for resume) and the pending
 * `installDictation` rejects with `InstallCancelled`. Safe to call when nothing
 * is running.
 */
export async function cancelInstall(): Promise<void> {
  if (!isTauri()) return;
  cancelRequested = true;
  const ids = [...inflight];
  if (!ids.length) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await Promise.all(
    ids.map((id) => invoke("download_cancel", { id }).catch(() => undefined)),
  );
}

/**
 * Downloads the whisper.cpp binaries (once) and one model into AppData/whisper.
 * Existing models are left alone, so you can keep base around and add a bigger
 * one next to it.
 *
 * Resolves once both are in place. Rejects with `InstallCancelled` after
 * `cancelInstall()` (the partial file is kept, the next call resumes it) and
 * with an ordinary `Error` for anything else — network, checksum mismatch,
 * disk. Progress arrives per step; `total` is the pinned size when the server
 * sends no Content-Length.
 */
export async function installDictation(
  onProgress: (p: InstallProgress) => void,
  modelFile: string = DEFAULT_MODEL_FILE,
): Promise<void> {
  if (!isTauri()) throw new Error("Dictation runs in the desktop app.");
  cancelRequested = false;
  const { mkdir, readFile, remove, writeFile, exists, BaseDirectory } = await import(
    "@tauri-apps/plugin-fs"
  );
  const appData = { baseDir: BaseDirectory.AppData };
  if (!(await exists("whisper", appData))) {
    await mkdir("whisper", { ...appData, recursive: true });
  }

  const status = await dictationStatus();

  if (!status?.engine) {
    await downloadToAppData(
      {
        id: "engine",
        url: ENGINE.url,
        dest: ENGINE.zip,
        sha256: ENGINE.sha256,
        expectedSize: ENGINE.bytes,
      },
      (loaded, total) => onProgress({ step: "engine", loaded, total }),
    );
    // The archive is 8 MB, so reading it back into the webview to unpack is fine.
    const zip = await readFile(ENGINE.zip, appData);
    const { unzipSync } = await import("fflate");
    const files = unzipSync(zip);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith("/") || data.length === 0) continue;
      // Flatten zip-internal folders; keep only the CLI and its runtime DLLs
      // (the zip also ships ~20 demo executables we don't need).
      const base = name.split("/").pop()!;
      const keep =
        /^whisper-cli(\.exe)?$/i.test(base) ||
        /^main(\.exe)?$/i.test(base) ||
        (/\.dll$/i.test(base) && /^(whisper|ggml)/i.test(base));
      if (!keep) continue;
      await writeFile(`whisper/${base}`, data, appData);
    }
    await remove(ENGINE.zip, appData).catch(() => undefined);
  }

  // A cancel that landed while the archive was being unpacked.
  if (cancelRequested) throw new InstallCancelled();

  if (!status?.models.includes(modelFile)) {
    const known = modelByFile(modelFile);
    await downloadToAppData(
      {
        id: `model:${modelFile}`,
        url: modelUrl(modelFile),
        dest: `whisper/${modelFile}`,
        sha256: known?.sha256,
        expectedSize: known?.bytes,
      },
      (loaded, total) => onProgress({ step: "model", loaded, total }),
    );
  }
}

/** Decoder overrides for one call; anything omitted comes from settings. */
export interface TranscribeOverrides {
  model?: string;
  quality?: DictationQuality;
  /** Extra context for this take only (e.g. the note you are dictating into). */
  prompt?: string;
  /** Skip the rolling session context (long files bring their own). */
  ignoreSessionContext?: boolean;
  maxLen?: number;
}

interface WhisperInvokeOptions {
  prompt?: string;
  model?: string;
  beamSize?: number;
  bestOf?: number;
  suppressNonSpeech?: boolean;
  maxLen?: number;
}

/**
 * Transcribes an audio blob. Returns plain text (json=false) or whisper JSON.
 * When `translate` is true, whisper translates the speech to English.
 */
export async function transcribeBlob(
  blob: Blob,
  lang: DictationLang,
  json = false,
  translate = false,
  overrides: TranscribeOverrides = {},
): Promise<string> {
  if (!isTauri()) throw new Error("Transcription needs the desktop app.");
  const settings = getDictationSettings();
  const wav = await blobToWhisperWav(blob);
  const { writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const rel = `whisper/input-${Date.now()}.wav`;
  await writeFile(rel, wav, { baseDir: BaseDirectory.AppData });

  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const absolute = await join(await appDataDir(), rel);

  const preset = QUALITY_PRESETS[overrides.quality ?? settings.quality];
  const promptSettings = overrides.ignoreSessionContext
    ? { ...settings, useSessionContext: false }
    : settings;
  const options: WhisperInvokeOptions = {
    prompt: buildPrompt(promptSettings, overrides.prompt),
    model: overrides.model ?? settings.model,
    beamSize: preset.beamSize,
    bestOf: preset.bestOf,
    suppressNonSpeech: settings.cleanup,
    maxLen: overrides.maxLen,
  };

  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const raw = await invoke<string>("whisper_transcribe", {
      wav: absolute,
      lang: lang === "auto" ? "auto" : lang,
      json,
      translate,
      options,
    });
    if (json || !settings.cleanup) return raw;
    return cleanTranscript(raw, {
      vocabulary: vocabularyTerms(settings),
      sentenceCase: true,
    });
  } finally {
    const { remove } = await import("@tauri-apps/plugin-fs");
    void remove(rel, { baseDir: BaseDirectory.AppData }).catch(() => undefined);
  }
}

/**
 * The dictation path: transcribe, clean, and remember the result as context for
 * the next take. Use this anywhere the user is speaking *now* (pill, voice
 * notes, the test recorder) rather than transcribing an existing file.
 */
export async function dictate(
  blob: Blob,
  overrides: TranscribeOverrides = {},
): Promise<string> {
  const settings = getDictationSettings();
  const text = (await transcribeBlob(blob, settings.lang, false, false, overrides)).trim();
  if (text) pushDictationContext(text);
  return text;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

/** Parses whisper.cpp -oj output into segments with second-based timestamps. */
export function parseWhisperJson(raw: string): WhisperSegment[] {
  const data = JSON.parse(raw) as {
    transcription?: Array<{
      offsets?: { from: number; to: number };
      text?: string;
    }>;
  };
  return (data.transcription ?? [])
    .map((seg) => ({
      start: (seg.offsets?.from ?? 0) / 1000,
      end: (seg.offsets?.to ?? 0) / 1000,
      // Sound tags and subtitle boilerplate would otherwise become subtitle
      // cues of their own.
      text: stripNonSpeech(seg.text ?? ""),
    }))
    .filter((s) => s.text.length > 0 && s.end > s.start);
}

/** Opens the mic with dictation-tuned constraints. */
export async function openDictationMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(DICTATION_MIC_CONSTRAINTS);
}

/** MediaRecorder set up for speech: opus, generous bitrate, small timeslices. */
export function createDictationRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = preferredRecorderMime();
  return new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 128000,
  });
}

export async function typeText(text: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("type_text", { text });
}

export { cleanTranscript, stripNonSpeech, joinDictation } from "./cleanup";
