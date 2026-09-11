/**
 * DOM events on `window` between the sync engine and the tools.
 *
 * `SYNC_APPLIED_EVENT` — the engine changed a tool's storage from another
 * device's data. Tools that keep their store in memory (the board view's
 * index, an automations rule list) should reload on it; the localStorage
 * collections need nothing, their own change events are fired for them.
 *
 * `SYNC_TOUCH_EVENT` — a tool tells the engine "I just wrote <collection>",
 * so a file-backed collection is pushed now instead of at the next poll.
 */

export const SYNC_APPLIED_EVENT = "owntools:sync-applied";
export interface SyncApplied {
  collection: string;
  /** Ids that changed locally (folder collections: board / meeting ids). */
  ids: string[];
  /** Ids removed locally because another device deleted them. */
  removed: string[];
}

export const SYNC_TOUCH_EVENT = "owntools:sync-touch";
export interface SyncTouch {
  collection: string;
}

export function emitSyncApplied(detail: SyncApplied): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SyncApplied>(SYNC_APPLIED_EVENT, { detail }));
}

export function onSyncApplied(cb: (detail: SyncApplied) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<SyncApplied>).detail);
  window.addEventListener(SYNC_APPLIED_EVENT, handler);
  return () => window.removeEventListener(SYNC_APPLIED_EVENT, handler);
}

/** For a tool: hurry the push of a file-backed collection it just wrote. */
export function touchSync(collection: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SyncTouch>(SYNC_TOUCH_EVENT, { detail: { collection } }));
}

export function onSyncTouch(collection: string, cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<SyncTouch>).detail;
    if (!detail || detail.collection === collection) cb();
  };
  window.addEventListener(SYNC_TOUCH_EVENT, handler);
  return () => window.removeEventListener(SYNC_TOUCH_EVENT, handler);
}
