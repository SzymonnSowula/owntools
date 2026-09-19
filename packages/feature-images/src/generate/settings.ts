/**
 * Where pictures come from, decided once in Settings → Intelligence and read
 * by every tool that wants one: this device, or one of the providers with the
 * person's own key. One localStorage JSON, like the language model's
 * (`@core/llm`), with an event so the modal and the Settings card agree.
 *
 * Keys are stored on this device only, next to the language model's cloud
 * key: never synced (`feature-sync` has no collection for this), never
 * logged, sent to nobody but the provider they belong to.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_DEVICE_MODEL, deviceModel, type EnginePreference } from "./device/models";
import { provider, PROVIDERS } from "./providers";
import type { AspectRatio, ImageProvider, ProviderCreds, Quality } from "./types";

/** "device" is the engine owntools installs; everything else is a provider id. */
export const DEVICE_SOURCE = "device";

export interface ImageSettings {
  source: string;
  /** Chosen model per source — switching provider and back keeps the choice. */
  models: Record<string, string>;
  keys: Record<string, string>;
  baseUrls: Record<string, string>;
  extras: Record<string, string>;
  device: { engine: EnginePreference; cpuOnly: boolean };
  /** What the tool opens with. */
  aspect: AspectRatio;
  quality: Quality;
  count: number;
}

export const IMAGE_SETTINGS_KEY = "owntools-image-settings";
export const IMAGE_SETTINGS_EVENT = "owntools:image-settings-changed";

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  source: DEVICE_SOURCE,
  models: {},
  keys: {},
  baseUrls: {},
  extras: {},
  device: { engine: "auto", cpuOnly: false },
  aspect: "1:1",
  quality: "standard",
  count: 1,
};

const ASPECTS: AspectRatio[] = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
const QUALITIES: Quality[] = ["draft", "standard", "high"];

function strings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Folds whatever was stored onto the current shape; anything unknown becomes the default. */
export function normalizeImageSettings(raw: unknown): ImageSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_IMAGE_SETTINGS;
  const device = (r.device && typeof r.device === "object" ? r.device : {}) as Record<string, unknown>;
  const source = typeof r.source === "string" && (r.source === DEVICE_SOURCE || provider(r.source)) ? r.source : d.source;
  return {
    source,
    models: strings(r.models),
    keys: strings(r.keys),
    baseUrls: strings(r.baseUrls),
    extras: strings(r.extras),
    device: {
      engine: device.engine === "gpu" || device.engine === "cpu" ? device.engine : "auto",
      cpuOnly: device.cpuOnly === true,
    },
    aspect: ASPECTS.includes(r.aspect as AspectRatio) ? (r.aspect as AspectRatio) : d.aspect,
    quality: QUALITIES.includes(r.quality as Quality) ? (r.quality as Quality) : d.quality,
    count: typeof r.count === "number" && r.count >= 1 && r.count <= 4 ? Math.round(r.count) : d.count,
  };
}

let cachedRaw: string | null | undefined;
let cached: ImageSettings = DEFAULT_IMAGE_SETTINGS;

export function imageSettings(): ImageSettings {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(IMAGE_SETTINGS_KEY);
  } catch {
    raw = null;
  }
  // `useSyncExternalStore` wants the same object for the same state.
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    cached = normalizeImageSettings(raw ? JSON.parse(raw) : null);
  } catch {
    cached = DEFAULT_IMAGE_SETTINGS;
  }
  return cached;
}

export function setImageSettings(patch: Partial<ImageSettings>): ImageSettings {
  const current = imageSettings();
  const next = normalizeImageSettings({ ...current, ...patch });
  try {
    localStorage.setItem(IMAGE_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / tests */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(IMAGE_SETTINGS_EVENT));
  return imageSettings();
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === IMAGE_SETTINGS_KEY) cb();
  };
  window.addEventListener(IMAGE_SETTINGS_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(IMAGE_SETTINGS_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useImageSettings(): ImageSettings {
  return useSyncExternalStore(subscribe, imageSettings, imageSettings);
}

/* ------------------------------------------------------------------------- */
/* Reading a source out of the settings                                      */
/* ------------------------------------------------------------------------- */

export function credsFor(p: ImageProvider, settings: ImageSettings): ProviderCreds {
  return {
    apiKey: settings.keys[p.id] ?? "",
    baseUrl: (settings.baseUrls[p.id] ?? "").trim() || (p.baseUrl?.default ?? ""),
    extra: settings.extras[p.id] ?? "",
  };
}

/** The model a source would use: the chosen one, else the first of its list. */
export function modelFor(source: string, settings: ImageSettings): string {
  const chosen = settings.models[source];
  if (source === DEVICE_SOURCE) return chosen && deviceModel(chosen) ? chosen : DEFAULT_DEVICE_MODEL;
  if (chosen !== undefined) return chosen;
  return provider(source)?.models[0]?.id ?? "";
}

/** Can this provider be called at all with what has been filled in? */
export function providerConfigured(p: ImageProvider, settings: ImageSettings): boolean {
  const creds = credsFor(p, settings);
  if (p.needsKey && !creds.apiKey.trim()) return false;
  if (p.baseUrl && !creds.baseUrl.trim()) return false;
  if (p.extra && !creds.extra.trim()) return false;
  return true;
}

/** Providers that are ready to use, in picker order — what the tool's source menu offers. */
export function configuredProviders(settings: ImageSettings): ImageProvider[] {
  return PROVIDERS.filter((p) => {
    if (!providerConfigured(p, settings)) return false;
    // A server needs no key, so every one of them would count; it does once its address was saved or it was chosen.
    return p.needsKey || p.id === settings.source || settings.baseUrls[p.id] !== undefined;
  });
}
