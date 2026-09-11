import { useSyncExternalStore } from "react";
import { llmSettings, notifyLlmChange, setLlmInstalling, setLlmSettings } from "@core/llm";
import { cancelInstall, installLlm, isInstallCancelled, type InstallProgress } from "./installer";
import { DEFAULT_LLM_MODEL_ID } from "./models";

// ---------------------------------------------------------------------------
// One install at a time, shared by every view.
//
// The download runs in Rust and outlives any React tree, so the state that
// describes it cannot live in a component: the Settings card starts it, the
// person opens another tool, comes back — and the card has to show the same
// download continuing, not offer to start it again (two `download_file`
// calls with one id would write the same `.part` file twice over). Same
// shape as `feature-dictation/install.ts`, on purpose.
// ---------------------------------------------------------------------------

export interface InstallSession {
  /** Model id being installed; null when idle. */
  installing: string | null;
  progress: InstallProgress | null;
  /** `pauseInstall()` was called and the download is stopping. */
  cancelling: boolean;
  /** Message of the last failed attempt; cleared by the next start. */
  error: string | null;
  /** Non-error outcome of the last attempt (a paused download). */
  notice: string | null;
  /** Bumped when an attempt ends, so views re-read the status. */
  generation: number;
}

export const PAUSED_NOTICE = "Download paused — it resumes where it stopped.";

const IDLE: InstallSession = {
  installing: null,
  progress: null,
  cancelling: false,
  error: null,
  notice: null,
  generation: 0,
};

let session: InstallSession = IDLE;
let running: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<InstallSession>) {
  session = { ...session, ...patch };
  for (const listener of listeners) listener();
}

export function getInstallSession(): InstallSession {
  return session;
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The live install session; re-renders on every progress tick. */
export function useInstallSession(): InstallSession {
  return useSyncExternalStore(subscribeInstall, getInstallSession, getInstallSession);
}

/** Per-step completion in percent, or null before the first progress event. */
export function installPercent(progress: InstallProgress | null): number | null {
  if (!progress?.total) return null;
  return Math.min(100, Math.round((progress.loaded / progress.total) * 100));
}

/**
 * Starts (or resumes) the install of the runtime plus `modelId`. Resolves
 * `true` once both are in place and `false` when the download was paused or
 * failed — the outcome is in the session (`notice` / `error`), so callers do
 * not need a try/catch. A call while an install is already running joins it.
 */
export function startInstall(modelId: string = DEFAULT_LLM_MODEL_ID): Promise<boolean> {
  if (running) return running;
  set({ installing: modelId, progress: null, cancelling: false, error: null, notice: null });
  setLlmInstalling(true);
  running = (async () => {
    try {
      await installLlm((progress) => set({ progress }), modelId);
      // First model in — make it the one the tools use.
      if (!llmSettings().local.model) setLlmSettings({ local: { model: modelId } });
      return true;
    } catch (err) {
      if (isInstallCancelled(err)) {
        // The partial file is kept; the next start picks it up where it stopped.
        set({ notice: PAUSED_NOTICE });
      } else {
        set({ error: err instanceof Error ? err.message : "Download failed." });
      }
      return false;
    } finally {
      running = null;
      set({
        installing: null,
        progress: null,
        cancelling: false,
        generation: session.generation + 1,
      });
      setLlmInstalling(false);
      notifyLlmChange();
    }
  })();
  return running;
}

/** Pauses the running install; the partial file stays for the next start. */
export async function pauseInstall(): Promise<void> {
  if (!running) return;
  set({ cancelling: true });
  await cancelInstall().catch(() => undefined);
}

/** Test hook: back to idle between cases. */
export function resetInstallSessionForTests(): void {
  session = IDLE;
  running = null;
}
