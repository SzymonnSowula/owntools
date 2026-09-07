import type { DiffEntry } from "../api/types";
import type { Entry } from "./arena";

/**
 * Port of `snapshot.rs diff_trees`: per-folder deltas between two entry
 * trees. A name is listed when its change is at least the threshold (1 MiB
 * or a thousandth of all top-level change), then its children get the same
 * treatment; siblings sort by |delta|. Used by the demo backend and tested here.
 */
const MIN = 1024 * 1024;
const MAX_ENTRIES = 800;

export function diffTrees(before: Entry, after: Entry, separator = "\\", caseInsensitive = true): { entries: DiffEntry[]; truncated: boolean } {
  const key = (n: string) => (caseInsensitive ? n.toLowerCase() : n);
  const mapOf = (e: Entry | undefined) => {
    const m = new Map<string, Entry>();
    for (const k of e?.[7] ?? []) m.set(key(k[0]), k);
    return m;
  };
  const a = mapOf(before);
  const b = mapOf(after);
  let totalAbs = 0;
  for (const n of new Set([...a.keys(), ...b.keys()])) totalAbs += Math.abs((b.get(n)?.[2] ?? 0) - (a.get(n)?.[2] ?? 0));
  const threshold = Math.max(MIN, Math.floor(totalAbs / 1000));
  const out: DiffEntry[] = [];
  let truncated = false;

  const visit = (ea: Entry | undefined, eb: Entry | undefined, path: string, depth: number) => {
    const ka = mapOf(ea);
    const kb = mapOf(eb);
    const rows = [...new Set([...ka.keys(), ...kb.keys()])]
      .map((n) => ({ n, delta: (kb.get(n)?.[2] ?? 0) - (ka.get(n)?.[2] ?? 0) }))
      .filter((r) => Math.abs(r.delta) >= threshold)
      .sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
    for (const { n, delta } of rows) {
      if (out.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const xa = ka.get(n);
      const xb = kb.get(n);
      const shown = (xb ?? xa)?.[0] ?? n;
      const childPath = path ? `${path}${separator}${shown}` : shown;
      const isDir = ((xb ?? xa)?.[1] ?? 0) === 1;
      out.push({
        path: childPath,
        name: shown,
        kind: isDir ? "dir" : "file",
        before: xa?.[2] ?? 0,
        after: xb?.[2] ?? 0,
        delta,
        depth,
        state: !xa ? "new" : !xb ? "gone" : delta > 0 ? "grew" : "shrank",
      });
      if (isDir && xa && xb) visit(xa, xb, childPath, depth + 1);
    }
  };
  visit(before, after, "", 0);
  return { entries: out, truncated };
}
