import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { CaptureBackend } from "./backend";
import type { CaptureFrame, CaptureIndex, CaptureItem, FinishMeta, FinishResult, OcrResult } from "./types";

/**
 * The Rust side (`src-tauri/src/capture_tool.rs`).
 *
 * Two transfers are deliberately not JSON:
 *
 * - `capture_pixels` answers with the screenshot's raw RGBA as a binary IPC
 *   response (`tauri::ipc::Response`). A 2560×1440 frame is 14.7 MB; over the
 *   IPC custom protocol that is tens of milliseconds, straight into an
 *   `ImageData`. The alternative — encoding a PNG in Rust, loading it through
 *   `convertFileSrc`, decoding it again in the webview — puts an encode *and*
 *   a decode of the same 3.7 megapixels in the critical path before the first
 *   paint, and the whole point of the overlay is that it appears the instant
 *   the shortcut is released. Rust still writes the PNG to `capture/tmp/` in
 *   the background as the record the contract describes (and as a fallback).
 * - `capture_finish` receives the composed PNG as the raw request body with
 *   the metadata in an `x-capture-meta` header, because a `Vec<u8>` argument
 *   would be serialised as a JSON array of numbers.
 */

/** Subscribes to a Tauri event; the returned function unsubscribes (safe before `listen` resolves). */
function subscribe<T>(name: string, cb: (payload: T) => void): () => void {
  let unlisten: (() => void) | null = null;
  let gone = false;
  void listen<T>(name, (e) => cb(e.payload)).then((fn) => {
    if (gone) fn();
    else unlisten = fn;
  });
  return () => {
    gone = true;
    unlisten?.();
  };
}

export const tauriBackend: CaptureBackend = {
  kind: "tauri",

  list: async () => (await invoke<CaptureIndex>("capture_list")).items,
  remove: (id) => invoke("capture_delete", { id }),
  setTitle: (id, title) => invoke("capture_set_title", { id, title }),
  ocr: (path, id) => invoke<OcrResult>("capture_ocr", { path, id: id ?? null }),
  copyImage: (path) => invoke("capture_copy_image", { path }),
  copyText: (text) => invoke("capture_copy_text", { text }),
  openFolder: () => invoke("capture_open_folder"),
  reveal: (path) => invoke("capture_reveal", { path }),
  imageUrl: (path) => convertFileSrc(path),
  readBytes: async (path) => {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return readFile(path);
  },
  onChanged: (cb) => subscribe<unknown>("capture-saved", () => cb()),

  onShown: (cb) => subscribe<CaptureFrame>("capture-shown", cb),
  current: () => invoke<CaptureFrame | null>("capture_current"),
  pixels: async (frame) => {
    const buffer = await invoke<ArrayBuffer>("capture_pixels", { id: frame.id });
    const expected = frame.width * frame.height * 4;
    if (buffer.byteLength !== expected) {
      throw new Error(`capture_pixels: ${buffer.byteLength} bytes for a ${frame.width}×${frame.height} frame`);
    }
    const data = new ImageData(new Uint8ClampedArray(buffer), frame.width, frame.height);
    return createImageBitmap(data);
  },
  finish: (png, meta) =>
    invoke<FinishResult>("capture_finish", png, { headers: { "x-capture-meta": JSON.stringify(meta) } }),
  cancel: (id) => invoke("capture_cancel", { id }),
  hide: () => invoke("capture_hide"),
  grab: async () => {
    await invoke("capture_grab", { target: "cursor" });
  },

  toBoard: async (path, title) => {
    await emitTo("main", "capture-to-board", { path, title: title ?? null });
    await invoke("capture_show_main");
  },
  toSocial: async (path) => {
    await emitTo("main", "capture-to-social", { path });
    await invoke("capture_show_main");
  },
  hotkeyRegistered: () => invoke<boolean>("capture_hotkey_registered").catch(() => null),
};

export type { CaptureItem };
