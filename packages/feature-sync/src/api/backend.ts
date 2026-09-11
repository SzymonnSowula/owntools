import type { BackendStatus, CopyOutcome, ReadAll, ScanEntry } from "../types";

export interface CopyOptions {
  /** Size cap in bytes for the folder being copied (default 20 MB). */
  maxBytes?: number;
  /** Top-level names inside the folder to leave out (`audio.wav`, `segments`). */
  exclude?: string[];
}

/**
 * Everything the engine asks of the machine. `tauri.ts` talks to the Rust
 * commands in `src-tauri/src/sync.rs` (the synced folder is outside AppData,
 * so Rust does all the I/O there) and to plugin-fs for AppData text files;
 * `demo.ts` keeps an in-memory folder with a second device in it, so the
 * card works — and merges — under `pnpm dev` and in the browser preview.
 */
export interface SyncBackend {
  readonly kind: "tauri" | "demo";

  status(): Promise<BackendStatus>;
  /** Tells Rust who we are so the manifest carries the name and state.json the id. */
  setDevice(deviceId: string, deviceName: string): Promise<void>;
  /** Validates the folder, creates `owntools-sync/<deviceId>/`, remembers it. */
  setFolder(folder: string): Promise<{ ok: boolean; deviceDirs: string[] }>;
  /** Forgets the folder; the files stay. */
  clearFolder(): Promise<void>;
  /** Every device's manifest + collection files; `folder` peeks without committing. */
  readAll(folder?: string): Promise<ReadAll>;
  /** Atomic write of one collection into this device's subtree. Returns the write time. */
  write(collection: string, json: string): Promise<number>;
  /** `<AppData>/<fromAppData>` → `<own subtree>/<relPath>`, whole folder. */
  copyOut(fromAppData: string, relPath: string, opts?: CopyOptions): Promise<CopyOutcome>;
  /** `<deviceId>/<relPath>` in the folder → `<AppData>/<toAppData>`, whole folder. */
  copyIn(deviceId: string, relPath: string, toAppData: string, opts?: CopyOptions): Promise<CopyOutcome>;
  /** Removes a folder from this device's subtree. */
  removeOut(relPath: string): Promise<void>;
  watch(on: boolean): Promise<boolean>;
  /** Fires after the folder changed and settled (another device wrote). */
  onChanged(cb: () => void): () => void;

  /** One level of `<AppData>/<rel>` with sizes and mtimes. */
  appScan(rel: string): Promise<ScanEntry[]>;
  appReadText(rel: string): Promise<string | null>;
  /** Atomic (temp + rename). Creates parent folders. */
  appWriteText(rel: string, text: string): Promise<void>;
  appRemove(rel: string): Promise<void>;

  /** Native folder picker; null when dismissed. */
  pickFolder(): Promise<string | null>;
}
