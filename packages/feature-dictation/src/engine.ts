import { isTauri } from "@core/env";
import { logInfo } from "@core/errors";
import {
  blobToWhisperWav,
  conditionPcm,
  DICTATION_MIC_CONSTRAINTS,
  encodeWav,
  preferredRecorderMime,
  WHISPER_SAMPLE_RATE,
} from "@core/audio";
import { llmComplete, llmStatus } from "@core/llm";
import { cleanTranscript, stripNonSpeech, type CleanupOptions } from "./cleanup";
import { applyVoiceCommands, type CommandId } from "./commands";
import { pushHistory } from "./history";
import {
  matchProfile,
  MODE_INSTRUCTIONS,
  sanitizeProfiles,
  type AppProfile,
  type ForegroundApp,
} from "./profiles";
import { resampleLinear } from "./segmenter";
import {
  createStreamingSession,
  StreamingFailed,
  type PartialState,
  type StreamingResult,
  type StreamingSession,
} from "./streaming";
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
  /** "new line", "scratch that", "send it" and their Polish twins (`commands.ts`). */
  voiceCommands: boolean;
  /**
   * Decode while you speak (Parakeet): utterances go to the resident
   * recognizer as they close, so the stop leaves only the tail to wait for.
   * Off = the whole take is decoded after the stop, as before.
   */
  streaming: boolean;
  /** Per-application finishing rules (`profiles.ts`). */
  profiles: AppProfile[];
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
  voiceCommands: true,
  streaming: true,
  profiles: [],
};

/**
 * Folds any stored shape onto the current one: entries are validated, and the
 * old free-text vocabulary becomes entries the first time it is seen. A JSON
 * from before voice commands, streaming or profiles existed gets their
 * defaults; a profile row that no longer parses is dropped, not kept broken.
 */
export function normalizeSettings(raw: Partial<DictationSettings> | null | undefined): DictationSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  let entries = sanitizeEntries(merged.entries);
  const legacy = typeof merged.vocabulary === "string" ? merged.vocabulary : "";
  if (!entries.length && legacy.trim()) entries = entriesFromText(legacy);
  return {
    ...merged,
    entries,
    vocabulary: "",
    voiceCommands: merged.voiceCommands !== false,
    streaming: merged.streaming !== false,
    profiles: sanitizeProfiles(merged.profiles),
  };
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
 * The window in front when a take starts: whether it is our own main window
 * (its text fields and the board take the words directly, see `insert.ts`)
 * and, for any other application, which one — the process image name
 * ("slack.exe"; the app name on macOS) and its title, for the per-app
 * profiles. Both null when the platform cannot say.
 */
export interface ForegroundTarget extends ForegroundApp {
  main: boolean;
}

const UNKNOWN_TARGET: ForegroundTarget = { main: false, app: null, title: null };

export async function dictationTargetInfo(): Promise<ForegroundTarget> {
  if (!isTauri()) return UNKNOWN_TARGET;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<unknown>("dictation_target");
    // A build from before the struct answered with a bare string.
    if (raw === "main" || raw === "other") return { ...UNKNOWN_TARGET, main: raw === "main" };
    if (raw && typeof raw === "object") {
      const r = raw as Partial<ForegroundTarget>;
      return {
        main: r.main === true,
        app: typeof r.app === "string" && r.app ? r.app : null,
        title: typeof r.title === "string" && r.title ? r.title : null,
      };
    }
    return UNKNOWN_TARGET;
  } catch {
    return UNKNOWN_TARGET;
  }
}

/** `"main"` when our own main window is in front, `"other"` for anything else. */
export async function dictationTarget(): Promise<DictationTarget> {
  return (await dictationTargetInfo()).main ? "main" : "other";
}

/**
 * Presses Enter in the application in front — what "send it" and a profile's
 * auto-send do after the text is typed. Never called when the target is our
 * own window: there the text lands in a field through `insert.ts`, and Enter
 * would submit whatever form that field belongs to.
 */
