import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BaseDirectory, exists, mkdir, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type { BackendStatus, CopyOutcome, ReadAll, ScanEntry } from "../types";
import type { CopyOptions, SyncBackend } from "./backend";

/** Rust event name, see `sync.rs` `CHANGED_EVENT`. */
export const SYNC_CHANGED_TAURI_EVENT = "sync-changed";

const APP_DATA = { baseDir: BaseDirectory.AppData } as const;

function parentOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i > 0 ? rel.slice(0, i) : "";
}

async function ensureDir(rel: string): Promise<void> {
  if (rel && !(await exists(rel, APP_DATA))) await mkdir(rel, { ...APP_DATA, recursive: true });
}

export const tauriBackend: SyncBackend = {
  kind: "tauri",

  status() {
    return invoke<BackendStatus>("sync_status");
  },
  setDevice(deviceId, deviceName) {
    return invoke<void>("sync_set_device", { deviceId, deviceName });
  },
  setFolder(folder) {
    return invoke<{ ok: boolean; deviceDirs: string[] }>("sync_set_folder", { folder });
  },
  clearFolder() {
    return invoke<void>("sync_clear_folder");
  },
  readAll(folder) {
    return invoke<ReadAll>("sync_read_all", { folder: folder ?? null });
  },
  write(collection, json) {
    return invoke<number>("sync_write", { collection, json });
  },
  copyOut(fromAppData, relPath, opts?: CopyOptions) {
    return invoke<CopyOutcome>("sync_copy_out", {
      fromAppData,
      relPath,
      maxBytes: opts?.maxBytes ?? null,
      exclude: opts?.exclude ?? null,
    });
  },
  copyIn(deviceId, relPath, toAppData, opts?: CopyOptions) {
    return invoke<CopyOutcome>("sync_copy_in", {
      deviceId,
      relPath,
      toAppData,
      maxBytes: opts?.maxBytes ?? null,
      exclude: opts?.exclude ?? null,
    });
  },
  removeOut(relPath) {
    return invoke<void>("sync_remove_out", { relPath });
  },
  watch(on) {
    return invoke<boolean>("sync_watch", { on });
  },
  onChanged(cb) {
    let disposed = false;
    let un: (() => void) | null = null;
    void listen(SYNC_CHANGED_TAURI_EVENT, () => cb()).then((unlisten) => {
      if (disposed) unlisten();
      else un = unlisten;
    });
    return () => {
      disposed = true;
      un?.();
    };
  },

  appScan(rel) {
    return invoke<ScanEntry[]>("sync_app_scan", { rel });
  },
  async appReadText(rel) {
    if (!(await exists(rel, APP_DATA))) return null;
    return readTextFile(rel, APP_DATA);
  },
  async appWriteText(rel, text) {
    await ensureDir(parentOf(rel));
    const tmp = `${rel}.sync-tmp`;
    await writeTextFile(tmp, text, APP_DATA);
    await rename(tmp, rel, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
  },
  async appRemove(rel) {
    if (await exists(rel, APP_DATA)) await remove(rel, { ...APP_DATA, recursive: true });
  },

  async pickFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose a folder another app already syncs for you",
    });
    return typeof picked === "string" && picked ? picked : null;
  },
};
