import { describe, expect, it } from "vitest";
import {
  asItemsDoc,
  asValueDoc,
  beats,
  capNewest,
  diffLocal,
  futureClock,
  hashOf,
  mergeItems,
  mergeValue,
  resolveFirstRun,
  resolveFirstRunValue,
  shadowOfItems,
  stableStringify,
  stampItems,
  stampValue,
  TOMBSTONE_TTL_MS,
  type Shadow,
} from "./merge";
import type { ItemsDoc, ValueDoc } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function doc<T>(items: Array<[string, number, string, T]>, tombstones: Array<[string, number, string]> = []): ItemsDoc<T> {
  return {
    version: 1,
    updatedAt: Math.max(0, ...items.map((i) => i[1]), ...tombstones.map((t) => t[1])),
    items: items.map(([id, updatedAt, by, value]) => ({ id, updatedAt, by, value })),
    tombstones: tombstones.map(([id, deletedAt, by]) => ({ id, deletedAt, by })),
  };
}

describe("stableStringify / hashOf", () => {
  it("does not care about key order or undefined fields", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(hashOf({ a: 1, b: undefined })).toBe(hashOf({ a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(hashOf("x")).not.toBe(hashOf(["x"]));
  });
});

describe("beats", () => {
  it("prefers the later claim, then the larger device id", () => {
    expect(beats({ t: 2, by: "a" }, { t: 1, by: "z" })).toBe(true);
    expect(beats({ t: 1, by: "a" }, { t: 2, by: "z" })).toBe(false);
    expect(beats({ t: 1, by: "b" }, { t: 1, by: "a" })).toBe(true);
    expect(beats({ t: 1, by: "a" }, { t: 1, by: "b" })).toBe(false);
    expect(beats({ t: 1, by: "a" }, { t: 1, by: "a" })).toBe(false);
  });
});

describe("mergeItems", () => {
  it("unions two devices and lets the newer edit win", () => {
    const a = doc([["x", 10, "A", "x from A"], ["only-a", 5, "A", "a"]]);
    const b = doc([["x", 20, "B", "x from B"], ["only-b", 7, "B", "b"]]);
    const { doc: merged, origin } = mergeItems([a, b], NOW);
    expect(merged.items.map((i) => [i.id, i.value])).toEqual([
      ["only-a", "a"],
      ["only-b", "b"],
      ["x", "x from B"],
    ]);
    expect(origin.get("x")).toBe(1);
    expect(origin.get("only-a")).toBe(0);
    expect(merged.updatedAt).toBe(20);
  });

  it("never lets an older remote version replace a newer local one", () => {
    const local = doc([["x", 30, "A", "local newer"]]);
    const remote = doc([["x", 20, "B", "remote older"]]);
    expect(mergeItems([local, remote], NOW).doc.items[0].value).toBe("local newer");
    // and the order of the inputs does not matter
    expect(mergeItems([remote, local], NOW).doc.items[0].value).toBe("local newer");
  });

  it("settles an equal timestamp by the lexically larger device id, deterministically", () => {
    const a = doc([["x", 10, "aaaa", "from aaaa"]]);
    const b = doc([["x", 10, "bbbb", "from bbbb"]]);
    expect(mergeItems([a, b], NOW).doc.items[0].value).toBe("from bbbb");
    expect(mergeItems([b, a], NOW).doc.items[0].value).toBe("from bbbb");
  });

  it("lets a tombstone delete an item it postdates, and an edit resurrect it", () => {
    const item = doc([["x", 10, "A", "v1"]]);
    const deleted = doc([], [["x", 15, "B"]]);
    const afterDelete = mergeItems([item, deleted], NOW).doc;
    expect(afterDelete.items).toEqual([]);
    expect(afterDelete.tombstones).toEqual([{ id: "x", deletedAt: 15, by: "B" }]);

    const edited = doc([["x", 20, "A", "v2"]]);
    const afterEdit = mergeItems([edited, deleted], NOW).doc;
    expect(afterEdit.items.map((i) => i.value)).toEqual(["v2"]);
    expect(afterEdit.tombstones).toEqual([]);
  });

  it("keeps a tombstone 90 days and then forgets it", () => {
    const fresh = doc<string>([], [["gone", NOW - 89 * DAY, "A"]]);
    const stale = doc<string>([], [["old", NOW - 91 * DAY, "A"]]);
    const merged = mergeItems([fresh, stale], NOW).doc;
    expect(merged.tombstones.map((t) => t.id)).toEqual(["gone"]);
    expect(TOMBSTONE_TTL_MS).toBe(90 * DAY);
  });

  it("is idempotent: merging the result again changes nothing", () => {
    const a = doc([["x", 10, "A", 1], ["y", 12, "A", 2]], [["z", 11, "A"]]);
    const b = doc([["x", 11, "B", 3], ["z", 9, "B", 4]]);
    const once = mergeItems([a, b], NOW).doc;
    const twice = mergeItems([once, a, b], NOW).doc;
    expect(hashOf(twice)).toBe(hashOf(once));
  });
});

describe("mergeValue", () => {
  it("takes the whole latest value", () => {
    const a: ValueDoc<{ lang: string }> = { version: 1, updatedAt: 5, by: "A", value: { lang: "pl" } };
    const b: ValueDoc<{ lang: string }> = { version: 1, updatedAt: 9, by: "B", value: { lang: "en" } };
    expect(mergeValue([a, b])).toEqual({ doc: b, origin: 1 });
    expect(mergeValue([b, a])).toEqual({ doc: b, origin: 0 });
    const tie: ValueDoc<{ lang: string }> = { version: 1, updatedAt: 9, by: "C", value: { lang: "auto" } };
    expect(mergeValue([a, b, tie]).doc.value.lang).toBe("auto");
  });
});

describe("capNewest", () => {
  it("keeps the n newest by the given time and leaves tombstones alone", () => {
    const takes = doc(
      [
        ["t1", 1, "A", { at: 100 }],
        ["t2", 1, "A", { at: 300 }],
        ["t3", 1, "A", { at: 200 }],
      ],
      [["t0", 50, "A"]],
    );
    const capped = capNewest(takes, 2, (v) => v.at);
    expect(capped.items.map((i) => i.id)).toEqual(["t2", "t3"]);
    expect(capped.tombstones).toHaveLength(1);
    expect(capNewest(takes, 5, (v) => v.at)).toBe(takes);
  });
});

describe("stampItems (shadow diff)", () => {
  const shadow: Shadow = {
    items: {
      kept: { hash: hashOf({ n: 1 }), updatedAt: 100, by: "B" },
      edited: { hash: hashOf({ n: 1 }), updatedAt: 100, by: "B" },
      removed: { hash: hashOf({ n: 1 }), updatedAt: 100, by: "A" },
    },
    tombstones: { long_gone: { deletedAt: 90, by: "B" } },
  };

  it("keeps the claim of an unchanged item, restamps an edited one, tombstones a missing one", () => {
    const local = [
      { id: "kept", value: { n: 1 } },
      { id: "edited", value: { n: 2 } },
      { id: "added", value: { n: 3 } },
    ];
    const stamped = stampItems(local, shadow, "A", NOW);
    const byId = Object.fromEntries(stamped.items.map((i) => [i.id, i]));
    expect(byId.kept).toMatchObject({ updatedAt: 100, by: "B" });
    expect(byId.edited).toMatchObject({ updatedAt: NOW, by: "A" });
    expect(byId.added).toMatchObject({ updatedAt: NOW, by: "A" });
    expect(stamped.tombstones).toEqual([
      { id: "removed", deletedAt: NOW, by: "A" },
      { id: "long_gone", deletedAt: 90, by: "B" },
    ]);
    expect(stamped.updatedAt).toBe(NOW);
  });

  it("drops a carried tombstone when the id comes back", () => {
    const stamped = stampItems([{ id: "long_gone", value: 1 }], shadow, "A", NOW);
    expect(stamped.tombstones.map((t) => t.id)).toEqual(["kept", "edited", "removed"]);
    expect(stamped.items[0]).toMatchObject({ id: "long_gone", updatedAt: NOW, by: "A" });
  });

  it("makes no claim on the first sync, so the folder wins the conflicts", () => {
    const first = stampItems([{ id: "x", value: "mine" }, { id: "only-here", value: "1" }], null, "A", NOW);
    expect(first.items.every((i) => i.updatedAt === 0 && i.by === "")).toBe(true);
    expect(first.tombstones).toEqual([]);
    const remote = doc([["x", 1, "B", "theirs"]]);
    const merged = mergeItems([first, remote], NOW).doc;
    expect(merged.items.find((i) => i.id === "x")?.value).toBe("theirs");
    // …and what only this device had is claimed for real afterwards.
    const resolved = resolveFirstRun(merged, "A", NOW);
    expect(resolved.items.find((i) => i.id === "only-here")).toMatchObject({ updatedAt: NOW, by: "A" });
    expect(resolved.items.find((i) => i.id === "x")).toMatchObject({ updatedAt: 1, by: "B" });
    expect(resolveFirstRun(resolved, "A", NOW + 1)).toBe(resolved);
  });

  it("ignores duplicate and empty ids", () => {
    const stamped = stampItems([{ id: "a", value: 1 }, { id: "a", value: 2 }, { id: "", value: 3 }], shadow, "A", NOW);
    expect(stamped.items.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("stampValue", () => {
  it("claims only when the value moved", () => {
    const shadow: Shadow = { items: {}, tombstones: {}, value: { hash: hashOf({ lang: "pl" }), updatedAt: 5, by: "B" } };
    expect(stampValue({ lang: "pl" }, shadow, "A", NOW)).toMatchObject({ updatedAt: 5, by: "B" });
    expect(stampValue({ lang: "en" }, shadow, "A", NOW)).toMatchObject({ updatedAt: NOW, by: "A" });
    const first = stampValue({ lang: "en" }, null, "A", NOW);
    expect(first).toMatchObject({ updatedAt: 0, by: "" });
    expect(resolveFirstRunValue(first, "A", NOW)).toMatchObject({ updatedAt: NOW, by: "A" });
  });

  it("first-sync defaults never beat a device that has synced before", () => {
    const fresh = stampValue({ lang: "auto", quality: "balanced" }, null, "B", NOW + 1000);
    const seasoned: ValueDoc<unknown> = { version: 1, updatedAt: NOW - 30 * DAY, by: "A", value: { lang: "pl", quality: "accurate" } };
    expect(mergeValue([fresh, seasoned]).doc.value).toEqual({ lang: "pl", quality: "accurate" });
  });
});

describe("shadowOfItems / diffLocal", () => {
  it("round-trips a doc into a shadow that reports it unchanged", () => {
    const merged = doc([["x", 10, "A", { n: 1 }], ["y", 12, "B", { n: 2 }]], [["z", 11, "A"]]);
    const shadow = shadowOfItems(merged, { items: {}, tombstones: {}, written: "w", pushed: { x: 10 } });
    expect(shadow.written).toBe("w");
    expect(shadow.pushed).toEqual({ x: 10 });
    const again = stampItems(
      merged.items.map((i) => ({ id: i.id, value: i.value })),
      shadow,
      "A",
      NOW,
    );
    expect(hashOf(again)).toBe(hashOf({ ...merged, updatedAt: again.updatedAt }));
  });

  it("names what to change and what to remove locally", () => {
    const merged = doc([["x", 10, "A", { n: 1 }], ["new", 12, "B", { n: 2 }]]);
    const local = [
      { id: "x", value: { n: 0 } },
      { id: "stale", value: { n: 9 } },
    ];
    expect(diffLocal(local, merged)).toEqual({ changed: ["x", "new"], removed: ["stale"] });
    expect(diffLocal(merged.items.map((i) => ({ id: i.id, value: i.value })), merged)).toEqual({ changed: [], removed: [] });
  });
});

describe("focus: per-workspace whole-value merge", () => {
  type Ws = { meta: { name: string }; data: { tasks: string[] } };
  it("merges workspaces as items, each one last-writer-wins as a whole", () => {
    const laptop = doc<Ws>([
      ["default", 100, "laptop", { meta: { name: "Personal" }, data: { tasks: ["a", "b"] } }],
      ["ws-study", 200, "laptop", { meta: { name: "Study" }, data: { tasks: ["read"] } }],
    ]);
    const desktop = doc<Ws>(
      [["default", 150, "desktop", { meta: { name: "Personal" }, data: { tasks: ["a", "b", "c"] } }]],
      [["ws-study", 250, "desktop"]],
    );
    const merged = mergeItems([laptop, desktop], NOW).doc;
    // The desktop edited the default workspace later: its whole dataset wins…
    expect(merged.items.map((i) => [i.id, i.value.data.tasks])).toEqual([["default", ["a", "b", "c"]]]);
    // …and deleted Study after the laptop's last edit, so the deletion stands.
    expect(merged.tombstones.map((t) => t.id)).toEqual(["ws-study"]);
  });
});

describe("guards", () => {
  it("accepts docs from disk leniently and rejects the rest", () => {
    const raw = {
      version: 1,
      updatedAt: 3,
      items: [{ id: "ok", updatedAt: 3, by: "A", value: 1 }, { id: 5 }, "junk", { id: "no-claim", value: 2 }],
      tombstones: [{ id: "t", deletedAt: 2, by: "A" }, { id: "bad" }],
    };
    const parsed = asItemsDoc(raw);
    expect(parsed?.items.map((i) => i.id)).toEqual(["ok"]);
    expect(parsed?.tombstones.map((t) => t.id)).toEqual(["t"]);
    expect(asItemsDoc({ version: 2, items: [] })).toBeNull();
    expect(asItemsDoc(null)).toBeNull();
    expect(asValueDoc({ version: 1, updatedAt: 1, by: "A", value: { a: 1 } })?.value).toEqual({ a: 1 });
    expect(asValueDoc({ version: 1, updatedAt: 1, value: 1 })?.by).toBe("");
    expect(asValueDoc({ version: 1, updatedAt: "1", value: 1 })).toBeNull();
    expect(asValueDoc({ version: 1, updatedAt: 1 })).toBeNull();
  });

  it("flags a manifest more than an hour in the future", () => {
    expect(futureClock(NOW + 59 * 60 * 1000, NOW)).toBe(false);
    expect(futureClock(NOW + 61 * 60 * 1000, NOW)).toBe(true);
    expect(futureClock(NOW - 5 * DAY, NOW)).toBe(false);
  });
});
