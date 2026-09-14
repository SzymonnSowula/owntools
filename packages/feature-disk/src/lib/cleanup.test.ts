import { describe, expect, it } from "vitest";
import type { BinUse, Protection, TrashOutcome } from "../api/types";
import {
  adminDialog,
  appsQueryFor,
  binBlockDialog,
  binSentence,
  listNames,
  mergeOutcomes,
  protectedDialog,
  protectedNames,
  skipSentence,
  summarizeCleanup,
} from "./cleanup";

const GB = 1024 ** 3;

const jetbrains: Protection = {
  id: 1,
  path: "C:\\Program Files\\JetBrains",
  apps: [{ id: "hklm64:PyCharm", name: "PyCharm 2026.1" }],
  services: [],
};
const mongo: Protection = {
  id: 2,
  path: "C:\\Program Files\\MongoDB",
  apps: [],
  services: [{ name: "MongoDB", display: "MongoDB Server (MongoDB)" }],
};
const faceit: Protection = {
  id: 3,
  path: "C:\\Program Files\\FACEIT AC",
  apps: [{ id: "hklm32:FACEIT", name: "FACEIT Anti-Cheat" }],
  services: [{ name: "FACEIT", display: "FACEIT Anti-Cheat" }],
};

const outcome = (o: Partial<TrashOutcome>): TrashOutcome => ({ removed: [], freed: 0, failed: [], skipped: [], ...o });

describe("names", () => {
  it("lists programs before services, once each", () => {
    expect(protectedNames([mongo, faceit, jetbrains])).toEqual(["FACEIT Anti-Cheat", "PyCharm 2026.1", "MongoDB Server (MongoDB)"]);
  });

  it("shortens long lists", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B"])).toBe("A and B");
    expect(listNames(["A", "B", "C"])).toBe("A, B and 1 more");
    expect(listNames(["A", "B", "C"], 3)).toBe("A, B and C");
  });

  it("finds a service-only program in Applications by its folder", () => {
    expect(appsQueryFor(jetbrains)).toBe("PyCharm 2026.1");
    expect(appsQueryFor(mongo)).toBe("MongoDB");
  });
});

describe("dialogs", () => {
  it("explains why installed programs stay", () => {
    expect(protectedDialog([jetbrains]).title).toBe("Part of an installed program");
    // FACEIT's driver has the same name as its program: listed once.
    expect(protectedDialog([jetbrains, mongo, faceit]).message).toMatch(/^These are part of PyCharm 2026\.1, FACEIT Anti-Cheat and MongoDB Server \(MongoDB\)\. /);
    expect(protectedDialog([jetbrains, mongo, faceit, { ...jetbrains, id: 4, apps: [{ id: "x", name: "OBS Studio" }] }]).message).toMatch(/and 1 more\./);
    expect(skipSentence([])).toBe("");
    expect(skipSentence([jetbrains])).toBe(" One item stays where it is: part of PyCharm 2026.1.");
  });

  it("asks for administrator permission once for many", () => {
    const one = adminDialog([{ id: 9, path: "C:\\Windows\\Temp", error: "needs administrator permission", needsAdmin: true }]);
    expect(one.message).toContain("“Temp”");
    expect(one.cancelLabel).toBe("Skip it");
    const many = adminDialog([
      { id: 9, path: "C:\\Windows\\Temp", error: "x", needsAdmin: true },
      { id: 10, path: "C:\\Windows.old", error: "x", needsAdmin: true },
    ]);
    expect(many.message).toContain("2 of these items");
    expect(many.message).toContain("once");
  });
});

