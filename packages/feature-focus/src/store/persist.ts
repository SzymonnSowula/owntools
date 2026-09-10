import { isTauri } from "../lib/env";
import type { AppData } from "../types";

const KEY = "focus-data";
const WS_KEY = "focus-workspaces";

/** The pre-workspaces dataset lives under the bare keys; keep mapping to it. */
export const DEFAULT_WORKSPACE_ID = "default";

/**
 * What a workspace launches when you start a session in it.
 * `app` runs an executable, `url` opens a link, `folder` reveals a directory,
 * `terminal` opens a console window and runs a command line in it.
 */
export type RitualStepKind = "app" | "url" | "folder" | "terminal";

export interface RitualStep {
  id: string;
  kind: RitualStepKind;
  label: string;
  /** exe/lnk path · url · folder path · command line, depending on `kind`. */
  target: string;
  /** Extra arguments for `app` (ignored elsewhere — `terminal` puts them in `target`). */
  args?: string;
  /** Working directory for `app` and `terminal`. */
  cwd?: string;
  enabled: boolean;
}

/** Which owntools module the session lands on. */
export type RitualTool = "hub" | "focus" | "create" | "launch" | "dictate";

export interface WorkspaceRitual {
  steps: RitualStep[];
  /** Start a focus timer of this length with the session (null = don't). */
  timerMinutes: number | null;
  /** Module to open once the session starts (null = stay on the hub). */
  openTool: RitualTool | null;
  /** Arm/disarm the scroll guard for the session (null = leave it alone). */
  scrollGuard: boolean | null;
  /** Launch straight away on switch instead of showing the confirmation sheet. */
  autoRun: boolean;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
  /** Undefined for workspaces created before rituals existed. */
  ritual?: WorkspaceRitual;
}

export function emptyRitual(): WorkspaceRitual {
  return {
    steps: [],
    timerMinutes: null,
    openTool: null,
    scrollGuard: null,
    autoRun: false,
  };
}

/** Rituals arrived after workspaces did — fill the gaps on read. */
export function ritualOf(ws: WorkspaceMeta | undefined): WorkspaceRitual {
  const base = emptyRitual();
  if (!ws?.ritual) return base;
  return {
    ...base,
    ...ws.ritual,
    steps: (ws.ritual.steps ?? []).map((s) => ({ ...s, enabled: s.enabled !== false })),
  };
}

export interface WorkspacesMeta {
  version: 1;
  active: string;
  list: WorkspaceMeta[];
}

let lazyStore: {
  get: (k: string) => Promise<unknown>;
  set: (k: string, v: unknown) => Promise<void>;
  delete: (k: string) => Promise<boolean>;
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

function dataKeys(wsId: string): { local: string; store: string } {
  return wsId === DEFAULT_WORKSPACE_ID
    ? { local: KEY, store: "state" }
    : { local: `${KEY}:${wsId}`, store: `state:${wsId}` };
}

export function defaultWorkspacesMeta(): WorkspacesMeta {
  return {
    version: 1,
    active: DEFAULT_WORKSPACE_ID,
    list: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: "Personal",
        emoji: "🏡",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export async function loadWorkspacesMeta(): Promise<WorkspacesMeta> {
  try {
    const store = await tauriStore();
    if (store) {
      const meta = (await store.get("workspaces")) as WorkspacesMeta | undefined;
      if (meta && meta.version === 1 && meta.list?.length) return meta;
    }
  } catch {
    /* fallback */
  }
  try {
    const raw = localStorage.getItem(WS_KEY);
    if (raw) {
      const meta = JSON.parse(raw) as WorkspacesMeta;
      if (meta && meta.version === 1 && meta.list?.length) return meta;
    }
  } catch {
    /* fallback */
  }
  return defaultWorkspacesMeta();
}

export async function saveWorkspacesMeta(meta: WorkspacesMeta): Promise<void> {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify(meta));
  } catch {
    /* quota */
  }
  try {
    const store = await tauriStore();
    if (store) {
      await store.set("workspaces", meta);
      await store.save();
    }
  } catch {
    /* preview / plugin missing */
  }
}

export async function loadPersisted(
  wsId: string = DEFAULT_WORKSPACE_ID,
): Promise<AppData | null> {
  const raw = await readRaw(wsId);
  if (!raw) return null;
  return migrate(raw);
}

async function readRaw(wsId: string): Promise<Record<string, unknown> | null> {
  const keys = dataKeys(wsId);
  try {
    const store = await tauriStore();
    if (store) {
      const data = (await store.get(keys.store)) as Record<string, unknown> | undefined;
      if (data && typeof data.version === "number") return data;
    }
  } catch {
    /* fallback */
  }
  try {
    const raw = localStorage.getItem(keys.local);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data && typeof data.version === "number") return data;
  } catch {
    return null;
  }
  return null;
}

const BACKUP_ARRAYS = ["lists", "tasks", "notes", "habits", "journal", "planner"] as const;
const BACKUP_OBJECTS = ["heatmap", "usage", "settings", "notebook"] as const;
const BACKUP_SECTIONS = [...BACKUP_ARRAYS, ...BACKUP_OBJECTS, "timer", "view", "sounds", "record", "piano"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Shape check for a JSON backup before it replaces a workspace: a numeric
 * `version`, the list sections are arrays when present, the map sections are
 * objects when present, and at least one focus section exists at all (so a
 * random `{ "version": 3 }` file can't wipe a workspace down to the seed).
 */
export function validateBackup(raw: unknown): raw is Record<string, unknown> {
  if (!isPlainObject(raw)) return false;
  if (typeof raw.version !== "number" || !Number.isFinite(raw.version)) return false;
  for (const key of BACKUP_ARRAYS) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return false;
  }
  for (const key of BACKUP_OBJECTS) {
    if (raw[key] !== undefined && !isPlainObject(raw[key])) return false;
  }
  return BACKUP_SECTIONS.some((key) => raw[key] !== undefined);
}

/**
 * Bring any persisted dataset (or restored backup) up to the current shape.
 * v1 heatmap days carry `minutes` only — the backfill below derives `seconds`,
 * so nothing is thrown away on the way to v2.
 */
export function migrate(raw: Record<string, unknown>): AppData {
  const data = { ...raw } as unknown as AppData;
  data.version = 2;
  data.heatmap = data.heatmap ?? {};
  data.usage = data.usage ?? {};
  data.settings = {
    ...data.settings,
    usageTracking: data.settings?.usageTracking ?? true,
    closeToTray: data.settings?.closeToTray ?? true,
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

export async function savePersisted(
  data: AppData,
  wsId: string = DEFAULT_WORKSPACE_ID,
): Promise<void> {
  const keys = dataKeys(wsId);
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(keys.local, json);
  } catch {
    /* quota */
  }
  try {
    const store = await tauriStore();
    if (store) {
      await store.set(keys.store, data);
      await store.save();
    }
  } catch {
    /* preview / plugin missing */
  }
}

export async function deletePersisted(wsId: string): Promise<void> {
  const keys = dataKeys(wsId);
  try {
    localStorage.removeItem(keys.local);
  } catch {
    /* */
  }
  try {
    const store = await tauriStore();
    if (store) {
      await store.delete(keys.store);
      await store.save();
    }
  } catch {
    /* */
  }
}
