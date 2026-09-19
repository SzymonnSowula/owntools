/**
 * The webview's side of the on-device image engine: what is installed, the
 * downloads, and one generation. Rust (`src-tauri/src/imagegen.rs`) owns the
 * process; this file only names files and numbers — it never builds a command
 * line.
 */
import { isTauri } from "@core/env";
import { logError } from "@core/errors";
import { dimensions } from "../http";
import { ProviderError, type GeneratedImage, type ImageRequest } from "../types";
import { deviceModel, runtimeFor, type DeviceFile, type DeviceModel, type EngineBuild, type EnginePreference } from "./models";

/** Mirrors `ImagegenStatus` in `imagegen.rs`. */
export interface EngineStatus {
  runtime: boolean;
  build: EngineBuild | null;
  vulkan: boolean;
  busy: string | null;
  dir: string;
  arch: string;
}

/** Mirrors `Progress` in `imagegen.rs`. */
interface EngineProgress {
  id: string;
  phase: "loading" | "sampling" | "decoding";
  step: number;
  steps: number;
  image: number;
  images: number;
  secondsPerStep: number;
}

/** Mirrors `GenerateResult` in `imagegen.rs`. */
interface EngineResult {
  files: string[];
  seed: number;
  ms: number;
}

const PROGRESS_EVENT = "imagegen-progress";
/** The rejection string `imagegen_generate` uses after `imagegen_cancel`. */
const CANCELLED = "cancelled";

export async function engineStatus(): Promise<EngineStatus | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<EngineStatus>("imagegen_status");
  } catch (err) {
    logError("images", "engine status", err);
    return null;
  }
}

/** `[name, description]` per device the engine sees — which graphics card it would use. */
export async function engineDevices(): Promise<[string, string][]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<[string, string][]>("imagegen_devices");
  } catch {
    return [];
  }
}

/** The files of `model` that are in place, by destination — size-checked, since a copied-in file is not a verified one. */
export async function presentFiles(model: DeviceModel): Promise<Set<string>> {
  const present = new Set<string>();
  if (!isTauri()) return present;
  const { exists, stat, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await Promise.all(
    model.files.map(async (file) => {
      try {
        if (!(await exists(file.dest, { baseDir: BaseDirectory.AppData }))) return;
        const info = await stat(file.dest, { baseDir: BaseDirectory.AppData });
        if (info.size === file.bytes) present.add(file.dest);
      } catch {
        /* not there */
      }
    }),
  );
  return present;
}

export function modelComplete(model: DeviceModel, present: ReadonlySet<string>): boolean {
  return model.files.every((f) => present.has(f.dest));
}

/** Does the engine in place match what the person asked for? A switch from GPU to processor means another archive. */
export function runtimeMatches(status: EngineStatus | null, preference: EnginePreference): boolean {
  if (!status?.runtime) return false;
  const wanted = runtimeFor(preference, status);
  return wanted !== null && wanted.build === status.build;
}

/* ------------------------------------------------------------------------- */
/* Generating                                                                */
/* ------------------------------------------------------------------------- */

function filesFor(model: DeviceModel): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of model.files) out[file.role] = file.dest;
  return out;
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // stable-diffusion.cpp reads a signed 64-bit seed; 31 bits keeps it a plain positive number everywhere.
  return buf[0] & 0x7fffffff;
}

/** The request Rust receives, as a pure function of the model and the person's choices. */
export function engineRequest(model: DeviceModel, request: Pick<ImageRequest, "prompt" | "negativePrompt" | "aspect" | "count" | "quality" | "seed">, id: string, cpuOnly: boolean) {
  const { width, height } = dimensions(request.aspect, model.megapixels * (request.quality === "high" && model.megapixels >= 1 ? 1.5 : 1), model.multiple, 2048);
  return {
    id,
    files: filesFor(model),
    prompt: request.prompt,
    negative: model.negativePrompt ? (request.negativePrompt?.trim() ?? "") || null : null,
    width,
    height,
    steps: model.steps[request.quality],
    cfgScale: model.cfgScale,
    sampler: model.sampler ?? null,
    seed: request.seed ?? randomSeed(),
    count: request.count,
    flashAttention: model.flashAttention,
    offloadToCpu: model.offloadToCpu && !cpuOnly,
    clipOnCpu: false,
    // Decoding a megapixel at once is where a 4 GB card runs out; tiles cost a second and always fit.
    vaeTiling: model.megapixels >= 1,
    cpuOnly,
  };
}

async function readOutput(rel: string): Promise<Blob> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  try {
    const res = await fetch(convertFileSrc(await join(await appDataDir(), rel)));
    if (res.ok) return new Blob([await res.arrayBuffer()], { type: "image/png" });
  } catch {
    /* read it over IPC instead */
  }
  const { readFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(rel, { baseDir: BaseDirectory.AppData });
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

export async function generateOnDevice(request: ImageRequest, modelId: string, options: { cpuOnly: boolean }): Promise<GeneratedImage[]> {
  if (!isTauri()) throw new ProviderError("On-device models run in the desktop app.", "input");
  const model = deviceModel(modelId);
  if (!model) throw new ProviderError(`Unknown on-device model: ${modelId}`, "input");
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const payload = engineRequest(model, request, id, options.cpuOnly);

  const unlisten = await listen<EngineProgress>(PROGRESS_EVENT, (event) => {
    const p = event.payload;
    if (p.id !== id) return;
    if (p.phase === "loading") return request.onProgress?.({ note: "Loading the model", fraction: null });
    const perImage = 1 / Math.max(1, p.images);
    const fraction = Math.min(1, (p.image - 1) * perImage + (p.step / Math.max(1, p.steps)) * perImage);
    const left = p.secondsPerStep > 0 ? Math.round((p.steps - p.step + (p.images - p.image) * p.steps) * p.secondsPerStep) : 0;
    request.onProgress?.({
      note:
        p.phase === "decoding"
          ? "Turning it into pixels"
          : `Step ${p.step} of ${p.steps}${p.images > 1 ? ` · picture ${p.image} of ${p.images}` : ""}${left > 3 ? ` · about ${left < 90 ? `${left} s` : `${Math.round(left / 60)} min`} left` : ""}`,
      fraction,
    });
  });
  const onAbort = () => void invoke("imagegen_cancel", { id }).catch(() => undefined);
  request.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (request.signal?.aborted) throw new DOMException("The generation was cancelled.", "AbortError");
    const result = await invoke<EngineResult>("imagegen_generate", { request: payload });
    return await Promise.all(result.files.map(async (rel, i) => ({ blob: await readOutput(rel), seed: result.seed + i })));
  } catch (err) {
    if (err === CANCELLED || request.signal?.aborted) throw new DOMException("The generation was cancelled.", "AbortError");
    throw new ProviderError(typeof err === "string" ? err : err instanceof Error ? err.message : "The image engine failed.");
  } finally {
    request.signal?.removeEventListener("abort", onAbort);
    unlisten();
  }
}

/** For the installer: a file as the Rust downloader wants it. */
export function downloadRequest(file: DeviceFile, id: string) {
  return { id, url: file.url, dest: file.dest, sha256: file.sha256, expectedSize: file.bytes, purpose: "image model download" };
}
