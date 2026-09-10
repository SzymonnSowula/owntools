/**
 * The model catalogue: every speech model dictation can run, from two engines.
 *
 *   - **whisper** — OpenAI's Whisper through whisper.cpp. ~100 languages,
 *     translation to English, word timestamps for subtitles, an initial prompt
 *     the vocabulary is fed into. One `ggml-*.bin` file per model.
 *   - **parakeet** — NVIDIA's Parakeet TDT through sherpa-onnx. 25 European
 *     languages with automatic detection, no hallucinated text on silence, and
 *     a decoder several times faster than whisper's on a CPU. A model is a
 *     folder of four files (encoder / decoder / joiner + tokens).
 *
 * Everything we download is pinned to an exact byte count and SHA-256, and
 * the Rust downloader refuses to install a file that does not match. The
 * engines get executed and the models get loaded, so a corrupt or swapped
 * download must never end up in AppData under a good name.
 */

import { platformOs } from "@core/env";

export type Engine = "whisper" | "parakeet";
export type Vendor = "openai" | "nvidia";

/** "148 MB", "1.6 GB" — decimal units, the way the download pages quote them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}

export interface PinnedFile {
  /** File name inside the model folder (parakeet) or the whisper folder. */
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface EngineRuntime {
  engine: Engine;
  /** "whisper.cpp b4938", shown in the model manager. */
  label: string;
  url: string;
  bytes: number;
  sha256: string;
  /** Where the archive lands (relative to AppData) before it is unpacked. */
  archive: string;
}

export interface DictationModel {
  /**
   * Stable id, also what `settings.model` stores. Whisper models keep their
   * file name as the id, so settings written before the catalogue still point
   * at the same model.
   */
  id: string;
  engine: Engine;
  vendor: Vendor;
  /** "Whisper", "Parakeet TDT". */
  family: string;
  label: string;
  note: string;
  languages: string;
  /** Total download, all files. */
  bytes: number;
  /** `bytes` for the picker. */
  size: string;
  files: PinnedFile[];
  tags: ModelTag[];
}

export type ModelTag = "recommended" | "fastest" | "best quality" | "files & subtitles";

/**
 * The engines are downloaded, not bundled, so every platform needs its own
 * archive — and the two platforms are not in the same place:
 *
 *   **sherpa-onnx** publishes a Windows x64 build and a macOS universal2
 *     build of the same release, so Parakeet works on both from day one.
 *   **whisper.cpp** publishes Windows and Linux binaries only — checked
 *     across v1.8.5–v1.9.3 and the pinned b4938, whose one Apple
 *     artifact is an `xcframework` (a library, not the CLI). The
 *     macOS build therefore comes from our own
 *     `.github/workflows/whisper-macos.yml`, which compiles the pinned tag
 *     on a macOS runner and prints the three constants to paste in below.
 *     Until that has been run once, `url` is empty and the app says so
 *     rather than downloading a Windows .exe onto a Mac.
 */
export type RuntimePlatform = "windows" | "macos";

function runtimePlatform(): RuntimePlatform | null {
  const os = platformOs();
  return os === "macos" ? "macos" : os === "windows" ? "windows" : null;
}

/** Pinned whisper.cpp builds, per platform (release b4938). */
export const WHISPER_RUNTIMES: Record<RuntimePlatform, EngineRuntime> = {
  windows: {
    engine: "whisper",
    label: "whisper.cpp b4938",
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip",
    bytes: 8361840,
    sha256: "c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d",
    archive: "whisper/whisper-bin-x64.zip",
  },
  macos: {
    engine: "whisper",
    label: "whisper.cpp b4938 (universal)",
    // Filled in by .github/workflows/whisper-macos.yml — see docs/macos.md.
    url: "",
    bytes: 0,
    sha256: "",
    archive: "whisper/whisper-bin-macos-universal.zip",
  },
};

/**
 * Pinned sherpa-onnx builds (release v1.13.7, shared libraries, no TTS).
 * Only the two recognizers and the libraries they load are unpacked out of
 * them (see `parakeet.rs`): the one-shot `sherpa-onnx-offline` and the
 * resident `sherpa-onnx-offline-websocket-server` that keeps the model in
 * memory between takes.
 */
export const PARAKEET_RUNTIMES: Record<RuntimePlatform, EngineRuntime> = {
  windows: {
    engine: "parakeet",
    label: "sherpa-onnx v1.13.7",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts.tar.bz2",
    bytes: 22932067,
    sha256: "38a0a32c0f55752b887209a099b1c477bf350d5d9d254602a842d0610a8da831",
    archive: "parakeet/runtime.tar.bz2",
  },
  macos: {
    engine: "parakeet",
    label: "sherpa-onnx v1.13.7 (universal)",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-v1.13.7-osx-universal2-shared-no-tts.tar.bz2",
    bytes: 39057685,
    sha256: "3e5fee727ec477d931b7707a23f4c40f60d765ea9514c1cef82e1a12a8803b43",
    archive: "parakeet/runtime.tar.bz2",
  },
};

