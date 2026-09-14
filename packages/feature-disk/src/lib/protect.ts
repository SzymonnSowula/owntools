import type { LeftOut } from "../api/types";
import { F_DIR, F_HIDDEN, F_LINK, NONE, type TsArena } from "./arena";

/**
 * The demo's copy of `src-tauri/src/disk/protect.rs`: which files the
 * duplicate finder leaves out, and why. The app asks Rust; the browser
 * preview and `pnpm dev` walk the generated tree with this, so the page shows
 * the same "left out" line there. Keep the lists in step with the Rust ones.
 */

export type Why = "apps" | "tools" | "projects" | "programs";

const APP_FOLDERS = new Set([
  "appdata", "program files", "program files (x86)", "windowsapps", "$recycle.bin", "system volume information",
  "steamapps", "steamlibrary", "epic games", "gog games", "xboxgames", "origin games", "ea games", "riot games",
  "ubisoft game launcher", "battle.net", "rockstar games",
]);
const APP_BUNDLES = [".app", ".framework", ".bundle", ".plugin", ".kext", ".appex", ".photoslibrary", ".photolibrary", ".fcpbundle", ".imovielibrary", ".musiclibrary", ".tvlibrary", ".logicx", ".lrdata", ".band"];
const DEPENDENCY_FOLDERS = new Set(["node_modules", "bower_components", "jspm_packages", "site-packages", "dist-packages", "__pycache__"]);
const PROGRAM_EXTS = new Set(["exe", "dll", "sys", "drv", "ocx", "cpl", "scr", "mui", "efi", "winmd", "node", "pyd", "so", "dylib", "vhd", "vhdx", "avhd", "avhdx", "vmdk", "vdi", "qcow2", "hdd"]);

export function folderRule(name: string): Why | null {
  const n = name.toLowerCase();
  if (APP_FOLDERS.has(n) || APP_BUNDLES.some((s) => n.length > s.length && n.endsWith(s))) return "apps";
  if ((n.length > 1 && n.startsWith(".")) || DEPENDENCY_FOLDERS.has(n)) return "tools";
  return null;
}

export function fileRule(name: string, hidden: boolean, parent: string): Why | null {
  if (hidden) return "tools";
  const n = name.toLowerCase();
  const dot = n.lastIndexOf(".");
  const ext = dot > 0 ? n.slice(dot + 1) : "";
  if (!PROGRAM_EXTS.has(ext)) return null;
  if (ext === "exe" && (n.includes("setup") || n.includes("install") || parent.toLowerCase() === "downloads")) return null;
  return "programs";
}

export function emptyLeftOut(): LeftOut {
  return { apps: 0, tools: 0, projects: 0, programs: 0, links: 0, cloud: 0, changed: 0 };
}

/** The files under `rootId` (≥ `minBytes`) that take part, and the rest counted by reason — `collect_candidates` in Rust. */
export function eligibleFiles(a: TsArena, rootId: number, minBytes: number): { ids: number[]; leftOut: LeftOut } {
  const leftOut = emptyLeftOut();
  const ids: number[] = [];
  const stack: [number, Why | null][] = a.childIds(rootId).map((c) => [c, null]);
  while (stack.length) {
    const [id, inherited] = stack.pop()!;
    const n = a.nodes[id];
    if (a.removed(id) || n.flags & F_LINK) continue;
    if (n.flags & F_DIR) {
      let why = inherited ?? folderRule(n.name) ?? (n.flags & F_HIDDEN ? "tools" : null);
      if (!why) {
        const kids = a.childIds(id).map((c) => a.nodes[c].name.toLowerCase());
        if (kids.includes(".git")) why = "projects";
        else if (kids.includes("pyvenv.cfg")) why = "tools";
      }
      for (const c of a.children(id)) stack.push([c, why]);
      continue;
    }
    if (n.size < Math.max(1, minBytes)) continue;
    const why = inherited ?? fileRule(n.name, (n.flags & F_HIDDEN) !== 0, n.parent === NONE ? "" : a.nodes[n.parent].name);
    if (why) leftOut[why] += 1;
    else ids.push(id);
  }
  return { ids, leftOut };
}
