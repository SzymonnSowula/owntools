import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  FlacOutputFormat,
  Input,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type OutputFormat,
  type Quality,
  type VideoCodec,
} from "mediabunny";

/**
 * Audio and video conversion on-device through mediabunny's `Conversion`:
 * WebCodecs encoders, streamed demux/mux, nothing leaves the machine. Tracks
 * the encoder can't produce are reported, never silently dropped.
 */

export interface MediaInfo {
  duration: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probeMedia(file: File): Promise<MediaInfo> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!video && !audio) throw new Error("No audio or video track found in this file.");
    const duration = await input.computeDuration();
    return {
      duration,
      width: video?.displayWidth ?? null,
      height: video?.displayHeight ?? null,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
    };
  } finally {
    input.dispose();
  }
}

export type AudioTarget = "mp3" | "m4a" | "wav" | "ogg" | "flac";

export const AUDIO_TARGETS: { value: AudioTarget; label: string; hint: string }[] = [
  { value: "mp3", label: "MP3", hint: "Plays everywhere." },
  { value: "m4a", label: "M4A (AAC)", hint: "Smaller than MP3 at the same quality; Apple-friendly." },
  { value: "wav", label: "WAV", hint: "Uncompressed; big, but nothing is lost." },
  { value: "ogg", label: "OGG (Opus)", hint: "Small and open; great for speech." },
  { value: "flac", label: "FLAC", hint: "Lossless, about half the size of WAV." },
];

export const AUDIO_MIME: Record<AudioTarget, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export interface AudioConvertOptions {
  target: AudioTarget;
  /** kbit/s for the lossy targets. */
  bitrate: number;
}

export type VideoTarget = "mp4" | "webm" | "mov";

export const VIDEO_TARGETS: { value: VideoTarget; label: string; hint: string }[] = [
  { value: "mp4", label: "MP4 (H.264)", hint: "The safe choice: every player, every site." },
  { value: "webm", label: "WebM (VP9)", hint: "Open format; browsers and the web." },
  { value: "mov", label: "MOV (H.264)", hint: "QuickTime container for Apple apps." },
];

export const VIDEO_MIME: Record<VideoTarget, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export type VideoQuality = "medium" | "high" | "best";

export interface VideoConvertOptions {
  target: VideoTarget;
  /** Cap on the shorter side (1080, 720, 480…), or null to keep the size. */
  maxHeight: number | null;
  quality: VideoQuality;
  muteAudio: boolean;
  trimStart: number | null;
  trimEnd: number | null;
}

export interface RunningConversion {
  done: Promise<Blob>;
  cancel(): Promise<void>;
}

const QUALITIES: Record<VideoQuality, Quality> = {
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  best: QUALITY_VERY_HIGH,
};

let mp3Registered = false;

async function ensureAudioCodec(codec: AudioCodec, label: string): Promise<void> {
  if (codec === "mp3" && !mp3Registered) {
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
    mp3Registered = true;
  }
  if (!(await canEncodeAudio(codec))) {
    throw new Error(`This machine has no ${label} encoder. Pick another format.`);
  }
}

function describeDiscards(conversion: Conversion): string | null {
  for (const d of conversion.discardedTracks) {
    if (d.reason === "discarded_by_user") continue;
    const what = d.track.type === "video" ? "video" : "audio";
    switch (d.reason) {
      case "undecodable_source_codec":
      case "unknown_source_codec":
        return `The ${what} track uses a codec this machine can't decode.`;
      case "no_encodable_target_codec":
        return `This machine can't encode the ${what} for that format.`;
      default:
        return `The ${what} track was left out (${d.reason}).`;
    }
  }
  return null;
}

