import { useEffect, useRef, useState } from "react";
import {
  extractPdfText,
  isPdfFile,
  openPdf,
  pagesToDocx,
  renderPdfPage,
  type PageImageFormat,
  type PdfHandle,
} from "../lib/pdf";
import { pagesToMarkdown, pagesToText, parsePageRange } from "../lib/pdfText";
import { baseName, copyText, formatBytes, saveBlob, zipBlobs, type SaveOutcome } from "../lib/save";
import { FilePicker } from "./FilePicker";
import { SavedLine, TextPreview, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "./ToolModal";

type Target = "txt" | "md" | "docx" | PageImageFormat;

const TARGETS: { value: Target; label: string; hint: string }[] = [
  { value: "txt", label: "Plain text (.txt)", hint: "Paragraphs as they read; layout is not kept." },
  { value: "md", label: "Markdown (.md)", hint: "Larger lines become ## headings." },
  { value: "docx", label: "Word (.docx)", hint: "Text and headings only — no images or tables." },
  { value: "png", label: "PNG images", hint: "One picture per page; several pages arrive zipped." },
  { value: "jpeg", label: "JPG images", hint: "Smaller than PNG; good for photos and scans." },
  { value: "webp", label: "WebP images", hint: "Smallest of the three; browsers and most apps." },
];

const WIDTHS = [1200, 1600, 2400, 3200];

interface Result {
  blob: Blob;
  name: string;
  text: string | null;
  pages: number;
}

export interface PdfConvertModalProps {
  open: boolean;
  onClose: () => void;
}

export function PdfConvertModal({ open, onClose }: PdfConvertModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [handle, setHandle] = useState<PdfHandle | null>(null);
  const [opening, setOpening] = useState(false);
  const [target, setTarget] = useState<Target>("txt");
  const [range, setRange] = useState("");
  const [pageBreaks, setPageBreaks] = useState(true);
  const [width, setWidth] = useState(1600);
  const [quality, setQuality] = useState(0.9);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const handleRef = useRef<PdfHandle | null>(null);

  const file = files[0] ?? null;

  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  // Close the worker-side document when the modal goes away.
  useEffect(() => {
    return () => {
      void handleRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  if (!open) return null;

  const isImage = target === "png" || target === "jpeg" || target === "webp";

  async function pick(next: File[]) {
    setFiles(next);
    setResult(null);
    setSaved(null);
    setError(null);
    setRange("");
    void handleRef.current?.close();
    setHandle(null);
    const picked = next[0];
    if (!picked) return;
    setOpening(true);
    try {
      setHandle(await openPdf(picked));
    } catch (err) {
      setError(
        err instanceof Error && /password|encrypt/i.test(err.message)
          ? "This PDF is password-protected."
          : "Couldn't open this PDF.",
      );
    } finally {
      setOpening(false);
    }
  }

  async function run() {
    if (!handle || !file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(null);
    setProgress(0);
    const stem = baseName(file.name, "document");
    try {
      const pages = parsePageRange(range, handle.pageCount);
      if (isImage) {
        const ext = target === "jpeg" ? "jpg" : target;
        const entries: { name: string; data: Uint8Array }[] = [];
        for (let i = 0; i < pages.length; i++) {
          const rendered = await renderPdfPage(handle, pages[i], { width, format: target, quality });
          entries.push({
            name: `${stem}-p${String(pages[i]).padStart(3, "0")}.${ext}`,
            data: new Uint8Array(await rendered.blob.arrayBuffer()),
          });
          setProgress((i + 1) / pages.length);
        }
        if (entries.length === 1) {
          setResult({
            blob: new Blob([entries[0].data as BlobPart], { type: `image/${target}` }),
            name: entries[0].name,
            text: null,
            pages: 1,
          });
        } else {
          setResult({ blob: await zipBlobs(entries), name: `${stem}-pages.zip`, text: null, pages: entries.length });
        }
      } else {
        const extracted = await extractPdfText(handle, pages, (p) => setProgress(p * 0.9));
        const total = extracted.reduce((n, p) => n + p.paragraphs.length, 0);
        if (!total) {
          setError("No text found — a scanned PDF has only pictures of text. Export the pages as images instead.");
          return;
        }
        if (target === "docx") {
          const blob = await pagesToDocx(extracted, { title: stem, pageBreaks });
          setResult({ blob, name: `${stem}.docx`, text: pagesToText(extracted, { pageBreaks }), pages: pages.length });
        } else {
          const text =
            target === "md" ? pagesToMarkdown(extracted, { pageBreaks }) : pagesToText(extracted, { pageBreaks });
          setResult({
            blob: new Blob([text], { type: target === "md" ? "text/markdown" : "text/plain" }),
            name: `${stem}.${target}`,
            text,
            pages: pages.length,
          });
        }
        setProgress(1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    try {
      setSaved(await saveBlob(result.blob, result.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  const hint = TARGETS.find((t) => t.value === target)?.hint;

  return (
    <ToolModal
      title="PDF → text / Word / images"
      subtitle="Read and rendered on this device — the PDF never leaves it."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn btn-secondary flex-1" disabled={busy} onClick={onClose}>
            Close
          </button>
          {result ? (
            <>
              {result.text !== null ? (
                <button
                  className="btn btn-secondary flex-1"
                  onClick={() => void copyText(result.text ?? "").then(() => setCopied(true))}
                >
                  {copied ? "Copied" : "Copy text"}
                </button>
              ) : null}
              <button className="btn btn-primary flex-1" onClick={() => void save()}>
                Save {result.name.endsWith(".zip") ? ".zip" : `.${result.name.split(".").pop()}`}
              </button>
            </>
          ) : (
            <button className="btn btn-primary flex-1" disabled={busy || !handle} onClick={() => void run()}>
              {busy ? "Converting…" : "Convert"}
            </button>
          )}
        </>
      }
    >
      <FilePicker
        files={files}
        onChange={(next) => void pick(next)}
        accept="application/pdf,.pdf"
        disabled={busy}
        hint="…or drop a PDF here"
        filter={isPdfFile}
      />
      {opening ? <ToolProgress value={null} label="Opening…" /> : null}
      {handle ? (
        <ToolNote>
          {handle.pageCount} page{handle.pageCount === 1 ? "" : "s"}.
        </ToolNote>
      ) : null}

      <ToolRow label="Convert to">
        <select
          className="field h-9 w-full"
          value={target}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value as Target);
            setResult(null);
            setSaved(null);
          }}
        >
          {TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </ToolRow>
      <ToolNote>{hint}</ToolNote>

      <ToolRow label="Pages">
        <input
          className="field h-9 w-full"
          placeholder={handle ? `all (1-${handle.pageCount}), or e.g. 1-3, 7` : "all"}
          value={range}
          disabled={busy}
          onChange={(e) => setRange(e.target.value)}
        />
      </ToolRow>

      {isImage ? (
        <>
          <ToolRow label="Width">
            <select className="field h-9 w-full" value={width} disabled={busy} onChange={(e) => setWidth(Number(e.target.value))}>
              {WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w} px
                </option>
              ))}
            </select>
          </ToolRow>
          {target !== "png" ? (
            <ToolRow label={`Quality ${Math.round(quality * 100)}%`}>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.05}
                value={quality}
                disabled={busy}
                className="w-full"
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </ToolRow>
          ) : null}
        </>
      ) : (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={pageBreaks} disabled={busy} onChange={(e) => setPageBreaks(e.target.checked)} />
          Mark page breaks
        </label>
      )}

      {busy ? <ToolProgress value={progress} /> : null}
      {error ? <ToolError>{error}</ToolError> : null}

      {result ? (
        <>
          <ToolNote>
            Ready — {result.pages} page{result.pages === 1 ? "" : "s"} · {result.name} · {formatBytes(result.blob.size)}
          </ToolNote>
          {result.text !== null ? <TextPreview text={result.text} /> : null}
          <SavedLine outcome={saved} />
        </>
      ) : null}
    </ToolModal>
  );
}
