import { useState } from "react";
import {
  dictationStatus,
  parseWhisperJson,
  transcribeBlob,
  type DictationLang,
  type WhisperSegment,
} from "@feature-dictation/engine";
import { segmentsToSrt } from "../lib/srt";
import { exportBlobToPath } from "../lib/projectIo";
import { blobToFileDownload } from "../lib/exportVideo";
import { isTauri } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

const LANGS: { value: DictationLang; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
];

export function TranscribeModal() {
  const open = useAppStore((s) => s.transcribeOpen);
  const setOpen = useAppStore((s) => s.setTranscribeOpen);
  const showToast = useAppStore((s) => s.showToast);
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState<DictationLang>("auto");
  const [translate, setTranslate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<WhisperSegment[] | null>(null);

  if (!open) return null;

  const text = segments ? segments.map((s) => s.text).join("\n") : "";

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
      const raw = await transcribeBlob(file, lang, true, translate);
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
    if (!segments || !file) return;
    try {
      const content = ext === "srt" ? segmentsToSrt(segments) : text;
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
    <div className="absolute inset-0 z-50 grid place-items-center bg-[#17151f]/35 p-6">
      <div className="w-full max-w-md rounded-[18px] border border-line bg-card p-6 shadow-[0_30px_80px_rgba(23,21,31,0.18)]">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Transcribe a file</h2>
        <p className="mt-1 text-sm text-muted">
          Transcribing on this device — nothing is uploaded.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <input
            className="field h-9 py-1 text-xs"
            type="file"
            accept="audio/*,video/*"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setSegments(null);
              setError(null);
            }}
          />

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

          {error ? <p className="text-sm font-medium text-coral">{error}</p> : null}

          {segments ? (
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-line bg-paper px-3 py-2 text-sm leading-relaxed">
              {text}
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={() => setOpen(false)}>
            Close
          </button>
          {segments ? (
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
