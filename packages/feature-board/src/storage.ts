import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { BinaryFileData, LibraryItems } from "@excalidraw/excalidraw/types";
import { isTauri } from "@core/env";
import { parseIndex, parseStoredScene, type BoardIndex, type StoredScene } from "./boards";

/**
 * Where boards live. In the app: `<AppData>/board/` — `index.json`, one folder
 * per board with `scene.json`, `files/<id>.json` (one image each, as the
 * data-URL record Excalidraw hands us) and `thumb.jpg`. In a plain browser
 * (`pnpm dev`) the same shape goes into IndexedDB.
 */
export interface BoardStorage {
  readonly kind: "tauri" | "browser";
  loadIndex(): Promise<BoardIndex>;
  saveIndex(index: BoardIndex): Promise<void>;
  loadScene(id: string): Promise<StoredScene | null>;
  saveScene(id: string, scene: StoredScene): Promise<void>;
  /** On-disk keys (see `fileKey`) of the images persisted for a board. */
  listFileKeys(id: string): Promise<string[]>;
  loadFiles(id: string, keys: readonly string[]): Promise<BinaryFileData[]>;
  saveFile(id: string, file: BinaryFileData): Promise<void>;
  removeFile(id: string, fileIdOrKey: string): Promise<void>;
  removeBoard(id: string): Promise<void>;
  saveThumb(id: string, blob: Blob): Promise<void>;
  /** URL of the preview, or null when there is none. `version` busts caches. */
  thumbUrl(id: string, version: number): Promise<string | null>;
  loadLibrary(): Promise<LibraryItems | null>;
  saveLibrary(items: LibraryItems): Promise<void>;
  /** Opens the file manager on a board's folder (desktop only). */
  reveal(id?: string): Promise<void>;
}

/** Excalidraw file ids are hex hashes; anything else is made safe for a file name. Idempotent. */
export function fileKey(fileId: string): string {
  return fileId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

function isFileData(value: unknown): value is BinaryFileData {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Partial<BinaryFileData>;
  return typeof f.id === "string" && typeof f.dataURL === "string" && typeof f.mimeType === "string";
}

function parseFileData(raw: string): BinaryFileData | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!isFileData(data)) return null;
    return { ...data, created: typeof data.created === "number" ? data.created : Date.now() };
  } catch {
    return null;
  }
}

function parseLibrary(raw: string | null | undefined): LibraryItems | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? (data as LibraryItems) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Tauri: <AppData>/board                                              */
/* ------------------------------------------------------------------ */

const ROOT = "board";
const BOARDS = `${ROOT}/boards`;
const INDEX = `${ROOT}/index.json`;
const LIBRARY = `${ROOT}/library.json`;
const APP_DATA = { baseDir: BaseDirectory.AppData } as const;

const boardDir = (id: string) => `${BOARDS}/${id}`;
const filesDir = (id: string) => `${boardDir(id)}/files`;
const sceneFile = (id: string) => `${boardDir(id)}/scene.json`;
const thumbFile = (id: string) => `${boardDir(id)}/thumb.jpg`;
const fileFile = (id: string, fileId: string) => `${filesDir(id)}/${fileKey(fileId)}.json`;

async function ensureDir(rel: string): Promise<void> {
  if (!(await exists(rel, APP_DATA))) await mkdir(rel, { ...APP_DATA, recursive: true });
}

/** Write next to the target, then rename over it, so a crash never leaves a half-written JSON. */
async function writeTextAtomic(rel: string, text: string): Promise<void> {
  const tmp = `${rel}.tmp`;
  await writeTextFile(tmp, text, APP_DATA);
  await rename(tmp, rel, {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  });
}

async function readTextOrNull(rel: string): Promise<string | null> {
  if (!(await exists(rel, APP_DATA))) return null;
  return readTextFile(rel, APP_DATA);
}

async function appDataPath(rel: string): Promise<string> {
  return join(await appDataDir(), rel);
}

