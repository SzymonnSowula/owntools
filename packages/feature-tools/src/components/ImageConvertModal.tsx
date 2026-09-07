import { useState } from "react";
import { convertImage, IMAGE_EXT, isImageFile, type ImageFormat } from "../lib/image";
import { baseName, formatBytes, saveBlob, zipBlobs, type SaveOutcome } from "../lib/save";
import { FilePicker } from "./FilePicker";
import { SavedLine, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "./ToolModal";

const FORMATS: { value: ImageFormat; label: string; hint: string }[] = [
  { value: "webp", label: "WebP", hint: "Smallest files; every modern browser and app." },
  { value: "jpeg", label: "JPG", hint: "Photos; transparency becomes white." },
  { value: "png", label: "PNG", hint: "Lossless, keeps transparency; biggest." },
];

const SIZES: { value: number | null; label: string }[] = [
  { value: null, label: "Keep size" },
  { value: 2560, label: "Max 2560 px" },
  { value: 1920, label: "Max 1920 px" },
  { value: 1280, label: "Max 1280 px" },
  { value: 800, label: "Max 800 px" },
  { value: 480, label: "Max 480 px" },
];

interface Converted {
  name: string;
  before: number;
  blob: Blob;
  width: number;
  height: number;
}

export interface ImageConvertModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImageConvertModal({ open, onClose }: ImageConvertModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<ImageFormat>("webp");
  const [quality, setQuality] = useState(0.85);
  const [maxSide, setMaxSide] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Converted[] | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);

  if (!open) return null;

  function reset() {
    setResults(null);
    setSaved(null);
    setError(null);
  }

  async function run() {
    if (!files.length || busy) return;
    setBusy(true);
    reset();
    setProgress(0);
    try {
      const out: Converted[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const converted = await convertImage(file, { format, quality, maxSide });
        out.push({
          name: `${baseName(file.name, "image")}.${IMAGE_EXT[format]}`,
          before: file.size,
          blob: converted.blob,
          width: converted.width,
          height: converted.height,
        });
        setProgress((i + 1) / files.length);
      }
      setResults(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!results?.length) return;
    try {
      if (results.length === 1) {
        setSaved(await saveBlob(results[0].blob, results[0].name));
      } else {
        const entries = await Promise.all(
          results.map(async (r) => ({ name: r.name, data: new Uint8Array(await r.blob.arrayBuffer()) })),
        );
        setSaved(await saveBlob(await zipBlobs(entries), `images-${IMAGE_EXT[format]}.zip`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  const before = results?.reduce((n, r) => n + r.before, 0) ?? 0;
  const after = results?.reduce((n, r) => n + r.blob.size, 0) ?? 0;

  return (
    <ToolModal
      title="Convert images"
      subtitle="PNG, JPG, WebP, GIF, BMP, AVIF or SVG in — smaller, resized, or just another format out."
      onClose={onClose}
      status={<SavedLine outcome={saved} />}
      busy={busy}
      footer={
        <>
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={onClose}>
            Close
          </button>
          {results ? (
            <button className="btn btn-primary flex-1" onClick={() => void save()}>
              {results.length === 1 ? `Save .${IMAGE_EXT[format]}` : `Save ${results.length} files (.zip)`}
            </button>
          ) : (
            <button className="btn btn-primary flex-1" disabled={busy || !files.length} onClick={() => void run()}>
              {busy ? "Converting…" : "Convert"}
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
        accept="image/*"
        multiple
        disabled={busy}
        hint="…or drop images here"
        filter={isImageFile}
      />

      <ToolRow label="Format">
        <select
          className="field h-9 w-full"
          value={format}
          disabled={busy}
          onChange={(e) => {
            setFormat(e.target.value as ImageFormat);
            reset();
          }}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </ToolRow>
      <ToolNote>{FORMATS.find((f) => f.value === format)?.hint}</ToolNote>

      {format !== "png" ? (
        <ToolRow label={`Quality ${Math.round(quality * 100)}%`}>
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.05}
            value={quality}
            disabled={busy}
            className="w-full"
            onChange={(e) => {
              setQuality(Number(e.target.value));
              reset();
            }}
          />
        </ToolRow>
      ) : null}

      <ToolRow label="Size">
        <select
          className="field h-9 w-full"
          value={maxSide ?? ""}
          disabled={busy}
          onChange={(e) => {
            setMaxSide(e.target.value ? Number(e.target.value) : null);
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

      {busy ? <ToolProgress value={progress} /> : null}
      {error ? <ToolError>{error}</ToolError> : null}

      {results ? (
        <>
          <ul className="max-h-40 overflow-y-auto rounded-[12px] border border-line bg-paper text-xs">
            {results.map((r) => (
              <li key={r.name} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink" title={r.name}>
                  {r.name}
                </span>
                <span className="shrink-0 text-muted">
                  {r.width}×{r.height}
                </span>
                <span className="shrink-0 text-muted">
                  {formatBytes(r.before)} → <span className="font-medium text-ink">{formatBytes(r.blob.size)}</span>
                </span>
              </li>
            ))}
          </ul>
          <ToolNote>
            {formatBytes(before)} → {formatBytes(after)}
            {before > 0 ? ` (${after <= before ? "−" : "+"}${Math.abs(Math.round((1 - after / before) * 100))}%)` : ""}
          </ToolNote>
        </>
      ) : null}
    </ToolModal>
  );
}
