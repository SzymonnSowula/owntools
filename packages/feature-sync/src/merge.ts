/**
 * The merge — pure functions, no storage, no clock of their own.
 *
 * Rules (the whole of them):
 *
 * - **Per item, the latest claim wins.** A claim is `(updatedAt, by)`: a later
 *   timestamp beats an earlier one, and two claims at the same instant are
 *   settled by the lexically larger device id, so every device reaches the
 *   same answer without talking.
 * - **Deletion is a tombstone**, `{ id, deletedAt, by }`, competing on the same
 *   terms; an edit after the deletion resurrects the item. Tombstones are kept
 *   90 days, long enough for a laptop that spent a season in a drawer.
 * - **A single-object collection is one claim** for the whole value.
 * - **Local changes are found by a shadow.** The tools' own stores mostly carry
 *   no per-item `updatedAt` (a task, a look preset, a vocabulary entry), so the
 *   engine keeps a hash of every item as it was last synced; an item whose hash
 *   moved was edited *here*, *now*, and an id that vanished was deleted here.
 * - **First sync makes no claim.** A device with no shadow stamps everything
 *   `(0, "")`, so whatever the folder already holds wins the conflicts and
 *   nothing on a fresh install (its seed tasks, its default settings) can
 *   overwrite months of another device's work. What only exists locally gets a
 *   real stamp right after (`resolveFirstRun`).
 */

import type { ItemsDoc, SyncItem, Tombstone, ValueDoc } from "./types";

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** A manifest stamped further ahead than this is a wrong clock, not the future. */
export const FUTURE_CLOCK_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/** JSON with object keys sorted, so equal values hash equal whatever built them. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/** Two FNV-1a passes over the stable JSON plus its length — a change detector, not a signature. */
export function hashOf(value: unknown): string {
  const s = stableStringify(value);
  let h = 0x811c9dc5;
  let g = 0x1b873593;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
    g ^= s.charCodeAt(s.length - 1 - i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}${g.toString(36)}.${s.length.toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

export interface Claim {
  t: number;
  by: string;
}

/** True when `a` beats `b`. */
export function beats(a: Claim, b: Claim): boolean {
  return a.t > b.t || (a.t === b.t && a.by > b.by);
}

const claimOf = (item: SyncItem): Claim => ({ t: item.updatedAt, by: item.by });
const tombClaim = (t: Tombstone): Claim => ({ t: t.deletedAt, by: t.by });

/* ------------------------------------------------------------------ */
/* Type guards for what comes off the disk                             */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isItem(v: unknown): v is SyncItem {
  return isRecord(v) && typeof v.id === "string" && v.id.length > 0 && isNum(v.updatedAt) && typeof v.by === "string" && "value" in v;
}

function isTombstone(v: unknown): v is Tombstone {
  return isRecord(v) && typeof v.id === "string" && v.id.length > 0 && isNum(v.deletedAt) && typeof v.by === "string";
}

/** Accepts a doc from another device, dropping malformed entries rather than the file. */
export function asItemsDoc<T = unknown>(raw: unknown): ItemsDoc<T> | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.items)) return null;
  const items = raw.items.filter(isItem) as SyncItem<T>[];
  const tombstones = Array.isArray(raw.tombstones) ? raw.tombstones.filter(isTombstone) : [];
  return { version: 1, updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : 0, items, tombstones };
}

export function asValueDoc<T = unknown>(raw: unknown): ValueDoc<T> | null {
  if (!isRecord(raw) || raw.version !== 1 || !("value" in raw) || !isNum(raw.updatedAt)) return null;
  return { version: 1, updatedAt: raw.updatedAt, by: typeof raw.by === "string" ? raw.by : "", value: raw.value as T };
}

/* ------------------------------------------------------------------ */
/* Merging                                                             */
/* ------------------------------------------------------------------ */

export function emptyItemsDoc<T>(): ItemsDoc<T> {
  return { version: 1, updatedAt: 0, items: [], tombstones: [] };
}

export interface MergedItems<T> {
  doc: ItemsDoc<T>;
  /** id → index of the input doc whose claim won (items and tombstones alike). */
  origin: Map<string, number>;
}

/**
 * Union of every device's list. Per id the latest claim wins, whether it is a
 * version of the item or its deletion; tombstones past their TTL are dropped.
 * Items come back sorted by id so equal inputs give byte-equal outputs.
 */
