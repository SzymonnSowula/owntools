/**
 * What the engine needs from the world, in one interface: `tauri.ts` answers
 * with Rust commands and plugin-fs, `demo.ts` with memory so the card works
 * under `pnpm dev` and in the browser preview. Pick one through `api.ts`.
 */

import type { Rule, RunRecord } from "./rules";

export interface WatchFolder {
  ruleId: string;
  folder: string;
  /** Lower-case, no dot; empty = any file. */
  extensions: string[];
}

export interface FileAdded {
  ruleId: string;
  path: string;
  size: number;
}

export interface FolderEntry {
  name: string;
  path: string;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
}

export interface RecordingInfo {
  title: string;
  durationMs: number;
  /** Absolute path of the screen recording, when it is on disk. */
  path?: string;
}

export interface AutomationsBackend {
  loadRules(): Promise<Rule[]>;
  saveRules(rules: Rule[]): Promise<void>;
  loadRuns(): Promise<RunRecord[]>;
  saveRuns(runs: RunRecord[]): Promise<void>;

  /** Replaces the set of watched folders. */
  watchSet(folders: WatchFolder[]): Promise<void>;
  onFileAdded(cb: (event: FileAdded) => void): () => void;
  /** screeni's `recording-finished { projectId }` (Tauri only; a no-op elsewhere). */
  onRecordingFinished(cb: (projectId: string) => void): () => void;
  recordingInfo(projectId: string): Promise<RecordingInfo | null>;

  /** Native folder picker; `null` when cancelled. The folder is allowlisted for writes. */
  pickFolder(title: string): Promise<string | null>;
  allowFolder(folder: string): Promise<void>;
  /** Writes into an allowlisted folder; never overwrites (" (2)" when the name exists). */
  writeText(folder: string, name: string, text: string): Promise<{ path: string; name: string }>;
  /** Copies a file from anywhere into `<AppData>/automations/tmp/` so plugin-fs can read it. */
  importFile(path: string): Promise<{ path: string; size: number }>;
  removeTemp(path: string): Promise<void>;
  listFolder(folder: string): Promise<FolderEntry[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** Absolute AppData folder, to tell a file plugin-fs may read from one it may not. */
  appDataDir(): Promise<string>;
  revealPath(path: string): Promise<void>;
}
