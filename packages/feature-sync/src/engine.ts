import { describeError, logError, logInfo } from "@core/errors";
import { useSyncExternalStore } from "react";
import { getSyncBackend, type SyncBackend } from "./api";
import { ADAPTERS, type Adapter, type AdapterContext } from "./collections";
import { adoptDeviceId, deviceId as newDeviceId, deviceName as resolveDeviceName, setDeviceName as storeDeviceName, storedDeviceId } from "./identity";
import {
  asItemsDoc,
  asValueDoc,
  capNewest,
  diffLocal,
  emptyShadow,
  futureClock,
  hashOf,
  mergeItems,
  mergeValue,
  resolveFirstRun,
  resolveFirstRunValue,
  shadowOfItems,
  shadowOfValue,
  stampItems,
  stampValue,
  type Shadow,
} from "./merge";
import type { CollectionId, CollectionStatus, DeviceInfo, ItemsDoc, ReadAll, SyncStatus, ValueDoc } from "./types";

/**
 * The loop. One cycle per collection:
 *
 *   read the tool → stamp against the shadow → merge with every other device →
 *   apply what changed through the tool's own functions → write our doc →
 *   remember the shadow.
 *
 * A **pull** (start, the folder watcher, "Sync now") runs every collection
 * against the other devices' files; a **push** (a tool's change event, 2 s
 * after the last one) runs one collection against nothing — its job is to
 * write our doc. Cycles never overlap: they queue and coalesce.
 */

const SHADOW_PREFIX = "owntools-sync-shadow:";
const ENABLED_KEY = "owntools-sync-collections";
export const PUSH_DEBOUNCE_MS = 2000;
const PULL_DEBOUNCE_MS = 400;

/* ------------------------------------------------------------------ */
/* Status store                                                        */
/* ------------------------------------------------------------------ */

function initialStatus(): SyncStatus {
  return {
    available: false,
    demo: false,
    folder: null,
    deviceId: "",
    deviceName: "",
    devices: [],
    syncing: false,
    lastSyncAt: null,
    warnings: [],
    error: null,
    collections: [],
  };
}

let status: SyncStatus = initialStatus();
const statusListeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const l of statusListeners) l();
}

function subscribeStatus(l: () => void): () => void {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
}

const getStatus = () => status;

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

/* ------------------------------------------------------------------ */
/* Persistence of the engine's own state                               */
/* ------------------------------------------------------------------ */

function loadShadow(id: CollectionId): Shadow | null {
  try {
    const raw = localStorage.getItem(SHADOW_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Shadow>;
    if (!parsed || typeof parsed !== "object") return null;
    return { ...emptyShadow(), ...parsed, items: parsed.items ?? {}, tombstones: parsed.tombstones ?? {} };
  } catch {
    return null;
  }
}

function saveShadow(id: CollectionId, shadow: Shadow): void {
  try {
    localStorage.setItem(SHADOW_PREFIX + id, JSON.stringify(shadow));
  } catch {
    /* quota: the next cycle re-derives what it can */
  }
}

function clearShadow(id: CollectionId): void {
  try {
    localStorage.removeItem(SHADOW_PREFIX + id);
  } catch {
    /* */
  }
}

function clearAllShadows(): void {
  for (const a of ADAPTERS) clearShadow(a.id);
}

function loadEnabled(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function isEnabled(id: CollectionId): boolean {
  return loadEnabled()[id] !== false;
}

/* ------------------------------------------------------------------ */
/* Engine state                                                        */
/* ------------------------------------------------------------------ */

let backend: SyncBackend | null = null;
let me = "";
let started = false;
let unsubs: Array<() => void> = [];
const pushTimers = new Map<CollectionId, number>();
let pullTimer: number | null = null;
const queued = { pull: false, push: new Set<CollectionId>() };
let running: Promise<void> | null = null;
const counts = new Map<CollectionId, { count: number; bytes: number }>();
let stickyWarnings: string[] = [];

function describeCollections(): CollectionStatus[] {
  return ADAPTERS.map((a) => ({
    id: a.id,
    label: a.label,
    detail: a.detail,
    note: a.note,
    enabled: isEnabled(a.id),
    count: counts.get(a.id)?.count ?? 0,
    bytes: counts.get(a.id)?.bytes ?? 0,
  }));
}

function devicesOf(read: ReadAll, now: number): DeviceInfo[] {
  return read.devices
    .filter((d) => d.deviceId !== me)
    .map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.manifest?.deviceName || d.deviceId.slice(0, 8),
      platform: d.manifest?.platform ?? "unknown",
      appVersion: d.manifest?.appVersion ?? "",
      updatedAt: d.manifest?.updatedAt ?? 0,
      futureClock: futureClock(d.manifest?.updatedAt ?? 0, now),
    }))
    .sort((a, b) => a.deviceName.localeCompare(b.deviceName));
}