/** The archive for this platform, or `null` where there is not one yet. */
export function runtimeFor(engine: Engine): EngineRuntime | null {
  const os = runtimePlatform();
  if (!os) return null;
  const runtime = engine === "whisper" ? WHISPER_RUNTIMES[os] : PARAKEET_RUNTIMES[os];
  return runtime.url ? runtime : null;
}

/** False when this engine has no build for the platform the app is on. */
export function engineAvailable(engine: Engine): boolean {
  return runtimeFor(engine) !== null;
}

/**
 * A model can only be installed when its engine can be. Everything that
 * lists models filters on this, so a Mac never offers a download it cannot
 * run afterwards.
 */
export function modelAvailable(model: DictationModel): boolean {
  return engineAvailable(model.engine);
}

/**
 * The runtime for this platform, with the Windows one as the fallback so
 * that code reading `.bytes` for a progress bar in a browser preview still
 * has a number to show.
 */
export const WHISPER_RUNTIME: EngineRuntime =
  WHISPER_RUNTIMES[runtimePlatform() ?? "windows"];
export const PARAKEET_RUNTIME: EngineRuntime =
  PARAKEET_RUNTIMES[runtimePlatform() ?? "windows"];

export const RUNTIMES: Record<Engine, EngineRuntime> = {
  whisper: WHISPER_RUNTIME,
  parakeet: PARAKEET_RUNTIME,
};

/**
 * Whisper models come from one pinned revision of ggerganov/whisper.cpp —
 * never `main`, because the checksums below belong to these exact files.
 */
export const MODEL_BASE_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/";

/** Parakeet v3 int8, sherpa-onnx export, pinned to one revision the same way. */
const PARAKEET_V3_BASE_URL =
  "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78/";

function whisperModel(model: {
  id: string;
  label: string;
  bytes: number;
  sha256: string;
  note: string;
  tags?: ModelTag[];
}): DictationModel {
  return {
    id: model.id,
    engine: "whisper",
    vendor: "openai",
    family: "Whisper",
    label: model.label,
    note: model.note,
    languages: "~100 languages · translates to English · timestamps for subtitles",
    bytes: model.bytes,
    size: formatBytes(model.bytes),
    files: [{ name: model.id, url: `${MODEL_BASE_URL}${model.id}`, bytes: model.bytes, sha256: model.sha256 }],
    tags: model.tags ?? [],
  };
}

const PARAKEET_V3_FILES: PinnedFile[] = [
  {
    name: "encoder.int8.onnx",
    url: `${PARAKEET_V3_BASE_URL}encoder.int8.onnx`,
    bytes: 652184281,
    sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
  },
  {
    name: "decoder.int8.onnx",
    url: `${PARAKEET_V3_BASE_URL}decoder.int8.onnx`,
    bytes: 11845275,
    sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
  },
  {
    name: "joiner.int8.onnx",
    url: `${PARAKEET_V3_BASE_URL}joiner.int8.onnx`,
    bytes: 6355277,
    sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
  },
  {
    name: "tokens.txt",
    url: `${PARAKEET_V3_BASE_URL}tokens.txt`,
    bytes: 93939,
    sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
  },
];

export const PARAKEET_V3_ID = "parakeet-tdt-0.6b-v3-int8";

/**
 * The catalogue, in the order the model manager shows it. `large-v3-turbo`
 * is the whisper that actually understands inflected languages, accents and
 * jargon; base is only there because it is small enough to try dictation on
 * a slow machine.
 */
export const MODELS: DictationModel[] = [
  {
    id: PARAKEET_V3_ID,
    engine: "parakeet",
    vendor: "nvidia",
    family: "Parakeet TDT",
    label: "Parakeet TDT 0.6B v3",
    note: "Top of the open ASR leaderboard, several times faster than whisper on a CPU, never invents words out of silence. Dictation only — subtitles and translation still use Whisper.",
    languages: "25 European languages incl. Polish, detected automatically",
    bytes: PARAKEET_V3_FILES.reduce((n, f) => n + f.bytes, 0),
    size: formatBytes(PARAKEET_V3_FILES.reduce((n, f) => n + f.bytes, 0)),
    files: PARAKEET_V3_FILES,
    tags: ["recommended", "fastest"],
  },
  whisperModel({
    id: "ggml-large-v3-turbo-q5_0.bin",
    label: "Whisper large v3 turbo (compressed)",
    bytes: 574041195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    note: "Large-model accuracy, quantised so it stays fast on CPU. The model behind transcribe, subtitles and translation.",
    tags: ["files & subtitles"],
  }),
  whisperModel({
    id: "ggml-large-v3-turbo.bin",
    label: "Whisper large v3 turbo",
    bytes: 1624555275,
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    note: "The uncompressed turbo. Wants a fast machine and plenty of RAM.",
    tags: ["best quality"],
  }),
  whisperModel({
    id: "ggml-small.bin",
    label: "Whisper small",
    bytes: 487601967,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    note: "Noticeably better on non-English speech than base, still light.",
  }),
  whisperModel({
    id: "ggml-base.bin",
    label: "Whisper base",
    bytes: 147951465,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    note: "Fastest whisper, weakest. English-only dictation at a push.",
  }),
];

