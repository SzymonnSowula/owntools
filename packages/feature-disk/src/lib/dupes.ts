import type { DupeGroup, LeftOut, NodeInfo } from "../api/types";
import { formatCount } from "./format";

/**
 * Duplicates — the page's decisions, kept pure so they can be tested: which
 * copy of a group stays, what is ticked by default, that the last copy can
 * never be ticked, and how to say what the search left out. What is *safe to
 * compare at all* is decided in Rust (`src-tauri/src/disk/protect.rs`); what
 * finally leaves is checked there again, right before it moves.
 */

export type Keep = "best" | "oldest" | "newest";

/** Folders a second copy usually lands in by accident. */
const STRAY_FOLDERS = new Set(["downloads", "desktop", "temp", "tmp"]);

/** `photo (1).jpg`, `DSC_0412 (copy).jpg`, `report - Copy.docx`, `IMG_2041 copy 2.heic`, `umowa - kopia.pdf`. */
const COPY_NAME = /(?:\((?:\d+|copy|kopia|kopie|copie|copia)(?:\s*\d+)?\)|[\s_-](?:copy|kopia|kopie|copie|copia)(?:\s*\d+)?)\s*(?:\.[^.]+)?$/i;

/** How likely a copy is the accidental one: named like a copy (2), sitting in Downloads, Desktop or a temp folder (1). */
export function strayScore(file: Pick<NodeInfo, "name" | "path">): number {
  const folders = file.path.split(/[\\/]+/).slice(0, -1).map((part) => part.toLowerCase());
  return (COPY_NAME.test(file.name) ? 2 : 0) + (folders.some((f) => STRAY_FOLDERS.has(f)) ? 1 : 0);
}

/**
 * The copy that stays. "best" keeps the one that looks deliberately placed —
 * not named like a copy, not in Downloads or on the Desktop — because that is
 * the one a project, a library or a shortcut is likeliest to point at; the
 * oldest breaks a tie.
 */
export function keeper(files: NodeInfo[], keep: Keep): NodeInfo | undefined {
  return files.slice().sort((a, b) => {
    if (keep === "best") {
      const stray = strayScore(a) - strayScore(b);
      if (stray) return stray;
    }
    const age = keep === "newest" ? b.mtime - a.mtime : a.mtime - b.mtime;
    return age || a.id - b.id;
  })[0];
}

/** Every listed copy except the one that stays. Copies past the list (`more`) are never ticked. */
export function defaultPicks(groups: DupeGroup[], keep: Keep): Set<number> {
  const picks = new Set<number>();
  for (const group of groups) {
    const stays = keeper(group.files, keep);
    for (const file of group.files) if (file.id !== stays?.id) picks.add(file.id);
  }
  return picks;
}

/** A copy can be ticked only while another copy of the file stays: listed and unticked, or past the list. */
export function canTick(group: DupeGroup, picked: ReadonlySet<number>, id: number): boolean {
  return picked.has(id) || group.more > 0 || group.files.some((f) => f.id !== id && !picked.has(f.id));
}

const LEFT_OUT: { key: keyof LeftOut; one: string; many: string }[] = [
  { key: "apps", one: "in Windows & installed apps", many: "in Windows & installed apps" },
  { key: "tools", one: "in hidden, tool & package folders", many: "in hidden, tool & package folders" },
  { key: "projects", one: "in code projects", many: "in code projects" },
  { key: "programs", one: "program or library", many: "programs & libraries" },
  { key: "links", one: "hard link", many: "hard links" },
  { key: "cloud", one: "online-only file", many: "online-only files" },
  { key: "changed", one: "changed since the scan", many: "changed since the scan" },
];

/** "8,412 in Windows & installed apps", "1 hard link" … — only the reasons that left something out. */
export function leftOutParts(left: LeftOut | null | undefined): { key: keyof LeftOut; count: number; text: string }[] {
  if (!left) return [];
  return LEFT_OUT.filter(({ key }) => (left[key] ?? 0) > 0).map(({ key, one, many }) => ({
    key,
    count: left[key],
    text: `${formatCount(left[key])} ${left[key] === 1 ? one : many}`,
  }));
}
