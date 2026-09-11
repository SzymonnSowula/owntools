import { getHistory, HISTORY_EVENT, HISTORY_KEY, HISTORY_LIMIT, subscribeHistory, type HistoryTake } from "@feature-dictation/history";
import { bytesOf, isRecord, type ItemsAdapter } from "./adapter";

/**
 * The last takes, one item per take. Takes are immutable — the only edits are
 * removals, which travel as tombstones — so merging is a union capped at the
 * tool's own limit of the newest 100 by `at`.
 */

function isTake(v: unknown): v is HistoryTake {
  return isRecord(v) && typeof v.id === "string" && typeof v.at === "number" && typeof v.text === "string";
}

export const dictationHistoryAdapter: ItemsAdapter<HistoryTake> = {
  kind: "items",
  id: "dictation-history",
  label: "Dictation history",
  detail: `the last ${HISTORY_LIMIT} takes; a take removed on one device is removed everywhere`,
  cap: { n: HISTORY_LIMIT, timeOf: (t) => t.at },
  async read() {
    const takes = getHistory();
    return { items: takes.map((t) => ({ id: t.id, value: t })), bytes: bytesOf(takes) };
  },
  async apply(_ctx, merged) {
    // `pushHistory` mints new ids, so the list is written the way the tool
    // writes it — same key, same event — with the merged takes, newest first.
    const takes = merged.items
      .map((i) => i.value)
      .filter(isTake)
      .sort((a, b) => b.at - a.at)
      .slice(0, HISTORY_LIMIT);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(takes));
    } catch {
      /* quota */
    }
    try {
      window.dispatchEvent(new Event(HISTORY_EVENT));
    } catch {
      /* no window */
    }
  },
  subscribe(cb) {
    if (typeof window === "undefined") return () => {};
    return subscribeHistory(cb);
  },
};
