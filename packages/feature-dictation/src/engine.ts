import { isTauri } from "@core/env";
import { logInfo } from "@core/errors";
import {
  blobToWhisperWav,
  DICTATION_MIC_CONSTRAINTS,
  preferredRecorderMime,
} from "@core/audio";
import { cleanTranscript, stripNonSpeech } from "./cleanup";
import { pushHistory } from "./history";
import {
  DEFAULT_MODEL_FILE,
  EMPTY_STATUS,
  engineAvailable,
  modelById,
  resolveActiveModel,
  runtimeFor,
  WHISPER_RUNTIME,
  type DictationModel,
  type Engine,
  type EngineStatus,
} from "./models";
import {
  entriesFromText,
  promptTerms,
  replacementRules,
  sanitizeEntries,
  spellingTerms,
  type VocabularyEntry,
} from "./vocabulary";

// ---------------------------------------------------------------------------
// Two engines, one catalogue
//
// whisper.cpp (OpenAI Whisper) and sherpa-onnx (NVIDIA Parakeet) — see
// `models.ts` for the pinned downloads and `parakeet.rs` / `dictation.rs` for
// the processes that run them. Whisper does everything (files, subtitles,
// translation, the vocabulary prompt); Parakeet is the faster dictation
// engine. `transcribeBlob` picks per call.
// ---------------------------------------------------------------------------

export {
  DEFAULT_MODEL_FILE,
  defaultInstallModel,
  dictationReady,
  EMPTY_STATUS,
  engineAvailable,
  formatBytes,
  MODEL_BASE_URL,
  modelAvailable,
  modelById,
  modelInstalled,
  modelReady,
  MODELS,
  PARAKEET_RUNTIME,
  PARAKEET_V3_ID,
  resolveActiveModel,
  PARAKEET_RUNTIMES,
  runtimeFor,
  runtimeInstalled,
  RUNTIMES,
  WHISPER_RUNTIMES,
  WHISPER_MODELS,
  WHISPER_RUNTIME,
} from "./models";
export type { DictationModel, Engine, EngineRuntime, EngineStatus, ModelTag, RuntimePlatform, Vendor } from "./models";

/** The whisper runtime under its old name (onboarding reads `.bytes`). */
export const ENGINE = { ...WHISPER_RUNTIME, zip: WHISPER_RUNTIME.archive } as const;
/** Old name of `modelById` — whisper ids are the file names, so it still fits. */
export const modelByFile = modelById;
export type WhisperModel = DictationModel;
export type DictationStatus = EngineStatus;

/** Download URL of a whisper model file at the pinned revision. */
export function modelUrl(file: string): string {
  return modelById(file)?.files[0]?.url ?? "";
}

export type DictationLang = "auto" | "en" | "pl";
export type DictationQuality = "fast" | "balanced" | "accurate";

export interface DictationSettings {
  lang: DictationLang;
  /**
   * Model id from the catalogue (`models.ts`); empty = the best runnable one.
   * Whisper ids are file names, so settings from before the catalogue still
   * point at the same model.
   */
  model: string;
  quality: DictationQuality;
  /**
   * The vocabulary: spellings whisper is told about and rewrites to, plus
   * spoken phrase → text replacements. See `vocabulary.ts`.
   */
  entries: VocabularyEntry[];
  /**
   * Pre-0.3 comma-separated terms. Read once by `getDictationSettings`, which
   * turns it into `entries`; kept in the type so an old JSON still parses.
   */
  vocabulary: string;
  /** Free-form sentence or two about what you dictate about. */
  context: string;
  /** Carry the previous few sentences into the next take. */
  useSessionContext: boolean;
  /** Drop `[BLANK_AUDIO]`, subtitle boilerplate and repetition loops. */
  cleanup: boolean;
  /** Drop "um", "uh", "yyy" — hesitation sounds, not words. */
  removeFillers: boolean;
  /** Remember the last takes locally (History page). */
  keepHistory: boolean;
}

export const SETTINGS_KEY = "suite-dictation-settings";
const LEGACY_LANG_KEY = "suite-dictation-lang";