export function mergeItems<T>(docs: readonly ItemsDoc<T>[], now = Date.now()): MergedItems<T> {
  const items = new Map<string, { item: SyncItem<T>; from: number }>();
  const tombs = new Map<string, { tomb: Tombstone; from: number }>();
  docs.forEach((doc, from) => {
    for (const item of doc.items) {
      const cur = items.get(item.id);
      if (!cur || beats(claimOf(item), claimOf(cur.item))) items.set(item.id, { item, from });
    }
    for (const tomb of doc.tombstones) {
      const cur = tombs.get(tomb.id);
      if (!cur || beats(tombClaim(tomb), tombClaim(cur.tomb))) tombs.set(tomb.id, { tomb, from });
    }
  });
  const origin = new Map<string, number>();
  const outItems: SyncItem<T>[] = [];
  const outTombs: Tombstone[] = [];
  const ids = new Set([...items.keys(), ...tombs.keys()]);
  for (const id of ids) {
    const it = items.get(id);
    const tb = tombs.get(id);
    if (it && tb) {
      if (beats(tombClaim(tb.tomb), claimOf(it.item))) {
        outTombs.push(tb.tomb);
        origin.set(id, tb.from);
      } else {
        outItems.push(it.item);
        origin.set(id, it.from);
      }
    } else if (it) {
      outItems.push(it.item);
      origin.set(id, it.from);
    } else if (tb) {
      outTombs.push(tb.tomb);
      origin.set(id, tb.from);
    }
  }
  // A tombstone is forgotten after the TTL unless some device still carries
  // the item it deletes: pruning it then would resurrect the item on the
  // next merge, which is the one thing a tombstone exists to prevent.
  const kept = outTombs.filter((t) => items.has(t.id) || now - t.deletedAt < TOMBSTONE_TTL_MS);
  outItems.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const updatedAt = Math.max(0, ...outItems.map((i) => i.updatedAt), ...kept.map((t) => t.deletedAt));
  return { doc: { version: 1, updatedAt, items: outItems, tombstones: kept }, origin };
}

export interface MergedValue<T> {
  doc: ValueDoc<T>;
  /** Index of the input doc that won. */
  origin: number;
}

/** The latest claim takes the whole value. */
export function mergeValue<T>(docs: readonly ValueDoc<T>[]): MergedValue<T> {
  if (!docs.length) throw new Error("mergeValue needs at least one doc");
  let best = 0;
  docs.forEach((doc, i) => {
    if (i > 0 && beats({ t: doc.updatedAt, by: doc.by }, { t: docs[best].updatedAt, by: docs[best].by })) best = i;
  });
  return { doc: docs[best], origin: best };
}

/** Keeps the `n` newest items by `timeOf` (default: the claim). Tombstones stay. */
export function capNewest<T>(doc: ItemsDoc<T>, n: number, timeOf: (v: T, item: SyncItem<T>) => number = (_v, i) => i.updatedAt): ItemsDoc<T> {
  if (doc.items.length <= n) return doc;
  const ranked = [...doc.items].sort((a, b) => timeOf(b.value, b) - timeOf(a.value, a) || (a.id < b.id ? -1 : 1));
  const keep = new Set(ranked.slice(0, n).map((i) => i.id));
  return { ...doc, items: doc.items.filter((i) => keep.has(i.id)) };
}

/* ------------------------------------------------------------------ */
/* Shadow: what this device last synced, so local edits can be found   */
/* ------------------------------------------------------------------ */

export interface ShadowEntry {
  hash: string;
  updatedAt: number;
  by: string;
}

export interface Shadow {
  items: Record<string, ShadowEntry>;
  tombstones: Record<string, { deletedAt: number; by: string }>;
  /** Single-object collections. */
  value?: ShadowEntry;
  /** Hash of the doc last written to the folder — skip the write when equal. */
  written?: string;
  /** Folder collections: `updatedAt` of the copy last pushed, per id. */
  pushed?: Record<string, number>;
}

export interface LocalItem<T> {
  id: string;
  value: T;
}

export function emptyShadow(): Shadow {
  return { items: {}, tombstones: {} };
}

/**
 * Turns this device's current list into a doc with claims: unchanged items keep
 * the claim they were synced with, changed or new ones are claimed now by this
 * device, and ids that were in the shadow but are gone become tombstones.
 * Without a shadow (first sync) nothing is claimed — see the module note.
 */
