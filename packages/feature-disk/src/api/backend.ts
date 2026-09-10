import type {
  AppInfo,
  Breakdown,
  ChildrenPage,
  DupesDone,
  DupesProgress,
  DupesResult,
  MonitorData,
  NodeInfo,
  QuickWin,
  RecentRoot,
  ScanDone,
  ScanProgress,
  ScanSummary,
  SnapshotDiff,
  SnapshotMeta,
  SubtreeQuery,
  TopFilesQuery,
  TrashOutcome,
  TrashProgress,
  TreeNode,
  VolumeInfo,
} from "./types";

/**
 * Everything the disk tool asks of the machine. One implementation talks to
 * the Rust commands (`tauri.ts`); the other (`demo.ts`) answers from a
 * generated tree so the browser preview and `pnpm dev` show a real-looking
 * disk. The UI never knows which one it got.
 */
export interface DiskBackend {
  volumes(): Promise<VolumeInfo[]>;
  home(): Promise<string | null>;
  recent(): Promise<RecentRoot[]>;
  pickFolder(): Promise<string | null>;

  scanStart(root: string): Promise<number>;
  scanCancel(): Promise<void>;
  summary(): Promise<ScanSummary | null>;

  node(id: number): Promise<NodeInfo | null>;
  children(id: number, limit?: number): Promise<ChildrenPage>;
  subtree(id: number, query: SubtreeQuery): Promise<TreeNode | null>;
  find(path: string): Promise<number | null>;
  search(query: string, limit?: number): Promise<NodeInfo[]>;
  topFiles(id: number, query: TopFilesQuery): Promise<NodeInfo[]>;
  breakdown(id: number): Promise<Breakdown>;
  quickWins(): Promise<QuickWin[]>;

  reveal(path: string): Promise<void>;
  open(path: string): Promise<void>;
  trash(ids: number[]): Promise<TrashOutcome>;

  dupesStart(rootId: number, minBytes: number): Promise<void>;
  dupesCancel(): Promise<void>;
  dupesResult(): Promise<DupesResult | null>;

  apps(refresh?: boolean): Promise<AppInfo[]>;
  appUninstall(id: string): Promise<void>;
  openAppsSettings(): Promise<void>;

  monitorStart(): Promise<void>;
  monitorRead(): Promise<MonitorData>;

  snapshotSave(name?: string): Promise<SnapshotMeta>;
  snapshotList(): Promise<SnapshotMeta[]>;
  snapshotDelete(id: string): Promise<void>;
  snapshotDiff(id: string, against?: string): Promise<SnapshotDiff>;
  snapshotOpen(id: string): Promise<ScanSummary>;

  onTrashProgress(cb: (p: TrashProgress) => void): () => void;
  onScanProgress(cb: (p: ScanProgress) => void): () => void;
  onScanDone(cb: (d: ScanDone) => void): () => void;
  onDupesProgress(cb: (p: DupesProgress) => void): () => void;
  onDupesDone(cb: (d: DupesDone) => void): () => void;
}
