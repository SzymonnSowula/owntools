import { describe, expect, it } from "vitest";
import type { CaptureItem } from "../api/types";
import { dayLabel, excerpt, groupByDay, itemLabel, searchItems, suggestedFileName } from "./library";

const item = (id: string, createdAt: number, extra: Partial<CaptureItem> = {}): CaptureItem => ({
  id,
  path: `C:\\captures\\${id}.png`,
  width: 800,
  height: 450,
  createdAt,
  ...extra,
});

// A fixed "now": Friday 11 September 2026, 14:30 local.
const NOW = new Date(2026, 8, 11, 14, 30).getTime();
const DAY = 86_400_000;

describe("searchItems", () => {
  const items = [
    item("a", NOW, { title: "launch plan", ocrText: "Ship the installer on Tuesday.\nPrice stays at 149 zl." }),
    item("b", NOW - DAY, { ocrText: "test result: ok. 41 passed" }),
    item("c", NOW - 2 * DAY),
  ];

  it("matches words across title and recognised text, case-insensitively", () => {
    expect(searchItems(items, "TUESDAY").map((i) => i.id)).toEqual(["a"]);
    expect(searchItems(items, "launch price").map((i) => i.id)).toEqual(["a"]);
    expect(searchItems(items, "passed").map((i) => i.id)).toEqual(["b"]);
  });

  it("requires every word", () => {
    expect(searchItems(items, "tuesday passed")).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(searchItems(items, "   ").length).toBe(3);
  });
});

describe("groupByDay", () => {
  it("groups newest first with Today / Yesterday / weekday / date labels", () => {
    const items = [
      item("old", new Date(2026, 6, 3, 9).getTime()),
      item("t1", NOW - 3_600_000),
      item("y", NOW - DAY),
      item("t2", NOW - 60_000),
      item("w", NOW - 3 * DAY),
    ];
    const groups = groupByDay(items, NOW, "en-GB");
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Tuesday", "3 July"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["t2", "t1"]);
  });

  it("names days beyond this year with the year", () => {
    expect(dayLabel(new Date(2025, 11, 24).getTime(), NOW, "en-GB")).toBe("24 December 2025");
  });
});

describe("labels and excerpts", () => {
  it("falls back to the size when there is no title", () => {
    expect(itemLabel(item("a", NOW))).toBe("800 × 450");
    expect(itemLabel(item("a", NOW, { title: "  hero shot " }))).toBe("hero shot");
  });

  it("cuts an excerpt around the first match", () => {
    const text = `${"lorem ipsum ".repeat(20)}needle in the haystack ${"dolor sit ".repeat(20)}`;
    const out = excerpt(text, "needle", 60);
    expect(out).toContain("needle");
    expect(out.startsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(64);
  });

  it("keeps a short text whole and collapses whitespace", () => {
    expect(excerpt("one\n\n  two   three", "", 90)).toBe("one two three");
    expect(excerpt(undefined, "x")).toBe("");
  });

  it("suggests a dated file name, with a safe title in front", () => {
    const name = suggestedFileName(item("a", new Date(2026, 8, 11, 9, 5, 7).getTime(), { title: "hub: v2/final?" }));
    expect(name).toBe("hub- v2-final- 2026-09-11 09-05-07.png");
    expect(suggestedFileName(item("a", new Date(2026, 0, 2, 3, 4, 5).getTime()))).toBe("2026-01-02 03-04-05.png");
  });
});