function run(
  build: () => Promise<Conversion>,
  mime: string,
  onProgress: (p: number) => void,
): RunningConversion {
  let conversion: Conversion | null = null;
  let cancelled = false;
  const done = (async () => {
    try {
      conversion = await build();
      if (cancelled) {
        await conversion.cancel();
        throw new Error("Cancelled.");
      }
      const problem = describeDiscards(conversion);
      if (problem) throw new Error(problem);
      conversion.onProgress = (p) => onProgress(p);
      await conversion.execute();
      const buffer = (conversion.output.target as BufferTarget).buffer;
      if (!buffer || buffer.byteLength === 0) throw new Error("The conversion produced an empty file.");
      return new Blob([buffer], { type: mime });
    } catch (err) {
      if (err instanceof ConversionCanceledError) throw new Error("Cancelled.");
      throw err;
    }
  })();
  return {
    done,
    cancel: async () => {
      cancelled = true;
      if (conversion && conversion.state === "executing") await conversion.cancel();
    },
  };
}

function inputFor(file: File): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
}

export function convertAudio(
  file: File,
  options: AudioConvertOptions,
  onProgress: (p: number) => void,
): RunningConversion {
  return run(
    async () => {
      let format: OutputFormat;
      let audio: ConversionAudioOptions;
      const bitrate = options.bitrate * 1000;
      switch (options.target) {
        case "mp3":
          await ensureAudioCodec("mp3", "MP3");
          format = new Mp3OutputFormat();
          audio = { codec: "mp3", bitrate };
          break;
        case "m4a":
          await ensureAudioCodec("aac", "AAC");
          format = new Mp4OutputFormat({ fastStart: "in-memory" });
          audio = { codec: "aac", bitrate };
          break;
        case "wav":
          format = new WavOutputFormat();
          audio = { codec: "pcm-s16" };
          break;
        case "ogg":
          await ensureAudioCodec("opus", "Opus");
          format = new OggOutputFormat();
          audio = { codec: "opus", bitrate };
          break;
        case "flac":
          await ensureAudioCodec("flac", "FLAC");
          format = new FlacOutputFormat();
          audio = { codec: "flac" };
          break;
      }
      const input = inputFor(file);
      if (!(await input.getPrimaryAudioTrack())) throw new Error("This file has no audio track.");
      return Conversion.init({
        input,
        output: new Output({ format, target: new BufferTarget() }),
        video: { discard: true },
        audio,
      });
    },
    AUDIO_MIME[options.target],
    onProgress,
  );
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function convertVideo(
  file: File,
  info: MediaInfo,
  options: VideoConvertOptions,
  onProgress: (p: number) => void,
): RunningConversion {
  return run(
    async () => {
      const isWebm = options.target === "webm";
      let codec: VideoCodec = isWebm ? "vp9" : "avc";
      if (isWebm && !(await canEncodeVideo("vp9"))) codec = "vp8";
      if (!(await canEncodeVideo(codec))) {
        throw new Error(`This machine has no ${codec.toUpperCase()} encoder. Pick another format.`);
      }
      const audioCodec: AudioCodec = isWebm ? "opus" : "aac";
      if (!options.muteAudio && info.hasAudio) await ensureAudioCodec(audioCodec, audioCodec.toUpperCase());

      const video: ConversionVideoOptions = { codec, bitrate: QUALITIES[options.quality] };
      if (options.maxHeight && info.width && info.height) {
        const scale = Math.min(1, options.maxHeight / Math.min(info.width, info.height));
        if (scale < 1) {
          video.width = even(info.width * scale);
          video.height = even(info.height * scale);
          video.fit = "fill";
        }
      }
      const format: OutputFormat =
        options.target === "mp4"
          ? new Mp4OutputFormat({ fastStart: "in-memory" })
          : options.target === "mov"
            ? new MovOutputFormat({ fastStart: "in-memory" })
            : new WebMOutputFormat();
      const trim =
        options.trimStart !== null || options.trimEnd !== null
          ? { start: options.trimStart ?? undefined, end: options.trimEnd ?? undefined }
          : undefined;
      return Conversion.init({
        input: inputFor(file),
        output: new Output({ format, target: new BufferTarget() }),
        video,
        audio: options.muteAudio ? { discard: true } : { codec: audioCodec, bitrate: 160_000 },
        trim,
      });
    },
    VIDEO_MIME[options.target],
    onProgress,
  );
}
