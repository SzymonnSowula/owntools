import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import type { AudioCodec, VideoCodec } from "mediabunny";
import type { AudioSettings, CropAspect, MediaUrls, Project, Segment, TimeRange } from "../types";
import { canvasSize, drawFrame, drawProgressBar, drawWatermark, type Rect } from "./compositor";
import { sliceSegmentsToTimelineRange, timelineDuration, timelineToSource } from "./segments";
import { applyFadesInPlace, mixChannel, renderSfxChannels } from "./sfx/mix";
import { sfxPack } from "./sfx/packs";
import { planSfx } from "./sfx/plan";
import { TransitionTracker, fadeVeilAlpha } from "./transitions";
import { ensureFiniteDuration, seekVideo } from "./videoEl";

export type ExportContainer = "mp4" | "webm";
export type ExportPhase = "prepare" | "audio" | "video" | "finalize";

export interface ExportOptions {
  fps?: number;
  watermark?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number, phase: ExportPhase) => void;
  /** Decoded image overlays keyed by `ImageOverlay.src`. */
  overlayImages?: Record<string, HTMLImageElement>;
  /** Export only this stretch of the *cut timeline* (a short clip), seconds. */
  range?: TimeRange;
  /**
   * Centre-crop the composed frame to this aspect and size the output for it
   * (1080×1920 / 1080×1080). Differs from the project's aspect, which fits the
   * video inside a taller canvas: this fills the frame with the middle of the picture.
   */
  crop?: CropAspect;
}

/** Output size of a cropped export. */
export function cropSize(aspect: CropAspect): { width: number; height: number } {
  return aspect === "9:16" ? { width: 1080, height: 1920 } : { width: 1080, height: 1080 };
}

/** What the encoder is asked for: the crop's size when cropping, else the project aspect's. */
export function outputSize(project: Project, crop?: CropAspect): { width: number; height: number } {
  return crop ? cropSize(crop) : canvasSize(project.aspect);
}

/**
 * The largest rectangle of a `sw`×`sh` picture with the output's aspect,
 * centred — the `drawImage` sub-rect a crop copies out.
 */
export function centreCrop(sw: number, sh: number, dw: number, dh: number): Rect {
  const want = dw / dh;
  const have = sw / sh;
  if (have > want) {
    const w = sh * want;
    return { x: (sw - w) / 2, y: 0, w, h: sh };
  }
  const h = sw / want;
  return { x: 0, y: (sh - h) / 2, w: sw, h };
}

/**
 * The clips an export renders: the project's, clamped to `actualDuration`
 * when the demuxer knows better than the seek probe, then sliced to the
 * requested stretch of the timeline. Throws when the clip range holds nothing.
 */
export function segmentsForExport(project: Project, actualDuration: number, range?: TimeRange): Segment[] {
  let segments = project.segments;
  if (actualDuration > 0.2) {
    const clamped = segments
      .map((s) => ({ ...s, end: Math.min(s.end, actualDuration) }))
      .filter((s) => s.end - s.start > 0.01);
    if (clamped.length) segments = clamped;
  }
  if (range) {
    segments = sliceSegmentsToTimelineRange(segments, range);
    if (!segments.length || timelineDuration(segments) < 0.05) {
      throw new Error("The clip range is empty — pick a longer stretch.");
    }
  }
  return segments;
}

/**
 * Draws one output frame: the full composition on `stage`, then — when
 * cropping — the centre of it onto the output, with the progress bar, the
 * fades and the watermark drawn on the *output* so a crop can not cut them
 * off or make the bar start off-screen. Without a crop, `stage` is the output.
 */
