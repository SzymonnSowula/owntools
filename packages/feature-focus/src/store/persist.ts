import { isTauri } from "../lib/env";
import type { AppData } from "../types";

const KEY = "focus-data";
let lazyStore: {
  get: (k: string) => Promise<unknown>;
  set: (k: string, v: unknown) => Promise<void>;
  save: () => Promise<void>;
} | null = null;

async function tauriStore() {
  if (!isTauri()) return null;
  if (lazyStore) return lazyStore;
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    lazyStore = new LazyStore("focus.json");
    return lazyStore;
  } catch {
    return null;
  }
}

export async function loadPersisted(): Promise<AppData | null> {
  const raw = await readRaw();
  if (!raw) return null;
  return migrate(raw);
}

async function readRaw(): Promise<Record<string, unknown> | null> {
  try {
    const store = await tauriStore();
    if (store) {
      const data = (await store.get("state")) as Record<string, unknown> | undefined;
      if (data && typeof data.version === "number") return data;
    }
  } catch {
    /* fallback */
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data && typeof data.version === "number") return data;
  } catch {
    return null;
  }
  return null;
}

function migrate(raw: Record<string, unknown>): AppData {
  const version = Number(raw.version ?? 1);
  const data = { ...raw } as unknown as AppData;
  if (version < 2) {
    data.version = 2;
    data.heatmap = {};
    data.usage = {};
  }
  data.version = 2;
  data.usage = data.usage ?? {};
  data.settings = {
    ...data.settings,
    usageTracking: data.settings?.usageTracking ?? true,
    scrollGuardEnabled: data.settings?.scrollGuardEnabled ?? false,
    scrollGuardSites: data.settings?.scrollGuardSites?.length
      ? data.settings.scrollGuardSites
      : ["x.com", "twitter.com", "tiktok.com", "instagram.com"],
    scrollGuardTaskId: data.settings?.scrollGuardTaskId ?? null,
  };
  for (const day of Object.values(data.heatmap ?? {})) {
    if (day && day.seconds == null) {
      day.seconds = Math.max(0, Math.round((day.minutes ?? 0) * 60));
    }
  }
  return data;
}

export async function savePersisted(data: AppData): Promise<void> {
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* quota */
  }
  try {
    const store = await tauriStore();
    if (store) {
      await store.set("state", data);
      await store.save();
    }
  } catch {
    /* preview / plugin missing */
  }
}
