import { useState } from "react";
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  getFirstEncodableAudioCodec,
} from "mediabunny";
import { encodeWav } from "@core/audio";
import { exportBlobToPath } from "../lib/projectIo";
import { blobToFileDownload } from "../lib/exportVideo";
import { isTauri } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

export interface ExtractAudioModalProps {
  open: boolean;
  onClose: () => void;
}

interface ExtractResult {
  blob: Blob;
  ext: "m4a" | "wav";
}

/** Decodes the file's whole audio track into one continuous AudioBuffer. */
async function decodeAudioTrack(
  file: File,
  onProgress: (p: number) => void,
): Promise<AudioBuffer | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryAudioTrack();
  if (!track) return null;
  if (!(await track.canDecode())) {
    throw new Error("Can't decode this file's audio in this environment.");
  }

  const duration = await track.computeDuration();
  const sampleRate = track.sampleRate;
  const numberOfChannels = Math.max(1, track.numberOfChannels);
  const totalFrames = Math.ceil(duration * sampleRate);
  if (totalFrames <= 0) return null;

  const out = new AudioBuffer({ length: totalFrames, numberOfChannels, sampleRate });
  const sink = new AudioBufferSink(track);
  for await (const { buffer, timestamp } of sink.buffers(0, duration)) {
    const destFrom = Math.round(timestamp * sampleRate);
    if (destFrom >= totalFrames) continue;
    const usable = Math.min(buffer.length, totalFrames - destFrom);
    if (usable <= 0) continue;
    const tmp = new Float32Array(usable);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      buffer.copyFromChannel(tmp, Math.min(ch, buffer.numberOfChannels - 1), 0);
      out.copyToChannel(tmp, ch, destFrom);
    }
    onProgress(Math.min(0.9, timestamp / duration));
  }
  return out;
}

/** Averages all channels of a buffer into one mono Float32Array. */
function mixdownToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  }
  return mono;
}

async function encodeM4a(buffer: AudioBuffer): Promise<Blob> {
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const source = new AudioBufferSource({ codec: "aac", bitrate: 192_000 });
  output.addAudioTrack(source);
  await output.start();
  try {
    await source.add(buffer);
    source.close();
    await output.finalize();
  } catch (err) {
    if (output.state === "started") await output.cancel().catch(() => undefined);
    throw err;
  }
  const bytes = (output.target as BufferTarget).buffer;
  if (!bytes || bytes.byteLength === 0) {
    throw new Error("Extraction produced an empty file. Try again.");
  }
  return new Blob([bytes], { type: "audio/mp4" });
}

export function ExtractAudioModal({ open, onClose }: ExtractAudioModalProps) {
  const showToast = useAppStore((s) => s.showToast);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);

  if (!open) return null;

  async function run() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      const buffer = await decodeAudioTrack(file, setProgress);
      if (!buffer) {
        setError("This file has no audio track.");
        return;
      }
      setProgress(0.92);
      const aac = await getFirstEncodableAudioCodec(["aac"]);
      if (aac) {
        setResult({ blob: await encodeM4a(buffer), ext: "m4a" });
      } else {
        const wav = encodeWav(mixdownToMono(buffer), buffer.sampleRate);
        setResult({ blob: new Blob([wav], { type: "audio/wav" }), ext: "wav" });
      }
      setProgress(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audio extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAudio() {
    if (!result || !file) return;
    try {
      const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_") || "audio";
      const saved = await exportBlobToPath(result.blob, `${base}.${result.ext}`, result.ext);
      if (saved === null && !isTauri()) {
        await blobToFileDownload(result.blob, `${base}.${result.ext}`);
      }
      if (saved !== null || !isTauri()) showToast("Audio saved.", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save the file.", "error");
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#17151f]/35 p-6">
      <div className="w-full max-w-md rounded-[18px] border border-line bg-card p-6 shadow-[0_30px_80px_rgba(23,21,31,0.18)]">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Video → audio</h2>
        <p className="mt-1 text-sm text-muted">
          Extracted on this device — the video stays untouched.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <input
            className="field h-9 py-1 text-xs"
            type="file"
            accept="video/*,audio/*"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
              setProgress(0);
            }}
          />

          {error ? <p className="text-sm font-medium text-coral">{error}</p> : null}

          {busy ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
              <div
                className="h-full rounded-full bg-teal transition-[width] duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          ) : null}

          {result ? (
            <p className="text-sm text-muted">
              Ready — {result.ext === "m4a" ? "M4A (AAC)" : "WAV"} audio extracted.
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={onClose}>
            Close
          </button>
          {result ? (
            <button className="btn btn-primary flex-1" onClick={() => void saveAudio()}>
              Save audio
            </button>
          ) : (
            <button
              className="btn btn-primary flex-1"
              disabled={busy || !file}
              onClick={() => void run()}
            >
              {busy ? "Extracting…" : "Run"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