function paintOutput(
  out: CanvasRenderingContext2D,
  stage: HTMLCanvasElement,
  crop: Rect | null,
  project: Project,
  progress: number,
  duration: number,
  timeline: number,
  watermark: boolean,
): void {
  if (!crop) return;
  const width = out.canvas.width;
  const height = out.canvas.height;
  out.drawImage(stage, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  if (project.progressBar.enabled && duration > 0) drawProgressBar(out, width, height, project, progress);
  const veil = fadeVeilAlpha(timeline, duration, project.fade.in, project.fade.out);
  if (veil > 0) {
    out.save();
    out.fillStyle = `rgba(0,0,0,${veil})`;
    out.fillRect(0, 0, width, height);
    out.restore();
  }
  if (watermark) drawWatermark(out, width, height);
}

/** With a crop the stage renders without the bar, fades and watermark — `paintOutput` puts them on the crop. */
function stageProject(project: Project, cropping: boolean): Project {
  if (!cropping) return project;
  return { ...project, progressBar: { ...project.progressBar, enabled: false }, fade: { in: 0, out: 0 } };
}

/**
 * Volume, mute and fades on the rendered timeline audio, in place. Returns
 * null when the track should be left out altogether.
 */
export function applyAudioSettings(
  buffer: AudioBuffer | null,
  audio: AudioSettings,
  duration: number,
): AudioBuffer | null {
  if (!buffer || audio.muted || audio.volume <= 0) return null;
  const gain = Math.min(2, Math.max(0, audio.volume));
  const rate = buffer.sampleRate;
  const total = buffer.length;
  const fadeIn = Math.max(0, Math.min(audio.fadeIn, duration)) * rate;
  const fadeOut = Math.max(0, Math.min(audio.fadeOut, duration)) * rate;
  const fadeOutStart = total - fadeOut;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < total; i++) {
      let g = gain;
      if (fadeIn > 0 && i < fadeIn) g *= i / fadeIn;
      if (fadeOut > 0 && i > fadeOutStart) g *= Math.max(0, (total - i) / fadeOut);
      data[i] = Math.max(-1, Math.min(1, data[i] * g));
    }
  }
  return buffer;
}

/**
 * Generated sound effects (clicks, typing, zooms, transitions) mixed onto the
 * timeline audio — or onto silence, so a muted or mic-less take still gets
 * them. The plan is the one the preview plays and the timeline shows; the
 * project passed in must already carry the segments the video is cut to.
 */
export function addSoundEffects(
  buffer: AudioBuffer | null,
  project: Project,
  duration: number,
): AudioBuffer | null {
  if (!project.sfx.enabled) return buffer;
  const events = planSfx(project);
  if (!events.length) return buffer;
  const sampleRate = buffer?.sampleRate ?? 48000;
  const channels = Math.max(buffer?.numberOfChannels ?? 2, project.sfx.spatial ? 2 : 1);
  const length = buffer?.length ?? Math.ceil(duration * sampleRate);
  if (length <= 0) return buffer;
  const sfx = renderSfxChannels({ events, pack: sfxPack(project.sfx.pack), sampleRate, channels, length });
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  for (let ch = 0; ch < channels; ch++) {
    applyFadesInPlace(sfx[ch], project.audio.fadeIn, project.audio.fadeOut, sampleRate);
    const base = buffer ? buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1)) : null;
    out.copyToChannel(mixChannel(base, sfx[ch]), ch);
  }
  return out;
}

export interface ExportResult {
  blob: Blob;
  ext: ExportContainer;
}

interface CodecChoice {
  container: ExportContainer;
  video: VideoCodec;
  audio: AudioCodec | null;
}

/** Bitrate tuned for screen content (lots of crisp text) rather than camera footage. */
function videoBitrate(width: number, height: number, fps: number): number {
  const base = (width * height * fps) / (1920 * 1080 * 30);
  return Math.round(Math.min(20_000_000, Math.max(6_000_000, base * 9_000_000)));
}

export async function probeExportSupport(
  width: number,
  height: number,
): Promise<CodecChoice | null> {
  if (typeof VideoFrame === "undefined" || typeof VideoEncoder === "undefined") return null;
  const mp4Video = await getFirstEncodableVideoCodec(["avc", "hevc", "av1"], { width, height });
  if (mp4Video) {
    const audio = await getFirstEncodableAudioCodec(["aac", "opus"]);
    return { container: "mp4", video: mp4Video, audio };
  }
  const webmVideo = await getFirstEncodableVideoCodec(["vp9", "vp8"], { width, height });
  if (webmVideo) {
    const audio = await getFirstEncodableAudioCodec(["opus"]);
    return { container: "webm", video: webmVideo, audio };
  }
  return null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't load the recording for export.");
  return res.blob();
}

/**
 * Renders the trimmed timeline's audio into one continuous AudioBuffer.
 * Segment boundaries are honored sample-accurately.
 */