/* ------------------------------------------------------------------ */
/* One collection                                                      */
/* ------------------------------------------------------------------ */

async function syncValue<T>(adapter: Extract<Adapter, { kind: "value" }>, remote: ReadAll | null, ctx: AdapterContext, now: number): Promise<void> {
  const local = await adapter.read(ctx);
  if (!local) return;
  const shadow = loadShadow(adapter.id);
  const localDoc = stampValue(local.value as T, shadow, me, now);
  const remoteDocs: ValueDoc<T>[] = [];
  if (remote) {
    for (const d of remote.devices) {
      if (d.deviceId === me) continue;
      const doc = asValueDoc<T>(d.collections[adapter.id]);
      if (doc) remoteDocs.push(doc);
    }
  }
  const winner = mergeValue([localDoc, ...remoteDocs]);
  let doc = winner.doc;
  if (winner.origin !== 0 && hashOf(doc.value) !== hashOf(local.value)) {
    await adapter.apply(ctx, doc.value);
    const after = await adapter.read(ctx);
    if (after) doc = { ...doc, value: after.value as T };
  }
  doc = resolveFirstRunValue(doc, me, now);
  const written = hashOf(doc);
  if (shadow?.written !== written) await ctx.backend.write(adapter.id, JSON.stringify(doc));
  saveShadow(adapter.id, { ...shadowOfValue(doc, shadow), written });
  counts.set(adapter.id, { count: 1, bytes: local.bytes });
}

async function syncItems<T>(adapter: Extract<Adapter, { kind: "items" }>, remote: ReadAll | null, ctx: AdapterContext, now: number): Promise<void> {
  const local = await adapter.read(ctx);
  if (!local) return;
  const shadow = loadShadow(adapter.id);
  const localDoc = stampItems<T>(local.items, shadow, me, now);
  const docs: ItemsDoc<T>[] = [localDoc];
  const deviceOfDoc: string[] = [me];
  if (remote) {
    for (const d of remote.devices) {
      if (d.deviceId === me) continue;
      const doc = asItemsDoc<T>(d.collections[adapter.id]);
      if (doc) {
        docs.push(doc);
        deviceOfDoc.push(d.deviceId);
      }
    }
  }
  const mergedRaw = mergeItems(docs, now);
  let merged = mergedRaw.doc;
  if (adapter.cap) merged = capNewest(merged, adapter.cap.n, adapter.cap.timeOf as (v: T) => number);
  merged = resolveFirstRun(merged, me, now);
  const origin = new Map<string, string>();
  for (const [id, idx] of mergedRaw.origin) origin.set(id, deviceOfDoc[idx] ?? me);

  const { changed, removed } = diffLocal(local.items, merged);
  let finalDoc = merged;
  if (changed.length || removed.length) {
    await adapter.apply(ctx, merged, changed, removed, origin);
    const after = await adapter.read(ctx);
    if (after) {
      // Keep the merged claims; take the values the tool actually stored.
      const stored = new Map(after.items.map((i) => [i.id, i.value as T] as const));
      finalDoc = {
        ...merged,
        items: merged.items.filter((i) => stored.has(i.id)).map((i) => ({ ...i, value: stored.get(i.id) as T })),
      };
    }
    logInfo("sync", `${adapter.id}: applied ${changed.length} change(s), ${removed.length} removal(s) from other devices`);
  }

  let pushed = shadow?.pushed;
  let dropped: string[] = [];
  if (adapter.push) {
    const result = await adapter.push(ctx, finalDoc, shadow ?? emptyShadow());
    pushed = result.pushed;
    dropped = result.dropped;
    if (dropped.length) finalDoc = { ...finalDoc, items: finalDoc.items.filter((i) => !dropped.includes(i.id)) };
  }

  const written = hashOf(finalDoc);
  if (shadow?.written !== written) await ctx.backend.write(adapter.id, JSON.stringify(finalDoc));
  // Skipped (over-cap) folders keep a stable claim in the shadow so they are
  // not re-stamped every cycle; everything else hashes what the tool holds.
  const forShadow: ItemsDoc<T> = {
    ...finalDoc,
    items: [...finalDoc.items, ...merged.items.filter((i) => dropped.includes(i.id))],
  };
  const nextShadow = shadowOfItems(forShadow, shadow);
  nextShadow.written = written;
  if (pushed) nextShadow.pushed = pushed;
  saveShadow(adapter.id, nextShadow);
  counts.set(adapter.id, { count: finalDoc.items.length, bytes: local.bytes });
}

