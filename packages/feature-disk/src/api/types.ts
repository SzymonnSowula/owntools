/**
 * disk — the shapes that cross IPC. Mirrors `src-tauri/src/disk/*.rs`
 * (serde `camelCase`); the demo backend produces the same shapes in the
 * browser so the whole UI runs under `pnpm dev`.
 */

/** Category ids are stable: they go into snapshots. Index = the Rust constant. */
export const CATEGORY_LABELS = [
  "Other",
  "Video",
  "Audio",
  "Image",
  "Document",
  "Developer",
  "Archive",
  "App & system",
] as const;

export const CAT_OTHER = 0;
export const CAT_VIDEO = 1;
export const CAT_AUDIO = 2;
export const CAT_IMAGE = 3;
export const CAT_DOCUMENT = 4;
export const CAT_DEVELOPER = 5;
export const CAT_ARCHIVE = 6;
export const CAT_APP = 7;
export const CATS = CATEGORY_LABELS.length;

export type NodeKind = "file" | "dir" | "link";

export interface NodeInfo {
  id: number;
  parent: number | null;
  name: string;
  path: string;
  kind: NodeKind;
  size: number;
  alloc: number;
  /** Unix seconds; a very negative number means unknown. */
  mtime: number;
  ctime: number;
  files: number;
  dirs: number;
  cat: number;
  error: boolean;
  hidden: boolean;
  depth: number;
  children: number;
  newest: number;
}

/** Pruned subtree for the visual views. Short keys: there can be 40k of these. */
export interface TreeNode {
  id: number;
  n: string;
  s: number;
  a: number;
  /** 0 file · 1 dir · 2 link */
  k: 0 | 1 | 2;
  c: number;
  m: number;
  f: number;
  d: number;
  e: boolean;
  ch?: TreeNode[];
  r?: { n: number; s: number };
}

export interface VolumeInfo {
  path: string;
  label: string;
  fs: string;
  kind: "fixed" | "removable" | "remote" | "cdrom" | "ramdisk" | "unknown";
  total: number;
  free: number;
  system: boolean;
  cluster: number;
}

export interface ScanSummary {
  scanId: number;
  root: string;
  name: string;
  size: number;
  alloc: number;
  files: number;
  dirs: number;
  errors: number;
  scannedAt: number;
  elapsedMs: number;
  source: "scan" | "snapshot";
  nodeCount: number;
  volume: VolumeInfo | null;
}

export interface ScanProgress {
  scanId: number;
  root: string;
  files: number;
  dirs: number;
  bytes: number;
  current: string;
  elapsedMs: number;
}

export interface ScanDone {
  scanId: number;
  ok: boolean;
  cancelled: boolean;
  error: string | null;
  summary: ScanSummary | null;
}

export interface RecentRoot {
  path: string;
  label: string;
  at: string;
  size: number;
}

export interface ChildrenPage {
  items: NodeInfo[];
  total: number;
}

export interface Breakdown {
  bytes: number[];
  count: number[];
}

export interface QuickWin {
  id: string;
  label: string;
  hint: string;
  bytes: number;
  count: number;
  caution: boolean;
  items: NodeInfo[];
}

export interface TrashOutcome {
  removed: number[];
  freed: number;
  failed: { id: number; path: string; error: string }[];
}

/** How far the Recycle Bin move has got; `path` is empty on the final tick. */
export interface TrashProgress {
  done: number;
  total: number;
  path: string;
}

export interface DupeGroup {
  hash: string;
  size: number;
  /** Oldest first. */
  files: NodeInfo[];
  more: number;
}

export interface DupesProgress {
  phase: "collect" | "prefix" | "full" | "done";
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface DupesResult {
  rootId: number;
  minBytes: number;
  scannedFiles: number;
  candidateFiles: number;
  groupCount: number;
  extraCopies: number;
  wasted: number;
  groups: DupeGroup[];
  cancelled: boolean;
}

export interface DupesDone {
  ok: boolean;
  error: string | null;
  result: DupesResult | null;
}

export interface AppInfo {
  id: string;
  name: string;
  version: string;
  publisher: string;
  installed: string | null;
  location: string | null;
  estimatedBytes: number;
  scannedBytes: number | null;
  nodeId: number | null;
  uninstall: string | null;
  scope: "machine" | "user";
}

export interface MonitorSample {
  t: number;
  free: number[];
}

export interface MonitorData {
  volumes: VolumeInfo[];
  samples: MonitorSample[];
  intervalS: number;
}

export interface SnapshotMeta {
  id: string;
  name: string;
  root: string;
  created: string;
  size: number;
  alloc: number;
  files: number;
  dirs: number;
  fileBytes: number;
}

export interface DiffEntry {
  path: string;
  name: string;
  kind: "dir" | "file";
  before: number;
  after: number;
  delta: number;
  depth: number;
  state: "grew" | "shrank" | "new" | "gone";
}

export interface SnapshotDiff {
  before: SnapshotMeta;
  after: SnapshotMeta;
  delta: number;
  entries: DiffEntry[];
  truncated: boolean;
}

export interface SubtreeQuery {
  depth: number;
  minBytes: number;
  maxChildren: number;
  budget: number;
}

export interface TopFilesQuery {
  cat?: number;
  minBytes?: number;
  modifiedAfter?: number;
  limit?: number;
}

export function isDir(n: NodeInfo | null | undefined): boolean {
  return n?.kind === "dir";
}
