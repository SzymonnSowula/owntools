import { useEffect, useState, useSyncExternalStore } from "react";
import { isTauri } from "@core/env";
import { downloadRequest, engineStatus, modelComplete, presentFiles, runtimeMatches, type EngineStatus } from "./engine";
import { DEVICE_MODELS, deviceModel, runtimeFor, type DeviceModel, type EnginePreference } from "./models";

// ---------------------------------------------------------------------------
// One install at a time, shared by every view — the same shape as the
// language-model session (`feature-llm/install.ts`), for the same reason: the
// download runs in Rust and outlives the React tree that started it, and two
// `download_file` calls with one id would write the same `.part` twice over.
//
// An image model is several files (diffusion model, decoder, text encoder),
// downloaded one after another; each that is already in place with its pinned
// size is skipped, so a paused install resumes at the file it stopped in and
// a text encoder the language model already brought is never fetched again.
// ---------------------------------------------------------------------------

export interface DeviceInstallSession {
  /** Model id being installed; null when idle. */
  installing: string | null;
  /** What is coming down right now, in words. */
  step: string | null;
  /** Bytes across the whole install, so the bar does not restart per file. */
  loaded: number;
  total: number;
  cancelling: boolean;
  error: string | null;
  notice: string | null;
  generation: number;
}

export const PAUSED_NOTICE = "Download paused - it resumes where it stopped.";
const DOWNLOAD_PROGRESS_EVENT = "download-progress";
const DOWNLOAD_CANCELLED = "cancelled";

class InstallPaused extends Error {
  constructor() {
    super("Download paused.");
    this.name = "InstallPaused";
  }
}

const IDLE: DeviceInstallSession = {
  installing: null,
  step: null,
  loaded: 0,
  total: 0,
  cancelling: false,
  error: null,
  notice: null,
  generation: 0,
};

let session: DeviceInstallSession = IDLE;
let running: Promise<boolean> | null = null;
let cancelRequested = false;
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function set(patch: Partial<DeviceInstallSession>) {
  session = { ...session, ...patch };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => session;

export function useDeviceInstall(): DeviceInstallSession {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function installPercent(s: Pick<DeviceInstallSession, "loaded" | "total">): number | null {
  if (!s.total) return null;
  return Math.min(100, Math.round((s.loaded / s.total) * 100));
}

async function download(request: ReturnType<typeof downloadRequest>, onProgress: (loaded: number) => void): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ id: string; loaded: number }>(DOWNLOAD_PROGRESS_EVENT, (event) => {
    if (event.payload.id === request.id) onProgress(event.payload.loaded);
  });
  inflight.add(request.id);
  try {
    if (cancelRequested) throw new InstallPaused();
    await invoke<string>("download_file", { request });
  } catch (err) {
    if (err instanceof InstallPaused || err === DOWNLOAD_CANCELLED) throw new InstallPaused();
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    inflight.delete(request.id);
    unlisten();
  }
}

async function install(model: DeviceModel, preference: EnginePreference): Promise<void> {
  if (!isTauri()) throw new Error("On-device models run in the desktop app.");
  cancelRequested = false;
  const status = await engineStatus();
  const runtime = runtimeFor(preference, status ?? { vulkan: false });
  if (!runtime) throw new Error("There is no on-device image engine for this machine yet - a provider with your own key still works.");
  const needRuntime = !runtimeMatches(status, preference);
  const present = await presentFiles(model);
  const missing = model.files.filter((f) => !present.has(f.dest));

  const total = (needRuntime ? runtime.bytes : 0) + missing.reduce((n, f) => n + f.bytes, 0);
  let before = 0;
  set({ total, loaded: 0 });

  if (needRuntime) {
    set({ step: "The image engine" });
    await download(
      { id: "imagegen-runtime", url: runtime.url, dest: runtime.archive, sha256: runtime.sha256, expectedSize: runtime.bytes, purpose: "image engine download" },
      (loaded) => set({ loaded: before + loaded }),
    );
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("imagegen_install_runtime", { archive: runtime.archive, build: runtime.build });
    before += runtime.bytes;
    set({ loaded: before });
  }
  for (const file of missing) {
    // A pause that landed between two files.
    if (cancelRequested) throw new InstallPaused();
    set({ step: file.label });
    await download(downloadRequest(file, `imagegen-file:${file.dest}`), (loaded) => set({ loaded: before + loaded }));
    before += file.bytes;
    set({ loaded: before });
  }
}

/** Resolves `true` once the engine and every file of the model are in place; `false` when paused or failed. */
export function startDeviceInstall(modelId: string, preference: EnginePreference): Promise<boolean> {
  if (running) return running;
  const model = deviceModel(modelId);
  if (!model) return Promise.resolve(false);
  set({ installing: modelId, step: null, loaded: 0, total: 0, cancelling: false, error: null, notice: null });
  running = (async () => {
    try {
      await install(model, preference);
      return true;
    } catch (err) {
      if (err instanceof InstallPaused) set({ notice: PAUSED_NOTICE });
      else set({ error: err instanceof Error ? err.message : "Download failed." });
      return false;
    } finally {
      running = null;
      set({ installing: null, step: null, cancelling: false, generation: session.generation + 1 });
    }
  })();
  return running;
}

export async function pauseDeviceInstall(): Promise<void> {
  if (!running || !isTauri()) return;
  cancelRequested = true;
  set({ cancelling: true });
  const { invoke } = await import("@tauri-apps/api/core");
  await Promise.all([...inflight].map((id) => invoke("download_cancel", { id }).catch(() => undefined)));
}

/** Deletes a model's own folder. Files it shares with another tool stay. */
export async function removeDeviceModel(modelId: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("imagegen_remove_model", { id: modelId });
  set({ generation: session.generation + 1 });
}

export interface DeviceState {
  status: EngineStatus | null;
  /** Per model: the destinations that are in place. */
  present: Record<string, Set<string>>;
}

/** What is installed, re-read after every install or removal. `null` until the first read. */
export function useDeviceState(): DeviceState | null {
  const { generation } = useDeviceInstall();
  const [state, setState] = useState<DeviceState | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const status = await engineStatus();
      const present: Record<string, Set<string>> = {};
      for (const model of DEVICE_MODELS) present[model.id] = await presentFiles(model);
      if (live) setState({ status, present });
    })();
    return () => {
      live = false;
    };
  }, [generation]);
  return state;
}

/** Installed and runnable: every file is there and so is an engine. */
export function deviceModelReady(state: DeviceState | null, modelId: string): boolean {
  const model = deviceModel(modelId);
  if (!state?.status?.runtime || !model) return false;
  return modelComplete(model, state.present[modelId] ?? new Set());
}

/** Test hook. */
export function resetDeviceInstallForTests(): void {
  session = IDLE;
  running = null;
  cancelRequested = false;
}
