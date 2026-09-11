/**
 * The language-model catalogue: what "install a model" in Settings →
 * Intelligence can fetch, and the llama.cpp build that runs it.
 *
 * Two Qwen3 builds, both from Alibaba's own GGUF repositories on Hugging
 * Face and both pinned to one **revision** (a commit hash, never `main`), so
 * the checksums below belong to these exact files for as long as the repo
 * exists. The checksums come from the LFS pointers
 * (`https://huggingface.co/<repo>/raw/<rev>/<file>` → `oid sha256:…` +
 * `size`), which is how they were verified without a second multi-GB
 * download; the light model was downloaded here and hashed once to prove
 * the pointer tells the truth.
 *
 * The runtime is a pinned llama.cpp release. GitHub publishes no checksums
 * for those, so each archive was downloaded and hashed on 2026-09-11.
 * `b10809` is the build the versioned release `v0.4.0` points at (its
 * `nightly-tag.txt`), i.e. the closest thing llama.cpp has to a stable tag.
 */

import { platformOs } from "@core/env";

export type LlmVendor = "qwen";
export type LlmModelTag = "recommended" | "light";

/** "148 MB", "2.5 GB" — decimal units, the way the download pages quote them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}

export interface LlmModel {
  /**
   * Stable id: the model folder under `<AppData>/llm/models/` and what
   * `LlmSettings.local.model` stores. Lowercase, no spaces.
   */
  id: string;
  label: string;
  vendor: LlmVendor;
  /** "4B", "1.7B". */
  params: string;
  /** GGUF quantisation, e.g. "Q4_K_M". */
  quant: string;
  /** File name inside the model folder. */
  file: string;
  /** Revision-pinned download URL. */
  url: string;
  bytes: number;
  sha256: string;
  /** `bytes` for the picker. */
  size: string;
  /** Native context length of the model (we run the server at 8192). */
  contextLength: number;
  /** One line: what it is good at. */
  goodFor: string;
  /** One line: what it needs from the machine. */
  ram: string;
  tags: LlmModelTag[];
}

export const VENDOR_NAMES: Record<LlmVendor, string> = {
  qwen: "Alibaba Qwen",
};

const QWEN3_4B_BASE = "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/";
const QWEN3_1_7B_BASE = "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/";

function model(m: Omit<LlmModel, "size">): LlmModel {
  return { ...m, size: formatBytes(m.bytes) };
}

/**
 * Catalogue order = picker order. The 4B is the one to recommend: it
 * follows instructions well enough for summaries, rewrites and JSON, and
 * Q4_K_M keeps it at 2.5 GB. The 1.7B is for a laptop with 8 GB of RAM or
 * a person who wants the answer faster than they want it polished.
 */
export const LLM_MODELS: LlmModel[] = [
  model({
    id: "qwen3-4b-q4_k_m",
    label: "Qwen3 4B",
    vendor: "qwen",
    params: "4B",
    quant: "Q4_K_M",
    file: "Qwen3-4B-Q4_K_M.gguf",
    url: `${QWEN3_4B_BASE}Qwen3-4B-Q4_K_M.gguf`,
    bytes: 2497280256,
    sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
    contextLength: 32768,
    goodFor: "Summaries, rewrites, chapters and tidy JSON in 100+ languages — the sensible default.",
    ram: "Needs ~4 GB of free RAM while it runs.",
    tags: ["recommended"],
  }),
  model({
    id: "qwen3-1.7b-q8_0",
    label: "Qwen3 1.7B",
    vendor: "qwen",
    params: "1.7B",
    quant: "Q8_0",
    file: "Qwen3-1.7B-Q8_0.gguf",
    url: `${QWEN3_1_7B_BASE}Qwen3-1.7B-Q8_0.gguf`,
    bytes: 1834426016,
    sha256: "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a",
    contextLength: 32768,
    goodFor: "Quick drafts and short rewrites on a modest laptop; simpler answers, faster.",
    ram: "Needs ~3 GB of free RAM while it runs.",
    tags: ["light"],
  }),
];

