import { describe, expect, it } from "vitest";
import type { DupeGroup, LeftOut, NodeInfo } from "../api/types";
import { canTick, defaultPicks, keeper, leftOutParts, strayScore } from "./dupes";

let nextId = 1;
function file(path: string, mtime: number, id = nextId++): NodeInfo {
  const name = path.split("\\").pop()!;
  return { id, parent: null, name, path, kind: "file", size: 8_000_000, alloc: 8_003_584, mtime, ctime: mtime, files: 0, dirs: 0, cat: 3, error: false, hidden: false, depth: 3, children: 0, newest: mtime };
}

function group(files: NodeInfo[], more = 0): DupeGroup {
  return { hash: "h", size: files[0].size, files, more };
}

describe("strayScore", () => {
  it("scores copies by name and by where they landed", () => {
    expect(strayScore(file("C:\\Users\\me\\Pictures\\DSC_0412.jpg", 1))).toBe(0);
    expect(strayScore(file("C:\\Users\\me\\Pictures\\DSC_0412 (copy).jpg", 1))).toBe(2);
    expect(strayScore(file("C:\\Users\\me\\Pictures\\photo (1).jpg", 1))).toBe(2);
    expect(strayScore(file("C:\\Users\\me\\Documents\\report - Copy.docx", 1))).toBe(2);
    expect(strayScore(file("C:\\Users\\me\\Documents\\umowa - kopia.pdf", 1))).toBe(2);
    expect(strayScore(file("C:\\Users\\me\\Pictures\\IMG_2041 copy 2.heic", 1))).toBe(2);
    expect(strayScore(file("C:\\Users\\me\\Downloads\\DSC_0412.jpg", 1))).toBe(1);
    expect(strayScore(file("C:\\Users\\me\\Desktop\\old stuff\\Win11.iso", 1))).toBe(1);
    expect(strayScore(file("C:\\Users\\me\\Downloads\\talk (2).mkv", 1))).toBe(3);
  });

  it("does not mistake ordinary names for copies", () => {
    expect(strayScore(file("C:\\Users\\me\\Documents\\copyright.pdf", 1))).toBe(0);
    expect(strayScore(file("C:\\Users\\me\\Videos\\Keynote 2026 - full talk (4K).mkv", 1))).toBe(0);
    expect(strayScore(file("C:\\Users\\me\\Documents\\copy.txt", 1))).toBe(0);
    // A folder called "Downloads Archive" is not Downloads.
    expect(strayScore(file("C:\\Users\\me\\Downloads Archive\\a.zip", 1))).toBe(0);
  });
});

describe("keeper", () => {
  const original = file("C:\\Users\\me\\Pictures\\Camera Roll\\DSC_0412.jpg", 300);
  const copied = file("C:\\Users\\me\\Pictures\\Camera Roll\\DSC_0412 (copy).jpg", 100);
  const downloaded = file("C:\\Users\\me\\Downloads\\DSC_0412.jpg", 200);

  it("keeps the deliberately placed copy, oldest first on a tie", () => {
    expect(keeper([copied, downloaded, original], "best")?.id).toBe(original.id);
    const a = file("C:\\Users\\me\\Videos\\talk.mkv", 50);
    const b = file("C:\\Users\\me\\Documents\\talk.mkv", 40);
    expect(keeper([a, b], "best")?.id).toBe(b.id);
  });

  it("keeps by age when asked", () => {
    expect(keeper([original, copied, downloaded], "oldest")?.id).toBe(copied.id);
    expect(keeper([original, copied, downloaded], "newest")?.id).toBe(original.id);
  });
});

describe("picks", () => {
  it("ticks every listed copy but the one that stays", () => {
    const a = file("C:\\Users\\me\\Videos\\talk.mkv", 10);
    const b = file("C:\\Users\\me\\Downloads\\talk.mkv", 5);
    const c = file("C:\\Users\\me\\Desktop\\talk.mkv", 1);
    const picks = defaultPicks([group([c, b, a])], "best");
    expect([...picks].sort()).toEqual([b.id, c.id].sort());
  });

  it("never lets the last copy be ticked", () => {
    const a = file("C:\\x\\a.bin", 1);
    const b = file("C:\\x\\b.bin", 2);
    const g = group([a, b]);
    expect(canTick(g, new Set(), a.id)).toBe(true);
    expect(canTick(g, new Set([a.id]), b.id)).toBe(false);
    // Unticking is always allowed.
    expect(canTick(g, new Set([a.id]), a.id)).toBe(true);
    // Copies past the listed 60 always stay, so every listed one may go.
    expect(canTick(group([a, b], 3), new Set([a.id]), b.id)).toBe(true);
  });
});

describe("leftOutParts", () => {
  it("names only the reasons that left something out", () => {
    const left: LeftOut = { apps: 8412, tools: 0, projects: 311, programs: 1, links: 12, cloud: 0, changed: 1 };
    expect(leftOutParts(left).map((p) => p.text)).toEqual([
      "8,412 in Windows & installed apps",
      "311 in code projects",
      "1 program or library",
      "12 hard links",
      "1 changed since the scan",
    ]);
    expect(leftOutParts(null)).toEqual([]);
  });
});