/* ------------------------------------------------------------------ */
/* Cycles                                                              */
/* ------------------------------------------------------------------ */

async function runCycle(pull: boolean, push: Set<CollectionId>): Promise<void> {
  if (!backend || !status.folder) return;
  const now = Date.now();
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const ctx: AdapterContext = { backend, me, now: () => Date.now(), warn };
  setStatus({ syncing: true });
  try {
    const remote = pull ? await backend.readAll() : null;
    const targets = pull ? ADAPTERS : ADAPTERS.filter((a) => push.has(a.id));
    for (const adapter of targets) {
      if (!isEnabled(adapter.id)) continue;
      try {
        if (adapter.kind === "value") await syncValue(adapter, remote, ctx, now);
        else await syncItems(adapter, remote, ctx, now);
      } catch (err) {
        logError("sync", adapter.id, err);
        warn(`${adapter.label}: ${describeError(err)}`);
      }
    }
    if (remote) {
      stickyWarnings = [...remote.warnings.map((w) => `Skipped file: ${w}`), ...warnings];
      setStatus({ devices: devicesOf(remote, now), lastSyncAt: Date.now(), error: null, warnings: stickyWarnings, collections: describeCollections() });
    } else {
      if (warnings.length) stickyWarnings = [...new Set([...stickyWarnings, ...warnings])];
      setStatus({ error: null, warnings: stickyWarnings, collections: describeCollections() });
    }
  } catch (err) {
    logError("sync", pull ? "pull" : "push", err);
    setStatus({ error: describeError(err) });
  } finally {
    setStatus({ syncing: false });
  }
}

