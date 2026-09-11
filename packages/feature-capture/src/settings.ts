import { useSyncExternalStore } from "react";

/**
 * The tool's few settings, in localStorage. Both windows read them: the
 * library page edits them, the overlay reads them the moment a capture is
 * saved (same origin, same storage — nothing has to be pushed across).
 */

export interface CaptureSettings {
  /** Also drop a copy into `<Pictures>/owntools/`. */
  saveToPictures: boolean;
  /** Recognise text on every save, so the library is searchable. */
  autoOcr: boolean;
  /** The colour chip that is active when the overlay opens. */
  defaultColor: string;
}

export const COLORS: { id: string; label: string }[] = [
  { id: "#0a84ff", label: "Blue" },
  { id: "#ff453a", label: "Red" },
  { id: "#ffd60a", label: "Yellow" },
  { id: "#ffffff", label: "White" },
  { id: "#1d1d1f", label: "Black" },
];

export const DEFAULT_SETTINGS: CaptureSettings = {
  saveToPictures: false,
  autoOcr: true,
  defaultColor: COLORS[0].id,
};

const KEY = "owntools-capture-settings";
const EVENT = "owntools:capture-settings";

let cache: CaptureSettings | null = null;

function normalize(raw: unknown): CaptureSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<Record<keyof CaptureSettings, unknown>>;
  return {
    saveToPictures: typeof r.saveToPictures === "boolean" ? r.saveToPictures : DEFAULT_SETTINGS.saveToPictures,
    autoOcr: typeof r.autoOcr === "boolean" ? r.autoOcr : DEFAULT_SETTINGS.autoOcr,
    defaultColor:
      typeof r.defaultColor === "string" && COLORS.some((c) => c.id === r.defaultColor)
        ? r.defaultColor
        : DEFAULT_SETTINGS.defaultColor,
  };
}

export function loadSettings(): CaptureSettings {
  if (cache) return cache;
  try {
    cache = normalize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

export function saveSettings(patch: Partial<CaptureSettings>): CaptureSettings {
  const next = normalize({ ...loadSettings(), ...patch });
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode; the in-memory copy still applies */
  }
  window.dispatchEvent(new Event(EVENT));
  return next;
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCaptureSettings(): [CaptureSettings, (patch: Partial<CaptureSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, loadSettings, () => DEFAULT_SETTINGS);
  return [settings, (patch) => void saveSettings(patch)];
}