async function renderTimelineAudio(
  sink: AudioBufferSink,
  segments: Segment[],
  sampleRate: number,
  numberOfChannels: number,
  duration: number,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  const totalFrames = Math.ceil(duration * sampleRate);
  if (totalFrames <= 0) return null;
  const out = new AudioBuffer({ length: totalFrames, numberOfChannels, sampleRate });

  let timelineOffset = 0;
  for (const seg of segments) {
    const segDur = Math.max(0, seg.end - seg.start);
    if (segDur <= 0) continue;
    for await (const wrapped of sink.buffers(seg.start, seg.end)) {
      throwIfAborted(signal);
      const { buffer, timestamp } = wrapped;
      // Overlap of this decoded chunk with the segment, in source time.
      const overlapStart = Math.max(timestamp, seg.start);
      const overlapEnd = Math.min(timestamp + buffer.duration, seg.end);
      if (overlapEnd <= overlapStart) continue;
      const srcFrom = Math.round((overlapStart - timestamp) * buffer.sampleRate);
      const frameCount = Math.min(
        Math.round((overlapEnd - overlapStart) * buffer.sampleRate),
        buffer.length - srcFrom,
      );
      const destFrom = Math.round((timelineOffset + (overlapStart - seg.start)) * sampleRate);
      if (frameCount <= 0 || destFrom >= totalFrames) continue;
      const usable = Math.min(frameCount, totalFrames - destFrom);
      const tmp = new Float32Array(usable);
      for (let ch = 0; ch < numberOfChannels; ch++) {
        buffer.copyFromChannel(tmp, Math.min(ch, buffer.numberOfChannels - 1), srcFrom);
        out.copyToChannel(tmp, ch, destFrom);
      }
    }
    timelineOffset += segDur;
  }
  return out;
}

