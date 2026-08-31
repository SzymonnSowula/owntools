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
import type { MediaUrls, Project, Segment } from "../types";
import { canvasSize, drawFrame } from "./compositor";
import { timelineDuration, timelineToSource } from "./segments";
import { ensureFiniteDuration, seekVideo } from "./videoEl";

export type ExportContainer = "mp4" | "webm";
export type ExportPhase = "prepare" | "audio" | "video" | "finalize";

export interface ExportOptions {
  fps?: number;
  watermark?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number, phase: ExportPhase) => void;
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
  if (!res.ok) throw new Error("Nie udało się wczytać nagrania do eksportu.");
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
  const { width, height } = canvasSize(project.aspect);

  onProgress?.(0.01, "prepare");

  const screenBlob = await fetchBlob(media.screenUrl);
  const screenInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(screenBlob) });
  const screenTrack = await screenInput.getPrimaryVideoTrack();
  if (!screenTrack || !(await screenTrack.canDecode())) {
    throw new Error("Nie można zdekodować nagrania w tym środowisku.");
  }

  // project.duration comes from a <video> seek probe and can overshoot the
  // real track length, which would freeze the last frame — clamp to the
  // demuxer's precise duration.
  let segments = project.segments;
  const actualDuration = await screenTrack.computeDuration().catch(() => 0);
  if (actualDuration > 0.2) {
    segments = segments
      .map((s) => ({ ...s, end: Math.min(s.end, actualDuration) }))
      .filter((s) => s.end - s.start > 0.01);
    if (!segments.length) segments = project.segments;
  }
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
  if (!ctx) throw new Error("Nie udało się utworzyć kontekstu canvas.");

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

      drawFrame({
        ctx,
        width,
        height,
        sourceTime: sourceTimes[i],
        project,
        screenVideo: screenCanvas,
        webcamVideo: webcamReady ? webcamCanvas : null,
        backgroundImage: background,
        watermark: options.watermark,
      });

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
    throw new Error("Eksport zapisał pusty plik. Spróbuj ponownie.");
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
  const { width, height } = canvasSize(project.aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Nie udało się utworzyć kontekstu canvas.");

  await ensureFiniteDuration(screen);
  if (webcam?.src) await ensureFiniteDuration(webcam).catch(() => 0);

  const duration = Math.max(0.1, timelineDuration(project.segments));
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const canvasStream = canvas.captureStream(0);
  const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & {
    requestFrame?: () => void;
  };
  if (!videoTrack) throw new Error("Nie udało się przechwycić klatek canvas.");

  const recorder = new MediaRecorder(new MediaStream([videoTrack]), {
    mimeType: mime,
    videoBitsPerSecond: 10_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Eksport się nie powiódł."));
    recorder.onstop = () => {
      if (!chunks.length) reject(new Error("Eksport zapisał pusty plik. Spróbuj ponownie."));
      else resolve(new Blob(chunks, { type: mime }));
    };
  });

  recorder.start(200);
  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(options.signal);
      const timeline = Math.min(duration, i / fps);
      const source = timelineToSource(timeline, project.segments);
      await seekVideo(screen, source);
      if (webcam?.src) await seekVideo(webcam, Math.max(0, source - project.webcamOffset));
      drawFrame({
        ctx,
        width,
        height,
        sourceTime: source,
        project,
        screenVideo: screen,
        webcamVideo: webcam,
        backgroundImage: background,
        watermark: options.watermark,
      });
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
  const { width, height } = canvasSize(project.aspect);
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

  if (!screen) throw new Error("Brak wideo do eksportu.");
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
