/**
 * The capture tool's data — shared by the overlay window, the library view and
 * both backends (Rust under Tauri, the in-memory demo in a browser).
 */

/** One entry of `<AppData>/capture/index.json`. */
export interface CaptureItem {
  id: string;
  /** Absolute path of the library PNG. */
  path: string;
  width: number;
  height: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Recognised text, when OCR ran (lines joined with "\n"). */
  ocrText?: string;
  /** A name the user gave it; otherwise the library shows size + time. */
  title?: string;
}

export interface CaptureIndex {
  version: number;
  items: CaptureItem[];
}

/** What `capture_grab` answers with and what `capture-shown` carries. */
export interface CaptureFrame {
  id: string;
  /** Where the full screenshot was written (`<AppData>/capture/tmp/<id>.png`). */
  path: string;
  /** Size of the screenshot in physical pixels. */
  width: number;
  height: number;
  /** The monitor's DPI scale (1 = 96 dpi). */
  scale: number;
  /** The monitor's origin on the virtual desktop, physical pixels. */
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Metadata that rides in the `x-capture-meta` header next to the PNG bytes. */
export interface FinishMeta {
  id: string;
  /** Size of the PNG being sent. */
  width: number;
  height: number;
  /** The selected region in screenshot pixels, for the record. */
  rect: Rect;
  save: {
    /** Keep it in the library (`<AppData>/capture/<id>.png` + index). */
    library: boolean;
    /** Also copy to `<Pictures>/owntools/<date time>.png`. */
    pictures: boolean;
  };
  /** Run text recognition on the result before answering. */
  ocr: boolean;
  /** Hide the overlay window as part of finishing (false keeps it up for the text sheet). */
  hide: boolean;
  title?: string;
}

export interface FinishResult {
  id: string;
  path: string;
  width: number;
  height: number;
  /** The Pictures copy, when one was made. */
  picturesPath?: string | null;
  ocrText?: string | null;
  /** Why OCR produced nothing, in words meant for the user. */
  ocrError?: string | null;
}

export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

/** Payload of the Tauri event `capture-saved` (Rust → main) and of `CAPTURE_SAVED_EVENT`. */
export interface CaptureSavedPayload {
  id: string;
  path: string;
  width: number;
  height: number;
  ocrText?: string;
}