function drain(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      while (queued.pull || queued.push.size) {
        const pull = queued.pull;
        const push = new Set(queued.push);
        queued.pull = false;
        queued.push.clear();
        await runCycle(pull, push);
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

function schedulePush(id: CollectionId): void {
  if (!status.folder || typeof window === "undefined") return;
  const prev = pushTimers.get(id);
  if (prev !== undefined) window.clearTimeout(prev);
  pushTimers.set(
    id,
    window.setTimeout(() => {
      pushTimers.delete(id);
      queued.push.add(id);
      void drain();
    }, PUSH_DEBOUNCE_MS),
  );
}

function schedulePull(): void {
  if (!status.folder || typeof window === "undefined") return;
  if (pullTimer !== null) window.clearTimeout(pullTimer);
  pullTimer = window.setTimeout(() => {
    pullTimer = null;
    queued.pull = true;
    void drain();
  }, PULL_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

/**
 * Starts the engine: identity, subscriptions, and — when a folder is already
 * chosen — the first pull plus the watcher. Safe to call once per window;
 * meant for App.tsx after the storage migration and the license init.
 */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  backend = getSyncBackend();
  let st;
  try {
    st = await backend.status();
  } catch (err) {
    logError("sync", "status", err);
    setStatus({ available: false, error: describeError(err) });
    return;
  }
  me = storedDeviceId() ?? (st.deviceId ? adoptDeviceId(st.deviceId) : newDeviceId());
  const name = resolveDeviceName(st.hostname, st.platform);
  try {
    await backend.setDevice(me, name);
  } catch (err) {
    logError("sync", "set device", err);
  }
  setStatus({
    available: true,
    demo: backend.kind === "demo",
    folder: st.folder,
    deviceId: me,
    deviceName: name,
    collections: describeCollections(),
  });
  for (const a of ADAPTERS) {
    try {
      unsubs.push(a.subscribe(() => schedulePush(a.id)));
    } catch (err) {
      logError("sync", `subscribe ${a.id}`, err);
    }
  }
  unsubs.push(backend.onChanged(() => schedulePull()));
  if (st.folder) {
    queued.pull = true;
    await drain();
    try {
      await backend.watch(true);
    } catch (err) {
      logError("sync", "watch", err);
    }
    logInfo("sync", `started: folder set, ${status.devices.length} other device(s)`);
  } else {
    logInfo("sync", "started: no folder chosen");
  }
}

/** Tears the engine down (tests, and a window going away). */
export function stopSync(): void {
  for (const u of unsubs) u();
  unsubs = [];
  for (const t of pushTimers.values()) if (typeof window !== "undefined") window.clearTimeout(t);
  pushTimers.clear();
  if (pullTimer !== null && typeof window !== "undefined") window.clearTimeout(pullTimer);
  pullTimer = null;
  queued.pull = false;
  queued.push.clear();
  started = false;
  backend = null;
  counts.clear();
  stickyWarnings = [];
  status = initialStatus();
  for (const l of statusListeners) l();
}

/** Reads every device's files and merges — "Sync now". */
export async function syncNow(): Promise<void> {
  if (!backend || !status.folder) return;
  queued.pull = true;
  await drain();
}

/** Other devices already in a folder, without committing to it. */
export async function peekFolder(folder: string): Promise<DeviceInfo[]> {
  if (!backend) throw new Error("sync is not started");
  const read = await backend.readAll(folder);
  return devicesOf(read, Date.now());
}

/**
 * Chooses the folder. Shadows are cleared, so this behaves like a first sync:
 * what the folder already holds wins the conflicts, and only what exists
 * nowhere else is pushed from here.
 */
export async function setSyncFolder(folder: string): Promise<void> {
  if (!backend) throw new Error("sync is not started");
  await backend.setFolder(folder);
  clearAllShadows();
  stickyWarnings = [];
  setStatus({ folder, error: null, warnings: [], devices: [] });
  queued.pull = true;
  await drain();
  try {
    await backend.watch(true);
  } catch (err) {
    logError("sync", "watch", err);
  }
  logInfo("sync", `folder chosen: ${folder}`);
}

/** Stops syncing and forgets the folder. The files stay; nothing local changes. */
export async function clearSyncFolder(): Promise<void> {
  if (!backend) return;
  try {
    await backend.watch(false);
  } catch {
    /* */
  }
  await backend.clearFolder();
  clearAllShadows();
  stickyWarnings = [];
  counts.clear();
  setStatus({ folder: null, devices: [], warnings: [], error: null, lastSyncAt: null, collections: describeCollections() });
  logInfo("sync", "folder cleared");
}

export async function pickSyncFolder(): Promise<string | null> {
  if (!backend) throw new Error("sync is not started");
  return backend.pickFolder();
}

export async function renameDevice(name: string): Promise<void> {
  if (!backend) return;
  const clean = storeDeviceName(name);
  if (!clean) return;
  await backend.setDevice(me, clean);
  setStatus({ deviceName: clean });
}

/**
 * Switches a collection on or off. Turning one off also forgets its shadow,
 * so turning it back on is a first sync again — the folder wins conflicts,
 * which is the safe direction after a gap.
 */
export function setCollectionEnabled(id: CollectionId, enabled: boolean): void {
  const next = { ...loadEnabled(), [id]: enabled };
  try {
    localStorage.setItem(ENABLED_KEY, JSON.stringify(next));
  } catch {
    /* */
  }
  if (!enabled) {
    clearShadow(id);
    counts.delete(id);
  }
  setStatus({ collections: describeCollections() });
  if (enabled && status.folder) {
    queued.pull = true;
    void drain();
  }
}

/** For tests: the id this window syncs as. */
export function currentDeviceId(): string {
  return me;
}
