import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  lastKnownLlmStatus,
  LLM_EVENT,
  LLM_SETTINGS_KEY,
  llmSettings,
  llmStatus,
  onLlmChange,
  setLlmSettings,
  type LlmSettings,
  type LlmStatus,
} from "@core/llm";

/**
 * The model's status for a component: `status` is null until the first
 * answer arrives (the last known one when there is one), `ready` is the
 * one-bit version every "AI" button needs, `refresh` asks again. Follows
 * every `LLM_EVENT` — a settings change, an install finishing, a removal —
 * so a button enables itself the moment the download completes.
 */
export function useLlm(): { status: LlmStatus | null; ready: boolean; refresh: () => void } {
  const [status, setStatus] = useState<LlmStatus | null>(() => lastKnownLlmStatus());
  const refresh = useCallback(() => {
    void llmStatus().then(setStatus, () => undefined);
  }, []);
  useEffect(() => {
    refresh();
    return onLlmChange(refresh);
  }, [refresh]);
  return { status, ready: Boolean(status?.available), refresh };
}

/* ------------------------------------------------------------------------- */
/* Settings as an external store (one snapshot for every mounted card)       */
/* ------------------------------------------------------------------------- */

let snapshot: LlmSettings | null = null;
const listeners = new Set<() => void>();

function current(): LlmSettings {
  if (!snapshot) snapshot = llmSettings();
  return snapshot;
}

function refreshSnapshot() {
  snapshot = llmSettings();
  for (const listener of listeners) listener();
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key === LLM_SETTINGS_KEY) refreshSnapshot();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener(LLM_EVENT, refreshSnapshot);
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  // Catch anything written while no card was mounted.
  snapshot = llmSettings();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener(LLM_EVENT, refreshSnapshot);
      window.removeEventListener("storage", onStorage);
    }
  };
}

export type UpdateLlmSettings = (patch: Partial<LlmSettings>) => void;

/** Live shared settings; a stable object between changes so React can bail out. */
export function useLlmSettings(): [LlmSettings, UpdateLlmSettings] {
  const settings = useSyncExternalStore(subscribe, current, current);
  const update = useCallback<UpdateLlmSettings>((patch) => {
    setLlmSettings(patch);
  }, []);
  return [settings, update];
}