export function stampItems<T>(local: readonly LocalItem<T>[], shadow: Shadow | null, me: string, now: number): ItemsDoc<T> {
  const items: SyncItem<T>[] = [];
  const seen = new Set<string>();
  for (const { id, value } of local) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const hash = hashOf(value);
    const prev = shadow?.items[id];
    if (prev && prev.hash === hash) items.push({ id, updatedAt: prev.updatedAt, by: prev.by, value });
    else if (!shadow) items.push({ id, updatedAt: 0, by: "", value });
    else items.push({ id, updatedAt: now, by: me, value });
  }
  const tombstones: Tombstone[] = [];
  if (shadow) {
    for (const id of Object.keys(shadow.items)) {
      if (!seen.has(id)) tombstones.push({ id, deletedAt: now, by: me });
    }
    for (const [id, t] of Object.entries(shadow.tombstones)) {
      if (!seen.has(id) && !tombstones.some((x) => x.id === id)) tombstones.push({ id, deletedAt: t.deletedAt, by: t.by });
    }
  }
  const updatedAt = Math.max(0, ...items.map((i) => i.updatedAt), ...tombstones.map((t) => t.deletedAt));
  return { version: 1, updatedAt, items, tombstones };
}

export function stampValue<T>(value: T, shadow: Shadow | null, me: string, now: number): ValueDoc<T> {
  const hash = hashOf(value);
  const prev = shadow?.value;
  if (prev && prev.hash === hash) return { version: 1, updatedAt: prev.updatedAt, by: prev.by, value };
  if (!shadow) return { version: 1, updatedAt: 0, by: "", value };
  return { version: 1, updatedAt: now, by: me, value };
}

/** After the first merge: what only this device had gets a real claim. */
export function resolveFirstRun<T>(doc: ItemsDoc<T>, me: string, now: number): ItemsDoc<T> {
  if (!doc.items.some((i) => i.by === "" && i.updatedAt === 0)) return doc;
  const items = doc.items.map((i) => (i.by === "" && i.updatedAt === 0 ? { ...i, updatedAt: now, by: me } : i));
  return { ...doc, items, updatedAt: Math.max(doc.updatedAt, now) };
}

export function resolveFirstRunValue<T>(doc: ValueDoc<T>, me: string, now: number): ValueDoc<T> {
  return doc.by === "" && doc.updatedAt === 0 ? { ...doc, updatedAt: now, by: me } : doc;
}

/** The shadow to keep once `doc` is what both the tool and the folder hold. */
export function shadowOfItems<T>(doc: ItemsDoc<T>, prev?: Shadow | null): Shadow {
  const items: Record<string, ShadowEntry> = {};
  for (const i of doc.items) items[i.id] = { hash: hashOf(i.value), updatedAt: i.updatedAt, by: i.by };
  const tombstones: Record<string, { deletedAt: number; by: string }> = {};
  for (const t of doc.tombstones) tombstones[t.id] = { deletedAt: t.deletedAt, by: t.by };
  const out: Shadow = { items, tombstones };
  if (prev?.written) out.written = prev.written;
  if (prev?.pushed) out.pushed = prev.pushed;
  return out;
}

export function shadowOfValue<T>(doc: ValueDoc<T>, prev?: Shadow | null): Shadow {
  const out: Shadow = { items: {}, tombstones: {}, value: { hash: hashOf(doc.value), updatedAt: doc.updatedAt, by: doc.by } };
  if (prev?.written) out.written = prev.written;
  return out;
}

/* ------------------------------------------------------------------ */
/* Differences                                                         */
/* ------------------------------------------------------------------ */

/** Ids whose local value differs from the merged one, plus ids to remove locally. */
export function diffLocal<T>(local: readonly LocalItem<T>[], merged: ItemsDoc<T>): { changed: string[]; removed: string[] } {
  const have = new Map(local.map((l) => [l.id, hashOf(l.value)] as const));
  const changed: string[] = [];
  const keep = new Set<string>();
  for (const item of merged.items) {
    keep.add(item.id);
    if (have.get(item.id) !== hashOf(item.value)) changed.push(item.id);
  }
  const removed = [...have.keys()].filter((id) => !keep.has(id));
  return { changed, removed };
}

/** Two docs describe the same state when their items and tombstones match claim for claim. */
export function sameDoc(a: ItemsDoc | ValueDoc, b: ItemsDoc | ValueDoc): boolean {
  return hashOf(a) === hashOf(b);
}

/* ------------------------------------------------------------------ */
/* Clocks                                                              */
/* ------------------------------------------------------------------ */

export function futureClock(manifestUpdatedAt: number, now = Date.now()): boolean {
  return manifestUpdatedAt - now > FUTURE_CLOCK_MS;
}
