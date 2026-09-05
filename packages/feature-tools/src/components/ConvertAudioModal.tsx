import { useRef, useState } from "react";
import { AUDIO_TARGETS, convertAudio, type AudioTarget, type RunningConversion } from "../lib/media";
import { baseName, formatBytes, saveBlob, type SaveOutcome } from "../lib/save";
import { FilePicker } from "./FilePicker";
import { SavedLine, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "./ToolModal";

const BITRATES = [96, 128, 192, 256, 320];

export interface ConvertAudioModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConvertAudioModal({ open, onClose }: ConvertAudioModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState<AudioTarget>("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const running = useRef<RunningConversion | null>(null);

  if (!open) return null;

  const file = files[0] ?? null;
  const lossy = target !== "wav" && target !== "flac";

  function reset() {
    setResult(null);
    setSaved(null);
    setError(null);
  }

  async function run() {
    if (!file || busy) return;
    setBusy(true);
    reset();
    setProgress(0);
    const job = convertAudio(file, { target, bitrate }, setProgress);
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
      setSaved(await saveBlob(result, `${baseName(file.name, "audio")}.${target}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  return (
    <ToolModal
      title="Convert audio"
      subtitle="Any audio or video file in; MP3, M4A, WAV, OGG or FLAC out — encoded on this device."
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
            <button className="btn btn-primary flex-1" disabled={!file} onClick={() => void run()}>
              Convert
            </button>
          )}
        </>
      }
    >
      <FilePicker
        files={files}
        onChange={(next) => {
          setFiles(next);
          reset();
        }}
        accept="audio/*,video/*"
        disabled={busy}
        hint="…or drop an audio / video file here"
      />

      <ToolRow label="Format">
        <select
          className="field h-9 w-full"
          value={target}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value as AudioTarget);
            reset();
          }}
        >
          {AUDIO_TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </ToolRow>
      <ToolNote>{AUDIO_TARGETS.find((t) => t.value === target)?.hint}</ToolNote>

      {lossy ? (
        <ToolRow label="Bitrate">
          <select
            className="field h-9 w-full"
            value={bitrate}
            disabled={busy}
            onChange={(e) => {
              setBitrate(Number(e.target.value));
              reset();
            }}
          >
            {BITRATES.map((b) => (
              <option key={b} value={b}>
                {b} kbit/s{b === 192 ? " (recommended)" : ""}
              </option>
            ))}
          </select>
        </ToolRow>
      ) : null}

      {busy ? <ToolProgress value={progress} label={`Converting… ${Math.round(progress * 100)}%`} /> : null}
      {error ? <ToolError>{error}</ToolError> : null}
      {result ? (
        <>
          <ToolNote>Ready — {formatBytes(result.size)}.</ToolNote>
          <SavedLine outcome={saved} />
        </>
      ) : null}
    </ToolModal>
  );
}
