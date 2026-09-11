import {
  Check,
  Circle,
  Copy,
  EyeOff,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  Presentation,
  Redo2,
  Save,
  ScanText,
  Send,
  Square,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { logError, logInfo } from "@core/errors";
import { CAPTURE_HOTKEY_LABEL } from "@core/hotkeys";
import { getCaptureBackend } from "./api";
import type { CaptureFrame, FinishResult, Rect } from "./api/types";
import {
  annotationFromDrag,
  badgeAnnotation,
  canRedo,
  canUndo,
  commit,
  emptyHistory,
  nextBadgeNumber,
  redo,
  textAnnotation,
  undo,
  TEXT_SIZE,
  type Annotation,
  type History,
  type ToolId,
} from "./lib/annotations";
import {
  clampPoint,
  clampRect,
  formatSize,
  handleAt,
  handlePoint,
  HANDLES,
  isUsable,
  moveRect,
  readoutPosition,
  rectFromPoints,
  resizeRect,
  roundRect,
  toolbarPosition,
  wholeRect,
  type Handle,
  type Point,
} from "./lib/region";
import { canvasToPng, composeCapture, drawScene } from "./lib/render";
import { COLORS, loadSettings } from "./settings";
import "./capture.css";

/**
 * The capture overlay — the page of the transparent, always-on-top `capture`
 * window. Rust takes the screenshot and shows the window sized to the monitor
 * (`capture_grab`, or the hotkey handler); this page hears `capture-shown`,
 * pulls the pixels and paints them full-window, so what the person sees is
 * their own screen, frozen, with a veil over it. Then: drag a region, mark it
 * up, and one of Copy / Copy text / Save / Board / Social.
 *
 * Coordinates: the canvas is the frame's size in device pixels and stretched
 * to the window in CSS, so every model coordinate is a screenshot pixel and
 * `scale` (frame px per CSS px) is the one conversion, applied to pointer
 * events on the way in and to DOM chrome positions on the way out.
 */

type Phase = "idle" | "select" | "edit" | "sheet";

interface Session {
  frame: CaptureFrame;
  bitmap: ImageBitmap;
}

type Drag =
  | { kind: "select"; from: Point }
  | { kind: "move"; start: Point; origin: Rect }
  | { kind: "resize"; handle: Handle; start: Point; origin: Rect }
  | { kind: "draw"; from: Point };

interface Sheet {
  id: string;
  path: string;
  text: string;
  error?: string | null;
}

const WIDTHS = [
  { id: 2, label: "Thin" },
  { id: 4, label: "Medium" },
  { id: 7, label: "Thick" },
];

const TOOLS: { id: ToolId; label: string; key: string; icon: ReactElement }[] = [
  { id: "select", label: "Adjust the area", key: "V", icon: <MousePointer2 /> },
  { id: "arrow", label: "Arrow", key: "A", icon: <MoveUpRight /> },
  { id: "rect", label: "Rectangle", key: "R", icon: <Square /> },
  { id: "ellipse", label: "Ellipse", key: "E", icon: <Circle /> },
  { id: "line", label: "Line", key: "L", icon: <Minus /> },
  { id: "highlight", label: "Highlighter", key: "H", icon: <Highlighter /> },
  { id: "text", label: "Text", key: "T", icon: <Type /> },
  { id: "badge", label: "Numbered step", key: "N", icon: <BadgeIcon /> },
  { id: "blur", label: "Pixelate", key: "B", icon: <EyeOff /> },
];

const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));

function BadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M10.2 9.2 12 8v8" />
    </svg>
  );
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

