import type { BackendStatus, CopyOutcome, ItemsDoc, Manifest, ReadAll, ScanEntry } from "../types";
import type { CopyOptions, SyncBackend } from "./backend";

/**
 * The browser stand-in for Rust: an in-memory synced folder that already holds
 * a second device ("MacBook") with a vocabulary, two takes, a look preset and
 * one board, so the card shows two devices merging under `pnpm dev`. The page
 * can play the other device through `window.__owntoolsSyncDemo`
 * (`remoteWrite`, `remoteVocabulary`, `readFolder`).
 */

export const DEMO_FOLDER = "~/Dropbox/owntools (demo)";
export const DEMO_REMOTE_ID = "demo-macbook-8f3a";
export const DEMO_REMOTE_NAME = "MacBook";

type Tree = { files: Record<string, string>; mtimeMs: number };

const bytesOf = (text: string) => new TextEncoder().encode(text).length;
const treeBytes = (tree: Tree) => Object.values(tree.files).reduce((n, t) => n + bytesOf(t), 0);

export class DemoSyncBackend implements SyncBackend {
  readonly kind = "demo" as const;
  private folder: string | null = null;
  private device = { id: "", name: "" };
  private watching = false;
  private lastRead: number | null = null;
  private lastWrite: number | null = null;
  /** `<deviceId>/<name>.json` → text. */
  private files = new Map<string, string>();
  /** `<deviceId>/<relPath>` → folder copy. */
  private trees = new Map<string, Tree>();
  /** AppData text files, by relative path. */
  private appText = new Map<string, string>();
  /** AppData folders, by relative path. */
  private appTrees = new Map<string, Tree>();
  private listeners = new Set<() => void>();

  constructor(seedRemote = true) {
    if (seedRemote) this.seedRemote();
  }

  /* ---------------- the other device ---------------- */

  private seedRemote(): void {
    const day = 24 * 60 * 60 * 1000;
    const at = Date.now() - day;
    this.files.set(`${DEMO_REMOTE_ID}/manifest.json`, JSON.stringify(this.remoteManifest(at)));
    const items = <T>(list: Array<[string, T]>): ItemsDoc<T> => ({
      version: 1,
      updatedAt: at,
      items: list.map(([id, value]) => ({ id, updatedAt: at, by: DEMO_REMOTE_ID, value })),
      tombstones: [],
    });
    this.files.set(
      `${DEMO_REMOTE_ID}/dictation-vocabulary.json`,
      JSON.stringify(
        items([
          ["kubernetes", { id: "v-demo-1", spoken: "Kubernetes", replacement: "", createdAt: at }],
          ["my email address", { id: "v-demo-2", spoken: "my email address", replacement: "hello@example.com", createdAt: at }],
        ]),
      ),
    );
    this.files.set(
      `${DEMO_REMOTE_ID}/dictation-history.json`,
      JSON.stringify(
        items([
          ["t-demo-1", { id: "t-demo-1", at: at + 60_000, text: "Move the launch to Thursday and tell the team.", durationMs: 4200 }],
          ["t-demo-2", { id: "t-demo-2", at: at + 120_000, text: "Draft the changelog for zero point three.", durationMs: 3100 }],
        ]),
      ),
    );
    this.files.set(
      `${DEMO_REMOTE_ID}/look-presets.json`,
      JSON.stringify(
        items([
          [
            "look_demo_deck",
            {
              id: "look_demo_deck",
              name: "Deck",
              look: {
                background: { mode: "gradient", gradientId: "royal", gradientAngle: 160, padding: 0.1, windowRadius: 22, shadow: 0.7 },
                webcam: { shape: "circle", size: 0.24, borderWidth: 5, corner: "br" },
                cursorStyle: { style: "arrow", size: 1.4, clicks: true, clickColor: "#0a84ff" },
                progressBar: { enabled: false },
                fade: { in: 0.3, out: 0.5 },
              },
            },
          ],
        ]),
      ),
    );
    const scene = JSON.stringify({ type: "owntools-board", version: 1, savedAt: at, elements: [], appState: {} });
    this.trees.set(`${DEMO_REMOTE_ID}/boards/roadmap-demo`, { files: { "scene.json": scene }, mtimeMs: at });
    this.files.set(
      `${DEMO_REMOTE_ID}/boards.json`,
      JSON.stringify(
        items([
          ["roadmap-demo", { id: "roadmap-demo", name: "Roadmap", createdAt: at - day, updatedAt: at, thumbAt: 0, savedAt: at, bytes: bytesOf(scene) }],
        ]),
      ),
    );
  }

  private remoteManifest(updatedAt: number): Manifest {
    return { deviceId: DEMO_REMOTE_ID, deviceName: DEMO_REMOTE_NAME, platform: "macos", appVersion: "0.2.0", updatedAt };
  }

