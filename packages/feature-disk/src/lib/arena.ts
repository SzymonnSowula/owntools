import {
  CAT_APP,
  CAT_ARCHIVE,
  CAT_AUDIO,
  CAT_DEVELOPER,
  CAT_DOCUMENT,
  CAT_IMAGE,
  CAT_OTHER,
  CAT_VIDEO,
  CATS,
  type Breakdown,
  type NodeInfo,
  type QuickWin,
  type TopFilesQuery,
  type TreeNode,
} from "../api/types";
import { extOf } from "./format";

/**
 * A TypeScript twin of `src-tauri/src/disk/arena.rs`: the same flat layout
 * (children contiguous, parents first) and the same queries. It exists for
 * the demo backend — the browser preview and `pnpm dev` — and for unit tests
 * of the query semantics the UI relies on. The app itself asks Rust.
 */

export const F_DIR = 1;
export const F_LINK = 2;
export const F_ERROR = 4;
export const F_HIDDEN = 8;
export const F_REMOVED = 32;
export const NONE = -1;

export interface TsNode {
  name: string;
  parent: number;
  firstChild: number;
  childCount: number;
  size: number;
  alloc: number;
  mtime: number;
  ctime: number;
  files: number;
  dirs: number;
  flags: number;
  cat: number;
  /** Directories only: per-category bytes / counts and the newest mtime inside. */
  catBytes: number[] | null;
  catCount: number[] | null;
  newest: number;
  /** Demo only: files with the same content key are byte-identical. */
  content?: number;
}

/** Nested description the generator produces; `TsArena.fromSpec` flattens it. */
export interface Spec {
  name: string;
  kids?: Spec[];
  size?: number;
  mtime?: number;
  ctime?: number;
  content?: number;
  error?: boolean;
  hidden?: boolean;
}

const EXT_CATEGORY: Record<string, number> = {};
for (const [cat, exts] of [
  [CAT_VIDEO, "mp4 mkv mov avi webm m4v wmv flv mpg mpeg m2ts mts 3gp"],
  [CAT_AUDIO, "mp3 wav flac m4a aac ogg opus wma aiff alac"],
  [CAT_IMAGE, "jpg jpeg png gif webp heic heif bmp tif tiff svg raw cr2 nef arw dng psd ai ico avif"],
  [CAT_DOCUMENT, "pdf doc docx xls xlsx ppt pptx txt md rtf odt csv epub pages numbers key tex log srt vtt"],
  [
    CAT_DEVELOPER,
    "js mjs cjs ts tsx jsx json map rs go py pyc java class jar kt c cc cpp h hpp cs rb php swift html htm css scss less vue svelte wasm o obj a lib pdb rlib rmeta d lock toml yaml yml xml ini cfg sh ps1 bat cmd sql db sqlite proto node tgz whl nupkg crate pem csproj sln gradle pack idx safetensors pt parquet onnx bin",
  ],
  [CAT_ARCHIVE, "zip rar 7z tar gz bz2 xz zst cab iso img dmg vhd vhdx vmdk vdi qcow2 ova wim esd bak"],
  [CAT_APP, "exe msi msix appx dll sys drv ocx cpl scr com app pkg apk ipa deb rpm efi dylib so lnk ttf otf woff woff2"],
] as [number, string][]) {
  for (const e of exts.split(" ")) EXT_CATEGORY[e] = cat;
}
// `bin` reads as archive in Rust; keep the TS twin in line.
EXT_CATEGORY.bin = CAT_ARCHIVE;

export function categoryOfName(name: string): number {
  const ext = extOf(name);
  return ext ? (EXT_CATEGORY[ext] ?? CAT_OTHER) : CAT_OTHER;
}

const isWin = () => typeof navigator !== "undefined" && /win/i.test(navigator.platform ?? "");

function sep(root: string): string {
  return root.includes("\\") || /^[a-z]:/i.test(root) ? "\\" : "/";
}

export class TsArena {
  root: string;
  nodes: TsNode[] = [];
  source: "scan" | "snapshot" = "scan";
  scannedAt = Math.floor(Date.now() / 1000);
  elapsedMs = 0;
  errors = 0;

  constructor(root: string) {
    this.root = root;
  }

