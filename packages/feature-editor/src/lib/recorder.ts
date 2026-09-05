import { BaseDirectory, open, type FileHandle } from "@tauri-apps/plugin-fs";
import type { CaptureSurface } from "../types";

/** 8 Mbps at 1080p, scaled with the frame area and capped — screen content is mostly text. */
function bitrateFor(stream: MediaStream): number {
  const s = stream.getVideoTracks()[0]?.getSettings();
  const pixels = (s?.width ?? 1920) * (s?.height ?? 1080);
  const scaled = Math.round(8_000_000 * (pixels / (1920 * 1080)));
  return Math.min(20_000_000, Math.max(6_000_000, scaled));
}

export function pickRecorderMime(): string {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function createRecorder(stream: MediaStream): MediaRecorder {
  const mime = pickRecorderMime();
  return mime
    ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(stream) })
    : new MediaRecorder(stream);
}

function toError(err: unknown, fallback: string): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string" && err) return new Error(err);
  return new Error(fallback);
}

export async function getDisplayStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 60, max: 60 },
      // A ceiling, not a target. Asking for 1920x1080 as the *ideal* made the
      // browser hand back a downscaled 2560x1440 screen at exactly 1920x1080 —
      // the same numbers a real 1080p screen reports, which left the two
      // impossible to tell apart when working out where the pointer was. At
      // native size the match is unambiguous, and the recording is sharper.
      // 1440p is the ceiling: it keeps a 4K screen inside what the encoder can
      // hold at 60 fps, and a downscaled surface still matches by shape.
      width: { max: 2560 },
      height: { max: 1440 },
    },
    audio: true,
  });
}

/**
 * Track settings can still be empty in the tick after the picker closes.
 * Waits briefly for the frame size to appear, since everything about placing
 * the cursor hangs off it.
 */
export async function describeDisplayStreamReady(stream: MediaStream): Promise<DisplayInfo> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const info = describeDisplayStream(stream);
    if (info.width > 0 && info.height > 0) return info;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return describeDisplayStream(stream);
}

export interface DisplayInfo {
  surface: CaptureSurface;
  width: number;
  height: number;
}

/** What the picker handed back: cursor overlays in the editor only line up for a monitor. */
export function describeDisplayStream(stream: MediaStream): DisplayInfo {
  const track = stream.getVideoTracks()[0];
  const settings = (track?.getSettings() ?? {}) as MediaTrackSettings & { displaySurface?: string };
  const surface: CaptureSurface =
    settings.displaySurface === "monitor" ||
    settings.displaySurface === "window" ||
    settings.displaySurface === "browser"
      ? settings.displaySurface
      : "unknown";
  return { surface, width: settings.width ?? 0, height: settings.height ?? 0 };
}

/**
 * The frame size the capture really delivers. `getSettings()` right after the
 * picker closes reports the *source's* format — for a window that is the
 * screen it sits on, or the constraint ceiling — and only follows the real
 * frames once they flow, so a 2560×1392 window announced itself as 2560×1440
 * and was matched to its screen. The first decoded frame is the truth: the
 * stream goes on a hidden <video> until that frame's size is known. A take
 * that never delivers one in time falls back to what the track says.
 */
export async function measureDisplayStream(stream: MediaStream, timeoutMs = 2500): Promise<DisplayInfo> {
  const reported = await describeDisplayStreamReady(stream);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  try {
    const measured = await new Promise<{ width: number; height: number } | null>((resolve) => {
      let timer = 0;
      const finish = (size: { width: number; height: number } | null) => {
        window.clearTimeout(timer);
        video.removeEventListener("loadedmetadata", check);
        video.removeEventListener("resize", check);
        resolve(size);
      };
      const check = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          finish({ width: video.videoWidth, height: video.videoHeight });
        }
      };
      timer = window.setTimeout(() => finish(null), timeoutMs);
      video.addEventListener("loadedmetadata", check);
      video.addEventListener("resize", check);
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      check();
    });
    return measured ? { ...reported, ...measured } : reported;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

