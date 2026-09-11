import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_MEET_SETTINGS, type MeetSettings } from "./types";

/**
 * One localStorage JSON for meet's settings (`owntools-` prefix, no
 * migration needed — the key is new). `useMeetSettings` is one
 * `useSyncExternalStore` over it, fired by `MEET_SETTINGS_EVENT` in this
 * window and by `storage` from another, the way dictate's hook works.
 */
export const MEET_SETTINGS_KEY = "owntools-meet-settings";
export const MEET_SETTINGS_EVENT = "owntools:meet-settings";

export function normalizeMeetSettings(raw: unknown): MeetSettings {
  const d = DEFAULT_MEET_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    mic: typeof r.mic === "boolean" ? r.mic : d.mic,
    system: typeof r.system === "boolean" ? r.system : d.system,
    micDevice: typeof r.micDevice === "string" ? r.micDevice : d.micDevice,
    sensitivity: r.sensitivity === "low" || r.sensitivity === "high" || r.sensitivity === "normal" ? r.sensitivity : d.sensitivity,
    keepAudio: typeof r.keepAudio === "boolean" ? r.keepAudio : d.keepAudio,
    lang: r.lang === "en" || r.lang === "pl" || r.lang === "auto" ? r.lang : d.lang,
  };
}

export function getMeetSettings(): MeetSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(MEET_SETTINGS_KEY);
    return normalizeMeetSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_MEET_SETTINGS };
  }
}

export function saveMeetSettings(patch: Partial<MeetSettings>): MeetSettings {
  const next = normalizeMeetSettings({ ...getMeetSettings(), ...patch });
  try {
    localStorage.setItem(MEET_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / tests */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MEET_SETTINGS_EVENT));
  return next;
}

let snapshot: MeetSettings | null = null;
const listeners = new Set<() => void>();

function current(): MeetSettings {
  if (!snapshot) snapshot = getMeetSettings();
  return snapshot;
}

function refresh() {
  snapshot = getMeetSettings();
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key === MEET_SETTINGS_KEY) refresh();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener(MEET_SETTINGS_EVENT, refresh);
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  snapshot = getMeetSettings();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener(MEET_SETTINGS_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function useMeetSettings(): [MeetSettings, (patch: Partial<MeetSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, current, current);
  const update = useCallback((patch: Partial<MeetSettings>) => {
    saveMeetSettings(patch);
  }, []);
  return [settings, update];
}
