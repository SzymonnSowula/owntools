import { useState } from "react";
import { isImageFile } from "../lib/image";
import { combineToPdf, isPdfFile, type CombinePageSize } from "../lib/pdf";
import { baseName, formatBytes, saveBlob, type SaveOutcome } from "../lib/save";
import { FilePicker } from "./FilePicker";
import { SavedLine, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "./ToolModal";

const SIZES: { value: CombinePageSize; label: string }[] = [
  { value: "fit", label: "Page fits each image" },
  { value: "a4", label: "A4" },
  { value: "letter", label: "US Letter" },
];

const MARGINS: { value: number; label: string }[] = [
  { value: 0, label: "None" },
  { value: 28, label: "Narrow" },
  { value: 56, label: "Wide" },
];

export interface MakePdfModalProps {
  open: boolean;
  onClose: () => void;
}

/** Images and PDFs, in the order listed, into one PDF. */
export function MakePdfModal({ open, onClose }: MakePdfModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<CombinePageSize>("fit");
  const [margin, setMargin] = useState(28);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);

  if (!open) return null;

  const pdfCount = files.filter(isPdfFile).length;
  const imageCount = files.length - pdfCount;

  async function run() {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(null);
    setProgress(0);
    try {
      setResult(await combineToPdf(files, { pageSize, margin }, setProgress));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the PDF.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    const stem = files.length === 1 ? baseName(files[0].name, "combined") : "combined";
    try {
      setSaved(await saveBlob(result, `${stem}.pdf`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  return (
    <ToolModal
      title="Images → PDF"
      subtitle="Photos, screenshots, scans — and whole PDFs — stacked into one file, in this order."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={onClose}>
            Close
          </button>
          {result ? (
            <button className="btn btn-primary flex-1" onClick={() => void save()}>
              Save .pdf
            </button>
          ) : (
            <button className="btn btn-primary flex-1" disabled={busy || !files.length} onClick={() => void run()}>
              {busy ? "Building…" : "Make PDF"}
            </button>
          )}
        </>
      }
    >
      <FilePicker
        files={files}
        onChange={(next) => {
          setFiles(next);
          setResult(null);
          setSaved(null);
          setError(null);
        }}
        accept="image/*,application/pdf,.pdf"
        multiple
        reorder
        disabled={busy}
        hint="…or drop images and PDFs here"
        filter={(f) => isImageFile(f) || isPdfFile(f)}
      />
      {files.length ? (
        <ToolNote>
          {imageCount ? `${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}
          {imageCount && pdfCount ? " + " : ""}
          {pdfCount ? `${pdfCount} PDF${pdfCount === 1 ? "" : "s"}` : ""}
          {" · "}use ▲ ▼ to reorder.
        </ToolNote>
      ) : null}

      <ToolRow label="Page size">
        <select className="field h-9 w-full" value={pageSize} disabled={busy} onChange={(e) => setPageSize(e.target.value as CombinePageSize)}>
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </ToolRow>
      {pageSize !== "fit" ? (
        <ToolRow label="Margin">
          <select className="field h-9 w-full" value={margin} disabled={busy} onChange={(e) => setMargin(Number(e.target.value))}>
            {MARGINS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </ToolRow>
      ) : null}
      <ToolNote>
        {pageSize === "fit"
          ? "Every image becomes a page of its own size; PDF pages keep theirs."
          : "Images are centred on the page, turned landscape when they are wider than tall."}
      </ToolNote>

      {busy ? <ToolProgress value={progress} /> : null}
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
