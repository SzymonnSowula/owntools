import { create } from "zustand";
import { confirmDialog } from "@ui/Dialog";
import { backend } from "./api";
import type {
  Breakdown,
  NodeInfo,
  QuickWin,
  RecentRoot,
  ScanProgress,
  ScanSummary,
  TrashOutcome,
  VolumeInfo,
} from "./api/types";
import type { ColorMode } from "./lib/colors";
import { formatBytes } from "./lib/format";

/**
 * disk — UI state. The tree itself lives in the backend; this store keeps
 * what the user is looking at (root, selection, view, colouring, depth),
 * the scan lifecycle, the sidebar data and the cleanup basket. Components
 * fetch tree slices through `hooks.ts`, keyed on `dataVersion`, which bumps
 * whenever the tree changes (a scan, a cleanup, an opened snapshot).
 */

export type Tab = "explore" | "dupes" | "apps" | "monitor" | "snapshots";
export type ViewKind = "treemap" | "sunburst" | "bars" | "list" | "files";
export type CenterMode =
  | { kind: "tree" }
  | { kind: "quickwin"; id: string }
  | { kind: "category"; cat: number }
  | { kind: "search"; query: string };

interface Prefs {
  view: ViewKind;
  colorMode: ColorMode;
  depth: number;
  inspectorOpen: boolean;
}

const PREFS_KEY = "shipshape-disk-prefs";

