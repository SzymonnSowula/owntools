import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  captionsRunning,
  loadCaptionsSettings,
  saveCaptionsSettings,
  subscribeCaptionsSettings,
  subscribeCaptionsState,
  type CaptionsSettings,
} from "./captions";

/**
 * One live copy of the captions settings per window. A save fires the event
 * in this window; the other window (main ↔ captions) hears the `storage`
 * event. The snapshot only changes on those, so React sees a stable object.
 */
let snapshot: CaptionsSettings | null = null;
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function current(): CaptionsSettings {
  if (!snapshot) snapshot = loadCaptionsSettings();
  return snapshot;
}

function refresh() {
  snapshot = loadCaptionsSettings();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) unsubscribe = subscribeCaptionsSettings(refresh);
  listeners.add(listener);
  snapshot = loadCaptionsSettings();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribe?.();
      unsubscribe = null;
    }
  };
}

export function useCaptionsSettings(): [CaptionsSettings, (patch: Partial<CaptionsSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, current, current);
  const update = useCallback((patch: Partial<CaptionsSettings>) => {
    saveCaptionsSettings(patch);
  }, []);
  return [settings, update];
}

/** Whether a capture is running, kept in step across both windows. */
export function useCaptionsRunning(): boolean {
  const [running, setRunning] = useState(() => captionsRunning());
  useEffect(() => subscribeCaptionsState(() => setRunning(captionsRunning())), []);
  return running;
}
