/**
 * One call from a file to a finished cut-out: matte (worker) → compose
 * (canvas) → encode. The quick tool uses it per file; anything else that
 * wants "this picture without its background" can too.
 */
import { loadImageSource } from "@feature-tools/lib/image";
import type { MattingPrefs } from "../prefs";
import { blurRadiusFor, canvasToBlob, composeCutout, formatAllowed, type Backdrop, type CutoutFormat } from "./compose";
import { cutOut } from "./engine";
import type { MattingBackend } from "./models";

export interface Cutout {
  blob: Blob;
  width: number;
  height: number;
  format: CutoutFormat;
  /** Share of the original frame that was kept, 0..1. */
  coverage: number;
  /** Matte time in milliseconds (decode + model + upscale), as the worker measured it. */
  ms: number;
  backend: MattingBackend;
}

export function backdropFor(prefs: MattingPrefs, width: number, height: number): Backdrop {
  switch (prefs.backdrop) {
    case "white":
      return { kind: "color", color: "#ffffff" };
    case "black":
      return { kind: "color", color: "#000000" };
    case "color":
      return { kind: "color", color: prefs.color };
    case "blur":
      return { kind: "blur", radius: blurRadiusFor(width, height) };
    default:
      return { kind: "transparent" };
  }
}

/** PNG when the asked-for format cannot carry the result (a transparent JPEG). */
export function effectiveFormat(prefs: MattingPrefs): CutoutFormat {
  return formatAllowed(prefs.format, backdropFor(prefs, 1, 1)) ? prefs.format : "png";
}

/** Names the file for the worker's matte cache. */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function removeBackground(file: File, prefs: MattingPrefs): Promise<Cutout> {
  const matte = await cutOut(file, {
    model: prefs.model,
    edge: prefs.edge,
    key: fileKey(file),
    prefer: prefs.cpuOnly ? "cpu" : "auto",
  });
  const source = await loadImageSource(file);
  try {
    const canvas = composeCutout(source.source, matte, {
      backdrop: backdropFor(prefs, matte.width, matte.height),
      trim: prefs.trim,
    });
    const format = effectiveFormat(prefs);
    const blob = await canvasToBlob(canvas, format);
    const { width, height } = canvas;
    canvas.width = canvas.height = 0;
    return { blob, width, height, format, coverage: matte.coverage, ms: matte.ms, backend: matte.backend };
  } finally {
    matte.mask.close();
    source.close();
  }
}
