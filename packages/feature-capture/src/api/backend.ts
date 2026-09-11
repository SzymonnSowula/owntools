import type { CaptureFrame, CaptureItem, FinishMeta, FinishResult, OcrResult } from "./types";

/**
 * Everything the capture UI asks of the machine. Two implementations: `tauri.ts`
 * (the Rust commands in `src-tauri/src/capture_tool.rs`) and `demo.ts` (a
 * generated screen and an in-memory library, so `/capture.html` and the
 * library page run under `pnpm dev`).
 */
export interface CaptureBackend {
  readonly kind: "tauri" | "demo";

  /* ---- library ------------------------------------------------------- */
  list(): Promise<CaptureItem[]>;
  remove(id: string): Promise<void>;
  setTitle(id: string, title: string): Promise<void>;
  /** Runs text recognition on a saved capture; with `id`, the text is kept in the index. */
  ocr(path: string, id?: string): Promise<OcrResult>;
  copyImage(path: string): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Opens the library folder in the file manager. */
  openFolder(): Promise<void>;
  /** Shows one file in the file manager. */
  reveal(path: string): Promise<void>;
  /** A URL an `<img>` can load for a library file. */
  imageUrl(path: string): string;
  /** The bytes of a library file (for a handoff to the board). */
  readBytes(path: string): Promise<Uint8Array>;
  /** Fires when the index changed behind the view's back (another window saved). */
  onChanged(cb: () => void): () => void;

  /* ---- overlay ------------------------------------------------------- */
  /** Fires when a screenshot was taken and the overlay should show it. */
  onShown(cb: (frame: CaptureFrame) => void): () => void;
  /** The frame currently on show, if the overlay mounted after the event fired. */
  current(): Promise<CaptureFrame | null>;
  /** The screenshot's pixels, drawable. */
  pixels(frame: CaptureFrame): Promise<ImageBitmap>;
  /** Writes the composed PNG, updates the index, optionally OCRs and hides. */
  finish(png: Uint8Array, meta: FinishMeta): Promise<FinishResult>;
  /** Dismisses the overlay without saving anything. */
  cancel(id: string | null): Promise<void>;
  /** Hides the overlay window right away (the work continues behind it). */
  hide(): Promise<void>;
  /** Takes a screenshot of the monitor under the pointer and shows the overlay. */
  grab(): Promise<void>;

  /* ---- other tools --------------------------------------------------- */
  /** Hands a saved capture to the board (main window: image element at the view centre). */
  toBoard(path: string, title?: string): Promise<void>;
  /** Hands a saved capture to social as a new draft with the image attached. */
  toSocial(path: string): Promise<void>;
  /** Whether the global shortcut is ours (false = another app owns it; null = unknown). */
  hotkeyRegistered(): Promise<boolean | null>;
}
