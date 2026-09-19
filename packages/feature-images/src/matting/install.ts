import { useEffect, useState, useSyncExternalStore } from "react";
import { installModel, isDownloadPaused, modelInstalled, pauseModelDownload, removeModel } from "./files";
import { MATTING_MODELS, mattingModel, type MattingModelId } from "./models";

// ---------------------------------------------------------------------------
// One download at a time, shared by every view — the same shape as the
// language-model and dictation install sessions, for the same reason: the
// download outlives the React tree that started it (the quick tool is a
// modal; Settings shows the same models), and a second `download_file` with
// the same id would write the same `.part` twice over.
// ---------------------------------------------------------------------------

export interface MattingInstallSession {
  installing: MattingModelId | null;
  loaded: number;
  total: number;
  cancelling: boolean;
  error: string | null;
  notice: string | null;
  /** Bumped whenever what is on disk may have changed. */
  generation: number;
}

export const PAUSED_NOTICE = "Download paused - it resumes where it stopped.";

const IDLE: MattingInstallSession = {
  installing: null,
  loaded: 0,
  total: 0,
  cancelling: false,
  error: null,
  notice: null,
  generation: 0,
};

let session: MattingInstallSession = IDLE;
let running: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<MattingInstallSession>) {
  session = { ...session, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): MattingInstallSession {
  return session;
}

export function useMattingInstall(): MattingInstallSession {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function installPercent(s: Pick<MattingInstallSession, "loaded" | "total">): number | null {
  if (!s.total) return null;
  return Math.min(100, Math.round((s.loaded / s.total) * 100));
}

/** Resolves `true` once the model is in place, `false` when paused or failed (the session says which). */
export function startMattingInstall(id: MattingModelId): Promise<boolean> {
  if (running) return running;
  const model = mattingModel(id);
  if (!model) return Promise.resolve(false);
  set({ installing: id, loaded: 0, total: model.bytes, cancelling: false, error: null, notice: null });
  running = (async () => {
    try {
      await installModel(model, (loaded, total) => set({ loaded, total: total || model.bytes }));
      return true;
    } catch (err) {
      if (isDownloadPaused(err)) set({ notice: PAUSED_NOTICE });
      else set({ error: err instanceof Error ? err.message : "Download failed." });
      return false;
    } finally {
      running = null;
      set({ installing: null, cancelling: false, generation: session.generation + 1 });
    }
  })();
  return running;
}

export async function pauseMattingInstall(): Promise<void> {
  if (!running) return;
  set({ cancelling: true });
  await pauseModelDownload().catch(() => undefined);
}

export async function removeMattingModel(id: MattingModelId): Promise<void> {
  const model = mattingModel(id);
  if (!model) return;
  await removeModel(model);
  set({ generation: session.generation + 1 });
}

export type InstalledMap = Record<MattingModelId, boolean>;

const NONE: InstalledMap = { general: false, portrait: false };

export async function installedMattingModels(): Promise<InstalledMap> {
  const entries = await Promise.all(MATTING_MODELS.map(async (m) => [m.id, await modelInstalled(m)] as const));
  return Object.fromEntries(entries) as InstalledMap;
}

/** Which models are on this device; `null` until the first check lands. Re-read after every install or removal. */
export function useInstalledMattingModels(): InstalledMap | null {
  const { generation } = useMattingInstall();
  const [installed, setInstalled] = useState<InstalledMap | null>(null);
  useEffect(() => {
    let live = true;
    void installedMattingModels()
      .catch(() => NONE)
      .then((map) => {
        if (live) setInstalled(map);
      });
    return () => {
      live = false;
    };
  }, [generation]);
  return installed;
}

/** Test hook. */
export function resetMattingInstallForTests(): void {
  session = IDLE;
  running = null;
}
