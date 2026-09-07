// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  countWords,
  getHistory,
  HISTORY_KEY,
  HISTORY_LIMIT,
  pushHistory,
  removeHistoryTake,
  subscribeHistory,
} from "./history";

beforeEach(() => {
  localStorage.clear();
});

describe("history", () => {
  it("stores takes newest first with their duration", () => {
    expect(pushHistory("   ")).toBeNull();
    const first = pushHistory("first take", 1200.6);
    const second = pushHistory("second take");
    const list = getHistory();
    expect(list.map((t) => t.text)).toEqual(["second take", "first take"]);
    expect(first?.durationMs).toBe(1201);
    expect(second?.durationMs).toBeUndefined();
  });

  it("caps the list and survives a corrupt store", () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) pushHistory(`take ${i}`);
    expect(getHistory()).toHaveLength(HISTORY_LIMIT);
    expect(getHistory()[0].text).toBe(`take ${HISTORY_LIMIT + 4}`);
    localStorage.setItem(HISTORY_KEY, "{not json");
    expect(getHistory()).toEqual([]);
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ id: 1 }, { id: "x", at: 1, text: "ok" }]));
    expect(getHistory().map((t) => t.text)).toEqual(["ok"]);
  });

  it("removes one take or all of them and notifies subscribers", () => {
    const seen = vi.fn();
    const off = subscribeHistory(seen);
    const a = pushHistory("a");
    pushHistory("b");
    removeHistoryTake(a!.id);
    expect(getHistory().map((t) => t.text)).toEqual(["b"]);
    clearHistory();
    expect(getHistory()).toEqual([]);
    expect(seen).toHaveBeenCalledTimes(4);
    off();
    pushHistory("c");
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it("counts words the way a person would", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("Hello, world — it's anna@x.dev")).toBe(4);
    expect(countWords("Łódź jest piękna.")).toBe(3);
  });
});