const tauriStorage: BoardStorage = {
  kind: "tauri",
  async loadIndex() {
    return parseIndex(await readTextOrNull(INDEX));
  },
  async saveIndex(index) {
    await ensureDir(ROOT);
    await writeTextAtomic(INDEX, JSON.stringify(index, null, 2));
  },
  async loadScene(id) {
    return parseStoredScene(await readTextOrNull(sceneFile(id)));
  },
  async saveScene(id, scene) {
    await ensureDir(boardDir(id));
    await writeTextAtomic(sceneFile(id), JSON.stringify(scene));
  },
  async listFileKeys(id) {
    if (!(await exists(filesDir(id), APP_DATA))) return [];
    const entries = await readDir(filesDir(id), APP_DATA);
    return entries
      .filter((e) => e.isFile && e.name.endsWith(".json"))
      .map((e) => e.name.slice(0, -".json".length));
  },
  async loadFiles(id, keys) {
    const out: BinaryFileData[] = [];
    for (const key of keys) {
      const raw = await readTextOrNull(fileFile(id, key));
      const file = raw ? parseFileData(raw) : null;
      if (file) out.push(file);
    }
    return out;
  },
  async saveFile(id, file) {
    await ensureDir(filesDir(id));
    await writeTextAtomic(fileFile(id, file.id), JSON.stringify(file));
  },
  async removeFile(id, fileIdOrKey) {
    const rel = fileFile(id, fileIdOrKey);
    if (await exists(rel, APP_DATA)) await remove(rel, APP_DATA);
  },
  async removeBoard(id) {
    const rel = boardDir(id);
    if (await exists(rel, APP_DATA)) await remove(rel, { ...APP_DATA, recursive: true });
  },
  async saveThumb(id, blob) {
    await ensureDir(boardDir(id));
    await writeFile(thumbFile(id), new Uint8Array(await blob.arrayBuffer()), APP_DATA);
  },
  async thumbUrl(id, version) {
    if (!version || !(await exists(thumbFile(id), APP_DATA))) return null;
    return `${convertFileSrc(await appDataPath(thumbFile(id)))}?v=${version}`;
  },
  async loadLibrary() {
    return parseLibrary(await readTextOrNull(LIBRARY));
  },
  async saveLibrary(items) {
    await ensureDir(ROOT);
    await writeTextAtomic(LIBRARY, JSON.stringify(items));
  },
  async reveal(id) {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await ensureDir(BOARDS);
    const target = id && (await exists(sceneFile(id), APP_DATA)) ? sceneFile(id) : BOARDS;
    await revealItemInDir(await appDataPath(target));
  },
};

/* ------------------------------------------------------------------ */
/* Browser: IndexedDB key/value                                        */
/* ------------------------------------------------------------------ */

const DB_NAME = "owntools-board";
const STORE = "kv";
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const kvGet = <T>(key: string) => tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
const kvSet = (key: string, value: unknown) => tx("readwrite", (s) => s.put(value, key)).then(() => undefined);
const kvDel = (key: string) => tx("readwrite", (s) => s.delete(key)).then(() => undefined);
const kvKeys = (prefix: string) =>
  tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + String.fromCharCode(0xffff)))).then(
    (keys) => keys.map(String),
  );

const objectUrls = new Map<string, { version: number; url: string }>();

const browserStorage: BoardStorage = {
  kind: "browser",
  async loadIndex() {
    return parseIndex((await kvGet<string>("index")) ?? null);
  },
  async saveIndex(index) {
    await kvSet("index", JSON.stringify(index));
  },
  async loadScene(id) {
    return parseStoredScene((await kvGet<string>(`scene:${id}`)) ?? null);
  },
  async saveScene(id, scene) {
    await kvSet(`scene:${id}`, JSON.stringify(scene));
  },
  async listFileKeys(id) {
    const prefix = `file:${id}:`;
    return (await kvKeys(prefix)).map((k) => k.slice(prefix.length));
  },
  async loadFiles(id, keys) {
    const out: BinaryFileData[] = [];
    for (const key of keys) {
      const file = await kvGet<unknown>(`file:${id}:${fileKey(key)}`);
      if (isFileData(file)) out.push(file);
    }
    return out;
  },
  async saveFile(id, file) {
    await kvSet(`file:${id}:${fileKey(file.id)}`, file);
  },
  async removeFile(id, fileIdOrKey) {
    await kvDel(`file:${id}:${fileKey(fileIdOrKey)}`);
  },
  async removeBoard(id) {
    const keys = [...(await kvKeys(`file:${id}:`)), `scene:${id}`, `thumb:${id}`];
    for (const key of keys) await kvDel(key);
  },
  async saveThumb(id, blob) {
    await kvSet(`thumb:${id}`, blob);
  },
  async thumbUrl(id, version) {
    if (!version) return null;
    const hit = objectUrls.get(id);
    if (hit && hit.version === version) return hit.url;
    const blob = await kvGet<Blob>(`thumb:${id}`);
    if (!blob) return null;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(blob);
    objectUrls.set(id, { version, url });
    return url;
  },
  async loadLibrary() {
    return parseLibrary((await kvGet<string>("library")) ?? null);
  },
  async saveLibrary(items) {
    await kvSet("library", JSON.stringify(items));
  },
  async reveal() {
    /* no folder to show in a browser */
  },
};

export function getBoardStorage(): BoardStorage {
  return isTauri() ? tauriStorage : browserStorage;
}