  /** Plays the other device: writes a collection file into its subtree and lets the watcher fire. */
  remoteWrite(collection: string, doc: unknown, deviceId = DEMO_REMOTE_ID): void {
    this.files.set(`${deviceId}/${collection}.json`, typeof doc === "string" ? doc : JSON.stringify(doc));
    this.files.set(`${deviceId}/manifest.json`, JSON.stringify(this.remoteManifest(Date.now())));
    this.fire();
  }

  /** Convenience for the page: the MacBook adds or edits vocabulary entries. */
  remoteVocabulary(entries: Array<{ spoken: string; replacement?: string }>, updatedAt = Date.now()): void {
    const existing = this.files.get(`${DEMO_REMOTE_ID}/dictation-vocabulary.json`);
    const doc = (existing ? JSON.parse(existing) : { version: 1, updatedAt: 0, items: [], tombstones: [] }) as ItemsDoc<unknown>;
    for (const e of entries) {
      const id = e.spoken.toLocaleLowerCase();
      const value = { id: `v-remote-${id.replace(/\W+/g, "-")}`, spoken: e.spoken, replacement: e.replacement ?? "", createdAt: updatedAt };
      const item = { id, updatedAt, by: DEMO_REMOTE_ID, value };
      const i = doc.items.findIndex((x) => x.id === id);
      if (i >= 0) doc.items[i] = item;
      else doc.items.push(item);
    }
    doc.updatedAt = updatedAt;
    this.remoteWrite("dictation-vocabulary", doc);
  }

