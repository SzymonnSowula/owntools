import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DiskBackend } from "./backend";
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
  TopFilesQuery,
  TrashOutcome,
  TrashProgress,
  TreeNode,
  VolumeInfo,
} from "./types";

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

export const tauriBackend: DiskBackend = {
  volumes: () => invoke<VolumeInfo[]>("disk_volumes"),
  home: () => invoke<string | null>("disk_home"),
  recent: () => invoke<RecentRoot[]>("disk_recent"),
  pickFolder: async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder to scan" });
    return typeof picked === "string" ? picked : null;
  },

  scanStart: (root) => invoke<number>("disk_scan_start", { root }),
  scanCancel: () => invoke("disk_scan_cancel"),
  summary: () => invoke<ScanSummary | null>("disk_summary"),

  node: (id) => invoke<NodeInfo | null>("disk_node", { id }),
  children: (id, limit) => invoke<ChildrenPage>("disk_children", { id, limit }),
  subtree: (id, q) =>
    invoke<TreeNode | null>("disk_subtree", {
      id,
      depth: q.depth,
      minBytes: q.minBytes,
      maxChildren: q.maxChildren,
      budget: q.budget,
    }),
  find: (path) => invoke<number | null>("disk_find", { path }),
  search: (query, limit) => invoke<NodeInfo[]>("disk_search", { query, limit }),
  topFiles: (id, q: TopFilesQuery) =>
    invoke<NodeInfo[]>("disk_top_files", {
      id,
      cat: q.cat,
      minBytes: q.minBytes,
      modifiedAfter: q.modifiedAfter,
      limit: q.limit,
    }),
  breakdown: (id) => invoke<Breakdown>("disk_breakdown", { id }),
  quickWins: () => invoke<QuickWin[]>("disk_quick_wins"),

  reveal: (path) => invoke("disk_reveal", { path }),
  open: (path) => invoke("disk_open", { path }),
  trash: (ids) => invoke<TrashOutcome>("disk_trash", { ids }),

  dupesStart: (rootId, minBytes) => invoke("disk_dupes_start", { rootId, minBytes }),
  dupesCancel: () => invoke("disk_dupes_cancel"),
  dupesResult: () => invoke<DupesResult | null>("disk_dupes_result"),

  apps: (refresh) => invoke<AppInfo[]>("disk_apps", { refresh }),
  appUninstall: (id) => invoke("disk_app_uninstall", { id }),
  openAppsSettings: () => invoke("disk_open_apps_settings"),

  monitorStart: () => invoke("disk_monitor_start"),
  monitorRead: () => invoke<MonitorData>("disk_monitor_read"),

  snapshotSave: (name) => invoke<SnapshotMeta>("disk_snapshot_save", { name }),
  snapshotList: () => invoke<SnapshotMeta[]>("disk_snapshot_list"),
  snapshotDelete: (id) => invoke("disk_snapshot_delete", { id }),
  snapshotDiff: (id, against) => invoke<SnapshotDiff>("disk_snapshot_diff", { id, against }),
  snapshotOpen: (id) => invoke<ScanSummary>("disk_snapshot_open", { id }),

  onTrashProgress: (cb) => subscribe<TrashProgress>("disk-trash-progress", cb),
  onScanProgress: (cb) => subscribe<ScanProgress>("disk-scan-progress", cb),
  onScanDone: (cb) => subscribe<ScanDone>("disk-scan-done", cb),
  onDupesProgress: (cb) => subscribe<DupesProgress>("disk-dupes-progress", cb),
  onDupesDone: (cb) => subscribe<DupesDone>("disk-dupes-done", cb),
};
