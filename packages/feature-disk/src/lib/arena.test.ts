import { describe, expect, it } from "vitest";
import { CAT_DOCUMENT, CAT_VIDEO } from "../api/types";
import { TsArena, type Spec } from "./arena";
import { buildDemoSpec } from "./demoTree";
import { diffTrees } from "./diff";

const MB = 1024 * 1024;

const sample = (): Spec => ({
  name: "root",
  kids: [
    { name: "Downloads", mtime: 100, kids: [{ name: "movie.mp4", size: 3_000_000, mtime: 900 }, { name: "setup.exe", size: 500_000, mtime: 200 }] },
    { name: "Docs", mtime: 100, kids: [{ name: "a.pdf", size: 20_000, mtime: 300 }, { name: "sub", mtime: 100, kids: [{ name: "b.pdf", size: 30_000, mtime: 1000 }] }] },
    { name: "readme.txt", size: 1000, mtime: 500 },
  ],
});

describe("TsArena mirrors the Rust arena", () => {
  it("aggregates, resolves paths and prunes subtrees", () => {
    const a = TsArena.fromSpec("C:\\root", sample());
    expect(a.nodes[0].size).toBe(3_551_000);
    expect(a.nodes[0].files).toBe(5);
    expect(a.nodes[0].dirs).toBe(3);
    const docs = a.findPath("C:\\root\\Docs")!;
    expect(a.nodes[docs].cat).toBe(CAT_DOCUMENT);
    expect(a.nodes[docs].newest).toBe(1000);
    expect(a.pathOf(a.findPath("c:\\root\\docs\\sub\\b.pdf")!)).toBe("C:\\root\\Docs\\sub\\b.pdf");
    expect(a.findPath("C:\\root\\")).toBe(0);
    expect(a.findPath("D:\\x")).toBeNull();
    const t = a.subtree(0, 5, 10_000, 100, 1000)!;
    expect(t.ch!.map((c) => c.n)).toEqual(["Downloads", "Docs"]);
    expect(t.r).toEqual({ n: 1, s: 1000 });
    const one = a.subtree(0, 5, 0, 1, 1000)!;
    expect(one.ch).toHaveLength(1);
    expect(one.r!.n).toBe(2);
    expect(a.breakdown(0).bytes[CAT_VIDEO]).toBe(3_000_000);
  });

  it("top files, search and removal keep totals consistent", () => {
    const a = TsArena.fromSpec("C:\\root", sample());
    expect(a.topFiles(0, { limit: 2 }).map((f) => f.name)).toEqual(["movie.mp4", "setup.exe"]);
    expect(a.topFiles(0, { cat: CAT_DOCUMENT })).toHaveLength(3);
    expect(a.topFiles(0, { modifiedAfter: 800 })).toHaveLength(2);
    expect(a.search("PDF").map((f) => f.name)).toEqual(["b.pdf", "a.pdf"]);
    a.remove(a.findPath("C:\\root\\Downloads")!);
    expect(a.nodes[0].size).toBe(51_000);
    expect(a.nodes[0].files).toBe(3);
    expect(a.nodes[0].dirs).toBe(2);
    expect(a.childIds(0)).toHaveLength(2);
    expect(a.breakdown(0).bytes[CAT_VIDEO]).toBe(0);
  });

  it("round-trips through the snapshot entry tree", () => {
    const a = TsArena.fromSpec("C:\\root", sample());
    const entry = a.toEntry();
    expect(entry[2]).toBe(a.nodes[0].size);
    const back = TsArena.fromEntry("C:\\root", entry);
    expect(back.nodes[0].size).toBe(a.nodes[0].size);
    expect(back.source).toBe("snapshot");
    const downloads = back.findPath("C:\\root\\Downloads")!;
    expect(back.nodes[downloads].size).toBe(3_500_000);
    // movie.mp4 (3 MB) survives as a file; setup.exe (500 KB) folds into a synthetic child.
    const kids = back.childIds(downloads).map((i) => back.nodes[i].name);
    expect(kids).toEqual(["movie.mp4", "(1 smaller files)"]);
  });
});

describe("demo tree", () => {
  const spec = buildDemoSpec({ seed: 7, now: 1_800_000_000 });
  const a = TsArena.fromSpec("C:\\Users\\demo", spec);

  it("is deterministic and disk-sized", () => {
    const b = TsArena.fromSpec("C:\\Users\\demo", buildDemoSpec({ seed: 7, now: 1_800_000_000 }));
    expect(b.nodes[0].size).toBe(a.nodes[0].size);
    expect(a.length).toBeGreaterThan(20_000);
    expect(a.length).toBeLessThan(80_000);
    expect(a.nodes[0].size / (1024 * MB)).toBeGreaterThan(90);
    expect(a.nodes[0].size / (1024 * MB)).toBeLessThan(200);
    for (let i = 1; i < a.length; i++) expect(a.nodes[i].parent).toBeLessThan(i);
  });

  it("plants duplicates and quick wins", () => {
    const groups = new Map<string, number>();
    a.walk(0, (_, n) => {
      if (n.content !== undefined) groups.set(`${n.size}:${n.content}`, (groups.get(`${n.size}:${n.content}`) ?? 0) + 1);
      return true;
    });
    expect(Array.from(groups.values()).filter((c) => c > 1).length).toBeGreaterThanOrEqual(4);
    const wins = a.quickWins();
    const ids = wins.map((w) => w.id);
    expect(ids).toContain("downloads");
    expect(ids).toContain("caches");
    expect(ids).toContain("node_modules");
    expect(ids).toContain("build");
    expect(ids).toContain("media");
    expect(ids).toContain("installers");
    expect(ids).toContain("vm");
    for (const w of wins) expect(w.items.length).toBeGreaterThan(0);
    expect(wins.every((w, i) => i === 0 || wins[i - 1].bytes >= w.bytes)).toBe(true);
  });

  it("diffs against a modified copy", () => {
    const before = a.toEntry();
    const b = TsArena.fromSpec("C:\\Users\\demo", spec);
    b.remove(b.findPath("C:\\Users\\demo\\Downloads")!);
    const { entries, truncated } = diffTrees(before, b.toEntry());
    expect(truncated).toBe(false);
    expect(entries[0].name).toBe("Downloads");
    expect(entries[0].state).toBe("gone");
    expect(entries[0].delta).toBeLessThan(0);
    expect(entries.every((e) => Math.abs(e.delta) >= MB)).toBe(true);
  });
});