  /** What the folder holds right now: `<deviceId>/<file>` → parsed JSON. */
  readFolder(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.files) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    }
    return out;
  }

  /** The AppData stand-in, for assertions in the page. */
  readAppData(): { text: Record<string, string>; folders: string[] } {
    return { text: Object.fromEntries(this.appText), folders: [...this.appTrees.keys()] };
  }

  private fire(): void {
    if (!this.watching) return;
    const cbs = [...this.listeners];
    setTimeout(() => cbs.forEach((cb) => cb()), 30);
  }

  /* ---------------- SyncBackend ---------------- */

  async status(): Promise<BackendStatus> {
    return {
      folder: this.folder,
      deviceId: this.device.id || null,
      deviceName: this.device.name || null,
      watching: this.watching,
      lastRead: this.lastRead,
      lastWrite: this.lastWrite,
      hostname: "DESKTOP-DEMO",
      platform: "windows",
      appVersion: "0.2.0",
    };
  }

  async setDevice(deviceId: string, deviceName: string): Promise<void> {
    this.device = { id: deviceId, name: deviceName };
    if (this.folder) this.files.set(`${deviceId}/manifest.json`, JSON.stringify(this.ownManifest(Date.now())));
  }

  private ownManifest(updatedAt: number): Manifest {
    return { deviceId: this.device.id, deviceName: this.device.name, platform: "windows", appVersion: "0.2.0", updatedAt };
  }

  async setFolder(folder: string): Promise<{ ok: boolean; deviceDirs: string[] }> {
    if (!this.device.id) throw new Error("sync: device identity not set yet");
    this.folder = folder;
    this.files.set(`${this.device.id}/manifest.json`, JSON.stringify(this.ownManifest(Date.now())));
    return { ok: true, deviceDirs: this.deviceIds() };
  }

  private deviceIds(): string[] {
    return [...new Set([...this.files.keys()].map((k) => k.split("/")[0]))].sort();
  }

  async clearFolder(): Promise<void> {
    this.folder = null;
    this.watching = false;
  }

  async readAll(folder?: string): Promise<ReadAll> {
    if (!folder && !this.folder) throw new Error("sync: no folder chosen");
    const devices = this.deviceIds().map((deviceId) => {
      const manifestRaw = this.files.get(`${deviceId}/manifest.json`);
      let manifest: Manifest | null = null;
      try {
        manifest = manifestRaw ? (JSON.parse(manifestRaw) as Manifest) : null;
      } catch {
        manifest = null;
      }
      const collections: Record<string, unknown> = {};
      for (const [k, v] of this.files) {
        if (!k.startsWith(`${deviceId}/`) || k.endsWith("/manifest.json")) continue;
        try {
          collections[k.slice(deviceId.length + 1).replace(/\.json$/, "")] = JSON.parse(v);
        } catch {
          /* corrupt: skipped, like Rust does */
        }
      }
      return { deviceId, manifest, collections };
    });
    const readAt = Date.now();
    if (!folder) this.lastRead = readAt;
    return { devices, warnings: [], readAt };
  }

  async write(collection: string, json: string): Promise<number> {
    if (!this.folder) throw new Error("sync: no folder chosen");
    JSON.parse(json);
    const at = Date.now();
    this.files.set(`${this.device.id}/${collection}.json`, json);
    this.files.set(`${this.device.id}/manifest.json`, JSON.stringify(this.ownManifest(at)));
    this.lastWrite = at;
    return at;
  }

  private outcome(tree: Tree | undefined, opts?: CopyOptions): CopyOutcome {
    if (!tree) return { ok: false, skipped: false, reason: "no such folder", bytes: 0, files: 0 };
    const exclude = new Set(opts?.exclude ?? []);
    const files = Object.fromEntries(Object.entries(tree.files).filter(([name]) => !exclude.has(name.split("/")[0])));
    const bytes = treeBytes({ files, mtimeMs: tree.mtimeMs });
    const cap = opts?.maxBytes ?? 20 * 1024 * 1024;
    if (bytes > cap) {
      return { ok: false, skipped: true, reason: `${(bytes / 1048576).toFixed(1)} MB, over the ${Math.round(cap / 1048576)} MB limit`, bytes, files: Object.keys(files).length };
    }
    return { ok: true, skipped: false, reason: null, bytes, files: Object.keys(files).length };
  }

  async copyOut(fromAppData: string, relPath: string, opts?: CopyOptions): Promise<CopyOutcome> {
    const tree = this.appTrees.get(fromAppData);
    const outcome = this.outcome(tree, opts);
    if (outcome.ok && tree) {
      const exclude = new Set(opts?.exclude ?? []);
      const files = Object.fromEntries(Object.entries(tree.files).filter(([name]) => !exclude.has(name.split("/")[0])));
      this.trees.set(`${this.device.id}/${relPath}`, { files, mtimeMs: Date.now() });
      this.lastWrite = Date.now();
    }
    return outcome;
  }

  async copyIn(deviceId: string, relPath: string, toAppData: string, opts?: CopyOptions): Promise<CopyOutcome> {
    const tree = this.trees.get(`${deviceId}/${relPath}`);
    const outcome = this.outcome(tree, opts);
    if (outcome.ok && tree) this.appTrees.set(toAppData, { files: { ...tree.files }, mtimeMs: Date.now() });
    return outcome;
  }

  async removeOut(relPath: string): Promise<void> {
    this.trees.delete(`${this.device.id}/${relPath}`);
  }

  async watch(on: boolean): Promise<boolean> {
    this.watching = on && !!this.folder;
    return this.watching;
  }

  onChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async appScan(rel: string): Promise<ScanEntry[]> {
    const prefix = `${rel.replace(/\/+$/, "")}/`;
    const out = new Map<string, ScanEntry>();
    for (const [path, tree] of this.appTrees) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length).split("/")[0];
      const cur = out.get(name) ?? { name, isDir: true, mtimeMs: 0, bytes: 0 };
      cur.bytes += treeBytes(tree);
      cur.mtimeMs = Math.max(cur.mtimeMs, tree.mtimeMs);
      out.set(name, cur);
    }
    for (const [path, text] of this.appText) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const name = rest.split("/")[0];
      if (rest.includes("/")) {
        const cur = out.get(name) ?? { name, isDir: true, mtimeMs: Date.now(), bytes: 0 };
        cur.bytes += bytesOf(text);
        out.set(name, cur);
      } else if (!out.has(name)) {
        out.set(name, { name, isDir: false, mtimeMs: Date.now(), bytes: bytesOf(text) });
      }
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async appReadText(rel: string): Promise<string | null> {
    if (this.appText.has(rel)) return this.appText.get(rel) ?? null;
    // A file inside a folder copy (`board/boards/<id>/scene.json`).
    for (const [path, tree] of this.appTrees) {
      if (rel.startsWith(`${path}/`)) return tree.files[rel.slice(path.length + 1)] ?? null;
    }
    return null;
  }

  async appWriteText(rel: string, text: string): Promise<void> {
    this.appText.set(rel, text);
  }

  async appRemove(rel: string): Promise<void> {
    this.appText.delete(rel);
    this.appTrees.delete(rel);
    for (const key of [...this.appTrees.keys()]) if (key.startsWith(`${rel}/`)) this.appTrees.delete(key);
    for (const key of [...this.appText.keys()]) if (key.startsWith(`${rel}/`)) this.appText.delete(key);
  }

  async pickFolder(): Promise<string | null> {
    return DEMO_FOLDER;
  }
}

declare global {
  interface Window {
    __owntoolsSyncDemo?: DemoSyncBackend;
  }
}

let demo: DemoSyncBackend | null = null;

/** One demo folder per page, reachable from the console and the preview page. */
export function demoBackend(): DemoSyncBackend {
  if (!demo) {
    demo = new DemoSyncBackend();
    if (typeof window !== "undefined") window.__owntoolsSyncDemo = demo;
  }
  return demo;
}

/** Tests: a fresh folder with the seeded MacBook, or an empty one. */
export function resetDemoBackend(seedRemote = true): DemoSyncBackend {
  demo = new DemoSyncBackend(seedRemote);
  if (typeof window !== "undefined") window.__owntoolsSyncDemo = demo;
  return demo;
}
