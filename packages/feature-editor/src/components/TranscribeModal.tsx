import { useEffect, useMemo, useRef, useState } from "react";
import {
  dictationStatus,
  parseWhisperJson,
  transcribeBlob,
  type DictationLang,
  type WhisperSegment,
} from "@feature-dictation/engine";
import { segmentsToSrt } from "../lib/srt";
import {
  GROUPINGS,
  groupTranscript,
  transcriptToText,
  type TranscriptGrouping,
} from "../lib/transcriptFormat";
import { exportBlobToPath } from "../lib/projectIo";
import { blobToFileDownload } from "../lib/exportVideo";
import { isTauri } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

const LANGS: { value: DictationLang; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
];

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface TranscribeModalProps {
  open: boolean;
  onClose: () => void;
  /** Preselects the "Translate to English" checkbox each time the modal opens. */
  initialTranslate?: boolean;
}

export function TranscribeModal({ open, onClose, initialTranslate }: TranscribeModalProps) {
  const showToast = useAppStore((s) => s.showToast);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lang, setLang] = useState<DictationLang>("auto");
  const [translate, setTranslate] = useState(false);
  const [grouping, setGrouping] = useState<TranscriptGrouping>("sentences");
  const [timestamps, setTimestamps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<WhisperSegment[] | null>(null);

  useEffect(() => {
    if (open) setTranslate(Boolean(initialTranslate));
  }, [open, initialTranslate]);

  /** Whisper's raw cues regrouped the way the user picked — drives preview AND both exports. */
  const blocks = useMemo(
    () => (segments ? groupTranscript(segments, grouping) : []),
    [segments, grouping],
  );
  const text = useMemo(() => transcriptToText(blocks, timestamps), [blocks, timestamps]);

  if (!open) return null;

  function pick(next: File | null) {
    setFile(next);
    setSegments(null);
    setError(null);
  }

  async function run() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setSegments(null);
    try {
      const status = await dictationStatus();
      if (!status?.engine || !status?.model) {
        setError("Set up the local speech engine in the dictate tool first.");
        return;
      }
      const raw = await transcribeBlob(file, lang, true, translate, {
        ignoreSessionContext: true,
      });
      const parsed = parseWhisperJson(raw);
      if (!parsed.length) {
        setError("No speech was found in this file.");
        return;
      }
      setSegments(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAs(ext: "txt" | "srt") {
    if (!blocks.length || !file) return;
    try {
      const content = ext === "srt" ? segmentsToSrt(blocks) : text;
      const blob = new Blob([content], { type: "text/plain" });
      const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_") || "transcript";
      const saved = await exportBlobToPath(blob, `${base}.${ext}`, ext);
      if (saved === null && !isTauri()) await blobToFileDownload(blob, `${base}.${ext}`);
      if (saved !== null || !isTauri()) {
        showToast(ext === "srt" ? "Subtitles saved." : "Transcript saved.", "info");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save the file.", "error");
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#17151f]/35 p-6">
      <div className="w-full max-w-md rounded-[18px] border border-line bg-card p-6 shadow-[0_30px_80px_rgba(23,21,31,0.18)]">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Transcribe a file</h2>
        <p className="mt-1 text-sm text-muted">
          Transcribing on this device — nothing is uploaded.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="audio/*,video/*"
            disabled={busy}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <div
            className={`flex items-center gap-3 rounded-[14px] border border-dashed px-3 py-3 transition ${
              dragging ? "border-accent bg-accent/10" : "border-line bg-paper"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (busy) return;
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) pick(dropped);
            }}
          >
            <button
              type="button"
              className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {file ? "Change file" : "Choose file"}
            </button>
            <div className="min-w-0 flex-1 text-xs">
              {file ? (
                <>
                  <p className="truncate font-medium text-ink">{file.name}</p>
                  <p className="text-muted">{fileSize(file.size)}</p>
                </>
              ) : (
                <p className="text-muted">…or drop an audio / video file here</p>
              )}
            </div>
            {file && !busy ? (
              <button
                type="button"
                className="btn btn-ghost shrink-0 px-2 py-1 text-xs"
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = "";
                  pick(null);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <select
              className="field h-9 flex-1"
              value={lang}
              disabled={busy}
              onChange={(e) => setLang(e.target.value as DictationLang)}
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={translate}
                disabled={busy}
                onChange={(e) => setTranslate(e.target.checked)}
              />
              Translate to English
            </label>
          </div>

          <div className="flex items-center gap-3">
            <select
              className="field h-9 flex-1"
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as TranscriptGrouping)}
            >
              {GROUPINGS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={timestamps}
                onChange={(e) => setTimestamps(e.target.checked)}
              />
              Add timestamps
            </label>
          </div>
          <p className="text-xs text-muted">
            {GROUPINGS.find((g) => g.value === grouping)?.hint}{" "}
            {timestamps
              ? "Each block is stamped [hh:mm:ss] in the .txt; the .srt keeps exact cue times."
              : "Tick the box to stamp the .txt too — the .srt is always timed."}
          </p>

          {error ? <p className="text-sm font-medium text-coral">{error}</p> : null}

          {blocks.length ? (
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-line bg-paper px-3 py-2 text-sm leading-relaxed">
              {text}
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={onClose}>
            Close
          </button>
          {blocks.length ? (
            <>
              <button className="btn btn-secondary flex-1" onClick={() => void saveAs("txt")}>
                Save .txt
              </button>
              <button className="btn btn-secondary flex-1" onClick={() => void saveAs("srt")}>
                Save .srt
              </button>
            </>
          ) : null}
          <button
            className="btn btn-primary flex-1"
            disabled={busy || !file}
            onClick={() => void run()}
          >
            {busy ? "Transcribing…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
