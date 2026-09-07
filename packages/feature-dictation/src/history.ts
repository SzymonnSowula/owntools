/**
 * A short local history of takes — what was dictated, when, and how long the
 * recording was. Kept in localStorage next to the settings so the pill (its
 * own window, same origin) and the dictate view see one list. Capped, and
 * never leaves the machine; the setting `keepHistory` turns it off and
 * `clearHistory` wipes it.
 */

export interface HistoryTake {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  text: string;
  /** Length of the recording in milliseconds, when known. */
  durationMs?: number;
}

export const HISTORY_KEY = "suite-dictation-history";
export const HISTORY_LIMIT = 100;
/** Fired on `window` after every write, so a view in the same window updates. */
export const HISTORY_EVENT = "suite-dictation-history";

let counter = 0;

function read(): HistoryTake[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is HistoryTake =>
        Boolean(t) &&
        typeof t === "object" &&
        typeof (t as HistoryTake).id === "string" &&
        typeof (t as HistoryTake).at === "number" &&
        typeof (t as HistoryTake).text === "string",
    );
  } catch {
    return [];
  }
}

function write(takes: HistoryTake[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(takes));
  } catch {
    /* quota or no storage: history is a convenience */
  }
  try {
    window.dispatchEvent(new Event(HISTORY_EVENT));
  } catch {
    /* no window (tests without jsdom) */
  }
}

/** Newest first. */
export function getHistory(): HistoryTake[] {
  return read().sort((a, b) => b.at - a.at);
}

export function pushHistory(text: string, durationMs?: number): HistoryTake | null {
  const body = text.trim();
  if (!body) return null;
  counter += 1;
  const take: HistoryTake = {
    id: `t${Date.now().toString(36)}${counter.toString(36)}`,
    at: Date.now(),
    text: body,
    ...(durationMs !== undefined ? { durationMs: Math.max(0, Math.round(durationMs)) } : {}),
  };
  write([take, ...getHistory()].slice(0, HISTORY_LIMIT));
  return take;
}

export function removeHistoryTake(id: string): void {
  write(getHistory().filter((t) => t.id !== id));
}

export function clearHistory(): void {
  write([]);
}

/** Word count the way the history page shows it. */
export function countWords(text: string): number {
  const words = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-@.]*/gu);
  return words ? words.length : 0;
}

/**
 * Subscribes to changes from this window (`HISTORY_EVENT`) and from the pill
 * window (the `storage` event, which fires across same-origin windows).
 */
export function subscribeHistory(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === HISTORY_KEY) listener();
  };
  window.addEventListener(HISTORY_EVENT, listener);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", listener);
  return () => {
    window.removeEventListener(HISTORY_EVENT, listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", listener);
  };
}
