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

/** Pinned whisper.cpp Windows build (release b4938). */
export const WHISPER_RUNTIME: EngineRuntime = {
  engine: "whisper",
  label: "whisper.cpp b4938",
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip",
  bytes: 8361840,
  sha256: "c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d",
  archive: "whisper/whisper-bin-x64.zip",
};

/**
 * Pinned sherpa-onnx Windows build (release v1.13.7, x64, shared libs,
 * static CRT, no TTS). Only `sherpa-onnx-offline.exe` and the DLLs it loads
 * are kept out of it (see `parakeet.rs`).
 */
export const PARAKEET_RUNTIME: EngineRuntime = {
  engine: "parakeet",
  label: "sherpa-onnx v1.13.7",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts.tar.bz2",
  bytes: 22932067,
  sha256: "38a0a32c0f55752b887209a099b1c477bf350d5d9d254602a842d0610a8da831",
  archive: "parakeet/runtime.tar.bz2",
};

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
  parakeet: { runtime: false, dir: "", models: [] },
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
