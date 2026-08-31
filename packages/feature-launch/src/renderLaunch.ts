import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import { probeExportSupport } from "@feature-editor/lib/exportVideo";
import { drawWatermark } from "@feature-editor/lib/compositor";
import { buildScenes, drawAtTime, totalDuration, type LaunchSpec, type TemplateId } from "./scenes";

export interface RenderOptions {
  fps?: number;
  watermark?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: number) => void;
}

const WIDTH = 1920;
const HEIGHT = 1080;

/** Renders the launch video offline to MP4 (H.264) or WebM fallback. */
export async function renderLaunchVideo(
  template: TemplateId,
  spec: LaunchSpec,
  options: RenderOptions = {},
): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  const fps = options.fps ?? 60;
  const scenes = buildScenes(template, spec);
  const duration = totalDuration(scenes);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const choice = await probeExportSupport(WIDTH, HEIGHT);
  if (!choice) throw new Error("Video encoding is unavailable in this environment.");

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Couldn't create a canvas context.");

  const output = new Output({
    format:
      choice.container === "mp4"
        ? new Mp4OutputFormat({ fastStart: "in-memory" })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: choice.video,
    bitrate: 12_000_000,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      drawAtTime(ctx, WIDTH, HEIGHT, i / fps, scenes, spec);
      if (options.watermark) drawWatermark(ctx, WIDTH, HEIGHT);
      await source.add(i / fps, 1 / fps);
      options.onProgress?.((i + 1) / totalFrames);
    }
    source.close();
    await output.finalize();
  } catch (err) {
    if (output.state === "started") await output.cancel().catch(() => undefined);
    throw err;
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error("Export produced an empty file.");
  return {
    blob: new Blob([buffer], { type: choice.container === "mp4" ? "video/mp4" : "video/webm" }),
    ext: choice.container,
  };
}