export const DEFAULT_SETTINGS: DictationSettings = {
  lang: "auto",
  model: "",
  quality: "balanced",
  entries: [],
  vocabulary: "",
  context: "",
  useSessionContext: true,
  cleanup: true,
  removeFillers: false,
  keepHistory: true,
};

/**
 * Folds any stored shape onto the current one: entries are validated, and the
 * old free-text vocabulary becomes entries the first time it is seen.
 */
export function normalizeSettings(raw: Partial<DictationSettings> | null | undefined): DictationSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  let entries = sanitizeEntries(merged.entries);
  const legacy = typeof merged.vocabulary === "string" ? merged.vocabulary : "";
  if (!entries.length && legacy.trim()) entries = entriesFromText(legacy);
  return { ...merged, entries, vocabulary: "" };
}

/** Beam search / best-of per preset — whisper's own default is 5 / 5. */
const QUALITY_PRESETS: Record<DictationQuality, { beamSize: number; bestOf: number }> = {
  fast: { beamSize: 1, bestOf: 1 },
  balanced: { beamSize: 5, bestOf: 5 },
  accurate: { beamSize: 8, bestOf: 8 },
};

export function getDictationSettings(): DictationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw) as Partial<DictationSettings>);
    const legacy = localStorage.getItem(LEGACY_LANG_KEY);
    if (legacy === "en" || legacy === "pl" || legacy === "auto") {
      return normalizeSettings({ lang: legacy });
    }
  } catch {
    /* corrupt or unavailable storage — fall through to defaults */
  }
  return normalizeSettings(null);
}

/** Fired on `window` after every save, so every view of the settings agrees. */
export const SETTINGS_EVENT = "suite-dictation-settings";

export function saveDictationSettings(patch: Partial<DictationSettings>): DictationSettings {
  const next = normalizeSettings({ ...getDictationSettings(), ...patch });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    localStorage.setItem(LEGACY_LANG_KEY, next.lang);
  } catch {
    /* */
  }
  try {
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  } catch {
    /* no window */
  }
  return next;
}

export function getDictationLang(): DictationLang {
  return getDictationSettings().lang;
}

export function setDictationLang(lang: DictationLang): void {
  saveDictationSettings({ lang });
}

/** Canonical spellings from the vocabulary — the words rewritten after a take. */
export function vocabularyTerms(settings = getDictationSettings()): string[] {
  return spellingTerms(settings.entries);
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
  const terms = promptTerms(settings.entries);
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

/** What is installed, both engines. `null` outside the desktop app. */
export async function dictationStatus(): Promise<EngineStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const status = await invoke<Partial<EngineStatus>>("dictation_status");
  return {
    ...EMPTY_STATUS,
    ...status,
    models: status.models ?? [],
    parakeet: { ...EMPTY_STATUS.parakeet, ...(status.parakeet ?? {}), models: status.parakeet?.models ?? [] },
  };
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

/** Deletes an installed model of either engine. */
export async function removeModel(id: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  if (modelById(id)?.engine === "parakeet") {
    await invoke("parakeet_remove_model", { id });
  } else {
    await invoke("dictation_remove_model", { name: id });
  }
}

// ---------------------------------------------------------------------------
// Install
//
// Downloads run in Rust (`download_file`): streamed to `<file>.part`, resumed
// with an HTTP Range request if a previous attempt was interrupted, checked
// against the pinned SHA-256 and only then renamed into place. A 1.6 GB
// model never sits in the webview's memory, and a half-downloaded one is never
// visible as installed. A file that is already complete and matches its
// checksum is skipped, so a multi-file model resumes file by file.
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
 * The engine archive for whichever platform we are on, or a clear failure.
 * whisper.cpp has never shipped a macOS binary, so a Mac without our own
 * build pinned in `models.ts` gets told that rather than a download error
 * halfway through.
 */
function requireRuntime(engine: "whisper" | "parakeet") {
  const runtime = runtimeFor(engine);
  if (runtime) return runtime;
  const name = engine === "whisper" ? "Whisper" : "Parakeet";
  throw new Error(
    `${name} does not have a build for this platform yet. Parakeet runs on both Windows and macOS — pick a Parakeet model instead.`,
  );
}

/** whisper.cpp: the pinned archive, unpacked in the webview (it is 8 MB). */
async function installWhisperRuntime(onProgress: (p: InstallProgress) => void): Promise<void> {
  const runtime = requireRuntime("whisper");
  const { mkdir, readFile, remove, writeFile, exists, BaseDirectory } = await import(
    "@tauri-apps/plugin-fs"
  );
  const appData = { baseDir: BaseDirectory.AppData };
  if (!(await exists("whisper", appData))) {
    await mkdir("whisper", { ...appData, recursive: true });
  }
  await downloadToAppData(
    {
      id: "engine",
      url: runtime.url,
      dest: runtime.archive,
      sha256: runtime.sha256,
      expectedSize: runtime.bytes,
    },
    (loaded, total) => onProgress({ step: "engine", loaded, total }),
  );
  const zip = await readFile(runtime.archive, appData);
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
    const dest = `whisper/${base}`;
    await writeFile(dest, data, appData);
    // macOS and Linux: `writeFile` leaves the file at 0644, and a
    // recognizer that cannot be executed is not installed.
    if (!/\.(dll|exe)$/i.test(base)) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("mark_executable", { path: dest }).catch(() => undefined);
    }
  }
  await remove(runtime.archive, appData).catch(() => undefined);
}