/** Whisper file name the onboarding installs and the transcribe tools fall back to. */
export const DEFAULT_MODEL_FILE = "ggml-large-v3-turbo-q5_0.bin";

/**
 * What onboarding and the "install engine" buttons install when nobody
 * has chosen anything.
 *
 * Whisper where whisper runs, because it is the model the transcribe,
 * subtitle and translate tools also need — one download covers all of
 * it. On a platform whisper has no build for, the best model that *does*
 * run there: on macOS that is Parakeet, which is the faster dictation
 * engine anyway and the only reason the rest of the tools are honest
 * about being unavailable rather than broken.
 */
export function defaultInstallModel(): DictationModel {
  const whisper = MODELS.find((m) => m.id === DEFAULT_MODEL_FILE);
  if (whisper && modelAvailable(whisper)) return whisper;
  return MODELS.find(modelAvailable) ?? MODELS[0];
}

export function modelById(id: string): DictationModel | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Whisper models only, catalogue order — for the pieces that need whisper. */
export const WHISPER_MODELS: DictationModel[] = MODELS.filter((m) => m.engine === "whisper");

/** What the backend reports about what is on disk. */
export interface EngineStatus {
  /** whisper.cpp unpacked. */
  engine: boolean;
  /** At least one whisper model. */
  model: boolean;
  dir: string;
  /** Installed whisper model files, best first. */
  models: string[];
  parakeet: {
    runtime: boolean;
    /**
     * The resident recognizer is installed too. An engine unpacked before
     * it existed has `runtime` without `server`, and every take pays the
     * ~4.5 s model load again; the Models page offers the update.
     */
    server: boolean;
    /** The model is loaded right now, so the next take is decode-only. */
    resident: boolean;
    dir: string;
    /** Ids of the complete Parakeet model folders. */
    models: string[];
  };
}

export const EMPTY_STATUS: EngineStatus = {
  engine: false,
  model: false,
  dir: "",
  models: [],
  parakeet: { runtime: false, server: false, resident: false, dir: "", models: [] },
};

export function runtimeInstalled(status: EngineStatus | null, engine: Engine): boolean {
  if (!status) return false;
  return engine === "whisper" ? status.engine : status.parakeet.runtime;
}

export function modelInstalled(status: EngineStatus | null, model: DictationModel): boolean {
  if (!status) return false;
  return model.engine === "whisper"
    ? status.models.includes(model.id)
    : status.parakeet.models.includes(model.id);
}

/** Installed and runnable: files on disk plus the engine that runs them. */
export function modelReady(status: EngineStatus | null, model: DictationModel): boolean {
  return modelInstalled(status, model) && runtimeInstalled(status, model.engine);
}

/**
 * The model dictation will use: the chosen one when it is runnable, else a
 * runnable Parakeet (the faster dictation engine), else the best runnable
 * whisper (the backend ranks those), else nothing. Whisper files the
 * catalogue does not know still count — a user may have dropped one into the
 * folder.
 */
export function resolveActiveModel(
  chosen: string,
  status: EngineStatus | null,
): { id: string; engine: Engine; model?: DictationModel } | null {
  if (!status) return null;
  const pick = modelById(chosen);
  if (pick && modelReady(status, pick)) return { id: pick.id, engine: pick.engine, model: pick };
  if (chosen && status.engine && status.models.includes(chosen)) {
    return { id: chosen, engine: "whisper", model: pick };
  }
  if (status.parakeet.runtime && status.parakeet.models.length) {
    return { id: status.parakeet.models[0], engine: "parakeet", model: modelById(status.parakeet.models[0]) };
  }
  if (status.engine && status.models.length) {
    return { id: status.models[0], engine: "whisper", model: modelById(status.models[0]) };
  }
  return null;
}

/** Anything runnable at all. */
export function dictationReady(status: EngineStatus | null): boolean {
  return resolveActiveModel("", status) !== null;
}