export function CaptureOverlay() {
  const backend = useMemo(() => getCaptureBackend(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selection, setSelection] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tool, setTool] = useState<ToolId>("arrow");
  const [color, setColor] = useState<string>(COLORS[0].id);
  const [width, setWidth] = useState<number>(4);
  const [history, setHistory] = useState<History>(emptyHistory());
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [textEdit, setTextEdit] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hintSeen, setHintSeen] = useState(false);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [barSize, setBarSize] = useState({ w: 760, h: 46 });

  const scale = session ? session.bitmap.width / Math.max(1, viewport.w) : 1;
  const bounds = session ? { w: session.bitmap.width, h: session.bitmap.height } : { w: 1, h: 1 };
  const annotations = history.present;

  const reset = useCallback(() => {
    setSession((s) => {
      s?.bitmap.close();
      return null;
    });
    setPhase("idle");
    setSelection(null);
    setDrag(null);
    setDraft(null);
    setTextEdit(null);
    setTextValue("");
    setSheet(null);
    setHistory(emptyHistory());
    setBusy(null);
  }, []);

  /* ---- a frame arrives ------------------------------------------------ */

  const load = useCallback(
    async (frame: CaptureFrame) => {
      const t0 = performance.now();
      try {
        const bitmap = await backend.pixels(frame);
        setSession((prev) => {
          prev?.bitmap.close();
          return { frame, bitmap };
        });
        const settings = loadSettings();
        setColor(settings.defaultColor);
        setTool("arrow");
        setSelection(null);
        setHistory(emptyHistory());
        setDraft(null);
        setTextEdit(null);
        setSheet(null);
        setHintSeen(false);
        setPhase("select");
        setViewport({ w: window.innerWidth, h: window.innerHeight });
        logInfo("capture", `frame ${frame.id} ${frame.width}×${frame.height} painted in ${Math.round(performance.now() - t0)} ms`);
      } catch (err) {
        logError("capture", "load frame", err);
        setToast("The screenshot could not be shown.");
        void backend.cancel(frame.id);
      }
    },
    [backend],
  );

  useEffect(() => {
    const off = backend.onShown((frame) => void load(frame));
    // The event may have fired before this page finished loading.
    void backend.current().then((frame) => {
      if (frame) void load(frame);
      else if (backend.kind === "demo") void backend.grab();
    });
    return off;
  }, [backend, load]);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* ---- painting ------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !session) return;
    if (canvas.width !== session.bitmap.width || canvas.height !== session.bitmap.height) {
      canvas.width = session.bitmap.width;
      canvas.height = session.bitmap.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, session.bitmap, selection, draft ? [...annotations, draft] : annotations, phase === "sheet" ? 0.6 : 0.45);
  }, [session, selection, annotations, draft, phase]);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && (Math.abs(r.width - barSize.w) > 1 || Math.abs(r.height - barSize.h) > 1)) {
      setBarSize({ w: r.width, h: r.height });
    }
  });

  /* ---- coordinates ---------------------------------------------------- */

  const toImage = useCallback(
    (e: { clientX: number; clientY: number }): Point => clampPoint({ x: e.clientX * scale, y: e.clientY * scale }, bounds),
    [scale, bounds],
  );
  const toCss = (v: number) => v / scale;

  const style = useMemo(() => ({ color, width, scale }), [color, width, scale]);

  /* ---- actions -------------------------------------------------------- */

  const cancel = useCallback(() => {
    const id = session?.frame.id ?? null;
    reset();
    backend.cancel(id).catch((err) => logError("capture", "cancel", err));
  }, [backend, reset, session]);

  const push = useCallback((next: readonly Annotation[]) => setHistory((h) => commit(h, next)), []);

  const commitText = useCallback(() => {
    if (!textEdit) return;
    const text = textValue.trim();
    if (text) {
      const at = { x: textEdit.x, y: textEdit.y + TEXT_SIZE * 0.82 * scale };
      push([...annotations, textAnnotation(at, text, style)]);
    }
    setTextEdit(null);
    setTextValue("");
  }, [annotations, push, scale, style, textEdit, textValue]);

  const finish = useCallback(
    async (opts: {
      label: string;
      ocr: boolean;
      hide: boolean;
      pictures: boolean;
      after?: (r: FinishResult) => Promise<void> | void;
    }) => {
      if (!session || !selection || busy) return;
      const rect = roundRect(clampRect(selection, bounds));
      if (!isUsable(rect)) return;
      setBusy(opts.label);
      const t0 = performance.now();
      let hidden = false;
      try {
        if (opts.hide) {
          await backend.hide();
          hidden = true;
        }
        const canvas = composeCapture(session.bitmap, rect, annotations);
        const png = await canvasToPng(canvas);
        const result = await backend.finish(png, {
          id: session.frame.id,
          width: canvas.width,
          height: canvas.height,
          rect,
          save: { library: true, pictures: opts.pictures },
          ocr: opts.ocr,
          hide: opts.hide,
        });
        logInfo(
          "capture",
          `${opts.label}: ${result.width}×${result.height} → ${result.path} in ${Math.round(performance.now() - t0)} ms${
            result.ocrText !== undefined ? ` · ocr ${result.ocrText?.length ?? 0} chars` : ""
          }`,
        );
        await opts.after?.(result);
        if (opts.hide) reset();
      } catch (err) {
        logError("capture", opts.label, err);
        if (hidden) {
          // The window is already gone; leave a clean state for the next take.
          reset();
        } else {
          setToast("That did not work — check the log in Settings → Support.");
        }
      } finally {
        setBusy(null);
      }
    },
    [annotations, backend, bounds, busy, reset, selection, session],
  );

  const doCopy = () =>
    finish({
      label: "copy",
      ocr: loadSettings().autoOcr,
      hide: true,
      pictures: false,
      after: (r) => backend.copyImage(r.path),
    });

  const doCopyText = () =>
    finish({
      label: "copy text",
      ocr: true,
      hide: false,
      pictures: false,
      after: (r) => {
        setSheet({ id: r.id, path: r.path, text: r.ocrText ?? "", error: r.ocrError });
        setPhase("sheet");
      },
    });

  const doSave = () => {
    const s = loadSettings();
    return finish({ label: "save", ocr: s.autoOcr, hide: true, pictures: s.saveToPictures });
  };

  const doBoard = () =>
    finish({
      label: "to board",
      ocr: loadSettings().autoOcr,
      hide: true,
      pictures: false,
      after: (r) => backend.toBoard(r.path),
    });

  const doSocial = () =>
    finish({
      label: "to social",
      ocr: loadSettings().autoOcr,
      hide: true,
      pictures: false,
      after: (r) => backend.toSocial(r.path),
    });

  const closeSheet = useCallback(() => {
    reset();
    backend.hide().catch((err) => logError("capture", "hide", err));
  }, [backend, reset]);

  const copySheetText = useCallback(async () => {
    if (!sheet) return;
    try {
      await backend.copyText(sheet.text);
    } catch (err) {
      logError("capture", "copy text", err);
    }
    closeSheet();
  }, [backend, closeSheet, sheet]);

  const pickTool = useCallback(
    (next: ToolId) => {
      setTool(next);
      // A white or black highlighter is invisible or a blackout; yellow is what people mean.
      if (next === "highlight" && (color === "#ffffff" || color === "#1d1d1f")) setColor("#ffd60a");
    },
    [color],
  );

  /* ---- keyboard ------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "idle") return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.preventDefault();
        if (textEdit) {
          setTextEdit(null);
          setTextValue("");
        } else if (phase === "sheet") closeSheet();
        else if (drag) {
          setDrag(null);
          setDraft(null);
        } else cancel();
        return;
      }
      if (isEditable(e.target)) return;
      if (phase === "select") {
        if (e.key === "Enter" && session) {
          e.preventDefault();
          setSelection(wholeRect(bounds));
          setPhase("edit");
          setTool("arrow");
        }
        return;
      }
      if (phase !== "edit") return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setHistory((h) => redo(h));
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void doCopy();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void doSave();
        return;
      }
      if (e.key === "Enter" && !mod) {
        e.preventDefault();
        void doSave();
        return;
      }
      if (mod || e.altKey) return;
      const t = TOOL_KEYS[e.key.toLowerCase()];
      if (t) {
        e.preventDefault();
        pickTool(t);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= COLORS.length) setColor(COLORS[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---- pointer -------------------------------------------------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!session || busy || phase === "idle" || phase === "sheet" || e.button !== 0) return;
    if (isEditable(e.target)) return;
    if (textEdit) {
      commitText();
      return;
    }
    const p = toImage(e);
    rootRef.current?.setPointerCapture(e.pointerId);
    if (phase === "select" || !selection) {
      setHintSeen(true);
      setDrag({ kind: "select", from: p });
      setSelection({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    if (tool === "select") {
      const hit = handleAt(selection, p, 10 * scale);
      if (hit === "inside") setDrag({ kind: "move", start: p, origin: selection });
      else if (hit) setDrag({ kind: "resize", handle: hit, start: p, origin: selection });
      else {
        setDrag({ kind: "select", from: p });
        setSelection({ x: p.x, y: p.y, w: 0, h: 0 });
        setHistory(emptyHistory());
      }
      return;
    }
    if (tool === "text") {
      setTextEdit(p);
      setTextValue("");
      return;
    }
    if (tool === "badge") {
      push([...annotations, badgeAnnotation(p, nextBadgeNumber(annotations), style)]);
      return;
    }
    setDrag({ kind: "draw", from: p });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !session) return;
    const p = toImage(e);
    switch (drag.kind) {
      case "select":
        setSelection(clampRect(rectFromPoints(drag.from, p), bounds));
        break;
      case "move":
        setSelection(moveRect(drag.origin, p.x - drag.start.x, p.y - drag.start.y, bounds));
        break;
      case "resize":
        setSelection(resizeRect(drag.origin, drag.handle, p.x - drag.start.x, p.y - drag.start.y, bounds));
        break;
      case "draw":
        setDraft(annotationFromDrag(tool, drag.from, p, style));
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    rootRef.current?.releasePointerCapture(e.pointerId);
    if (drag.kind === "select") {
      if (selection && isUsable(selection)) {
        setSelection(roundRect(selection));
        if (phase === "select") {
          setPhase("edit");
          setTool("arrow");
        }
      } else {
        // A slipped click: back to choosing an area.
        setSelection(null);
        if (phase === "edit") setPhase("select");
      }
    } else if (drag.kind === "draw" && draft) {
      push([...annotations, draft]);
    }
    setDraft(null);
    setDrag(null);
  };

  /* ---- layout of the chrome ------------------------------------------- */

  const cssSel = selection
    ? { x: toCss(selection.x), y: toCss(selection.y), w: toCss(selection.w), h: toCss(selection.h) }
    : null;
  const barPos = cssSel && phase === "edit" ? toolbarPosition(cssSel, viewport, barSize, 12) : null;
  const readout = cssSel && selection && (drag || phase === "edit") ? readoutPosition(cssSel, viewport, { w: 92, h: 24 }, 8) : null;

  const demo = backend.kind === "demo";
  const showHandles = phase === "edit" && tool === "select" && cssSel;

  return (
    <div
      ref={rootRef}
      className="cpo"
      data-phase={phase}
      data-tool={tool}
      data-drag={drag?.kind ?? undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(null);
        setDraft(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {session ? <canvas ref={canvasRef} className="cpo-canvas" /> : null}

      {phase === "select" && !hintSeen ? (
        <div className="cpo-hint">
          <span>Drag to select an area</span>
          <span className="cpo-hint-sep" />
          <kbd>⏎</kbd> <span>whole screen</span>
          <span className="cpo-hint-sep" />
          <kbd>Esc</kbd> <span>cancel</span>
        </div>
      ) : null}

      {cssSel && selection && (phase === "edit" || drag) ? (
        <div
          className="cpo-frame"
          style={{ left: cssSel.x, top: cssSel.y, width: Math.max(1, cssSel.w), height: Math.max(1, cssSel.h) }}
        />
      ) : null}

      {showHandles && cssSel
        ? HANDLES.map((h) => {
            const c = handlePoint(cssSel, h);
            return <span key={h} className="cpo-handle" data-h={h} style={{ left: c.x, top: c.y }} />;
          })
        : null}

      {readout && selection ? (
        <div className="cpo-readout" style={{ left: readout.x, top: readout.y }}>
          {formatSize(selection.w, selection.h)}
        </div>
      ) : null}

      {textEdit ? (
        <input
          className="cpo-text-input"
          autoFocus
          value={textValue}
          placeholder="Type, then Enter"
          style={{ left: toCss(textEdit.x), top: toCss(textEdit.y), color, fontSize: TEXT_SIZE }}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "Escape") {
              setTextEdit(null);
              setTextValue("");
            }
          }}
          onBlur={commitText}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : null}

      {phase === "edit" && barPos ? (
        <div
          ref={barRef}
          className="cpo-bar"
          role="toolbar"
          aria-label="Mark-up"
          style={{ left: barPos.x, top: barPos.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`cpo-tool${tool === t.id ? " active" : ""}`}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => pickTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
          <span className="cpo-sep" />
          <div className="cpo-colors" role="radiogroup" aria-label="Colour">
            {COLORS.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.id}
                aria-label={c.label}
                title={`${c.label} (${i + 1})`}
                className={`cpo-color${color === c.id ? " active" : ""}`}
                style={{ ["--c" as string]: c.id }}
                onClick={() => setColor(c.id)}
              />
            ))}
          </div>
          <div className="cpo-widths" role="radiogroup" aria-label="Stroke width">
            {WIDTHS.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={width === w.id}
                aria-label={w.label}
                title={w.label}
                className={`cpo-width${width === w.id ? " active" : ""}`}
                onClick={() => setWidth(w.id)}
              >
                <i style={{ width: w.id + 3, height: w.id + 3 }} />
              </button>
            ))}
          </div>
          <span className="cpo-sep" />
          <button
            type="button"
            className="cpo-tool"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!canUndo(history)}
            onClick={() => setHistory((h) => undo(h))}
          >
            <Undo2 />
          </button>
          <button
            type="button"
            className="cpo-tool"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={!canRedo(history)}
            onClick={() => setHistory((h) => redo(h))}
          >
            <Redo2 />
          </button>
          <span className="cpo-sep" />
          <button type="button" className="cpo-action" title="Copy image (Ctrl+C)" disabled={!!busy} onClick={() => void doCopy()}>
            <Copy />
            <span>Copy</span>
          </button>
          <button type="button" className="cpo-action" title="Recognise the text and copy it" disabled={!!busy} onClick={() => void doCopyText()}>
            <ScanText />
            <span>Copy text</span>
          </button>
          <button type="button" className="cpo-action" title="Send to the board" disabled={!!busy || demo} onClick={() => void doBoard()}>
            <Presentation />
            <span>Board</span>
          </button>
          <button type="button" className="cpo-action" title="Start a social post with it" disabled={!!busy || demo} onClick={() => void doSocial()}>
            <Send />
            <span>Social</span>
          </button>
          <button type="button" className="cpo-action primary" title="Save to the library (Enter)" disabled={!!busy} onClick={() => void doSave()}>
            <Save />
            <span>Save</span>
          </button>
          <button type="button" className="cpo-tool cpo-close" title="Cancel (Esc)" aria-label="Cancel" onClick={cancel}>
            <X />
          </button>
        </div>
      ) : null}

      {busy ? (
        <div className="cpo-busy" role="status">
          <i aria-hidden />
          {busy === "copy text" ? "Reading the text…" : "Saving…"}
        </div>
      ) : null}

      {phase === "sheet" && sheet ? (
        <div className="cpo-sheet" role="dialog" aria-label="Text in this capture" onPointerDown={(e) => e.stopPropagation()}>
          <div className="cpo-sheet-head">
            <div>
              <div className="cpo-sheet-title">Text in this capture</div>
              <div className="cpo-sheet-sub">
                {sheet.error ? sheet.error : `${sheet.text.split("\n").filter(Boolean).length} lines · saved to the library`}
              </div>
            </div>
            <button type="button" className="cpo-tool" aria-label="Close" title="Close (Esc)" onClick={closeSheet}>
              <X />
            </button>
          </div>
          <textarea
            className="cpo-sheet-text"
            value={sheet.text}
            spellCheck={false}
            autoFocus
            onChange={(e) => setSheet({ ...sheet, text: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="cpo-sheet-actions">
            <button type="button" className="cpo-action" onClick={closeSheet}>
              <Check />
              <span>Done</span>
            </button>
            <button type="button" className="cpo-action primary" disabled={!sheet.text.trim()} onClick={() => void copySheetText()}>
              <Copy />
              <span>Copy text</span>
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="cpo-toast" role="status">
          {toast}
        </div>
      ) : null}

      {demo && phase === "idle" ? (
        <div className="cpo-demo">
          <div className="cpo-demo-title">capture overlay</div>
          <p>
            In the app this window appears the moment you press <kbd>{CAPTURE_HOTKEY_LABEL}</kbd>, with your screen frozen
            under it. Here the screen is painted for the preview.
          </p>
          <button type="button" className="cpo-action primary" onClick={() => void backend.grab()}>
            Simulate the shortcut
          </button>
        </div>
      ) : null}
    </div>
  );
}
