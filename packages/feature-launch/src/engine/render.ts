import { LaunchVideo } from "./LaunchVideo";
import { FPS, formatDef, type LaunchInput } from "./types";

/**
 * One export path for both apps. Rendering happens entirely in the client
 * (WebCodecs under the hood), so the desktop app and the website produce
 * byte-comparable files from the same input.
 */

export interface CompositionConfig {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

export function compositionFor(input: LaunchInput): CompositionConfig {
  const format = formatDef(input.format);
  return {
    id: "launch",
    width: format.width,
    height: format.height,
    fps: FPS,
    durationInFrames: Math.round(input.seconds * FPS),
  };
}

export interface RenderOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  /** "mp4" (h264) by default; webm is the fallback where mp4 can't encode. */
  container?: "mp4" | "webm";
}

export async function renderLaunchVideo(
  input: LaunchInput,
  options: RenderOptions = {},
): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  const { renderMediaOnWeb } = await import("@remotion/web-renderer");
  const config = compositionFor(input);
  const container = options.container ?? "mp4";
  const render = await renderMediaOnWeb({
    composition: {
      id: config.id,
      component: LaunchVideo,
      durationInFrames: config.durationInFrames,
      fps: config.fps,
      width: config.width,
      height: config.height,
      defaultProps: { input },
    },
    inputProps: { input },
    container,
    videoBitrate: "high",
    muted: true,
    signal: options.signal,
    onProgress: ({ progress }) => options.onProgress?.(progress),
  });
  const blob = await render.getBlob();
  return { blob, ext: container };
}

/** Filename the export dialogs default to. */
export function exportFileName(input: LaunchInput, ext: string): string {
  const base = (input.name || "launch").trim().replace(/[^\w-]+/g, "_") || "launch";
  return `${base}-launch-${input.format}-${input.seconds}s.${ext}`;
}
