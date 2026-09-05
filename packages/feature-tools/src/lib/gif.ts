import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

/**
 * Video → animated GIF: frames are decoded at a fixed rate through
 * mediabunny's CanvasSink (scaled on the way), each one quantised to its own
 * 256-colour palette and written with gifenc. Per-frame palettes cost a few
 * bytes per frame and keep colours honest across scene changes.
 */

export interface GifOptions {
  fps: number;
  /** Output width in pixels; height follows the video's aspect. */
  width: number;
  start: number;
  /** null = to the end. */
  end: number | null;
  loop: boolean;
}

export interface GifResult {
  blob: Blob;
  frames: number;
  width: number;
  height: number;
}

export async function videoToGif(
  file: File,
  options: GifOptions,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<GifResult> {
  const { GIFEncoder, applyPalette, quantize } = await import("gifenc");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("This file has no video track.");
    if (!(await track.canDecode())) throw new Error("Can't decode this video here.");
    const duration = await track.computeDuration();
    const start = Math.min(Math.max(0, options.start), duration);
    const end = Math.min(options.end ?? duration, duration);
    if (end - start < 0.05) throw new Error("Pick a longer range.");
    const fps = Math.min(30, Math.max(1, options.fps));
    const width = Math.min(Math.max(16, Math.round(options.width)), track.displayWidth || options.width);
    const timestamps: number[] = [];
    for (let t = start; t < end; t += 1 / fps) timestamps.push(t);
    const delay = Math.round(1000 / fps);

    const sink = new CanvasSink(track, { width, fit: "contain" });
    const gif = GIFEncoder();
    let frames = 0;
    let w = 0;
    let h = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (signal?.aborted) throw new Error("Cancelled.");
      if (!wrapped) continue;
      const canvas = wrapped.canvas;
      w = canvas.width;
      h = canvas.height;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error("No 2D canvas available.");
      const { data } = ctx.getImageData(0, 0, w, h);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, w, h, { palette, delay, repeat: options.loop ? 0 : -1 });
      frames += 1;
      onProgress(frames, timestamps.length);
    }
    if (!frames) throw new Error("No frames could be decoded in that range.");
    gif.finish();
    const bytes = gif.bytes();
    return { blob: new Blob([bytes as BlobPart], { type: "image/gif" }), frames, width: w, height: h };
  } finally {
    input.dispose();
  }
}
