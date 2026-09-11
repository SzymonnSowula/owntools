/**
 * The desktop backend: rules and runs as JSON under `<AppData>/automations/`
 * through plugin-fs, everything outside AppData through the Rust commands in
 * `src-tauri/src/automations.rs`.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { RECORDING_FINISHED_TAURI_EVENT } from "@core/events";
import { projectDir } from "@feature-editor/lib/projectIo";
import type { AutomationsBackend, FileAdded, FolderEntry, RecordingInfo, WatchFolder } from "./backend";
import { normalizeRules, normalizeRuns, type Rule, type RunRecord } from "./rules";

const DIR = "automations";
const RULES = `${DIR}/rules.json`;
const RUNS = `${DIR}/runs.json`;
const APP_DATA = { baseDir: BaseDirectory.AppData } as const;
const FILE_ADDED_EVENT = "automation-file-added";

async function ensureDir(): Promise<void> {
  if (!(await exists(DIR, APP_DATA))) await mkdir(DIR, { ...APP_DATA, recursive: true });
}

async function readJson(rel: string): Promise<unknown> {
  if (!(await exists(rel, APP_DATA))) return null;
  try {
    return JSON.parse(await readTextFile(rel, APP_DATA));
  } catch {
    return null;
  }
}

/** Write next to the file, then rename over it: a crash mid-write leaves the old file whole. */
async function writeJson(rel: string, value: unknown): Promise<void> {
  await ensureDir();
  const tmp = `${rel}.tmp`;
  await writeTextFile(tmp, JSON.stringify(value, null, 2), APP_DATA);
  await rename(tmp, rel, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
}

/** Subscribes to a Tauri event; the returned function unsubscribes (safe before the listen resolves). */
function subscribe<T>(name: string, cb: (payload: T) => void): () => void {
  let unlisten: (() => void) | null = null;
  let gone = false;
  void listen<T>(name, (e) => cb(e.payload)).then((fn) => {
    if (gone) fn();
    else unlisten = fn;
  });
  return () => {
    gone = true;
    unlisten?.();
  };
}

export const tauriBackend: AutomationsBackend = {
  loadRules: async () => normalizeRules(await readJson(RULES)),
  saveRules: (rules: Rule[]) => writeJson(RULES, rules),
  loadRuns: async () => normalizeRuns(await readJson(RUNS)),
  saveRuns: (runs: RunRecord[]) => writeJson(RUNS, runs),

  watchSet: async (folders: WatchFolder[]) => {
    await invoke<number>("automations_watch_set", { folders });
  },
  onFileAdded: (cb) => subscribe<FileAdded>(FILE_ADDED_EVENT, cb),
  onRecordingFinished: (cb) =>
    subscribe<{ projectId?: string } | string>(RECORDING_FINISHED_TAURI_EVENT, (payload) => {
      const id = typeof payload === "string" ? payload : payload?.projectId;
      if (id) cb(id);
    }),
  recordingInfo: async (projectId: string): Promise<RecordingInfo | null> => {
    const rel = `${projectDir(projectId)}/project.json`;
    if (!(await exists(rel, APP_DATA))) return null;
    try {
      const project = JSON.parse(await readTextFile(rel, APP_DATA)) as {
        name?: string;
        duration?: number;
        screenPath?: string;
      };
      const info: RecordingInfo = {
        title: project.name ?? "Recording",
        durationMs: Math.round((project.duration ?? 0) * 1000),
      };
      if (project.screenPath) info.path = await join(await appDataDir(), project.screenPath);
      return info;
    } catch {
      return null;
    }
  },

  pickFolder: async (title: string) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title });
    if (typeof picked !== "string" || !picked) return null;
    await invoke<string[]>("automations_allow_folder", { folder: picked });
    return picked;
  },
  allowFolder: async (folder: string) => {
    await invoke<string[]>("automations_allow_folder", { folder });
  },
  writeText: (folder, name, text) => invoke<{ path: string; name: string }>("automations_write_text", { folder, name, text }),
  importFile: (path) => invoke<{ path: string; size: number }>("automations_import_file", { path }),
  removeTemp: async (path) => {
    await remove(path).catch(() => undefined);
  },
  listFolder: (folder) => invoke<FolderEntry[]>("automations_list_folder", { folder }),
  readText: (path) => readTextFile(path),
  readBytes: (path) => readFile(path),
  appDataDir: () => appDataDir(),
  revealPath: async (path) => {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  },
};