/** sherpa-onnx: the pinned tar.bz2, unpacked by Rust (`parakeet_install_runtime`). */
async function installParakeetRuntime(onProgress: (p: InstallProgress) => void): Promise<void> {
  const runtime = requireRuntime("parakeet");
  await downloadToAppData(
    {
      id: "parakeet-runtime",
      url: runtime.url,
      dest: runtime.archive,
      sha256: runtime.sha256,
      expectedSize: runtime.bytes,
    },
    (loaded, total) => onProgress({ step: "engine", loaded, total }),
  );
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("parakeet_install_runtime", { archive: runtime.archive });
}

/** Where a model's files live, relative to AppData. */
function modelFileDest(model: DictationModel, name: string): string {
  return model.engine === "whisper" ? `whisper/${name}` : `parakeet/models/${model.id}/${name}`;
}

/**
 * Downloads a model's files one after another; progress is the model as a
 * whole. The big file comes first, so an interrupted install has the least
 * left to fetch when it resumes.
 */
async function installModelFiles(
  model: DictationModel,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  const files = [...model.files].sort((a, b) => b.bytes - a.bytes);
  const total = model.bytes;
  let done = 0;
  for (const file of files) {
    if (cancelRequested) throw new InstallCancelled();
    await downloadToAppData(
      {
        id: `model:${model.id}:${file.name}`,
        url: file.url,
        dest: modelFileDest(model, file.name),
        sha256: file.sha256,
        expectedSize: file.bytes,
      },
      (loaded) => onProgress({ step: "model", loaded: done + loaded, total }),
    );
    done += file.bytes;
    onProgress({ step: "model", loaded: done, total });
  }
}

/**
 * Installs one model from the catalogue plus the engine that runs it, when
 * that is not in place yet. Existing models are left alone, so you can keep
 * base around and add a bigger one next to it, or add Parakeet next to whisper.
 *
 * Resolves once everything is in place. Rejects with `InstallCancelled` after
 * `cancelInstall()` (the partial file is kept, the next call resumes it) and
 * with an ordinary `Error` for anything else — network, checksum mismatch,
 * disk. Progress arrives per step; `total` is the pinned size when the server
 * sends no Content-Length.
 */
