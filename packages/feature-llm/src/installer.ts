/**
 * The Tauri-touching half of installing a model: downloads through the Rust
 * downloader (`download_file` — streamed to `<file>.part`, resumed with a
 * Range request, checked against the pinned SHA-256 and only then renamed
 * into place), then `llm_install_runtime` unpacks the llama.cpp archive. A
 * 2.5 GB model never sits in the webview's memory, and a half-downloaded one
 * is never visible as installed.
 *
 * `install.ts` wraps this in the one shared session the UI reads.
 */

import { isTauri } from "@core/env";
import { llmBackendStatus, llmSettings, notifyLlmChange, setLlmSettings } from "@core/llm";
import { DEFAULT_LLM_MODEL_ID, modelById, runtimeFor, type LlmModel } from "./models";

export interface InstallProgress {
  step: "runtime" | "model";
  loaded: number;
  total: number;
}

/**
 * `installLlm` rejects with this when the download was paused through
 * `cancelInstall()`. Nothing is lost: the partial file stays on disk and the
 * next `installLlm` call for the same model resumes where it stopped.
 */
export class InstallCancelled extends Error {
  constructor() {
    super("Download paused.");
    this.name = "InstallCancelled";
  }
}

export function isInstallCancelled(err: unknown): err is InstallCancelled {
  return err instanceof InstallCancelled || (err instanceof Error && err.name === "InstallCancelled");
}

/** Mirrors `DownloadRequest` in `src-tauri/src/downloader.rs`. */
interface DownloadRequest {
  id: string;
  url: string;
  /** Destination relative to the app data folder. */
  dest: string;
  sha256?: string;
  expectedSize?: number;
  /** What the download is for, as the Privacy card shows it. */
  purpose?: string;
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
/** Set by `cancelInstall`; `installLlm` checks it between steps. */
let cancelRequested = false;

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
 * (the `.part` file stays on disk for resume) and the pending `installLlm`
 * rejects with `InstallCancelled`. Safe to call when nothing is running.
 */
export async function cancelInstall(): Promise<void> {
  if (!isTauri()) return;
  cancelRequested = true;
  const ids = [...inflight];
  if (!ids.length) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await Promise.all(ids.map((id) => invoke("download_cancel", { id }).catch(() => undefined)));
}

/** Where a model's file lives, relative to AppData. */
export function modelFileDest(model: LlmModel): string {
  return `llm/models/${model.id}/${model.file}`;
}

async function installRuntime(arch: string | null, onProgress: (p: InstallProgress) => void): Promise<void> {
  const runtime = runtimeFor(arch);
  if (!runtime) {
    throw new Error(
      arch && arch !== "aarch64"
        ? "The on-device model runtime is built for Apple Silicon only so far — Intel Macs can use a cloud provider."
        : "There is no on-device model runtime for this platform yet — a cloud provider still works.",
    );
  }
  await downloadToAppData(
    {
      id: "llm-runtime",
      url: runtime.url,
      dest: runtime.archive,
      sha256: runtime.sha256,
      expectedSize: runtime.bytes,
      purpose: "language model runtime download",
    },
    (loaded, total) => onProgress({ step: "runtime", loaded, total }),
  );
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("llm_install_runtime", { archive: runtime.archive });
}

async function installModelFile(model: LlmModel, onProgress: (p: InstallProgress) => void): Promise<void> {
  await downloadToAppData(
    {
      id: `llm-model:${model.id}`,
      url: model.url,
      dest: modelFileDest(model),
      sha256: model.sha256,
      expectedSize: model.bytes,
      purpose: "language model download",
    },
    (loaded, total) => onProgress({ step: "model", loaded, total: total || model.bytes }),
  );
}

/**
 * Installs one model from the catalogue plus the runtime that runs it, when
 * that is not in place yet. Existing models are left alone.
 *
 * Resolves once everything is in place. Rejects with `InstallCancelled` after
 * `cancelInstall()` (the partial file is kept, the next call resumes it) and
 * with an ordinary `Error` for anything else — network, checksum mismatch,
 * disk. Progress arrives per step; `total` is the pinned size when the server
 * sends no Content-Length.
 */
export async function installLlm(
  onProgress: (p: InstallProgress) => void,
  modelId: string = DEFAULT_LLM_MODEL_ID,
): Promise<void> {
  if (!isTauri()) throw new Error("On-device models run in the desktop app.");
  const model = modelById(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  cancelRequested = false;

  const status = await llmBackendStatus();
  if (!status?.runtime) await installRuntime(status?.arch ?? null, onProgress);
  // A cancel that landed while the archive was being unpacked.
  if (cancelRequested) throw new InstallCancelled();
  const installed = status?.models.some((m) => m.id === model.id && m.installed) ?? false;
  if (!installed) await installModelFile(model, onProgress);
}

/** Deletes an installed model (and forgets it as the chosen one). */
export async function removeModel(id: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("llm_remove_model", { id });
  if (llmSettings().local.model === id) setLlmSettings({ local: { model: "" } });
  notifyLlmChange();
}
