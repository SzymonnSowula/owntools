import { describe, expect, it } from "vitest";
import { migrateBrandedStorageKeys } from "./storageMigration";

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

describe("migrateBrandedStorageKeys", () => {
  it("carries a renamed key over and drops the old one", () => {
    const s = fakeStorage({ "shipshape-onboarded": "1", "shipshape-hub-notes": "[]" });

    expect(migrateBrandedStorageKeys(s).sort()).toEqual([
      "owntools-hub-notes",
      "owntools-onboarded",
    ]);
    expect(s.getItem("owntools-onboarded")).toBe("1");
    expect(s.getItem("shipshape-onboarded")).toBeNull();
  });

  it("catches keys built at runtime, not just the ones written out in source", () => {
    const s = fakeStorage({ "shipshape-board-a1b2c3": "{}" });

    migrateBrandedStorageKeys(s);

    expect(s.getItem("owntools-board-a1b2c3")).toBe("{}");
  });

  it("never overwrites live state, but still clears the stale twin", () => {
    const s = fakeStorage({ "shipshape-theme": "night", "owntools-theme": "ocean" });

    expect(migrateBrandedStorageKeys(s)).toEqual([]);
    expect(s.getItem("owntools-theme")).toBe("ocean");
    expect(s.getItem("shipshape-theme")).toBeNull();
  });

  it("is idempotent", () => {
    const s = fakeStorage({ "shipshape-onboarded": "1" });

    migrateBrandedStorageKeys(s);
    expect(migrateBrandedStorageKeys(s)).toEqual([]);
    expect(s.getItem("owntools-onboarded")).toBe("1");
  });

  it("leaves keys that never carried the brand alone", () => {
    const s = fakeStorage({
      "suite-dictation-settings": "{}",
      "focus-workspaces": "[]",
      "screeni-look-presets": "[]",
    });

    expect(migrateBrandedStorageKeys(s)).toEqual([]);
    expect(s.getItem("suite-dictation-settings")).toBe("{}");
    expect(s.getItem("focus-workspaces")).toBe("[]");
    expect(s.getItem("screeni-look-presets")).toBe("[]");
  });
});