async function exportWithWebCodecs(
  project: Project,
  media: MediaUrls,
  background: HTMLImageElement | null,
  choice: CodecChoice,
  options: ExportOptions,
): Promise<ExportResult> {
  const fps = options.fps ?? 60;
  const { signal, onProgress } = options;
  const { width, height } = outputSize(project, options.crop);
  const stageSize = canvasSize(project.aspect);
  const cropping = Boolean(options.crop);

  onProgress?.(0.01, "prepare");

  const screenBlob = await fetchBlob(media.screenUrl);
  const screenInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(screenBlob) });
  const screenTrack = await screenInput.getPrimaryVideoTrack();
  if (!screenTrack || !(await screenTrack.canDecode())) {
    throw new Error("Can't decode the recording in this environment.");
  }

  // project.duration comes from a <video> seek probe and can overshoot the
  // real track length, which would freeze the last frame — clamp to the
  // demuxer's precise duration. A clip export then slices the timeline.
  const actualDuration = await screenTrack.computeDuration().catch(() => 0);
  const segments = segmentsForExport(project, actualDuration, options.range);
  const duration = Math.max(0.1, timelineDuration(segments));
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const wantWebcam = project.webcam.enabled && Boolean(media.webcamUrl);
  let webcamSink: VideoSampleSink | null = null;
  if (wantWebcam && media.webcamUrl) {
    try {
      const webcamBlob = await fetchBlob(media.webcamUrl);
      const webcamInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(webcamBlob) });
      const webcamTrack = await webcamInput.getPrimaryVideoTrack();
      if (webcamTrack && (await webcamTrack.canDecode())) {
        webcamSink = new VideoSampleSink(webcamTrack);
      }
    } catch {
      webcamSink = null;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Couldn't create a canvas context.");
  // The composition is drawn at the project's aspect; a crop copies its centre onto the output.
  const stage = cropping ? document.createElement("canvas") : canvas;
  if (cropping) {
    stage.width = stageSize.width;
    stage.height = stageSize.height;
  }
  const stageCtx = cropping ? stage.getContext("2d", { alpha: false }) : ctx;
  if (!stageCtx) throw new Error("Couldn't create a canvas context.");
  const cropRect = cropping ? centreCrop(stageSize.width, stageSize.height, width, height) : null;
  const drawn = stageProject(project, cropping);

  const vw = project.videoWidth || screenTrack.displayWidth || 1920;
  const vh = project.videoHeight || screenTrack.displayHeight || 1080;
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = vw;
  screenCanvas.height = vh;
  const screenCtx = screenCanvas.getContext("2d", { alpha: false })!;

  const webcamCanvas = document.createElement("canvas");
  const webcamCtx = webcamCanvas.getContext("2d", { alpha: false })!;
  let webcamReady = false;

  const output = new Output({
    format:
      choice.container === "mp4"
        ? new Mp4OutputFormat({ fastStart: "in-memory" })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, {
    codec: choice.video,
    bitrate: videoBitrate(width, height, fps),
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });

  // Audio: decode the recording's audio track (if any), stitch trimmed
  // segments together, then hand a single continuous buffer to the encoder.
  let audioBuffer: AudioBuffer | null = null;
  let audioSource: AudioBufferSource | null = null;
  if (choice.audio) {
    try {
      const audioTrack = await screenInput.getPrimaryAudioTrack();
      if (audioTrack && (await audioTrack.canDecode())) {
        onProgress?.(0.03, "audio");
        audioBuffer = await renderTimelineAudio(
          new AudioBufferSink(audioTrack),
          segments,
          audioTrack.sampleRate,
          Math.max(1, audioTrack.numberOfChannels),
          duration,
          signal,
        );
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      audioBuffer = null;
    }
    audioBuffer = applyAudioSettings(audioBuffer, project.audio, duration);
    audioBuffer = addSoundEffects(audioBuffer, { ...project, segments }, duration);
    if (audioBuffer) {
      audioSource = new AudioBufferSource({ codec: choice.audio, bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }
  }

  await output.start();

  try {
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer);
      audioSource.close();
    }

    const epsilon = 1e-4;
    const sourceTimes: number[] = [];
    for (let i = 0; i < totalFrames; i++) {
      const timeline = Math.min(duration - epsilon, i / fps);
      sourceTimes.push(timelineToSource(timeline, segments));
    }

    const screenSink = new VideoSampleSink(screenTrack);
    const screenFrames = screenSink.samplesAtTimestamps(sourceTimes);
    const webcamFrames = webcamSink
      ? webcamSink.samplesAtTimestamps(
          sourceTimes.map((t) => Math.max(0, t - project.webcamOffset)),
        )
      : null;

    const transitions = new TransitionTracker();
    let i = 0;
    for await (const sample of screenFrames) {
      throwIfAborted(signal);
      if (sample) {
        sample.draw(screenCtx, 0, 0, vw, vh);
        sample.close();
      }
      if (webcamFrames) {
        const camResult = await webcamFrames.next();
        const cam = camResult.done ? null : camResult.value;
        if (cam) {
          if (!webcamReady) {
            webcamCanvas.width = cam.displayWidth;
            webcamCanvas.height = cam.displayHeight;
            webcamReady = true;
          }
          cam.draw(webcamCtx, 0, 0, webcamCanvas.width, webcamCanvas.height);
          cam.close();
        }
      }

      const timeline = Math.min(duration - epsilon, i / fps);
      drawFrame({
        ctx: stageCtx,
        width: stage.width,
        height: stage.height,
        sourceTime: sourceTimes[i],
        timelineTime: timeline,
        timelineDuration: duration,
        project: { ...drawn, segments },
        screenVideo: screenCanvas,
        webcamVideo: webcamReady ? webcamCanvas : null,
        backgroundImage: background,
        overlayImages: options.overlayImages,
        transition: transitions.begin(segments, timeline),
        onFrameReady: (frame) => transitions.end(frame, segments, timeline, 1 / fps + 1e-3),
        watermark: cropping ? false : options.watermark,
      });
      paintOutput(ctx, stage, cropRect, project, timeline / duration, duration, timeline, Boolean(options.watermark));

      await videoSource.add(i / fps, 1 / fps);
      i += 1;
      onProgress?.(0.06 + 0.91 * (i / totalFrames), "video");
    }
    videoSource.close();

    onProgress?.(0.98, "finalize");
    await output.finalize();
  } catch (err) {
    if (output.state === "started") await output.cancel().catch(() => undefined);
    throw err;
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Export produced an empty file. Try again.");
  }
  onProgress?.(1, "finalize");
  return {
    blob: new Blob([buffer], {
      type: choice.container === "mp4" ? "video/mp4" : "video/webm",
    }),
    ext: choice.container,
  };
}

/* ---------------------------------------------------------------------------
 * Legacy fallback: realtime MediaRecorder capture of the preview canvas.
 * Only used when WebCodecs is unavailable; quality is capped by realtime
 * encoding, so the primary path above should almost always win.
 * ------------------------------------------------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function exportWithMediaRecorder(
  project: Project,
  screen: HTMLVideoElement,
  webcam: HTMLVideoElement | null,
  background: HTMLImageElement | null,
  options: ExportOptions,
): Promise<ExportResult> {
  const fps = Math.min(30, options.fps ?? 30);
  const mimeCandidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mime = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
  const { width, height } = outputSize(project, options.crop);
  const stageSize = canvasSize(project.aspect);
  const cropping = Boolean(options.crop);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Couldn't create a canvas context.");
  const stage = cropping ? document.createElement("canvas") : canvas;
  if (cropping) {
    stage.width = stageSize.width;
    stage.height = stageSize.height;
  }
  const stageCtx = cropping ? stage.getContext("2d", { alpha: false }) : ctx;
  if (!stageCtx) throw new Error("Couldn't create a canvas context.");
  const cropRect = cropping ? centreCrop(stageSize.width, stageSize.height, width, height) : null;
  const drawn = stageProject(project, cropping);

  await ensureFiniteDuration(screen);
  if (webcam?.src) await ensureFiniteDuration(webcam).catch(() => 0);

  const segments = segmentsForExport(project, 0, options.range);
  const duration = Math.max(0.1, timelineDuration(segments));
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const canvasStream = canvas.captureStream(0);
  const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & {
    requestFrame?: () => void;
  };
  if (!videoTrack) throw new Error("Couldn't capture canvas frames.");

  const recorder = new MediaRecorder(new MediaStream([videoTrack]), {
    mimeType: mime,
    videoBitsPerSecond: 10_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Export failed."));
    recorder.onstop = () => {
      if (!chunks.length) reject(new Error("Export produced an empty file. Try again."));
      else resolve(new Blob(chunks, { type: mime }));
    };
  });

  recorder.start(200);
  const transitions = new TransitionTracker();
  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(options.signal);
      const timeline = Math.min(duration, i / fps);
      const source = timelineToSource(timeline, segments);
      await seekVideo(screen, source);
      if (webcam?.src) await seekVideo(webcam, Math.max(0, source - project.webcamOffset));
      drawFrame({
        ctx: stageCtx,
        width: stage.width,
        height: stage.height,
        sourceTime: source,
        timelineTime: timeline,
        timelineDuration: duration,
        project: { ...drawn, segments },
        screenVideo: screen,
        webcamVideo: webcam,
        backgroundImage: background,
        overlayImages: options.overlayImages,
        transition: transitions.begin(segments, timeline),
        onFrameReady: (frame) => transitions.end(frame, segments, timeline, 1 / fps + 1e-3),
        watermark: cropping ? false : options.watermark,
      });
      paintOutput(ctx, stage, cropRect, project, timeline / duration, duration, timeline, Boolean(options.watermark));
      videoTrack.requestFrame?.();
      options.onProgress?.(Math.min(0.99, (i + 1) / totalFrames), "video");
      await sleep(Math.round(1000 / fps));
    }
    videoTrack.requestFrame?.();
    await sleep(120);
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
  }
  const blob = await stopped;
  options.onProgress?.(1, "finalize");
  return { blob, ext: "webm" };
}

export async function exportProject(
  project: Project,
  media: MediaUrls,
  screen: HTMLVideoElement | null,
  webcam: HTMLVideoElement | null,
  background: HTMLImageElement | null,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { width, height } = outputSize(project, options.crop);
  let choice: CodecChoice | null = null;
  try {
    choice = await probeExportSupport(width, height);
  } catch {
    choice = null;
  }

  if (choice) {
    try {
      return await exportWithWebCodecs(project, media, background, choice, options);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      console.error("WebCodecs export failed, falling back to MediaRecorder:", err);
    }
  }

  if (!screen) throw new Error("No video to export.");
  return exportWithMediaRecorder(project, screen, webcam, background, options);
}

export async function blobToFileDownload(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