export async function installDictation(
  onProgress: (p: InstallProgress) => void,
  modelId: string = DEFAULT_MODEL_FILE,
): Promise<void> {
  if (!isTauri()) throw new Error("Dictation runs in the desktop app.");
  const model = modelById(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  cancelRequested = false;

  if (!engineAvailable(model.engine)) requireRuntime(model.engine);

  const status = await dictationStatus();
  // Parakeet also needs the resident recognizer: an engine unpacked before
  // that existed still works, but pays the 4.5 s model load on every take,
  // so "install" on such a machine means "fetch the archive again".
  const runtimeReady =
    model.engine === "whisper"
      ? status?.engine
      : status?.parakeet.runtime && status?.parakeet.server;
  if (!runtimeReady) {
    if (model.engine === "whisper") await installWhisperRuntime(onProgress);
    else await installParakeetRuntime(onProgress);
  }

  // A cancel that landed while the archive was being unpacked.
  if (cancelRequested) throw new InstallCancelled();

  const installed =
    model.engine === "whisper"
      ? (status?.models ?? []).includes(model.id)
      : (status?.parakeet.models ?? []).includes(model.id);
  if (!installed) await installModelFiles(model, onProgress);
}

/** Decoder overrides for one call; anything omitted comes from settings. */
export interface TranscribeOverrides {
  /** Model id; empty = the settings' choice, then the best runnable one. */
  model?: string;
  quality?: DictationQuality;
  /** Extra context for this take only (e.g. the note you are dictating into). */
  prompt?: string;
  /** Skip the rolling session context (long files bring their own). */
  ignoreSessionContext?: boolean;
  maxLen?: number;
  /**
   * Someone is speaking *now* (the pill, a voice note): apply the phrase
   * replacements and filler removal. A file being transcribed gets the
   * spelling fixes only — "my email address" in a lecture is just words.
   */
  live?: boolean;
  /** Length of the recording, for the history. */
  durationMs?: number;
}

interface WhisperInvokeOptions {
  prompt?: string;
  model?: string;
  beamSize?: number;
  bestOf?: number;
  suppressNonSpeech?: boolean;
  maxLen?: number;
}

/** Where the per-take WAV is written before an engine reads it. */
const SCRATCH_DIR = "whisper";

/** The JSON line sherpa-onnx prints for a file. */
interface ParakeetJson {
  text?: string;
  tokens?: string[];
  timestamps?: number[];
}

/** What `parakeet_transcribe` answers: the JSON plus what it cost. */
interface ParakeetCall {
  json: string;
  /** Milliseconds the user waited for this take. */
  ms: number;
  /** The model was already loaded — i.e. this is the honest number. */
  warm: boolean;
  audioMs: number;
}

/**
 * How long the last take took, so the UI can show it and a regression is
 * noticed by someone other than the person waiting. Only set for Parakeet,
 * which is the engine dictation runs on.
 */
export interface DictationTiming {
  ms: number;
  warm: boolean;
  audioMs: number;
}

let lastTiming: DictationTiming | null = null;

export function lastDictationTiming(): DictationTiming | null {
  return lastTiming;
}

/**
 * Loads the speech model before it is needed. The pill calls this the
 * moment it starts listening, so the model load overlaps with the user
 * speaking instead of being added to the wait afterwards; on this laptop
 * that is the difference between ~5 s and ~0.7 s for a four-second take.
 *
 * Never throws: a warm-up that fails only means the next take is cold.
 */
export async function warmUpDictation(): Promise<void> {
  if (!isTauri()) return;
  try {
    const status = await dictationStatus();
    if (!status?.parakeet.server) return;
    const active = resolveActiveModel(getDictationSettings().model, status);
    if (!active || active.engine !== "parakeet") return;
    const { invoke } = await import("@tauri-apps/api/core");
    const ms = await invoke<number>("parakeet_warmup", { model: active.id });
    logInfo("dictation", `model warm in ${ms} ms`);
  } catch (err) {
    logInfo("dictation", `warm-up skipped: ${String(err)}`);
  }
}

/**
 * Which engine and model a call runs on. Subtitles (JSON with timestamps) and
 * translation are whisper features, so those calls go to whisper whatever
 * model is chosen; plain text goes to the chosen model.
 */
async function pickEngine(
  chosen: string,
  needsWhisper: boolean,
): Promise<{ engine: Engine; model: string }> {
  const status = await dictationStatus();
  if (needsWhisper) {
    if (!status?.engine || !status.models.length) throw new Error("Whisper is not installed.");
    const keep = modelById(chosen)?.engine === "whisper" && status.models.includes(chosen);
    return { engine: "whisper", model: keep ? chosen : "" };
  }
  const active = resolveActiveModel(chosen, status);
  if (!active) throw new Error("No speech model is installed.");
  return { engine: active.engine, model: active.id };
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
  const target = await pickEngine(overrides.model ?? settings.model, json || translate);
  logInfo("dictation", `engine ${target.engine} · model ${target.model || "(best installed)"}`);
  // A live take is trimmed to the words in it: whatever silence sat
  // between the hotkey and the first syllable is time the recognizer
  // would otherwise decode at its real-time factor. A file keeps its
  // silence, because its timings end up in subtitles.
  const wav = await blobToWhisperWav(blob, { trimSilence: overrides.live === true });
  const { exists, mkdir, writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  // The scratch WAV lives next to the whisper models; with Parakeet alone
  // installed that folder does not exist yet (caught natively: "os error 3").
  const appData = { baseDir: BaseDirectory.AppData };
  if (!(await exists(SCRATCH_DIR, appData))) await mkdir(SCRATCH_DIR, { ...appData, recursive: true });
  const rel = `${SCRATCH_DIR}/input-${Date.now()}.wav`;
  await writeFile(rel, wav, appData);

  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const absolute = await join(await appDataDir(), rel);
  const { invoke } = await import("@tauri-apps/api/core");

  try {
    let raw: string;
    if (target.engine === "parakeet") {
      const call = await invoke<ParakeetCall>("parakeet_transcribe", {
        wav: absolute,
        model: target.model,
      });
      lastTiming = { ms: call.ms, warm: call.warm, audioMs: call.audioMs };
      logInfo(
        "dictation",
        `${call.audioMs} ms of speech in ${call.ms} ms (${call.warm ? "warm" : "cold"})`,
      );
      let parsed: ParakeetJson = {};
      try {
        parsed = JSON.parse(call.json) as ParakeetJson;
      } catch {
        throw new Error("Parakeet returned something that is not a result.");
      }
      raw = (parsed.text ?? "").trim();
    } else {
      const preset = QUALITY_PRESETS[overrides.quality ?? settings.quality];
      const promptSettings = overrides.ignoreSessionContext
        ? { ...settings, useSessionContext: false }
        : settings;
      const options: WhisperInvokeOptions = {
        prompt: buildPrompt(promptSettings, overrides.prompt),
        model: target.model,
        beamSize: preset.beamSize,
        bestOf: preset.bestOf,
        suppressNonSpeech: settings.cleanup,
        maxLen: overrides.maxLen,
      };
      raw = await invoke<string>("whisper_transcribe", {
        wav: absolute,
        lang: lang === "auto" ? "auto" : lang,
        json,
        translate,
        options,
      });
      if (json) return raw;
    }
    return cleanTranscript(raw, {
      hallucinations: settings.cleanup,
      vocabulary: vocabularyTerms(settings),
      replacements: overrides.live ? replacementRules(settings.entries) : [],
      removeFillers: overrides.live ? settings.removeFillers : false,
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
  const text = (
    await transcribeBlob(blob, settings.lang, false, false, { ...overrides, live: true })
  ).trim();
  if (text) {
    pushDictationContext(text);
    if (settings.keepHistory) pushHistory(text, overrides.durationMs);
  }
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

/**
 * macOS decides whether an app may type into *other* applications, and it
 * decides silently: without the Accessibility permission `CGEventPost`
 * succeeds and not a character appears. Everywhere else there is nothing to
 * grant, which is what `"not-needed"` means.
 */
export type AccessibilityStatus = "granted" | "denied" | "not-needed";

export async function accessibilityStatus(): Promise<AccessibilityStatus> {
  if (!isTauri()) return "not-needed";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AccessibilityStatus>("accessibility_status");
  } catch {
    return "not-needed";
  }
}

/**
 * Asks macOS to show its "open System Settings" sheet. That sheet appears
 * once per app, so this is only ever called from a button the user pressed —
 * spending it on a background check would leave them with no prompt and no
 * idea why dictation does nothing.
 */
export async function requestAccessibility(): Promise<AccessibilityStatus> {
  if (!isTauri()) return "not-needed";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AccessibilityStatus>("accessibility_request");
  } catch {
    return "not-needed";
  }
}

export async function typeText(text: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("type_text", { text });
}

export { cleanTranscript, stripNonSpeech, joinDictation } from "./cleanup";
export type { VocabularyEntry } from "./vocabulary";
