import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import { buildScenes, drawAtTime, totalDuration, type LaunchSpec, type TemplateId } from "./scenes";

const WIDTH = 1280;
const HEIGHT = 720;

export function canRenderInBrowser(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const fontSize = Math.max(13, Math.round(h * 0.022));
  ctx.save();
  ctx.font = `600 ${fontSize}px Inter, ui-sans-serif, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const label = "made with shipshape · shipshape.app";
  const padX = fontSize * 0.9;
  const boxW = ctx.measureText(label).width + padX * 2;
  const boxH = fontSize * 2.1;
  const x = w - h * 0.03;
  const y = h - h * 0.03;
  ctx.fillStyle = "rgba(16,16,18,0.6)";
  const bx = x - boxW;
  const by = y - boxH;
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, boxH / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(label, x - padX, y - boxH / 2 + 1);
  ctx.restore();
}

/** Renders the launch video in the browser (free tool — watermark always on). */
export async function renderInBrowser(
  template: TemplateId,
  spec: LaunchSpec,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; ext: string }> {
  const fps = 30;
  const scenes = buildScenes(template, spec);
  const duration = totalDuration(scenes);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const mp4Codec = await getFirstEncodableVideoCodec(["avc"], { width: WIDTH, height: HEIGHT });
  const webmCodec = mp4Codec
    ? null
    : await getFirstEncodableVideoCodec(["vp9", "vp8"], { width: WIDTH, height: HEIGHT });
  if (!mp4Codec && !webmCodec) {
    throw new Error("This browser can't encode video. Try Chrome or Edge — or the desktop app.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Couldn't create a canvas context.");

  const output = new Output({
    format: mp4Codec ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: (mp4Codec ?? webmCodec)!,
    bitrate: 7_000_000,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      drawAtTime(ctx, WIDTH, HEIGHT, i / fps, scenes, spec);
      drawWatermark(ctx, WIDTH, HEIGHT);
      await source.add(i / fps, 1 / fps);
      onProgress((i + 1) / totalFrames);
      if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0));
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
    blob: new Blob([buffer], { type: mp4Codec ? "video/mp4" : "video/webm" }),
    ext: mp4Codec ? "mp4" : "webm",
  };
}