  /** Flattens a spec breadth-first, so every child index is above its parent's. */
  static fromSpec(root: string, spec: Spec): TsArena {
    const a = new TsArena(root);
    const mk = (s: Spec, parent: number): TsNode => {
      const dir = s.kids !== undefined;
      return {
        name: s.name,
        parent,
        firstChild: 0,
        childCount: 0,
        size: dir ? 0 : (s.size ?? 0),
        alloc: dir ? 0 : Math.ceil((s.size ?? 0) / 4096) * 4096,
        mtime: s.mtime ?? 0,
        ctime: s.ctime ?? s.mtime ?? 0,
        files: 0,
        dirs: 0,
        flags: (dir ? F_DIR : 0) | (s.error ? F_ERROR : 0) | (s.hidden ? F_HIDDEN : 0),
        cat: dir ? 0 : categoryOfName(s.name),
        catBytes: dir ? new Array(CATS).fill(0) : null,
        catCount: dir ? new Array(CATS).fill(0) : null,
        newest: -1e15,
        content: s.content,
      };
    };
    a.nodes.push({ ...mk({ ...spec, kids: spec.kids ?? [] }, NONE), name: root });
    const queue: [Spec, number][] = [[spec, 0]];
    while (queue.length) {
      const [s, id] = queue.shift()!;
      const kids = s.kids ?? [];
      const start = a.nodes.length;
      for (const k of kids) {
        const cid = a.nodes.length;
        a.nodes.push(mk(k, id));
        if (k.kids !== undefined) queue.push([k, cid]);
      }
      a.nodes[id].firstChild = start;
      a.nodes[id].childCount = kids.length;
      if (s.error) a.errors += 1;
    }
    a.aggregate();
    return a;
  }

  get length(): number {
    return this.nodes.length;
  }

  isDir(id: number): boolean {
    return (this.nodes[id]?.flags & F_DIR) !== 0;
  }

  removed(id: number): boolean {
    return (this.nodes[id]?.flags & F_REMOVED) !== 0;
  }

  *children(id: number): Generator<number> {
    const n = this.nodes[id];
    if (!n) return;
    for (let i = n.firstChild; i < n.firstChild + n.childCount; i++) {
      if (!this.removed(i)) yield i;
    }
  }

  childIds(id: number): number[] {
    return Array.from(this.children(id));
  }

  depthOf(id: number): number {
    let d = 0;
    let cur = id;
    while (this.nodes[cur] && this.nodes[cur].parent !== NONE) {
      cur = this.nodes[cur].parent;
      d += 1;
    }
    return d;
  }

  pathOf(id: number): string {
    const parts: string[] = [];
    let cur = id;
    while (this.nodes[cur] && this.nodes[cur].parent !== NONE) {
      parts.push(this.nodes[cur].name);
      cur = this.nodes[cur].parent;
    }
    parts.reverse();
    const s = sep(this.root);
    const base = this.root.replace(/[\\/]+$/, "");
    return parts.length ? `${base}${s}${parts.join(s)}` : this.root;
  }

  findPath(path: string): number | null {
    const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\//g, "\\");
    const root = norm(this.root);
    const target = norm(path);
    const eq = (a: string, b: string) => (isWin() || /^[a-z]:/i.test(root) ? a.toLowerCase() === b.toLowerCase() : a === b);
    if (!eq(target.slice(0, root.length), root)) return null;
    const rest = target.slice(root.length).replace(/^\\+/, "");
    if (!rest) return 0;
    let cur = 0;
    for (const comp of rest.split("\\")) {
      if (!comp) continue;
      let next: number | null = null;
      for (const c of this.children(cur)) {
        if (eq(this.nodes[c].name, comp)) {
          next = c;
          break;
        }
      }
      if (next === null) return null;
      cur = next;
    }
    return cur;
  }

  aggregate(): void {
    for (const n of this.nodes) {
      if (n.flags & F_DIR) {
        n.size = 0;
        n.alloc = 0;
        n.files = 0;
        n.dirs = 0;
        n.catBytes = new Array(CATS).fill(0);
        n.catCount = new Array(CATS).fill(0);
        n.newest = -1e15;
      } else {
        n.newest = n.mtime;
      }
    }
    for (let i = this.nodes.length - 1; i >= 1; i--) {
      const n = this.nodes[i];
      if (n.flags & F_REMOVED || n.parent === NONE) continue;
      const p = this.nodes[n.parent];
      p.size += n.size;
      p.alloc += n.alloc;
      if (n.flags & F_DIR) {
        p.dirs += 1 + n.dirs;
        p.files += n.files;
        for (let c = 0; c < CATS; c++) {
          p.catBytes![c] += n.catBytes![c];
          p.catCount![c] += n.catCount![c];
        }
      } else {
        p.files += 1;
        p.catBytes![n.cat] += n.size;
        p.catCount![n.cat] += 1;
      }
      if (n.newest > p.newest) p.newest = n.newest;
    }
    for (const n of this.nodes) {
      if (n.flags & F_DIR) {
        let best = 0;
        for (let c = 0; c < CATS; c++) if (n.catBytes![c] > n.catBytes![best]) best = c;
        n.cat = best;
      }
    }
  }

