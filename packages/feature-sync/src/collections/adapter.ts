import type { SyncBackend } from "../api/backend";
import type { LocalItem, Shadow } from "../merge";
import type { CollectionId, ItemsDoc } from "../types";

/**
 * One adapter per collection: how to read the tool's storage into ids and
 * values, how to write a merged result back *through the tool's own
 * functions* (so its views update live), and how to learn that it changed.
 * The engine owns the claims, the shadow and the folder; an adapter never
 * sees another device.
 */

export interface AdapterContext {
  backend: SyncBackend;
  /** This device's id. */
  me: string;
  now(): number;
  /** A line for the card ("board Roadmap skipped: 31 MB, over the 20 MB limit"). */
  warn(message: string): void;
}

export interface LocalItems<T> {
  items: LocalItem<T>[];
  /** Approximate size for the card. */
  bytes: number;
}

export interface ItemsAdapter<T> {
  kind: "items";
  id: CollectionId;
  label: string;
  detail: string;
  note?: string;
  /** Keep only the newest `n` after merging (history). */
  cap?: { n: number; timeOf: (value: T) => number };
  /** Null = not ready yet (a store still hydrating); the cycle skips it. */
  read(ctx: AdapterContext): Promise<LocalItems<T> | null>;
  /**
   * Make local storage match `merged`. Only `changed` (new or different) and
   * `removed` ids differ; `origin` names the device whose version won, so a
   * folder collection knows where to copy from (`ctx.me` = already local).
   */
  apply(ctx: AdapterContext, merged: ItemsDoc<T>, changed: string[], removed: string[], origin: Map<string, string>): Promise<void>;
  /**
   * Folder collections: mirror changed local folders into this device's
   * subtree before the doc is written. Returns ids that could not be pushed
   * (over the size cap) and are left out of the doc, and the claims pushed.
   */
  push?(ctx: AdapterContext, doc: ItemsDoc<T>, shadow: Shadow): Promise<{ dropped: string[]; pushed: Record<string, number> }>;
  subscribe(cb: () => void): () => void;
}

export interface ValueAdapter<T> {
  kind: "value";
  id: CollectionId;
  label: string;
  detail: string;
  note?: string;
  read(ctx: AdapterContext): Promise<{ value: T; bytes: number } | null>;
  apply(ctx: AdapterContext, value: T): Promise<void>;
  subscribe(cb: () => void): () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Adapter = ItemsAdapter<any> | ValueAdapter<any>;

export function bytesOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `storage` events for one key (another window of the same origin wrote it). */
export function onStorageKey(key: string, cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === null || e.key === key) cb();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/** Polls a cheap signature and calls back when it moves. */
export function poll(everyMs: number, signature: () => Promise<string> | string, cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let last: string | null = null;
  let stopped = false;
  const tick = async () => {
    try {
      const sig = await signature();
      if (last !== null && sig !== last) cb();
      last = sig;
    } catch {
      /* the file may not exist yet */
    }
  };
  void tick();
  const timer = window.setInterval(() => {
    if (!stopped) void tick();
  }, everyMs);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

export function combine(...unsubs: Array<() => void>): () => void {
  return () => unsubs.forEach((u) => u());
}
