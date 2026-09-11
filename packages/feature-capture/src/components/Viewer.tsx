import { ChevronLeft, ChevronRight, Copy, FolderOpen, Presentation, ScanText, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { logError } from "@core/errors";
import { isTauri, isMac } from "@core/env";
import { confirmDialog } from "@ui/Dialog";
import { getCaptureBackend, type CaptureItem } from "../api";
import { sendToBoard, sendToSocial } from "../bridge";
import { Button } from "../components";
import { formatDateTime, itemLabel } from "../lib/library";
import { dropItem, patchItem } from "../store";

/**
 * One capture, large, with everything that can be done to it. Sits over the
 * library grid inside the tool's main column; Esc closes, ← → walk the list.
 */
export function Viewer({ item, onClose, onStep }: { item: CaptureItem; onClose: () => void; onStep: (dir: 1 | -1) => void }) {
  const backend = useMemo(() => getCaptureBackend(), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState(item.title ?? "");

  useEffect(() => setTitle(item.title ?? ""), [item.id, item.title]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onStep(1);
      else if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  const run = async (label: string, fn: () => Promise<void>, done?: string) => {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (err) {
      logError("capture", label, err);
      setNotice(err instanceof Error && err.message ? err.message : "That did not work — check the log in Settings → Support.");
    } finally {
      setBusy(null);
    }
  };

  const copyImage = () => run("copy image", () => backend.copyImage(item.path), "Image copied.");

  const recognise = () =>
    run(
      "ocr",
      async () => {
        const result = await backend.ocr(item.path, item.id);
        patchItem(item.id, { ocrText: result.text });
        if (!result.text.trim()) setNotice("No text was found in this capture.");
      },
      "Text recognised.",
    );

  const copyText = () =>
    run(
      "copy text",
      async () => {
        let text = item.ocrText;
        if (!text) {
          const result = await backend.ocr(item.path, item.id);
          patchItem(item.id, { ocrText: result.text });
          text = result.text;
        }
        if (!text.trim()) throw new Error("No text was found in this capture.");
        await backend.copyText(text);
      },
      "Text copied.",
    );

  const toBoard = () => run("to board", () => sendToBoard(item.path, item.title), undefined);
  const toSocial = () => run("to social", () => sendToSocial(item.path), undefined);
  const reveal = () => run("reveal", () => backend.reveal(item.path));

  const remove = async () => {
    const ok = await confirmDialog({
      title: "Delete capture",
      message: `Delete "${itemLabel(item)}" from the library? A copy saved to Pictures stays where it is.`,
      kind: "danger",
      okLabel: "Delete",
      cancelLabel: "Keep",
    });
    if (!ok) return;
    await run("delete", async () => {
      await backend.remove(item.id);
      dropItem(item.id);
      onClose();
    });
  };

  const commitTitle = () => {
    const next = title.trim();
    if (next === (item.title ?? "")) return;
    patchItem(item.id, { title: next || undefined });
    backend.setTitle(item.id, next).catch((err) => logError("capture", "rename", err));
  };

  const ocrUnavailable = isMac();

  return (
    <div className="cp-viewer" role="dialog" aria-label={itemLabel(item)}>
      <div className="cp-viewer-bar">
        <input
          className="cp-viewer-title"
          value={title}
          placeholder={`${item.width} × ${item.height}`}
          aria-label="Capture name"
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitle(item.title ?? "");
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="cp-viewer-meta">
          {formatDateTime(item.createdAt)} · {item.width} × {item.height}
        </span>
        <span className="cp-viewer-nav">
          <button type="button" className="cp-icon-btn" aria-label="Previous" title="Previous (←)" onClick={() => onStep(-1)}>
            <ChevronLeft />
          </button>
          <button type="button" className="cp-icon-btn" aria-label="Next" title="Next (→)" onClick={() => onStep(1)}>
            <ChevronRight />
          </button>
          <button type="button" className="cp-icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X />
          </button>
        </span>
      </div>
      <div className="cp-viewer-body">
        <div className="cp-viewer-stage">
          <img className="cp-viewer-img" src={backend.imageUrl(item.path)} alt={itemLabel(item)} draggable={false} />
        </div>
        <aside className="cp-viewer-side">
          <div className="cp-viewer-actions">
            <Button onClick={copyImage} disabled={!!busy}>
              <Copy />
              Copy image
            </Button>
            <Button onClick={copyText} disabled={!!busy || ocrUnavailable} title={ocrUnavailable ? "Text recognition is not available on macOS yet." : undefined}>
              <ScanText />
              Copy text
            </Button>
            <Button onClick={toBoard} disabled={!!busy}>
              <Presentation />
              Send to board
            </Button>
            <Button onClick={toSocial} disabled={!!busy}>
              <Send />
              Send to social
            </Button>
            {isTauri() ? (
              <Button onClick={reveal} disabled={!!busy}>
                <FolderOpen />
                Show in folder
              </Button>
            ) : null}
            <Button onClick={() => void remove()} disabled={!!busy} danger>
              <Trash2 />
              Delete
            </Button>
          </div>
          <div className="cp-viewer-text">
            <div className="cp-viewer-text-head">
              <span>Text in this capture</span>
              {!ocrUnavailable ? (
                <button type="button" className="cp-link" onClick={recognise} disabled={!!busy}>
                  {item.ocrText ? "Recognise again" : "Recognise"}
                </button>
              ) : null}
            </div>
            {item.ocrText ? (
              <textarea className="cp-viewer-ocr" value={item.ocrText} readOnly spellCheck={false} />
            ) : (
              <p className="cp-viewer-none">
                {ocrUnavailable
                  ? "Text recognition is not available on macOS yet."
                  : "No text recognised yet. Turn on automatic recognition in Settings, or run it here."}
              </p>
            )}
          </div>
          {notice ? (
            <div className="cp-notice" role="status">
              {notice}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
