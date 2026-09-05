import { useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { logError } from "@core/errors";
import { exportBoard, type ExportKind } from "./exporters";
import { IconCopy, IconDownload, IconFile, IconShare } from "./icons";

/**
 * Rendered inside Excalidraw's top-right island row (renderTopRightUI), so the
 * editor's own CSS variables are in scope and it sits next to the library
 * toggle like a native control.
 */
export function ExportMenu({
  api,
  name,
  onNotice,
}: {
  api: ExcalidrawImperativeAPI | null;
  name: string;
  onNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (kind: ExportKind) => {
    if (!api || busy) return;
    setBusy(kind);
    try {
      const outcome = await exportBoard(api, kind, name);
      if (outcome === "empty") {
        api.setToast({ message: "Nothing to export yet — draw something first." });
      } else if (outcome === "copied") {
        api.setToast({ message: "PNG copied to the clipboard." });
      } else if (outcome === "saved") {
        api.setToast({
          message:
            kind === "file" ? "Board file saved." : `${kind.toUpperCase()} saved.`,
        });
      }
    } catch (err) {
      logError("board", `export ${kind}`, err);
      onNotice("Export failed — check the log in Settings → Support.");
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div className="board-tr" ref={wrapRef}>
      <button
        type="button"
        className="board-tr-btn"
        title="Export this board"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!api}
        onClick={() => setOpen((v) => !v)}
      >
        <IconShare />
        export
      </button>
      {open ? (
        <div className="board-tr-pop" role="menu">
          <button type="button" className="board-tr-item" role="menuitem" onClick={() => void run("clipboard")}>
            <IconCopy />
            Copy as PNG
          </button>
          <button type="button" className="board-tr-item" role="menuitem" onClick={() => void run("png")}>
            <IconDownload />
            Save PNG…
          </button>
          <button type="button" className="board-tr-item" role="menuitem" onClick={() => void run("svg")}>
            <IconDownload />
            Save SVG…
          </button>
          <div className="board-tr-sep" />
          <button type="button" className="board-tr-item" role="menuitem" onClick={() => void run("file")}>
            <IconFile />
            Save board file (.excalidraw)…
          </button>
        </div>
      ) : null}
    </div>
  );
}
