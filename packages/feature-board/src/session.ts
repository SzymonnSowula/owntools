import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { logError } from "@core/errors";
import { liveElements, pickAppState, referencedFileIds, sceneSignature, toStoredScene } from "./boards";
import { fileKey, type BoardStorage } from "./storage";

export interface SceneSnapshot {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}

export interface BoardSessionOptions {
  onSaved?: (savedAt: number) => void;
  /** Renders a preview of the scene; null skips this round. */
  thumbnail?: (snap: SceneSnapshot) => Promise<Blob | null>;
  onThumbnail?: (at: number) => void;
  onError?: (err: unknown) => void;
  /** Debounce for scene writes, ms. */
  saveDelay?: number;
  /** Minimum gap between previews, ms. */
  thumbEvery?: number;
}

/**
 * Owns the writes for one open board. Excalidraw's onChange fires on every
 * state update, so changes are fingerprinted, debounced and written in order:
 * new images first (a scene must never point at a file that is not there),
 * then the scene, then the images nothing refers to any more are dropped.
 * Images are tracked by their on-disk key (`storage.fileKey`).
 */
export class BoardSession {
  private readonly onDisk: Set<string>;
  private pending: SceneSnapshot | null = null;
  private last: SceneSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private signature: string;
  private lastThumbAt = 0;
  private thumbDirty = false;
  private closed = false;

  constructor(
    private readonly storage: BoardStorage,
    readonly boardId: string,
    onDiskKeys: readonly string[],
    initialSignature: string,
    private readonly opts: BoardSessionOptions = {},
  ) {
    this.onDisk = new Set(onDiskKeys);
    this.signature = initialSignature;
  }

  onChange(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): void {
    if (this.closed) return;
    const sig = sceneSignature(elements, appState);
    if (sig === this.signature) return;
    this.signature = sig;
    this.pending = { elements, appState, files };
    this.thumbDirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.saveDelay ?? 700);
  }

  /** Writes whatever is pending; calls are serialised, so awaiting the last one is enough. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snap = this.pending;
    this.pending = null;
    if (snap) {
      this.last = snap;
      this.chain = this.chain
        .then(() => this.write(snap))
        .catch((err) => {
          this.opts.onError?.(err);
          logError("board", `save ${this.boardId}`, err);
        });
    }
    return this.chain;
  }

  /** Last write plus a final preview; the session is inert afterwards. */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    const snap = this.last;
    if (snap && this.thumbDirty) await this.renderThumb(snap);
  }

  private async write(snap: SceneSnapshot): Promise<void> {
    const elements = liveElements(snap.elements);
    const used = new Map<string, string>();
    for (const id of referencedFileIds(elements)) used.set(fileKey(id), id);

    for (const [key, id] of used) {
      if (this.onDisk.has(key)) continue;
      const file = snap.files[id as keyof BinaryFiles];
      if (!file?.dataURL) continue; // still being read; the next save picks it up
      await this.storage.saveFile(this.boardId, file);
      this.onDisk.add(key);
    }

    await this.storage.saveScene(this.boardId, toStoredScene(elements, pickAppState(snap.appState)));
    const at = Date.now();
    this.opts.onSaved?.(at);

    for (const key of [...this.onDisk]) {
      if (used.has(key)) continue;
      await this.storage
        .removeFile(this.boardId, key)
        .catch((err) => logError("board", "prune file", err));
      this.onDisk.delete(key);
    }

    if (this.thumbDirty && at - this.lastThumbAt >= (this.opts.thumbEvery ?? 15_000)) {
      await this.renderThumb(snap);
    }
  }

  private async renderThumb(snap: SceneSnapshot): Promise<void> {
    if (!this.opts.thumbnail) return;
    this.thumbDirty = false;
    this.lastThumbAt = Date.now();
    try {
      const blob = await this.opts.thumbnail(snap);
      if (!blob) return;
      await this.storage.saveThumb(this.boardId, blob);
      this.opts.onThumbnail?.(Date.now());
    } catch (err) {
      logError("board", "thumbnail", err);
    }
  }
}
