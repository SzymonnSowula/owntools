import { isTauri } from "@core/env";

/**
 * Where social keeps its files. In the app: `<AppData>/social/` — a handful
 * of JSON files, one JSON per post under `posts/`, binaries under `media/`
 * and `avatars/`. In a plain browser (`pnpm dev`) the same paths key an
 * IndexedDB store, so the whole tool works in the preview.
 *
 * The adapter is deliberately path-based: the Rust agent server writes the
 * same paths, and a post is always a whole file, so "read, change, write"
 * is the only protocol both sides need.
 */
export interface SocialStorage {
  readonly kind: "tauri" | "browser";
  readText(rel: string): Promise<string | null>;
  /** Atomic: written next to the target, then renamed over it. */
  writeText(rel: string, text: string): Promise<void>;
  /** Adds to the end of a file (the activity log); creates it when missing. */
  appendText(rel: string, text: string): Promise<void>;
  remove(rel: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
  /** File names (not paths) directly under `relDir`. */
  list(relDir: string): Promise<string[]>;
  readBinary(rel: string): Promise<Uint8Array | null>;
  writeBinary(rel: string, bytes: Uint8Array): Promise<void>;
  /** A URL the webview can load the file from, or null when it is missing. */
  fileUrl(rel: string, version?: number): Promise<string | null>;
  /** Absolute path of the social folder (desktop only). */
  rootPath(): Promise<string | null>;
  /** Opens the file manager on the social folder (desktop only). */
  reveal(rel?: string): Promise<void>;
}

export const ROOT = "social";

export const PATHS = {
  channels: "channels.json",
  credentials: "credentials.json",
  tags: "tags.json",
  media: "media.json",
  settings: "settings.json",
  /** Mirror of the network catalogue, written for the Rust agent server. */
  networks: "networks.json",
  /** Brand voice, one Markdown document every agent reads (see voice.ts). */
  voice: "voice.md",
  /** One JSON line per agent / automation write and per review decision (see activity.ts). */
  activity: "activity.jsonl",
  posts: "posts",
  mediaDir: "media",
  avatars: "avatars",
} as const;

export const postPath = (id: string) => `${PATHS.posts}/${id}.json`;

/** Only ids that make safe file names reach the disk. */
export function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

/* ------------------------------------------------------------------ */
/* Tauri: <AppData>/social                                             */
/* ------------------------------------------------------------------ */

async function tauriFs() {
  return import("@tauri-apps/plugin-fs");
}

function makeTauriStorage(): SocialStorage {
  const abs = (rel: string) => `${ROOT}/${rel}`;
  let baseDirPromise: Promise<number> | null = null;
  const appData = () => {
    if (!baseDirPromise) baseDirPromise = tauriFs().then((fs) => fs.BaseDirectory.AppData);
    return baseDirPromise;
  };
  const opts = async () => ({ baseDir: await appData() });

  const ensureDir = async (rel: string) => {
    const fs = await tauriFs();
    const o = await opts();
    if (!(await fs.exists(rel, o))) await fs.mkdir(rel, { ...o, recursive: true });
  };
  const parentOf = (rel: string) => rel.split("/").slice(0, -1).join("/");
  const appDataPath = async (rel: string) => {
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    return join(await appDataDir(), abs(rel));
  };

  return {
    kind: "tauri",
    async readText(rel) {
      const fs = await tauriFs();
      const o = await opts();
      if (!(await fs.exists(abs(rel), o))) return null;
      return fs.readTextFile(abs(rel), o);
    },
    async writeText(rel, text) {
      const fs = await tauriFs();
      const o = await opts();
      await ensureDir(parentOf(abs(rel)));
      const tmp = `${abs(rel)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await fs.writeTextFile(tmp, text, o);
      await fs.rename(tmp, abs(rel), { oldPathBaseDir: o.baseDir, newPathBaseDir: o.baseDir });
    },
    async appendText(rel, text) {
      const fs = await tauriFs();
      const o = await opts();
      await ensureDir(parentOf(abs(rel)));
      await fs.writeTextFile(abs(rel), text, { ...o, append: true });
    },
    async remove(rel) {
      const fs = await tauriFs();
      const o = await opts();
      if (await fs.exists(abs(rel), o)) await fs.remove(abs(rel), o);
    },
    async exists(rel) {
      const fs = await tauriFs();
      return fs.exists(abs(rel), await opts());
    },
    async list(relDir) {
      const fs = await tauriFs();
      const o = await opts();
      if (!(await fs.exists(abs(relDir), o))) return [];
      const entries = await fs.readDir(abs(relDir), o);
      return entries.filter((e) => e.isFile).map((e) => e.name);
    },
    async readBinary(rel) {
      const fs = await tauriFs();
      const o = await opts();
      if (!(await fs.exists(abs(rel), o))) return null;
      return fs.readFile(abs(rel), o);
    },
    async writeBinary(rel, bytes) {
      const fs = await tauriFs();
      await ensureDir(parentOf(abs(rel)));
      await fs.writeFile(abs(rel), bytes, await opts());
    },
    async fileUrl(rel, version = 0) {
      const fs = await tauriFs();
      if (!(await fs.exists(abs(rel), await opts()))) return null;
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const url = convertFileSrc(await appDataPath(rel));
      return version ? `${url}?v=${version}` : url;
    },
    async rootPath() {
      const { appDataDir, join } = await import("@tauri-apps/api/path");
      return join(await appDataDir(), ROOT);
    },
    async reveal(rel) {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await ensureDir(ROOT);
      const fs = await tauriFs();
      const target = rel && (await fs.exists(abs(rel), await opts())) ? rel : "";
      await revealItemInDir(target ? await appDataPath(target) : ((await this.rootPath()) ?? ""));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Browser: IndexedDB key/value keyed by the same relative paths        */
/* ------------------------------------------------------------------ */

const DB_NAME = "owntools-social";
const STORE = "files";
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
  tx<IDBValidKey[]>("readonly", (s) =>
    s.getAllKeys(IDBKeyRange.bound(prefix, prefix + String.fromCharCode(0xffff))),
  ).then((keys) => keys.map(String));

const objectUrls = new Map<string, { version: number; url: string }>();

function mimeFor(rel: string): string {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

const browserStorage: SocialStorage = {
  kind: "browser",
  async readText(rel) {
    const v = await kvGet<string>(rel);
    return typeof v === "string" ? v : null;
  },
  async writeText(rel, text) {
    await kvSet(rel, text);
  },
  async appendText(rel, text) {
    const current = await kvGet<string>(rel);
    await kvSet(rel, `${typeof current === "string" ? current : ""}${text}`);
  },
  async remove(rel) {
    await kvDel(rel);
    const hit = objectUrls.get(rel);
    if (hit) {
      URL.revokeObjectURL(hit.url);
      objectUrls.delete(rel);
    }
  },
  async exists(rel) {
    return (await kvGet<unknown>(rel)) !== undefined;
  },
  async list(relDir) {
    const prefix = `${relDir}/`;
    return (await kvKeys(prefix)).map((k) => k.slice(prefix.length)).filter((k) => !k.includes("/"));
  },
  async readBinary(rel) {
    const v = await kvGet<Uint8Array | Blob>(rel);
    if (v instanceof Uint8Array) return v;
    if (v instanceof Blob) return new Uint8Array(await v.arrayBuffer());
    return null;
  },
  async writeBinary(rel, bytes) {
    await kvSet(rel, bytes);
    const hit = objectUrls.get(rel);
    if (hit) {
      URL.revokeObjectURL(hit.url);
      objectUrls.delete(rel);
    }
  },
  async fileUrl(rel, version = 0) {
    const hit = objectUrls.get(rel);
    if (hit && hit.version === version) return hit.url;
    const bytes = await this.readBinary(rel);
    if (!bytes) return null;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFor(rel) }));
    objectUrls.set(rel, { version, url });
    return url;
  },
  async rootPath() {
    return null;
  },
  async reveal() {
    /* nothing to show in a browser */
  },
};

let tauriStorage: SocialStorage | null = null;

export function getSocialStorage(): SocialStorage {
  if (!isTauri()) return browserStorage;
  if (!tauriStorage) tauriStorage = makeTauriStorage();
  return tauriStorage;
}