describe("the Recycle Bin", () => {
  const bin = (b: Partial<BinUse>): BinUse => ({ root: "C:\\", hasBin: true, reason: null, capacity: 25.8 * GB, used: 0, adding: GB, items: 3, evicts: 0, ...b });

  it("says nothing about a small cleanup", () => {
    expect(binSentence([bin({})])).toBe("");
    expect(binBlockDialog([bin({})], 3)).toBeNull();
  });

  it("says how much of the bin a big one takes, and what it pushes out", () => {
    // The duplicates click that started this: 25.1 GB into a 25.8 GB bin.
    expect(binSentence([bin({ adding: 25.1 * GB })])).toBe(" That is 25.1 GB of the 25.8 GB the Recycle Bin on C:\\ holds.");
    expect(binSentence([bin({ adding: 20 * GB, used: 10 * GB, evicts: 4.2 * GB })])).toBe(
      " To make room, Windows will permanently erase the oldest 4.2 GB already in the Recycle Bin on C:\\.",
    );
  });

  it("refuses more than the bin holds instead of asking", () => {
    const over = binBlockDialog([bin({ adding: 30 * GB })], 3);
    expect(over?.title).toBe("More than the Recycle Bin holds");
    expect(over?.message).toContain("This is 30 GB, and the Recycle Bin on C:\\ holds 25.8 GB.");
    expect(binSentence([bin({ adding: 30 * GB })])).toBe("");
  });

  it("keeps items on a drive without a bin, and says so", () => {
    const usb = bin({ root: "E:\\", hasBin: false, reason: "E:\\ is a removable drive, which has no Recycle Bin", capacity: 0, items: 2 });
    expect(binSentence([bin({}), usb])).toBe(" 2 items stay where they are: E:\\ is a removable drive, which has no Recycle Bin, and nothing is deleted for good.");
    expect(binBlockDialog([bin({}), usb], 5)).toBeNull();
    expect(binBlockDialog([usb], 2)?.title).toBe("No Recycle Bin there");
  });
});

describe("the outcome", () => {
  it("lets the retry answer for the items it retried", () => {
    const first = outcome({
      removed: [4],
      freed: 2 * GB,
      failed: [
        { id: 9, path: "C:\\Windows\\Temp", error: "needs administrator permission", needsAdmin: true },
        { id: 11, path: "C:\\Users\\me\\busy.log", error: "a file in it is open in another program", needsAdmin: false },
      ],
      skipped: [jetbrains],
    });
    const retry = outcome({ removed: [9], freed: GB });
    const merged = mergeOutcomes(first, retry, [9]);
    expect(merged.removed).toEqual([4, 9]);
    expect(merged.freed).toBe(3 * GB);
    expect(merged.failed.map((f) => f.id)).toEqual([11]);
    expect(merged.skipped).toEqual([jetbrains]);
  });

  it("words every mix of moved, skipped and failed", () => {
    expect(summarizeCleanup(outcome({ removed: [1, 2], freed: GB }))).toEqual({
      text: "2 items moved to the Recycle Bin · 1 GB freed. They are in the Recycle Bin until you empty it.",
      kind: "ok",
      appsQuery: null,
    });
    const skippedOnly = summarizeCleanup(outcome({ skipped: [jetbrains] }));
    expect(skippedOnly).toEqual({ text: "1 left alone: part of PyCharm 2026.1", kind: "ok", appsQuery: "PyCharm 2026.1" });
    // Two items of one program name that program, not "installed programs".
    const oneProgram = summarizeCleanup(outcome({ removed: [7], freed: GB, skipped: [jetbrains, { ...jetbrains, id: 8, path: "C:\\Program Files\\JetBrains\\PyCharm 2026.1\\bin" }] }));
    expect(oneProgram.text).toBe("1 moved to the Recycle Bin · 1 GB freed · 2 left alone: part of PyCharm 2026.1");
    const mixed = summarizeCleanup(
      outcome({
        removed: [5],
        freed: GB,
        skipped: [mongo, faceit],
        failed: [{ id: 6, path: "C:\\Windows.old", error: "Windows refused, even with administrator permission", needsAdmin: false }],
      }),
    );
    expect(mixed.text).toBe(
      "1 moved to the Recycle Bin · 1 GB freed · 2 left alone: part of installed programs · 1 could not be moved — Windows.old: Windows refused, even with administrator permission",
    );
    expect(mixed.kind).toBe("error");
    expect(mixed.appsQuery).toBe("MongoDB");
  });
});