export async function pressEnter(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("press_enter");
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
  /**
   * The application the take is going to, read by the pill when the take
   * *starts* — a window switched to mid-take does not change the profile.
   */
  target?: ForegroundApp;
  /** Profile override for this take; the settings' switch otherwise. */
  removeFillers?: boolean;
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
 *
 * For a streamed take `ms` is the **tail**: from the stop to the last word,
 * the only number the person waits for. `decodeMs` is everything the
 * recognizer spent on the take, most of it while they were still talking.
 */
export interface DictationTiming {
  ms: number;
  warm: boolean;
  audioMs: number;
  /** Decoded while speaking; `ms` is the tail. */
  streamed?: boolean;
  decodeMs?: number;
  /** Audio left to decode when the person stopped. */
  tailAudioMs?: number;
  segments?: number;
}

let lastTiming: DictationTiming | null = null;

export function lastDictationTiming(): DictationTiming | null {
  return lastTiming;
}

/** Where the per-take WAVs go before an engine reads them. */
async function writeScratchWav(wav: Uint8Array): Promise<{ rel: string; absolute: string }> {
  const { exists, mkdir, writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  // The scratch WAV lives next to the whisper models; with Parakeet alone
  // installed that folder does not exist yet (caught natively: "os error 3").
  const appData = { baseDir: BaseDirectory.AppData };
  if (!(await exists(SCRATCH_DIR, appData))) await mkdir(SCRATCH_DIR, { ...appData, recursive: true });
  const rel = `${SCRATCH_DIR}/input-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}.wav`;
  await writeFile(rel, wav, appData);
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return { rel, absolute: await join(await appDataDir(), rel) };
}

async function removeScratch(rel: string): Promise<void> {
  const { remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await remove(rel, { baseDir: BaseDirectory.AppData }).catch(() => undefined);
}

/**
 * The lowest-level Parakeet call: a conditioned 16 kHz WAV in, the recognizer's
 * text and what it cost out. Both the whole-take path and the streaming
 * segments end here.
 */
async function runParakeet(wav: Uint8Array, model: string): Promise<{ text: string; call: ParakeetCall }> {
  const { rel, absolute } = await writeScratchWav(wav);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const call = await invoke<ParakeetCall>("parakeet_transcribe", { wav: absolute, model });
    let parsed: ParakeetJson = {};
    try {
      parsed = JSON.parse(call.json) as ParakeetJson;
    } catch {
      throw new Error("Parakeet returned something that is not a result.");
    }
    return { text: (parsed.text ?? "").trim(), call };
  } finally {
    void removeScratch(rel);
  }
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

  if (target.engine === "parakeet") {
    const { text, call } = await runParakeet(wav, target.model);
    lastTiming = { ms: call.ms, warm: call.warm, audioMs: call.audioMs };
    logInfo(
      "dictation",
      `${call.audioMs} ms of speech in ${call.ms} ms (${call.warm ? "warm" : "cold"})`,
    );
    return cleanTranscript(text, cleanupOptions(settings, overrides));
  }

  const { rel, absolute } = await writeScratchWav(wav);
  try {
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
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("whisper_transcribe", {
      wav: absolute,
      lang: lang === "auto" ? "auto" : lang,
      json,
      translate,
      options,
    });
    if (json) return raw;
    return cleanTranscript(raw, cleanupOptions(settings, overrides));
  } finally {
    void removeScratch(rel);
  }
}

/**
 * The clean-up a transcript gets. A live take (someone speaking now) also gets
 * the phrase replacements and the filler removal — the latter overridable per
 * app; a file being transcribed gets spelling fixes only.
 */
function cleanupOptions(settings: DictationSettings, overrides: TranscribeOverrides): CleanupOptions {
  return {
    hallucinations: settings.cleanup,
    vocabulary: vocabularyTerms(settings),
    replacements: overrides.live ? replacementRules(settings.entries) : [],
    removeFillers: overrides.live ? (overrides.removeFillers ?? settings.removeFillers) : false,
    sentenceCase: true,
  };
}

// ---------------------------------------------------------------------------
// Finishing a take
//
// Whatever decoded the audio — whisper on the whole take, Parakeet on the whole
// take, Parakeet segment by segment — the words then go through the same
// door: voice commands, the per-app profile, the rolling context, the history.
// ---------------------------------------------------------------------------

/** What a live take came to, beyond the text. */
export interface DictateOutcome {
  text: string;
  /** "Send it" was said, or the profile asks for Enter: press it after typing. */
  send: boolean;
  /** "Undo" was said; there is nothing to undo with yet, the pill says so. */
  undo: boolean;
  /** Voice commands that fired. */
  commands: CommandId[];
  /** The profile that applied, if any. */
  profile: AppProfile | null;
  /** Why the profile's tone was not applied ("no model"), when it was not. */
  formattingSkipped: string | null;
  engine: Engine;
  /** Segments decoded while speaking; 0 for a whole-take decode. */
  segments: number;
}

const EMPTY_OUTCOME: Omit<DictateOutcome, "engine"> = {
  text: "",
  send: false,
  undo: false,
  commands: [],
  profile: null,
  formattingSkipped: null,
  segments: 0,
};

/** Waiting longer than this for a rewrite is worse than typing the words as said. */
const FORMAT_TIMEOUT_MS = 8000;

/**
 * Rewrites the take in the profile's tone through the shared language model
 * — only when one is set up. Without one the text comes back untouched with
 * a reason, never an error and never a wait: the model status is a local
 * lookup.
 */
async function formatForMode(
  text: string,
  mode: AppProfile["mode"],
): Promise<{ text: string; skipped: string | null }> {
  if (!mode || mode === "plain" || !text.trim()) return { text, skipped: null };
  let status;
  try {
    status = await llmStatus();
  } catch {
    return { text, skipped: "no model" };
  }
  if (!status.available) return { text, skipped: "no model" };
  try {
    const out = await llmComplete({
      system: MODE_INSTRUCTIONS[mode],
      prompt: text,
      purpose: "dictation formatting",
      temperature: 0.2,
      maxTokens: Math.min(2000, Math.max(200, text.length)),
      signal: AbortSignal.timeout(FORMAT_TIMEOUT_MS),
    });
    const cleaned = out.trim().replace(/^["“]|["”]$/g, "");
    return cleaned ? { text: cleaned, skipped: null } : { text, skipped: "model answered with nothing" };
  } catch (err) {
    const why = err instanceof Error && err.name === "TimeoutError" ? "model took too long" : "model error";
    logInfo("dictation", `formatting skipped: ${why}`);
    return { text, skipped: why };
  }
}

/**
 * Everything after the recognizer: voice commands, the per-app profile, the
 * rolling context and the history entry. Shared by the whole-take and the
 * streaming paths.
 */
async function finishTake(
  cleaned: string,
  settings: DictationSettings,
  overrides: TranscribeOverrides,
  engine: Engine,
  segments: string[] | null,
): Promise<DictateOutcome> {
  const profile = overrides.target ? matchProfile(settings.profiles, overrides.target) : null;
  let text = cleaned.trim();
  let send = false;
  let undo = false;
  let commands: CommandId[] = [];
  if (text && settings.voiceCommands) {
    const result = applyVoiceCommands(text, segments ? { segments } : {});
    text = result.text;
    send = result.send;
    undo = result.undo;
    commands = result.applied;
  }
  let formattingSkipped: string | null = null;
  if (text && profile?.mode && profile.mode !== "plain") {
    const formatted = await formatForMode(text, profile.mode);
    text = formatted.text;
    formattingSkipped = formatted.skipped;
  }
  if (profile?.autoSend) send = true;
  if (text) {
    pushDictationContext(text);
    if (settings.keepHistory) {
      pushHistory(text, overrides.durationMs, {
        ...(overrides.target ? { app: overrides.target.app } : {}),
        ...(formattingSkipped ? { note: `formatting skipped: ${formattingSkipped}` } : {}),
      });
    }
  }
  return {
    text,
    send: Boolean(text) && send,
    undo,
    commands,
    profile,
    formattingSkipped,
    engine,
    segments: segments?.length ?? 0,
  };
}

/**
 * The dictation path, in full: transcribe the whole take, clean it, apply the
 * voice commands and the profile, remember the result as context for the
 * next take. Use this anywhere the user is speaking *now* (pill, voice notes,
 * the test recorder) rather than transcribing an existing file.
 */
export async function dictateDetailed(
  blob: Blob,
  overrides: TranscribeOverrides = {},
): Promise<DictateOutcome> {
  const settings = getDictationSettings();
  const profile = overrides.target ? matchProfile(settings.profiles, overrides.target) : null;
  const live: TranscribeOverrides = {
    ...overrides,
    live: true,
    removeFillers: overrides.removeFillers ?? profile?.removeFillers,
  };
  const status = await dictationStatus();
  const engine = resolveActiveModel(live.model ?? settings.model, status)?.engine ?? "whisper";
  const text = (await transcribeBlob(blob, settings.lang, false, false, live)).trim();
  if (!text) return { ...EMPTY_OUTCOME, engine, profile };
  return finishTake(text, settings, live, engine, null);
}

/** `dictateDetailed` for callers that only want the words (voice notes, the test recorder). */
export async function dictate(blob: Blob, overrides: TranscribeOverrides = {}): Promise<string> {
  return (await dictateDetailed(blob, overrides)).text;
}

// ---------------------------------------------------------------------------
// Streaming
//
// Parakeet's resident recognizer answers a short utterance in a few hundred
// milliseconds, so there is no reason to hold the whole take until the stop:
// the segmenter closes an utterance on the pause after it and it is decoded
// while the next one is being spoken. At the stop only the tail is left.
// Whisper stays whole-take — its CLI loads the model per call.
// ---------------------------------------------------------------------------

/** Parakeet needs no padding to speak of; whisper's 1.2 s minimum does not apply. */
const SEGMENT_AUDIO = { padSeconds: 0.1, minSeconds: 0.5, trimSilence: false } as const;

/**
 * Whether the next take can be decoded while speaking: the setting is on, the
 * active model is Parakeet and the resident recognizer is installed (the
 * one-shot CLI would load the model once *per segment*).
 */
export function streamingAvailable(status: EngineStatus | null, settings = getDictationSettings()): boolean {
  if (!settings.streaming || !status?.parakeet.server) return false;
  return resolveActiveModel(settings.model, status)?.engine === "parakeet";
}

export interface DictationStream {
  session: StreamingSession;
  model: string;
}

/**
 * Opens a streaming take for the pill: feed it microphone PCM at
 * `sampleRate`, read `session.partial()` for the live text, then hand it to
 * `dictateStreamed`. Resolves null when the take has to be decoded whole
 * (whisper, an old engine, the setting off) — the caller records as before.
 */
export async function createDictationStream(
  sampleRate: number,
  onPartial?: (state: PartialState) => void,
  status?: EngineStatus | null,
): Promise<DictationStream | null> {
  if (!isTauri()) return null;
  const settings = getDictationSettings();
  const known = status === undefined ? await dictationStatus() : status;
  if (!streamingAvailable(known, settings)) return null;
  const active = resolveActiveModel(settings.model, known);
  if (!active || active.engine !== "parakeet") return null;
  const model = active.id;
  const session = createStreamingSession({
    sampleRate,
    onPartial,
    transcribe: async (pcm, rate) => {
      const at16k = rate === WHISPER_SAMPLE_RATE ? pcm : resampleLinear(pcm, rate, WHISPER_SAMPLE_RATE);
      const wav = encodeWav(conditionPcm(at16k, WHISPER_SAMPLE_RATE, SEGMENT_AUDIO), WHISPER_SAMPLE_RATE);
      const { text, call } = await runParakeet(wav, model);
      logInfo("dictation", `segment: ${call.audioMs} ms of speech in ${call.ms} ms`);
      return { text, ms: call.ms };
    },
  });
  return { session, model };
}

/**
 * Ends a streaming take: decodes the tail, joins the segments in order and
 * finishes the take like any other. Rejects with `StreamingFailed` when a
 * segment could not be decoded — the caller then falls back to
 * `dictateDetailed` on `session.audio()`, which the session kept for exactly
 * that.
 */
export async function dictateStreamed(
  stream: DictationStream,
  overrides: TranscribeOverrides = {},
): Promise<DictateOutcome> {
  const settings = getDictationSettings();
  const profile = overrides.target ? matchProfile(settings.profiles, overrides.target) : null;
  const live: TranscribeOverrides = {
    ...overrides,
    live: true,
    removeFillers: overrides.removeFillers ?? profile?.removeFillers,
  };
  const result: StreamingResult = await stream.session.finish();
  lastTiming = {
    ms: result.tailMs,
    warm: true,
    audioMs: Math.round(result.audioMs),
    streamed: true,
    decodeMs: result.decodeMs,
    tailAudioMs: result.tailAudioMs,
    segments: result.segments.length,
  };
  logInfo(
    "dictation",
    `streamed: ${result.segments.length} segments, ${Math.round(result.audioMs)} ms of audio, ` +
      `${result.decodeMs} ms decoding, tail ${result.tailMs} ms (queue ${result.maxQueue})`,
  );
  const options = cleanupOptions(settings, live);
  const cleaned = cleanTranscript(result.raw, options).trim();
  if (!cleaned) return { ...EMPTY_OUTCOME, engine: "parakeet", profile, segments: result.segments.length };
  // The commands see the segments so "scratch that" can drop an utterance;
  // each is cleaned the same way so their text matches the joined one.
  const segments = result.segments.map((s) => cleanTranscript(s, options).trim()).filter(Boolean);
  return finishTake(cleaned, settings, live, "parakeet", segments);
}

/** A WAV of everything a streaming session heard, for the whole-take fallback. */
export function sessionAudioBlob(session: StreamingSession): Blob {
  const pcm = session.audio();
  const at16k =
    session.sampleRate === WHISPER_SAMPLE_RATE ? pcm : resampleLinear(pcm, session.sampleRate, WHISPER_SAMPLE_RATE);
  return new Blob([encodeWav(at16k, WHISPER_SAMPLE_RATE)], { type: "audio/wav" });
}

export { StreamingFailed };
export type { PartialState, StreamingSession };

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
