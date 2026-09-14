import { TsArena, type Entry } from "../lib/arena";
import { buildDemoSpec } from "../lib/demoTree";
import { diffTrees } from "../lib/diff";
import { baseName, formatBytes } from "../lib/format";
import { eligibleFiles } from "../lib/protect";
import type { DiskBackend } from "./backend";
import type {
  AppInfo,
  BinUse,
  DupeGroup,
  DupesDone,
  DupesProgress,
  DupesResult,
  MonitorSample,
  NodeInfo,
  Protection,
  RecentRoot,
  ScanDone,
  ScanProgress,
  ScanSummary,
  SnapshotMeta,
  TrashFailure,
  TrashProgress,
  VolumeInfo,
} from "./types";

/**
 * The browser stand-in for the Rust backend: a generated user profile,
 * a scan that "takes" a couple of seconds with live progress, duplicates
 * from the planted content keys, a static list of apps, a free-space
 * random walk and in-memory snapshots. Same contract as `tauri.ts`, so the
 * UI is exercised end to end under `pnpm dev`.
 */

const GB = 1024 ** 3;
const DEMO_ROOT = "C:\\Users\\demo";

type Listener<T> = (payload: T) => void;

class Emitter<T> {
  private set = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(payload: T): void {
    for (const cb of Array.from(this.set)) cb(payload);
  }
}

const volumes: VolumeInfo[] = [
  { path: "C:\\", label: "Windows", fs: "NTFS", kind: "fixed", total: 245 * GB, free: 22 * GB, system: true, cluster: 4096 },
  { path: "D:\\", label: "Data", fs: "NTFS", kind: "fixed", total: 931 * GB, free: 412 * GB, system: false, cluster: 4096 },
  { path: "E:\\", label: "USB", fs: "exFAT", kind: "removable", total: 64 * GB, free: 51 * GB, system: false, cluster: 131072 },
];

