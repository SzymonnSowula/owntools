import { useRef, useState } from "react";
import { videoToGif, type GifResult } from "../lib/gif";
import { probeMedia, type MediaInfo } from "../lib/media";
import { baseName, formatBytes, saveBlob, type SaveOutcome } from "../lib/save";
import { formatDuration } from "../lib/youtube";
import { FilePicker } from "./FilePicker";
import { SavedLine, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "./ToolModal";

const FPS = [8, 10, 12, 15, 20];
const WIDTHS = [320, 480, 640, 800];

function parseSeconds(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export interface GifModalProps {
  open: boolean;
  onClose: () => void;
}

export function GifModal({ open, onClose }: GifModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loop, setLoop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GifResult | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const abort = useRef<AbortController | null>(null);

  if (!open) return null;

  const file = files[0] ?? null;

  function reset() {
    setResult(null);
    setSaved(null);
    setError(null);
  }

  async function pick(next: File[]) {
    setFiles(next);
    setInfo(null);
    reset();
    setStart("");
    setEnd("");
    const picked = next[0];
    if (!picked) return;
    try {
      const probed = await probeMedia(picked);
      if (!probed.hasVideo) throw new Error("This file has no video track.");
      setInfo(probed);
      if (probed.duration > 10) setEnd("10");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read this file.");
    }
  }

  async function run() {
    if (!file || !info || busy) return;
    const from = parseSeconds(start) ?? 0;
    const to = parseSeconds(end);
    if (start.trim() && parseSeconds(start) === null) return setError("Start should be seconds or m:ss.");
    if (end.trim() && to === null) return setError("End should be seconds or m:ss.");
    if (to !== null && to <= from) return setError("End has to come after start.");
    const span = (to ?? info.duration) - from;
    if (span > 60) return setError("Keep a GIF under a minute — pick a shorter range.");
    setBusy(true);
    reset();
    setProgress(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      setResult(
        await videoToGif(
          file,
          { fps, width, start: from, end: to, loop },
          (done, total) => setProgress({ done, total }),
          controller.signal,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the GIF.");
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  async function save() {
    if (!result || !file) return;
    try {
      setSaved(await saveBlob(result.blob, `${baseName(file.name, "clip")}.gif`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  return (
    <ToolModal
      title="Video → GIF"
      subtitle="A short looping clip — for a README, a pull request, a post."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={onClose}>
            Close
          </button>
          {busy ? (
            <button className="btn btn-secondary flex-1" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          ) : result ? (
            <button className="btn btn-primary flex-1" onClick={() => void save()}>
              Save .gif
            </button>
          ) : (
            <button className="btn btn-primary flex-1" disabled={!file || !info} onClick={() => void run()}>
              Make GIF
            </button>
          )}
        </>
      }
    >
      <FilePicker files={files} onChange={(next) => void pick(next)} accept="video/*" disabled={busy} hint="…or drop a video here" />
      {info ? (
        <ToolNote>
          {info.width}×{info.height} · {formatDuration(info.duration)}
        </ToolNote>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <span>From</span>
          <input className="field h-9 w-20 text-right" placeholder="0" value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} />
          <span>to</span>
          <input className="field h-9 w-20 text-right" placeholder="end" value={end} disabled={busy} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={loop} disabled={busy} onChange={(e) => setLoop(e.target.checked)} />
          Loop
        </label>
      </div>

      <ToolRow label="Frame rate">
        <select className="field h-9 w-full" value={fps} disabled={busy} onChange={(e) => setFps(Number(e.target.value))}>
          {FPS.map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
      </ToolRow>
      <ToolRow label="Width">
        <select className="field h-9 w-full" value={width} disabled={busy} onChange={(e) => setWidth(Number(e.target.value))}>
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w} px
            </option>
          ))}
        </select>
      </ToolRow>
      <ToolNote>Seconds or m:ss. Fewer frames and a smaller width make a much smaller file.</ToolNote>

      {busy ? (
        <ToolProgress
          value={progress ? progress.done / progress.total : null}
          label={progress ? `Frame ${progress.done} of ${progress.total}` : "Decoding…"}
        />
      ) : null}
      {error ? <ToolError>{error}</ToolError> : null}
      {result ? (
        <>
          <ToolNote>
            Ready — {result.width}×{result.height}, {result.frames} frames, {formatBytes(result.blob.size)}.
          </ToolNote>
          <SavedLine outcome={saved} />
        </>
      ) : null}
    </ToolModal>
  );
}