function loadPrefs(): Prefs {
  const base: Prefs = { view: "treemap", colorMode: "folder", depth: 7, inspectorOpen: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      view: (["treemap", "sunburst", "bars", "list", "files"] as ViewKind[]).includes(p.view as ViewKind) ? (p.view as ViewKind) : base.view,
      colorMode: (["type", "folder", "age"] as ColorMode[]).includes(p.colorMode as ColorMode) ? (p.colorMode as ColorMode) : base.colorMode,
      depth: typeof p.depth === "number" ? Math.min(12, Math.max(1, Math.round(p.depth))) : base.depth,
      inspectorOpen: p.inspectorOpen ?? base.inspectorOpen,
    };
  } catch {
    return base;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

export interface Notice {
  text: string;
  kind: "ok" | "error";
}

export interface DiskStore extends Prefs {
  tab: Tab;
  volumes: VolumeInfo[];
  recent: RecentRoot[];
  home: string | null;
  summary: ScanSummary | null;
  scanning: boolean;
  progress: ScanProgress | null;
  scanError: string | null;
  activeScanId: number | null;
  dataVersion: number;
  currentId: number;
  selectedId: number | null;
  filter: string;
  center: CenterMode;
  cleanup: NodeInfo[];
  quickWins: QuickWin[] | null;
  breakdown: Breakdown | null;
  notice: Notice | null;

  init(): Promise<void>;
  setTab(tab: Tab): void;
  scan(root: string): Promise<void>;
  scanHome(): Promise<void>;
  scanFolder(): Promise<void>;
  cancelScan(): Promise<void>;
  drill(id: number): void;
  goUp(): Promise<void>;
  select(id: number | null): void;
  setView(view: ViewKind): void;
  setColorMode(mode: ColorMode): void;
  setDepth(depth: number): void;
  setFilter(filter: string): void;
  setCenter(center: CenterMode): void;
  toggleInspector(): void;
  addToCleanup(items: NodeInfo[]): void;
  removeFromCleanup(id: number): void;
  toggleCleanup(item: NodeInfo): void;
  clearCleanup(): void;
  runCleanup(): Promise<void>;
  trashNow(items: NodeInfo[], what?: string): Promise<TrashOutcome | null>;
  refreshSidebar(): Promise<void>;
  notify(text: string, kind?: Notice["kind"]): void;
  reveal(path: string): void;
  open(path: string): void;
  copyPath(path: string): void;
}

let subscribed = false;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export const useDiskStore = create<DiskStore>((set, get) => ({
  ...loadPrefs(),
  tab: "explore",
  volumes: [],
  recent: [],
  home: null,
  summary: null,
  scanning: false,
  progress: null,
  scanError: null,
  activeScanId: null,
  dataVersion: 0,
  currentId: 0,
  selectedId: null,
  filter: "",
  center: { kind: "tree" },
  cleanup: [],
  quickWins: null,
  breakdown: null,
  notice: null,

  async init() {
    const api = backend();
    if (!subscribed) {
      subscribed = true;
      api.onScanProgress((p) => {
        const { activeScanId } = get();
        if (activeScanId !== null && p.scanId !== activeScanId) return;
        set({ progress: p, scanning: true });
      });
      api.onScanDone((d) => {
        const { activeScanId } = get();
        if (activeScanId !== null && d.scanId !== activeScanId && !d.summary) return;
        if (!d.ok || !d.summary) {
          set({
            scanning: false,
            progress: null,
            activeScanId: null,
            scanError: d.cancelled ? null : (d.error ?? "scan failed"),
          });
          if (d.cancelled) get().notify("Scan cancelled");
          return;
        }
        set((s) => ({
          scanning: false,
          progress: null,
          activeScanId: null,
          scanError: null,
          summary: d.summary,
          currentId: 0,
          selectedId: null,
          center: { kind: "tree" },
          filter: "",
          cleanup: [],
          quickWins: null,
          breakdown: null,
          dataVersion: s.dataVersion + 1,
        }));
        void get().refreshSidebar();
      });
    }
    const [volumes, recent, home, summary] = await Promise.all([
      api.volumes().catch(() => [] as VolumeInfo[]),
      api.recent().catch(() => [] as RecentRoot[]),
      api.home().catch(() => null),
      api.summary().catch(() => null),
    ]);
    set({ volumes, recent, home });
    if (summary && !get().summary) {
      set((s) => ({ summary, currentId: 0, selectedId: null, dataVersion: s.dataVersion + 1 }));
      void get().refreshSidebar();
    }
  },

  setTab(tab) {
    set({ tab });
  },

  async scan(root) {
    const api = backend();
    set({ scanning: true, progress: null, scanError: null, center: { kind: "tree" }, filter: "" });
    try {
      const id = await api.scanStart(root);
      set({ activeScanId: id });
    } catch (err) {
      set({ scanning: false, scanError: String(err instanceof Error ? err.message : err) });
    }
  },

  async scanHome() {
    const home = get().home ?? (await backend().home().catch(() => null));
    if (!home) {
      get().notify("Could not find your home folder", "error");
      return;
    }
    await get().scan(home);
  },

  async scanFolder() {
    const picked = await backend().pickFolder().catch(() => null);
    if (picked) await get().scan(picked);
  },

  async cancelScan() {
    await backend().scanCancel().catch(() => undefined);
    set({ scanning: false, progress: null, activeScanId: null });
  },

  drill(id) {
    set({ currentId: id, selectedId: null, center: { kind: "tree" } });
  },

  async goUp() {
    const { currentId } = get();
    if (currentId === 0) return;
    const node = await backend().node(currentId).catch(() => null);
    set({ currentId: node?.parent ?? 0, selectedId: currentId, center: { kind: "tree" } });
  },

  select(id) {
    set({ selectedId: id });
  },

  setView(view) {
    set({ view });
    const { colorMode, depth, inspectorOpen } = get();
    savePrefs({ view, colorMode, depth, inspectorOpen });
  },
  setColorMode(colorMode) {
    set({ colorMode });
    const { view, depth, inspectorOpen } = get();
    savePrefs({ view, colorMode, depth, inspectorOpen });
  },
  setDepth(depth) {
    const d = Math.min(12, Math.max(1, Math.round(depth)));
    set({ depth: d });
    const { view, colorMode, inspectorOpen } = get();
    savePrefs({ view, colorMode, depth: d, inspectorOpen });
  },
  setFilter(filter) {
    set({ filter });
    const trimmed = filter.trim();
    const { center } = get();
    if (trimmed.length >= 2) set({ center: { kind: "search", query: trimmed } });
    else if (center.kind === "search") set({ center: { kind: "tree" } });
  },
  setCenter(center) {
    set({ center });
    if (center.kind !== "search" && get().filter) set({ filter: "" });
  },
  toggleInspector() {
    const inspectorOpen = !get().inspectorOpen;
    set({ inspectorOpen });
    const { view, colorMode, depth } = get();
    savePrefs({ view, colorMode, depth, inspectorOpen });
  },

  addToCleanup(items) {
    set((s) => {
      const have = new Set(s.cleanup.map((c) => c.id));
      const next = items.filter((i) => !have.has(i.id));
      return next.length ? { cleanup: [...s.cleanup, ...next] } : {};
    });
  },
  removeFromCleanup(id) {
    set((s) => ({ cleanup: s.cleanup.filter((c) => c.id !== id) }));
  },
  toggleCleanup(item) {
    const has = get().cleanup.some((c) => c.id === item.id);
    if (has) get().removeFromCleanup(item.id);
    else get().addToCleanup([item]);
  },
  clearCleanup() {
    set({ cleanup: [] });
  },

  async runCleanup() {
    const items = get().cleanup;
    if (!items.length) return;
    const outcome = await get().trashNow(items, "the cleanup list");
    if (outcome) set((s) => ({ cleanup: s.cleanup.filter((c) => !outcome.removed.includes(c.id)) }));
  },

  async trashNow(items, what) {
    if (!items.length) return null;
    const total = items.reduce((a, i) => a + i.size, 0);
    const ok = await confirmDialog({
      kind: "danger",
      title: "Move to the Recycle Bin?",
      message: `${items.length} item${items.length === 1 ? "" : "s"} · ${formatBytes(total)}${what ? ` from ${what}` : ""}. They go to the Recycle Bin, not away for good — you can restore them from there.`,
      okLabel: "Move to Recycle Bin",
    });
    if (!ok) return null;
    try {
      const outcome = await backend().trash(items.map((i) => i.id));
      const removed = new Set(outcome.removed);
      set((s) => ({
        dataVersion: s.dataVersion + 1,
        selectedId: s.selectedId !== null && removed.has(s.selectedId) ? null : s.selectedId,
        cleanup: s.cleanup.filter((c) => !removed.has(c.id)),
        summary: s.summary ? { ...s.summary, size: Math.max(0, s.summary.size - outcome.freed) } : s.summary,
      }));
      if (outcome.failed.length) {
        get().notify(
          `${outcome.removed.length} moved to the Recycle Bin, ${outcome.failed.length} failed (${outcome.failed[0].error})`,
          "error",
        );
      } else {
        get().notify(`${outcome.removed.length} item${outcome.removed.length === 1 ? "" : "s"} moved to the Recycle Bin · ${formatBytes(outcome.freed)} freed`);
      }
      void get().refreshSidebar();
      return outcome;
    } catch (err) {
      get().notify(`Could not clean up: ${err instanceof Error ? err.message : String(err)}`, "error");
      return null;
    }
  },

  async refreshSidebar() {
    const api = backend();
    const [quickWins, breakdown, recent, volumes] = await Promise.all([
      api.quickWins().catch(() => null),
      api.breakdown(0).catch(() => null),
      api.recent().catch(() => get().recent),
      api.volumes().catch(() => get().volumes),
    ]);
    set({ quickWins, breakdown, recent, volumes });
  },

  notify(text, kind = "ok") {
    set({ notice: { text, kind } });
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => set({ notice: null }), kind === "error" ? 7000 : 4000);
  },

  reveal(path) {
    void backend()
      .reveal(path)
      .catch((err) => get().notify(`Could not open Explorer: ${err instanceof Error ? err.message : String(err)}`, "error"));
  },
  open(path) {
    void backend()
      .open(path)
      .catch((err) => get().notify(`Could not open: ${err instanceof Error ? err.message : String(err)}`, "error"));
  },
  copyPath(path) {
    void navigator.clipboard
      ?.writeText(path)
      .then(() => get().notify("Path copied"))
      .catch(() => get().notify("Could not copy", "error"));
  },
}));
