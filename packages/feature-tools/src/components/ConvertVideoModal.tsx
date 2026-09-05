import { useRef, useState } from "react";
import {
  convertVideo,
  probeMedia,
  VIDEO_TARGETS,
  type MediaInfo,
  type RunningConversion,
  type VideoQuality,
  type VideoTarget,
} from "../lib/media";
import { baseName, formatBytes, saveBlob, type SaveOutcome } from "../lib/save";
import { formatDuration } from "../lib/youtube";
import { FilePicker } from "./FilePicker";
import { SavedLine, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "./ToolModal";

const SIZES: { value: number | null; label: string }[] = [
  { value: null, label: "Keep size" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
  { value: 480, label: "480p" },
];

const QUALITIES: { value: VideoQuality; label: string }[] = [
  { value: "medium", label: "Medium — small file" },
  { value: "high", label: "High" },
  { value: "best", label: "Best — big file" },
];

function parseSeconds(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export interface ConvertVideoModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConvertVideoModal({ open, onClose }: ConvertVideoModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [target, setTarget] = useState<VideoTarget>("mp4");
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const [quality, setQuality] = useState<VideoQuality>("high");
  const [mute, setMute] = useState(false);
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const running = useRef<RunningConversion | null>(null);

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
    setTrimStart("");
    setTrimEnd("");
    const picked = next[0];
    if (!picked) return;
    try {
      const probed = await probeMedia(picked);
      if (!probed.hasVideo) throw new Error("This file has no video track — try Convert audio.");
      setInfo(probed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read this file.");
    }
  }

  async function run() {
    if (!file || !info || busy) return;
    const start = parseSeconds(trimStart);
    const end = parseSeconds(trimEnd);
    if (trimStart.trim() && start === null) return setError("Start should be seconds or m:ss.");
    if (trimEnd.trim() && end === null) return setError("End should be seconds or m:ss.");
    if (start !== null && end !== null && end <= start) return setError("End has to come after start.");
    setBusy(true);
    reset();
    setProgress(0);
    const job = convertVideo(
      file,
      info,
      { target, maxHeight, quality, muteAudio: mute, trimStart: start, trimEnd: end },
      setProgress,
    );
    running.current = job;
    try {
      setResult(await job.done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed.");
    } finally {
      running.current = null;
      setBusy(false);
    }
  }

  async function save() {
    if (!result || !file) return;
    try {
      setSaved(await saveBlob(result, `${baseName(file.name, "video")}.${target}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  return (
    <ToolModal
      title="Convert video"
      subtitle="Re-encoded with the machine's own codecs; nothing is uploaded."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={onClose}>
            Close
          </button>
          {busy ? (
            <button className="btn btn-secondary flex-1" onClick={() => void running.current?.cancel()}>
              Cancel
            </button>
          ) : result ? (
            <button className="btn btn-primary flex-1" onClick={() => void save()}>
              Save .{target}
            </button>
          ) : (
            <button className="btn btn-primary flex-1" disabled={!file || !info} onClick={() => void run()}>
              Convert
            </button>
          )}
        </>
      }
    >
      <FilePicker files={files} onChange={(next) => void pick(next)} accept="video/*" disabled={busy} hint="…or drop a video here" />
      {info ? (
        <ToolNote>
          {info.width}×{info.height} · {formatDuration(info.duration)}
          {info.hasAudio ? "" : " · no audio"}
        </ToolNote>
      ) : null}

      <ToolRow label="Format">
        <select
          className="field h-9 w-full"
          value={target}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value as VideoTarget);
            reset();
          }}
        >
          {VIDEO_TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </ToolRow>
      <ToolNote>{VIDEO_TARGETS.find((t) => t.value === target)?.hint}</ToolNote>

      <ToolRow label="Size">
        <select
          className="field h-9 w-full"
          value={maxHeight ?? ""}
          disabled={busy}
          onChange={(e) => {
            setMaxHeight(e.target.value ? Number(e.target.value) : null);
            reset();
          }}
        >
          {SIZES.map((s) => (
            <option key={s.label} value={s.value ?? ""}>
              {s.label}
            </option>
          ))}
        </select>
      </ToolRow>

      <ToolRow label="Quality">
        <select
          className="field h-9 w-full"
          value={quality}
          disabled={busy}
          onChange={(e) => {
            setQuality(e.target.value as VideoQuality);
            reset();
          }}
        >
          {QUALITIES.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      </ToolRow>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <span>Trim</span>
          <input
            className="field h-9 w-20 text-right"
            placeholder="start"
            value={trimStart}
            disabled={busy}
            onChange={(e) => setTrimStart(e.target.value)}
          />
          <span>→</span>
          <input
            className="field h-9 w-20 text-right"
            placeholder="end"
            value={trimEnd}
            disabled={busy}
            onChange={(e) => setTrimEnd(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={mute} disabled={busy} onChange={(e) => setMute(e.target.checked)} />
          Remove audio
        </label>
      </div>
      <ToolNote>Trim takes seconds or m:ss; leave both empty for the whole clip.</ToolNote>

      {busy ? <ToolProgress value={progress} label={`Converting… ${Math.round(progress * 100)}%`} /> : null}
      {error ? <ToolError>{error}</ToolError> : null}
      {result ? (
        <>
          <ToolNote>
            Ready — {formatBytes(result.size)}
            {file ? ` (was ${formatBytes(file.size)})` : ""}.
          </ToolNote>
          <SavedLine outcome={saved} />
        </>
      ) : null}
    </ToolModal>
  );
}