  info(id: number): NodeInfo | null {
    const n = this.nodes[id];
    if (!n) return null;
    return {
      id,
      parent: n.parent === NONE ? null : n.parent,
      name: n.name,
      path: this.pathOf(id),
      kind: n.flags & F_DIR ? "dir" : n.flags & F_LINK ? "link" : "file",
      size: n.size,
      alloc: n.alloc,
      mtime: n.mtime,
      ctime: n.ctime,
      files: n.files,
      dirs: n.dirs,
      cat: n.cat,
      error: (n.flags & F_ERROR) !== 0,
      hidden: (n.flags & F_HIDDEN) !== 0,
      depth: this.depthOf(id),
      children: this.childIds(id).length,
      newest: n.newest,
    };
  }

  childrenInfo(id: number, limit = 2000): { items: NodeInfo[]; total: number } {
    const ids = this.childIds(id);
    ids.sort((a, b) => this.nodes[b].size - this.nodes[a].size || this.nodes[a].name.localeCompare(this.nodes[b].name));
    return { items: ids.slice(0, limit).map((i) => this.info(i)!), total: ids.length };
  }

  subtree(id: number, depth: number, minBytes: number, maxChildren: number, budget: number): TreeNode | null {
    let used = 0;
    const build = (cur: number, d: number): TreeNode | null => {
      const n = this.nodes[cur];
      if (!n) return null;
      used += 1;
      const out: TreeNode = {
        id: cur,
        n: n.name,
        s: n.size,
        a: n.alloc,
        k: n.flags & F_DIR ? 1 : n.flags & F_LINK ? 2 : 0,
        c: n.cat,
        m: n.mtime,
        f: n.files,
        d: n.dirs,
        e: (n.flags & F_ERROR) !== 0,
      };
      if (d === 0 || !(n.flags & F_DIR) || n.childCount === 0 || used >= budget) return out;
      const ids = this.childIds(cur).sort((a, b) => this.nodes[b].size - this.nodes[a].size);
      const ch: TreeNode[] = [];
      let restN = 0;
      let restS = 0;
      ids.forEach((cid, i) => {
        const child = this.nodes[cid];
        if (i >= maxChildren || child.size < minBytes || used >= budget) {
          restN += 1;
          restS += child.size;
          return;
        }
        const t = build(cid, d - 1);
        if (t) ch.push(t);
      });
      if (ch.length) out.ch = ch;
      if (restN > 0) out.r = { n: restN, s: restS };
      return out;
    };
    return build(id, depth);
  }

  walk(id: number, f: (id: number, node: TsNode) => boolean): void {
    const stack = this.childIds(id);
    while (stack.length) {
      const cur = stack.pop()!;
      const n = this.nodes[cur];
      if (n.flags & F_REMOVED) continue;
      if (f(cur, n) && n.flags & F_DIR) stack.push(...this.children(cur));
    }
  }

  topFiles(id: number, q: TopFilesQuery): NodeInfo[] {
    const limit = q.limit ?? 200;
    const hits: [number, number][] = [];
    this.walk(id, (i, n) => {
      if (n.flags & F_DIR) return true;
      if (n.flags & F_LINK) return false;
      if (n.size < (q.minBytes ?? 0)) return false;
      if (q.cat !== undefined && n.cat !== q.cat) return false;
      if (q.modifiedAfter !== undefined && n.mtime < q.modifiedAfter) return false;
      hits.push([n.size, i]);
      return false;
    });
    hits.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    return hits.slice(0, limit).map(([, i]) => this.info(i)!);
  }