const APPS: AppInfo[] = [
  ["Cursor", "1.6.2", "Anysphere", "2026-08-29", "C:\\Users\\demo\\AppData\\Local\\Programs\\cursor", 0.62],
  ["Docker Desktop", "4.43.1", "Docker Inc.", "2026-06-14", "C:\\Program Files\\Docker\\Docker", 2.9],
  ["Visual Studio Code", "1.104.0", "Microsoft Corporation", "2026-09-01", "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code", 0.41],
  ["Python 3.12.6 (64-bit)", "3.12.6", "Python Software Foundation", "2026-04-20", "C:\\Users\\demo\\AppData\\Local\\Programs\\Python\\Python312", 0.15],
  ["Ollama", "0.11.4", "Ollama", "2026-08-17", "C:\\Users\\demo\\AppData\\Local\\Programs\\Ollama", 1.9],
  ["Google Chrome", "140.0.7339.80", "Google LLC", "2026-09-03", "C:\\Program Files\\Google\\Chrome\\Application", 0.52],
  ["Microsoft Edge", "140.0.3485.54", "Microsoft Corporation", "2026-09-02", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application", 0.61],
  ["Node.js", "22.19.0", "Node.js Foundation", "2026-08-07", "C:\\Program Files\\nodejs", 0.09],
  ["Rustup", "1.28.2", "The Rust Project Developers", "2025-11-12", null, 0.01],
  ["OBS Studio", "31.0.0", "OBS Project", "2026-07-09", "C:\\Program Files\\obs-studio", 0.43],
  ["Adobe Creative Cloud", "6.4.0", "Adobe Inc.", "2025-10-03", "C:\\Program Files\\Adobe\\Adobe Creative Cloud", 1.3],
  ["Adobe Premiere Pro 2025", "25.2", "Adobe Inc.", "2025-10-03", "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025", 5.7],
  ["Figma", "125.3.5", "Figma, Inc.", "2026-08-26", "C:\\Users\\demo\\AppData\\Local\\Figma", 0.28],
  ["Notion", "4.19.0", "Notion Labs, Inc.", "2026-08-20", "C:\\Users\\demo\\AppData\\Local\\Programs\\Notion", 0.31],
  ["Slack", "4.45.64", "Slack Technologies", "2026-08-11", "C:\\Users\\demo\\AppData\\Local\\slack", 0.22],
  ["Discord", "1.0.9195", "Discord Inc.", "2026-07-30", "C:\\Users\\demo\\AppData\\Local\\Discord", 0.19],
  ["Spotify", "1.2.68", "Spotify AB", "2026-08-15", "C:\\Users\\demo\\AppData\\Roaming\\Spotify", 0.36],
  ["Zoom Workplace", "6.5.7", "Zoom Video Communications", "2026-07-01", "C:\\Users\\demo\\AppData\\Roaming\\Zoom\\bin", 0.35],
  ["Steam", "3.7.2", "Valve Corporation", "2025-12-24", "C:\\Program Files (x86)\\Steam", 41.2],
  ["Unity Hub", "3.13.0", "Unity Technologies", "2026-02-14", "C:\\Program Files\\Unity Hub", 0.5],
  ["Android Studio", "2025.1.3", "Google LLC", "2026-05-21", "C:\\Program Files\\Android\\Android Studio", 3.4],
  ["Windows Terminal", "1.23.1", "Microsoft Corporation", "2026-08-30", null, 0.08],
  ["7-Zip 24.09 (x64)", "24.09", "Igor Pavlov", "2025-03-15", "C:\\Program Files\\7-Zip", 0.006],
  ["Git", "2.51.0", "The Git Development Community", "2026-08-12", "C:\\Program Files\\Git", 0.39],
  ["NVIDIA Graphics Driver 581.29", "581.29", "NVIDIA Corporation", "2026-09-04", null, 1.2],
  ["Postman", "11.58.2", "Postman, Inc.", "2026-08-05", "C:\\Users\\demo\\AppData\\Local\\Postman", 0.47],
].map(([name, version, publisher, installed, location, gb], i) => ({
  id: `demo:${i}`,
  name: name as string,
  version: version as string,
  publisher: publisher as string,
  installed: installed as string,
  location: location as string | null,
  estimatedBytes: Math.round((gb as number) * GB),
  scannedBytes: null,
  nodeId: null,
  uninstall: i % 5 === 3 ? null : `msiexec /x{DEMO-${i}}`,
  scope: i % 4 === 0 ? "user" : "machine",
}));

interface Snap {
  meta: SnapshotMeta;
  tree: Entry;
}

const normPath = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
const within = (inner: string, outer: string) => inner === outer || inner.startsWith(`${outer}\\`);

/** `bin.rs` in miniature: Windows' default bin size, 10 % of the first 40 GiB + 5 % of the rest. */
function defaultBinCapacity(total: number): number {
  return Math.floor(Math.min(total, 40 * GB) / 10 + Math.max(0, total - 40 * GB) / 20);
}

/** What a cleanup of `ids` would put in each demo drive's Recycle Bin (C: already holds 1.2 GB). */
function binsFor(a: TsArena, ids: number[]): BinUse[] {
  const byRoot = new Map<string, { items: number; adding: number }>();
  for (const id of ids) {
    if (!a.nodes[id] || a.removed(id)) continue;
    const root = `${a.pathOf(id).slice(0, 2).toUpperCase()}\\`;
    const entry = byRoot.get(root) ?? { items: 0, adding: 0 };
    entry.items += 1;
    entry.adding += a.nodes[id].size;
    byRoot.set(root, entry);
  }
  return Array.from(byRoot, ([root, { items, adding }]) => {
    const volume = volumes.find((v) => v.path.toLowerCase() === root.toLowerCase());
    const hasBin = volume?.kind === "fixed";
    const capacity = hasBin && volume ? defaultBinCapacity(volume.total) : 0;
    const used = hasBin && root === "C:\\" ? 1.2 * GB : 0;
    return {
      root,
      hasBin,
      reason: hasBin ? null : `${root} is a ${volume?.kind ?? "network"} drive, which has no Recycle Bin`,
      capacity,
      used,
      adding,
      items,
      evicts: hasBin ? Math.min(used, Math.max(0, used + adding - capacity)) : 0,
    };
  });
}

/** `installed.rs` in miniature: the demo apps' folders, in either direction. */
function protectionsFor(a: TsArena, ids: number[]): Protection[] {
  const out: Protection[] = [];
  for (const id of ids) {
    if (!a.nodes[id] || a.removed(id)) continue;
    const path = a.pathOf(id);
    const item = normPath(path);
    const apps = APPS.filter((app) => app.location && (within(normPath(app.location), item) || within(item, normPath(app.location)))).map((app) => ({ id: app.id, name: app.name }));
    if (apps.length) out.push({ id, path, apps, services: [] });
  }
  return out;
}

export function createDemoBackend(): DiskBackend {
  let arena: TsArena | null = null;
  let scanId = 0;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let dupesCancelled = false;
  let dupesResult: DupesResult | null = null;
  const recent: RecentRoot[] = [];
  const snapshots = new Map<string, Snap>();
  const monitor: MonitorSample[] = [];
  let monitorTimer: ReturnType<typeof setInterval> | null = null;
  const progress = new Emitter<ScanProgress>();
  const done = new Emitter<ScanDone>();
  const dupesProgress = new Emitter<DupesProgress>();
  const dupesDone = new Emitter<DupesDone>();
  const trashProgress = new Emitter<TrashProgress>();

  const summaryOf = (a: TsArena, id: number): ScanSummary => {
    const root = a.nodes[0];
    return {
      scanId: id,
      root: a.root,
      name: baseName(a.root),
      size: root.size,
      alloc: root.alloc,
      files: root.files,
      dirs: root.dirs,
      errors: a.errors,
      scannedAt: a.scannedAt,
      elapsedMs: a.elapsedMs,
      source: a.source,
      nodeCount: a.length,
      volume: volumes.find((v) => a.root.toLowerCase().startsWith(v.path.toLowerCase())) ?? null,
    };
  };

  const need = (): TsArena => {
    if (!arena) throw new Error("nothing scanned yet");
    return arena;
  };

  const rememberRecent = (root: string, size: number) => {
    const i = recent.findIndex((r) => r.path.toLowerCase() === root.toLowerCase());
    if (i >= 0) recent.splice(i, 1);
    recent.unshift({ path: root, label: baseName(root), at: new Date().toISOString(), size });
    recent.splice(8);
  };

  const buildFor = (root: string): TsArena => {
    const spec = buildDemoSpec({ seed: root.length * 31 + 7 });
    const a = TsArena.fromSpec(root, spec);
    a.elapsedMs = 1840;
    return a;
  };

  const api: DiskBackend = {
    volumes: async () => volumes.map((v) => ({ ...v })),
    home: async () => DEMO_ROOT,
    recent: async () => recent.map((r) => ({ ...r })),
    pickFolder: async () => "C:\\Users\\demo\\Projects",

    scanStart: async (root) => {
      if (scanTimer) clearTimeout(scanTimer);
      scanId += 1;
      const id = scanId;
      const target = root.trim() || DEMO_ROOT;
      const built = buildFor(target);
      const total = built.nodes[0];
      const started = Date.now();
      const paths = [
        "AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache",
        "AppData\\Local\\Temp",
        "AppData\\Roaming\\Code\\CachedData",
        "Downloads",
        "Projects\\owntools\\node_modules",
        "Projects\\owntools\\target\\debug\\deps",
        "Pictures\\Camera Roll",
        "Videos\\Captures",
        ".cargo\\registry\\src",
        ".ollama\\models\\blobs",
      ];
      const steps = 18;
      let step = 0;
      const tick = () => {
        if (id !== scanId) return;
        step += 1;
        const t = Math.min(1, step / steps);
        const eased = 1 - (1 - t) ** 2;
        progress.emit({
          scanId: id,
          root: target,
          files: Math.round(total.files * eased),
          dirs: Math.round(total.dirs * eased),
          bytes: Math.round(total.size * eased),
          current: `${target}\\${paths[step % paths.length]}`,
          elapsedMs: Date.now() - started,
        });
        if (step < steps) {
          scanTimer = setTimeout(tick, 90 + Math.random() * 60);
          return;
        }
        arena = built;
        arena.elapsedMs = Date.now() - started;
        arena.scannedAt = Math.floor(Date.now() / 1000);
        dupesResult = null;
        rememberRecent(target, total.size);
        done.emit({ scanId: id, ok: true, cancelled: false, error: null, summary: summaryOf(arena, id) });
      };
      scanTimer = setTimeout(tick, 120);
      return id;
    },
    scanCancel: async () => {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = null;
      const id = scanId;
      scanId += 1;
      done.emit({ scanId: id, ok: false, cancelled: true, error: null, summary: null });
    },
    summary: async () => (arena ? summaryOf(arena, scanId) : null),

    node: async (id) => need().info(id),
    children: async (id, limit) => need().childrenInfo(id, limit ?? 2000),
    subtree: async (id, q) => need().subtree(id, q.depth, q.minBytes, q.maxChildren, q.budget),
    find: async (path) => need().findPath(path),
    search: async (query, limit) => need().search(query, limit ?? 200),
    topFiles: async (id, q) => need().topFiles(id, q),
    breakdown: async (id) => need().breakdown(id),
    quickWins: async () => need().quickWins(),

    reveal: async () => {},
    open: async () => {},
    trash: async (ids, options) => {
      const a = need();
      const elevated = options?.elevated ?? false;
      const removed: number[] = [];
      let freed = 0;
      const failed: TrashFailure[] = [];
      const skipped = protectionsFor(a, ids);
      const guarded = new Set(skipped.map((p) => p.id));
      // The Recycle Bin guard, as in bin.rs: no bin, or more than the bin holds, and nothing on that drive moves.
      const refusedBy = new Map<string, string>();
      for (const bin of binsFor(a, ids.filter((id) => !guarded.has(id)))) {
        if (!bin.hasBin) refusedBy.set(bin.root, `${bin.reason} — it would be deleted for good, so it was left alone`);
        else if (bin.adding > bin.capacity)
          refusedBy.set(bin.root, `${formatBytes(bin.adding)} together is more than the Recycle Bin on ${bin.root} holds (${formatBytes(bin.capacity)}); Windows would erase part of it for good. Move less at a time`);
      }
      const movable = ids.filter((id) => {
        if (guarded.has(id)) return false;
        const why = a.nodes[id] ? refusedBy.get(`${a.pathOf(id).slice(0, 2).toUpperCase()}\\`) : undefined;
        if (why) failed.push({ id, path: a.pathOf(id), error: why, needsAdmin: false });
        return !why;
      });
      // The real shell move takes seconds per folder; pace the demo so the
      // progress row is exercised here too.
      let step = 0;
      for (const id of movable) {
        const n = a.nodes[id];
        const path = n ? a.pathOf(id) : "";
        trashProgress.emit({ done: step++, total: movable.length, path });
        await new Promise((r) => setTimeout(r, 120));
        if (!n || a.removed(id)) continue;
        if (n.name === "NTUSER.DAT") {
          failed.push({ id, path, error: "a file in it is open in another program", needsAdmin: false });
          continue;
        }
        // Stand-in for a folder Windows protects: it moves once permission is given.
        if (!elevated && normPath(path).includes("\\appdata\\local\\packages\\")) {
          failed.push({ id, path, error: "Windows protects it: needs administrator permission", needsAdmin: true });
          continue;
        }
        freed += n.size;
        a.remove(id);
        removed.push(id);
      }
      trashProgress.emit({ done: movable.length, total: movable.length, path: "" });
      dupesResult = null;
      return { removed, freed, failed, skipped };
    },
    cleanupCheck: async (ids) => {
      const a = need();
      const protections = protectionsFor(a, ids);
      const guarded = new Set(protections.map((p) => p.id));
      return { protections, bins: binsFor(a, ids.filter((id) => !guarded.has(id))) };
    },

    dupesStart: async (rootId, minBytes) => {
      const a = need();
      dupesCancelled = false;
      // The rules of protect.rs: apps, tool & package folders, code projects and programs are left out.
      const { ids: eligible, leftOut } = eligibleFiles(a, rootId, minBytes);
      const bySize = new Map<string, number[]>();
      const scanned = eligible.length;
      for (const id of eligible) {
        const n = a.nodes[id];
        const key = `${n.size}:${n.content ?? `u${id}`}`;
        (bySize.get(key) ?? bySize.set(key, []).get(key)!).push(id);
      }
      const candidates = Array.from(bySize.values()).filter((ids) => ids.length > 1);
      const total = candidates.reduce((s, ids) => s + ids.length, 0);
      const bytesTotal = candidates.reduce((s, ids) => s + a.nodes[ids[0]].size * ids.length, 0);
      const finish = (phase: DupesProgress["phase"], done: number, bytesDone: number) =>
        dupesProgress.emit({ phase, done, total, bytesDone, bytesTotal });
      finish("collect", 0, 0);
      let step = 0;
      const steps = 14;
      const tick = () => {
        if (dupesCancelled) {
          dupesDone.emit({ ok: true, error: null, result: { rootId, minBytes, scannedFiles: scanned, candidateFiles: total, groupCount: 0, extraCopies: 0, wasted: 0, groups: [], leftOut, cancelled: true } });
          return;
        }
        step += 1;
        const t = step / steps;
        finish(t < 0.4 ? "prefix" : "full", Math.round(total * t), Math.round(bytesTotal * t));
        if (step < steps) {
          setTimeout(tick, 110);
          return;
        }
        const groups: DupeGroup[] = candidates
          .map((ids) => {
            const files = ids.map((i) => a.info(i)!).sort((x, y) => x.mtime - y.mtime || x.id - y.id) as NodeInfo[];
            return { hash: `demo${ids[0]}`, size: files[0].size, files, more: 0 };
          })
          .sort((x, y) => y.size * (y.files.length - 1) - x.size * (x.files.length - 1));
        const wasted = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
        dupesResult = {
          rootId,
          minBytes,
          scannedFiles: scanned,
          candidateFiles: total,
          groupCount: groups.length,
          extraCopies: groups.reduce((s, g) => s + g.files.length - 1, 0),
          wasted,
          groups,
          leftOut,
          cancelled: false,
        };
        dupesDone.emit({ ok: true, error: null, result: dupesResult });
      };
      setTimeout(tick, 150);
    },
    dupesCancel: async () => {
      dupesCancelled = true;
    },
    dupesResult: async () => dupesResult,
    dupesTrash: async (ids, options) => {
      const a = need();
      const result = dupesResult;
      if (!result) throw new Error("look for duplicates again first");
      const wanted = new Set(ids);
      const claimed = new Set<number>();
      const refused: TrashFailure[] = [];
      const movable: number[] = [];
      const touched = result.groups.filter((g) => g.files.some((f) => wanted.has(f.id)));
      const total = ids.length + touched.length;
      let done = 0;
      for (const g of touched) {
        const ticked = g.files.filter((f) => wanted.has(f.id));
        ticked.forEach((f) => claimed.add(f.id));
        // The real check reads each ticked copy and a copy that stays; pace it like that.
        done += ticked.length + 1;
        dupesProgress.emit({ phase: "check", done, total, bytesDone: 0, bytesTotal: 0 });
        await new Promise((r) => setTimeout(r, 90));
        const stays = g.files.some((f) => !wanted.has(f.id) && !a.removed(f.id)) || g.more > 0;
        for (const f of ticked) {
          if (!stays) refused.push({ id: f.id, path: f.path, error: "every copy of this file was ticked — one copy always stays", needsAdmin: false });
          else if (a.removed(f.id)) refused.push({ id: f.id, path: f.path, error: "already gone", needsAdmin: false });
          else movable.push(f.id);
        }
      }
      for (const id of ids) {
        if (!claimed.has(id)) refused.push({ id, path: a.nodes[id] ? a.pathOf(id) : "", error: "not on the duplicates list any more — look for duplicates again", needsAdmin: false });
      }
      const outcome = await api.trash(movable, options);
      // trash() drops the whole search; the duplicates page keeps it, minus what moved.
      dupesResult = forgetMoved(result, new Set(outcome.removed));
      return { ...outcome, failed: [...outcome.failed, ...refused] };
    },

    apps: async () => {
      const a = arena;
      return APPS.map((app) => {
        const id = a && app.location ? a.findPath(app.location) : null;
        const node = id !== null && a ? a.nodes[id] : null;
        return { ...app, scannedBytes: node && node.flags & 1 ? node.size : null, nodeId: node && node.flags & 1 ? id : null };
      });
    },
    appUninstall: async () => {},
    openAppsSettings: async () => {},

    monitorStart: async () => {
      if (monitorTimer) return;
      const now = Math.floor(Date.now() / 1000);
      // Two hours of history, sampled every 20 s: a slow decline with a cleanup halfway.
      for (let i = 360; i >= 0; i--) {
        const t = now - i * 20;
        const drift = (360 - i) * 0.004 * GB;
        const cleanup = i < 180 ? 9.5 * GB : 0;
        monitor.push({ t, free: volumes.map((v, vi) => (vi === 0 ? v.free - 8 * GB + cleanup - drift + Math.sin(i / 9) * 0.3 * GB : v.free - vi * drift * 0.2)) });
      }
      volumes[0].free = monitor[monitor.length - 1].free[0];
      monitorTimer = setInterval(() => {
        const last = monitor[monitor.length - 1];
        const next = { t: Math.floor(Date.now() / 1000), free: last.free.map((f, i) => f - (i === 0 ? 0.02 * GB : 0.001 * GB) + (Math.random() - 0.5) * 0.15 * GB) };
        monitor.push(next);
        if (monitor.length > 4320) monitor.shift();
        volumes[0].free = next.free[0];
      }, 20_000);
    },
    monitorRead: async () => ({ volumes: volumes.map((v) => ({ ...v })), samples: monitor.map((s) => ({ ...s })), intervalS: 20 }),

    snapshotSave: async (name) => {
      const a = need();
      const id = `snap_${Math.random().toString(16).slice(2, 10)}`;
      const meta: SnapshotMeta = {
        id,
        name: name?.trim() || `${baseName(a.root)} · ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
        root: a.root,
        created: new Date().toISOString(),
        size: a.nodes[0].size,
        alloc: a.nodes[0].alloc,
        files: a.nodes[0].files,
        dirs: a.nodes[0].dirs,
        fileBytes: Math.round(a.length * 22),
      };
      snapshots.set(id, { meta, tree: a.toEntry() });
      return meta;
    },
    snapshotList: async () => Array.from(snapshots.values()).map((s) => s.meta).sort((x, y) => y.created.localeCompare(x.created)),
    snapshotDelete: async (id) => {
      snapshots.delete(id);
    },
    snapshotDiff: async (id, against) => {
      const before = snapshots.get(id);
      if (!before) throw new Error("snapshot missing");
      let after: Snap;
      if (against) {
        const other = snapshots.get(against);
        if (!other) throw new Error("snapshot missing");
        after = other;
      } else {
        const a = need();
        after = {
          meta: { id: "current", name: "current scan", root: a.root, created: new Date().toISOString(), size: a.nodes[0].size, alloc: a.nodes[0].alloc, files: a.nodes[0].files, dirs: a.nodes[0].dirs, fileBytes: 0 },
          tree: a.toEntry(),
        };
      }
      if (before.meta.root.toLowerCase() !== after.meta.root.toLowerCase()) throw new Error(`different roots: ${before.meta.root} vs ${after.meta.root}`);
      const { entries, truncated } = diffTrees(before.tree, after.tree);
      return { before: before.meta, after: after.meta, delta: after.meta.size - before.meta.size, entries, truncated };
    },
    snapshotOpen: async (id) => {
      const snap = snapshots.get(id);
      if (!snap) throw new Error("snapshot missing");
      arena = TsArena.fromEntry(snap.meta.root, snap.tree);
      arena.scannedAt = Math.floor(Date.parse(snap.meta.created) / 1000);
      scanId += 1;
      dupesResult = null;
      const summary = summaryOf(arena, scanId);
      done.emit({ scanId, ok: true, cancelled: false, error: null, summary });
      return summary;
    },

    onTrashProgress: (cb) => trashProgress.on(cb),
    onScanProgress: (cb) => progress.on(cb),
    onScanDone: (cb) => done.on(cb),
    onDupesProgress: (cb) => dupesProgress.on(cb),
    onDupesDone: (cb) => dupesDone.on(cb),
  };
  return api;
}

/** A search minus the copies that moved; groups left with one copy go. */
function forgetMoved(result: DupesResult, gone: Set<number>): DupesResult {
  const groups = result.groups
    .map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.id)) }))
    .filter((g) => g.files.length + g.more > 1);
  const extra = (g: DupeGroup) => g.files.length + g.more - 1;
  return {
    ...result,
    groups,
    groupCount: groups.length,
    extraCopies: groups.reduce((s, g) => s + extra(g), 0),
    wasted: groups.reduce((s, g) => s + g.size * extra(g), 0),
  };
}