/** What "Install" installs when nobody has picked anything. */
export const DEFAULT_LLM_MODEL_ID = LLM_MODELS[0].id;

export function modelById(id: string): LlmModel | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

/* ------------------------------------------------------------------------- */
/* Runtime                                                                   */
/* ------------------------------------------------------------------------- */

export type RuntimePlatform = "windows" | "macos";

export interface LlmRuntime {
  /** "llama.cpp b10809", shown in the card. */
  label: string;
  url: string;
  bytes: number;
  sha256: string;
  /** Where the archive lands (relative to AppData) before Rust unpacks it. */
  archive: string;
  /** Archive format; the Rust side picks the unpacker from it. */
  kind: "zip" | "tar.gz";
}

export const LLAMA_CPP_TAG = "b10809";

/**
 * Pinned llama.cpp builds. CPU-only on purpose: the CUDA / Vulkan builds
 * are 150–390 MB, need drivers we cannot check for, and a 4B model at Q4
 * already answers in seconds on a laptop CPU. The macOS build is the
 * Apple Silicon one (Metal is inside it); an Intel Mac is not covered yet.
 */
export const LLM_RUNTIMES: Record<RuntimePlatform, LlmRuntime> = {
  windows: {
    label: `llama.cpp ${LLAMA_CPP_TAG}`,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-win-cpu-x64.zip`,
    bytes: 18407457,
    sha256: "9df3158ed228a641a4b127942d7f459f24c9e13f04682659d05c00c80099b6b5",
    archive: "llm/runtime.zip",
    kind: "zip",
  },
  macos: {
    label: `llama.cpp ${LLAMA_CPP_TAG} (Apple Silicon)`,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-macos-arm64.tar.gz`,
    bytes: 11123196,
    sha256: "7d692df9e1e386e62f1c12b843903218041e6cd74c9415aa39a7ed3176f9eaa2",
    archive: "llm/runtime.tar.gz",
    kind: "tar.gz",
  },
};

function runtimePlatform(): RuntimePlatform | null {
  const os = platformOs();
  return os === "macos" ? "macos" : os === "windows" ? "windows" : null;
}

/**
 * The archive for this platform, or `null` where there is none. `arch` is
 * what the Rust side reports (`std::env::consts::ARCH`); the macOS build is
 * arm64-only, so an Intel Mac is told that instead of being handed a binary
 * that will not start. Unknown (browser preview) counts as fine.
 */
export function runtimeFor(arch?: string | null): LlmRuntime | null {
  const os = runtimePlatform();
  if (!os) return null;
  if (os === "macos" && arch && arch !== "aarch64") return null;
  return LLM_RUNTIMES[os];
}

/**
 * The runtime for this platform, with the Windows one as the fallback so
 * code reading `.bytes` for a progress bar in a browser preview still has a
 * number to show.
 */
export const LLM_RUNTIME: LlmRuntime = LLM_RUNTIMES[runtimePlatform() ?? "windows"];

/* ------------------------------------------------------------------------- */
/* What the backend reports                                                  */
/* ------------------------------------------------------------------------- */

/** Mirrors `LlmBackendStatus` in `src-tauri/src/llm.rs`. */
export interface LlmBackendStatus {
  runtime: boolean;
  models: { id: string; installed: boolean; bytes: number }[];
  server: "off" | "loading" | "ready";
  serverModel: string | null;
  dir: string;
  arch: string;
}

export function modelInstalled(status: LlmBackendStatus | null, id: string): boolean {
  return Boolean(status?.models.some((m) => m.id === id && m.installed));
}

/** Installed and runnable: the file is there and so is the program that loads it. */
export function modelReady(status: LlmBackendStatus | null, id: string): boolean {
  return Boolean(status?.runtime) && modelInstalled(status, id);
}
