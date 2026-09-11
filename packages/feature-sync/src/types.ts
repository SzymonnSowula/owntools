/**
 * Shapes shared by the merge, the engine, the backends and the card.
 *
 * On disk (in the person's synced folder) every collection is one file per
 * device: `{ version: 1, updatedAt, items, tombstones }` for a list of things
 * with ids, `{ version: 1, updatedAt, by, value }` for a single object. Every
 * item and tombstone carries the claim it competes with: *when* and *by which
 * device* — see `merge.ts`.
 */

export type CollectionId =
  | "dictation-settings"
  | "dictation-vocabulary"
  | "dictation-history"
  | "look-presets"
  | "focus"
  | "automations-rules"
  | "boards"
  | "meet";

export const COLLECTION_IDS: CollectionId[] = [
  "dictation-settings",
  "dictation-vocabulary",
  "dictation-history",
  "look-presets",
  "focus",
  "automations-rules",
  "boards",
  "meet",
];

export interface SyncItem<T = unknown> {
  id: string;
  /** Epoch ms of the last change to this item, as the writing device saw it. */
  updatedAt: number;
  /** Device id of the writer — the tie-break when two claims share an instant. */
  by: string;
  value: T;
}

export interface Tombstone {
  id: string;
  deletedAt: number;
  by: string;
}

export interface ItemsDoc<T = unknown> {
  version: 1;
  updatedAt: number;
  items: SyncItem<T>[];
  tombstones: Tombstone[];
}

export interface ValueDoc<T = unknown> {
  version: 1;
  updatedAt: number;
  by: string;
  value: T;
}

export type Doc<T = unknown> = ItemsDoc<T> | ValueDoc<T>;

export interface Manifest {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  updatedAt: number;
}

/** One device's subtree, as the backend read it (`manifest` null when unreadable). */
export interface RemoteDevice {
  deviceId: string;
  manifest: Manifest | null;
  /** Collection name → parsed JSON, unvalidated; `merge.ts` type guards decide. */
  collections: Record<string, unknown>;
}

export interface ReadAll {
  devices: RemoteDevice[];
  /** Skipped files, one line each. */
  warnings: string[];
  readAt: number;
}

export interface CopyOutcome {
  ok: boolean;
  skipped: boolean;
  reason: string | null;
  bytes: number;
  files: number;
}

export interface ScanEntry {
  name: string;
  isDir: boolean;
  mtimeMs: number;
  bytes: number;
}

export interface BackendStatus {
  folder: string | null;
  deviceId: string | null;
  deviceName: string | null;
  watching: boolean;
  lastRead: number | null;
  lastWrite: number | null;
  hostname: string | null;
  platform: string;
  appVersion: string;
}

/** A device other than this one, as the card lists it. */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  updatedAt: number;
  /** Its manifest is stamped more than an hour ahead of this clock. */
  futureClock: boolean;
}

export interface CollectionStatus {
  id: CollectionId;
  label: string;
  /** What it carries, in plain words. */
  detail: string;
  enabled: boolean;
  count: number;
  bytes: number;
  /** Collection-specific note ("last writer wins for focus data"). */
  note?: string;
}

export interface SyncStatus {
  /** False in a plain browser without the demo backend. */
  available: boolean;
  /** True when the in-memory demo folder stands in for Rust. */
  demo: boolean;
  folder: string | null;
  deviceId: string;
  deviceName: string;
  devices: DeviceInfo[];
  syncing: boolean;
  lastSyncAt: number | null;
  warnings: string[];
  error: string | null;
  collections: CollectionStatus[];
}