/** Mutes or unmutes every audio track of a stream in place (a muted track records silence). */
export function setAudioEnabled(stream: MediaStream | null, enabled: boolean): void {
  stream?.getAudioTracks().forEach((t) => {
    t.enabled = enabled;
  });
}

export async function getWebcamStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
}

/**
 * Voice track for a screencast. Echo cancellation is not optional here: the
 * system audio we mix in also comes out of the speakers and back into the mic.
 */
export async function getMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

export interface RecordingSource {
  /** Display video plus one audio track (system audio and microphone mixed). */
  stream: MediaStream;
  /** Stops the microphone and the mixed track and closes the AudioContext. Leaves the display stream alone. */
  close: () => Promise<void>;
}

/**
 * MediaRecorder records exactly one audio track, so system audio and the mic
 * meet in an AudioContext. MediaStreamAudioDestinationNode is its own sink —
 * nothing is routed to the speakers, so mixing cannot create a feedback loop.
 * With a single audio source there is nothing to mix and the tracks go in as
 * they are.
 */
export function buildRecordingStream(display: MediaStream, mic: MediaStream | null): RecordingSource {
  const video = display.getVideoTracks();
  const audioStreams = [display, mic].filter(
    (s): s is MediaStream => Boolean(s && s.getAudioTracks().length),
  );
  const audioTracks = audioStreams.flatMap((s) => s.getAudioTracks());

  if (audioTracks.length <= 1) {
    return {
      stream: new MediaStream([...video, ...audioTracks]),
      close: async () => stopStream(mic),
    };
  }

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const sources = audioStreams.map((s) =>
    ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())),
  );
  sources.forEach((s) => s.connect(dest));
  void ctx.resume().catch(() => undefined);

  return {
    stream: new MediaStream([...video, ...dest.stream.getAudioTracks()]),
    close: async () => {
      sources.forEach((s) => s.disconnect());
      dest.stream.getTracks().forEach((t) => t.stop());
      stopStream(mic);
      await ctx.close().catch(() => undefined);
    },
  };
}

/** In-memory recording — the browser preview path. Every chunk stays in RAM until stop. */
export function recordStream(stream: MediaStream): {
  recorder: MediaRecorder;
  done: Promise<Blob>;
} {
  const recorder = createRecorder(stream);
  const chunks: BlobPart[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error("Recording failed."));
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
  });
  recorder.start(250);
  return { recorder, done };
}

export interface FileRecordingResult {
  /** The AppData-relative path that was passed in. */
  path: string;
  /** Bytes that reached the disk. */
  bytes: number;
  /** Bytes that never did — still queued at stop, or dropped once the queue was full. 0 on a clean take. */
  lostBytes: number;
  /** The last write (or recorder) error when something was lost, otherwise null. */
  error: Error | null;
}

export interface FileRecording {
  recorder: MediaRecorder;
  /** Settles after the recorder stopped and the last write attempt is over. Never rejects — check `lostBytes`. */
  done: Promise<FileRecordingResult>;
}

export interface FileRecordingOptions {
  /** How often MediaRecorder hands over a chunk. Default 1000 ms. */
  timesliceMs?: number;
  baseDir?: BaseDirectory;
  /** Memory budget for chunks waiting on a failing disk. Default 256 MB. */
  maxQueuedBytes?: number;
  /** Called with the error when a write fails, and with null once writes recover. */
  onWriteError?: (err: Error | null) => void;
}

/**
 * Disk-backed recording: each chunk is appended to `<baseDir>/<relPath>` as
 * it arrives, so RAM stays flat no matter how long the take runs and a crash
 * costs at most one chunk. The folder must already exist.
 *
 * Why a 1 s timeslice: at 8 Mbps that is ~1 MB per write — few enough IPC
 * round-trips to be negligible, small enough that nothing meaningful is lost
 * if the app dies. (The in-memory path uses 250 ms; on disk that would just
 * quadruple the IPC calls for the same bytes.)
 *
 * Writes are strictly ordered. A WebM only plays as a prefix of itself, so a
 * chunk that fails to write stays at the head of the queue and is retried
 * before anything newer; nothing newer is ever written around it.
 *
 * The file is opened once and every chunk goes through that handle. Appending
 * by path instead would re-run the plugin's scope check per chunk, and that
 * check resolves an *existing* file to its final path — under folder
 * redirection or app virtualisation that can differ from the path that was
 * allowed a second earlier, and the take would silently stop landing on disk.
 */
