import { useSyncExternalStore } from "react";
import { logError } from "@core/errors";
import { CAPTURE_SAVED_EVENT, onToolEvent } from "@core/events";
import { getCaptureBackend, type CaptureItem } from "./api";

/**
 * The library's state: the index as last read, plus a refresh that runs on
 * mount, when a capture lands (`CAPTURE_SAVED_EVENT`, or the backend saying
 * the index changed) and after every edit made here. One module-level store,
 * so leaving the tool and coming back does not re-read the index.
 */

export interface LibraryState {
  items: CaptureItem[];
  loaded: boolean;
  error: string | null;
}

let state: LibraryState = { items: [], loaded: false, error: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: Partial<LibraryState>): void {
  state = { ...state, ...next };
  for (const cb of Array.from(listeners)) cb();
}

export function getLibrary(): LibraryState {
  return state;
}

export function refreshLibrary(): Promise<void> {
  if (inflight) return inflight;
  inflight = getCaptureBackend()
    .list()
    .then((items) => set({ items, loaded: true, error: null }))
    .catch((err) => {
      logError("capture", "list", err);
      set({ loaded: true, error: "The capture library could not be read — check the log in Settings → Support." });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Local edits apply at once; the backend is the source of truth on the next refresh. */
export function patchItem(id: string, patch: Partial<CaptureItem>): void {
  set({ items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
}

export function dropItem(id: string): void {
  set({ items: state.items.filter((i) => i.id !== id) });
}

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  const backend = getCaptureBackend();
  onToolEvent(CAPTURE_SAVED_EVENT, () => void refreshLibrary());
  backend.onChanged(() => void refreshLibrary());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  wire();
  if (!state.loaded && !inflight) void refreshLibrary();
  return () => {
    listeners.delete(cb);
  };
}

export function useLibrary(): LibraryState {
  return useSyncExternalStore(subscribe, getLibrary, getLibrary);
}
