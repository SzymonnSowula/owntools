import { isTauri } from "@core/env";
import { blobToWhisperWav } from "@core/audio";

/** Pinned whisper.cpp Windows build + multilingual base model. */
const ENGINE_URL =
  "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip";
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODEL_FILE = "whisper/ggml-base.bin";

export interface DictationStatus {
  engine: boolean;
  model: boolean;
  dir: string;
}

export type DictationLang = "auto" | "en" | "pl";

const LANG_KEY = "suite-dictation-lang";

export function getDictationLang(): DictationLang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "pl" || v === "auto") return v;
  } catch {
    /* */
  }
  return "auto";
}

export function setDictationLang(lang: DictationLang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* */
  }
}

export async function dictationStatus(): Promise<DictationStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DictationStatus>("dictation_status");
}

async function download(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  const res = await tauriFetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress(buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export interface InstallProgress {
  step: "engine" | "model";
  loaded: number;
  total: number;
}

/** Downloads the whisper.cpp binaries (zip) and the model into AppData/whisper. */
export async function installDictation(
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  const { mkdir, writeFile, exists, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  if (!(await exists("whisper", { baseDir: BaseDirectory.AppData }))) {
    await mkdir("whisper", { baseDir: BaseDirectory.AppData, recursive: true });
  }

  const status = await dictationStatus();

  if (!status?.engine) {
    const zip = await download(ENGINE_URL, (loaded, total) =>
      onProgress({ step: "engine", loaded, total }),
    );
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
      await writeFile(`whisper/${base}`, data, { baseDir: BaseDirectory.AppData });
    }
  }

  if (!status?.model) {
    const model = await download(MODEL_URL, (loaded, total) =>
      onProgress({ step: "model", loaded, total }),
    );
    await writeFile(MODEL_FILE, model, { baseDir: BaseDirectory.AppData });
  }
}

/** Transcribes an audio blob. Returns plain text (json=false) or whisper JSON. */
export async function transcribeBlob(
  blob: Blob,
  lang: DictationLang,
  json = false,
): Promise<string> {
  if (!isTauri()) throw new Error("Transcription needs the desktop app.");
  const wav = await blobToWhisperWav(blob);
  const { writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const rel = `whisper/input-${Date.now()}.wav`;
  await writeFile(rel, wav, { baseDir: BaseDirectory.AppData });

  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const absolute = await join(await appDataDir(), rel);

  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<string>("whisper_transcribe", {
      wav: absolute,
      lang: lang === "auto" ? "auto" : lang,
      json,
    });
  } finally {
    const { remove } = await import("@tauri-apps/plugin-fs");
    void remove(rel, { baseDir: BaseDirectory.AppData }).catch(() => undefined);
  }
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
      text: (seg.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 0 && s.end > s.start);
}

export async function typeText(text: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("type_text", { text });
}