export function recordStreamToFile(
  stream: MediaStream,
  relPath: string,
  options: FileRecordingOptions = {},
): FileRecording {
  const timesliceMs = options.timesliceMs ?? 1000;
  const baseDir = options.baseDir ?? BaseDirectory.AppData;
  const maxQueuedBytes = options.maxQueuedBytes ?? 256 * 1024 * 1024;
  const recorder = createRecorder(stream);

  const queue: Blob[] = [];
  let queuedBytes = 0;
  let bytes = 0;
  let lostBytes = 0;
  let overflowed = false;
  let file: FileHandle | null = null;
  let lastError: Error | null = null;
  let chain: Promise<void> = Promise.resolve();

  async function ensureOpen(): Promise<FileHandle> {
    if (file) return file;
    // Truncates whatever an earlier attempt left at this path.
    file = await open(relPath, { write: true, create: true, truncate: true, baseDir });
    return file;
  }

  async function writeAll(handle: FileHandle, data: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < data.byteLength) {
      const n = await handle.write(offset === 0 ? data : data.subarray(offset));
      if (n <= 0) throw new Error("The disk accepted no data.");
      offset += n;
    }
  }

  async function flush(): Promise<void> {
    while (queue.length) {
      const chunk = queue[0];
      try {
        const data = new Uint8Array(await chunk.arrayBuffer());
        await writeAll(await ensureOpen(), data);
        bytes += data.byteLength;
        queue.shift();
        queuedBytes -= chunk.size;
        if (lastError) {
          lastError = null;
          options.onWriteError?.(null);
        }
      } catch (err) {
        lastError = toError(err, "Writing the recording to disk failed.");
        options.onWriteError?.(lastError);
        return; // keep the chunk; the next chunk (or stop) retries it
      }
    }
  }

  function schedule(): Promise<void> {
    chain = chain.then(flush);
    return chain;
  }

  const done = new Promise<FileRecordingResult>((resolve) => {
    let finished = false;
    let recorderError: Error | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      void schedule().then(async () => {
        // Whatever is still queued after the last attempt never made it.
        lostBytes += queuedBytes;
        await file?.close().catch(() => undefined);
        file = null;
        resolve({ path: relPath, bytes, lostBytes, error: lastError ?? recorderError });
      });
    };

    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      // Past the memory budget we drop this and every later chunk rather than
      // stall the app. Keeping older chunks and skipping newer ones would punch
      // a hole in the file; a clean, shorter take beats a longer broken one.
      if (overflowed || queuedBytes + e.data.size > maxQueuedBytes) {
        overflowed = true;
        lostBytes += e.data.size;
        return;
      }
      queue.push(e.data);
      queuedBytes += e.data.size;
      void schedule();
    };
    recorder.onerror = (e: Event) => {
      recorderError = toError((e as Event & { error?: unknown }).error, "Recording failed.");
      // The UA fires `stop` after `error`; the timer only guards against one that doesn't.
      window.setTimeout(finish, 1500);
    };
    recorder.onstop = finish;
  });

  recorder.start(timesliceMs);
  return { recorder, done };
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Turns a getDisplayMedia failure into something the user can act on. */
export function describeCaptureError(err: unknown): string {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name?: unknown }).name)
      : "";
  switch (name) {
    case "NotAllowedError":
      return "Screen sharing was cancelled or blocked. Try again and pick a screen or window.";
    case "NotFoundError":
      return "No screen or window could be captured.";
    case "NotReadableError":
    case "AbortError":
      return "The screen could not be read — another app may be blocking capture.";
    default: {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
      return message ? `Recording could not start: ${message}` : "Recording could not start.";
    }
  }
}
