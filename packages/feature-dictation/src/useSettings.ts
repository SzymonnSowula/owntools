import { useCallback, useSyncExternalStore } from "react";
import {
  getDictationSettings,
  saveDictationSettings,
  SETTINGS_EVENT,
  SETTINGS_KEY,
  type DictationSettings,
} from "./engine";

/**
 * One live copy of the dictation settings for every page of the view.
 * `saveDictationSettings` fires `SETTINGS_EVENT`; a write from the pill window
 * arrives as a `storage` event. The snapshot is only rebuilt on those, so
 * React sees a stable object between changes.
 */
let snapshot: DictationSettings | null = null;
const listeners = new Set<() => void>();

function current(): DictationSettings {
  if (!snapshot) snapshot = getDictationSettings();
  return snapshot;
}

function refresh() {
  snapshot = getDictationSettings();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener(SETTINGS_EVENT, refresh);
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  // Catch anything written while no page was mounted.
  snapshot = getDictationSettings();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener(SETTINGS_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    }
  };
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key === SETTINGS_KEY) refresh();
}

export type UpdateSettings = (patch: Partial<DictationSettings>) => void;

export function useDictationSettings(): [DictationSettings, UpdateSettings] {
  const settings = useSyncExternalStore(subscribe, current, current);
  const update = useCallback<UpdateSettings>((patch) => {
    saveDictationSettings(patch);
  }, []);
  return [settings, update];
}