  search(query: string, limit = 200): NodeInfo[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: [number, number][] = [];
    for (let i = 1; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.flags & F_REMOVED) continue;
      if (n.name.toLowerCase().includes(q)) hits.push([n.size, i]);
    }
    hits.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    return hits.slice(0, limit).map(([, i]) => this.info(i)!);
  }

  breakdown(id: number): Breakdown {
    const n = this.nodes[id];
    const bytes = new Array(CATS).fill(0);
    const count = new Array(CATS).fill(0);
    if (!n) return { bytes, count };
    if (n.flags & F_DIR) return { bytes: n.catBytes!.slice(), count: n.catCount!.slice() };
    bytes[n.cat] = n.size;
    count[n.cat] = 1;
    return { bytes, count };
  }

  remove(id: number): void {
    const n = this.nodes[id];
    if (!n || n.flags & F_REMOVED) return;
    n.flags |= F_REMOVED;
    const isDir = (n.flags & F_DIR) !== 0;
    let p = n.parent;
    while (p !== NONE) {
      const pn = this.nodes[p];
      pn.size = Math.max(0, pn.size - n.size);
      pn.alloc = Math.max(0, pn.alloc - n.alloc);
      if (isDir) {
        pn.dirs = Math.max(0, pn.dirs - 1 - n.dirs);
        pn.files = Math.max(0, pn.files - n.files);
        for (let c = 0; c < CATS; c++) {
          pn.catBytes![c] = Math.max(0, pn.catBytes![c] - n.catBytes![c]);
          pn.catCount![c] = Math.max(0, pn.catCount![c] - n.catCount![c]);
        }
      } else {
        pn.files = Math.max(0, pn.files - 1);
        pn.catBytes![n.cat] = Math.max(0, pn.catBytes![n.cat] - n.size);
        pn.catCount![n.cat] = Math.max(0, pn.catCount![n.cat] - 1);
      }
      p = pn.parent;
    }
  }

  /** The snapshot entry tree: folders + files ≥ 1 MiB (see snapshot.rs). */
  toEntry(id = 0): Entry {
    const n = this.nodes[id];
    const dir = (n.flags & F_DIR) !== 0;
    let kids: Entry[] | null = null;
    if (dir) {
      kids = this.childIds(id)
        .filter((c) => this.nodes[c].flags & F_DIR || this.nodes[c].size >= 1024 * 1024)
        .map((c) => this.toEntry(c))
        .sort((a, b) => b[2] - a[2]);
    }
    return [id === 0 ? "" : n.name, dir ? 1 : 0, n.size, n.alloc, n.files, n.dirs, n.mtime, kids];
  }

  /** Rebuilds a browsable arena from an entry tree (folded files become one synthetic child). */
  static fromEntry(root: string, tree: Entry): TsArena {
    const toSpec = (e: Entry): Spec => {
      if (e[1] !== 1) return { name: e[0], size: e[2], mtime: e[6] };
      const kids = (e[7] ?? []).map(toSpec);
      const keptSize = (e[7] ?? []).reduce((a, k) => a + k[2], 0);
      const keptFiles = (e[7] ?? []).reduce((a, k) => a + (k[1] === 1 ? k[4] : 1), 0);
      const folded = e[4] - keptFiles;
      if (folded > 0 && e[2] - keptSize > 0) kids.push({ name: `(${folded} smaller files)`, size: e[2] - keptSize, mtime: e[6] });
      return { name: e[0], kids, mtime: e[6] };
    };
    const a = TsArena.fromSpec(root, toSpec(tree));
    a.source = "snapshot";
    return a;
  }

  /** The quick-win rules the demo can show (a subset of quickwins.rs, same ids). */
  quickWins(): QuickWin[] {
    const MB = 1024 * 1024;
    const rules: Record<string, { label: string; hint: string; caution: boolean; ids: [number, number][]; bytes: number; count: number }> = {};
    const bucket = (id: string, label: string, hint: string, caution = false) =>
      (rules[id] ??= { label, hint, caution, ids: [], bytes: 0, count: 0 });
    const add = (b: ReturnType<typeof bucket>, id: number) => {
      const n = this.nodes[id];
      b.ids.push([n.size, id]);
      b.bytes += n.size;
      b.count += 1;
    };
    const cacheNames = new Set(["cache", "caches", ".cache", "code cache", "gpucache", "cachestorage", "cacheddata", "temp", "tmp", "logs", "crashdumps", "inetcache", "dawncache", "shadercache"]);
    const buildNames = new Set([".next", ".turbo", "__pycache__", "dist", "build", "target", ".nuxt", ".parcel-cache", "storybook-static", "coverage"]);
    const stack: [number, boolean][] = this.childIds(0).map((c) => [c, false]);
    while (stack.length) {
      const [id, inDownloads] = stack.pop()!;
      const n = this.nodes[id];
      if (n.flags & F_REMOVED) continue;
      const name = n.name.toLowerCase();
      const parentName = n.parent > 0 ? this.nodes[n.parent].name.toLowerCase() : "";
      if (n.flags & F_DIR) {
        if (name === "downloads" && !inDownloads) {
          const b = bucket("downloads", "Downloads", "Everything in your Downloads folders");
          b.bytes += n.size;
          b.count += n.childCount;
          for (const c of this.children(id)) b.ids.push([this.nodes[c].size, c]);
          stack.push(...this.childIds(id).map((c): [number, boolean] => [c, true]));
          continue;
        }
        let hit: ReturnType<typeof bucket> | null = null;
        if (name === "node_modules") hit = bucket("node_modules", "node_modules", "Dependencies of projects; `npm install` brings them back");
        else if (name === "_cacache" || name === "npm-cache" || name === ".npm" || name === "ms-playwright" || (name === "registry" && parentName === ".cargo") || (name === "cache" && parentName === "pip") || (name === "huggingface" && parentName === ".cache"))
          hit = bucket("packages", "Package caches", "npm, pip, cargo, Playwright stores — re-downloaded on demand");
        else if (cacheNames.has(name)) hit = bucket("caches", "Caches & logs", "App caches, temp folders, logs and crash dumps — apps rebuild these");
        else if (name === "avd" && parentName === ".android") hit = bucket("emulators", "Emulators & simulators", "Android system images and AVDs", true);
        else if (buildNames.has(name) && parentName !== "node_modules") {
          const siblings = n.parent >= 0 ? this.childIds(n.parent).map((c) => this.nodes[c].name.toLowerCase()) : [];
          const marker = ["package.json", "cargo.toml", "pyproject.toml", "tsconfig.json"].some((m) => siblings.includes(m));
          if (marker || [".next", ".turbo", "__pycache__"].includes(name) || (name === "target" && this.childIds(id).some((c) => ["debug", "release"].includes(this.nodes[c].name.toLowerCase()))))
            hit = bucket("build", "Build artifacts", "target, dist, build, .next, __pycache__ and friends — rebuilt by the next build", true);
        }
        if (hit) {
          if (n.size > 0) add(hit, id);
          continue;
        }
        stack.push(...this.childIds(id).map((c): [number, boolean] => [c, inDownloads]));
        continue;
      }
      const ext = extOf(name);
      if ((n.cat === CAT_VIDEO || n.cat === CAT_AUDIO) && n.size >= 100 * MB) add(bucket("media", "Large media", "Video and audio files over 100 MB", true), id);
      if (["vhd", "vhdx", "vmdk", "vdi", "qcow2", "ova"].includes(ext) && n.size >= 100 * MB) add(bucket("vm", "Disk images & VMs", "Virtual disks over 100 MB — WSL and Docker live here too", true), id);
      if (inDownloads && ["exe", "msi", "msix", "dmg", "pkg", "iso"].includes(ext) && n.size >= 5 * MB) add(bucket("installers", "Installers", "Setup files, disk images and ISOs sitting in Downloads"), id);
      if (["log", "dmp", "etl", "tmp"].includes(ext) && n.size >= MB) add(bucket("caches", "Caches & logs", "App caches, temp folders, logs and crash dumps — apps rebuild these"), id);
    }
    return Object.entries(rules)
      .filter(([, b]) => b.count > 0 && b.bytes > 0)
      .map(([id, b]) => ({
        id,
        label: b.label,
        hint: b.hint,
        bytes: b.bytes,
        count: b.count,
        caution: b.caution,
        items: b.ids
          .sort((x, y) => y[0] - x[0])
          .slice(0, 80)
          .map(([, i]) => this.info(i)!),
      }))
      .sort((a, b) => b.bytes - a.bytes);
  }
}

/** `[name, kind, size, alloc, files, dirs, mtime, children]` — the snapshot entry. */
export type Entry = [string, 0 | 1, number, number, number, number, number, Entry[] | null];
