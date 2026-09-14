import "./captions.css";
import { GripHorizontal, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { logInfo } from "@core/errors";
import { dictationStatus, getDictationSettings, resolveActiveModel, transcribeBlob, type EngineStatus } from "../engine";
import {
  AUDIO_CAPTURE_ERROR_EVENT,
  AUDIO_CAPTURE_SEGMENT_EVENT,
  CAPTIONS_SESSION,
  isCaptureSegment,
  lineOpacity,
  MAX_FONT,
  MIN_FONT,
  pushLine,
  type CaptionLine,
  type CaptionsSettings,
  type CaptureError,
  type CaptureSegment,
} from "./captions";
import { applyClickThrough, fitCaptionsWindow, hideCaptions, restartCaptions, startCaptionsDragging } from "./captionsControl";
import { useCaptionsRunning, useCaptionsSettings } from "./useCaptionsSettings";

/** Segments waiting for the recognizer beyond this are dropped: a late caption is no caption. */
const MAX_QUEUE = 3;

/** What the browser preview shows, one line every few seconds. */
const DEMO_LINES = [
  "So the plan for this quarter is to ship the captions overlay first.",
  "Every utterance is transcribed on this computer as soon as it ends.",
  "Nothing is recorded — each clip is deleted once its words are on screen.",
  "Drag the bar to move it; the gear sets the sources and the text size.",
  "Translation to English runs through Whisper when it is installed.",
  "Right, that's all for today - thanks, everyone.",
];

/**
 * Subscribes to a Tauri event *and* a DOM event of the same name, so the demo
 * feed (a `CustomEvent` in this window) and the real capture (Rust) arrive
 * through one door. The handler is read through a ref.
 */
function useCaptureEvent<T>(name: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onDom = (e: Event) => ref.current((e as CustomEvent<T>).detail);
    window.addEventListener(name, onDom);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) => listen<T>(name, (event) => ref.current(event.payload)))
        .then((off) => {
          if (disposed) off();
          else unlisten = off;
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      window.removeEventListener(name, onDom);
      unlisten?.();
    };
  }, [name]);
}

/** Reads the segment's WAV, transcribes it and deletes the file whatever happens. */
async function transcribeSegment(segment: CaptureSegment, translate: boolean): Promise<string> {
  if (!isTauri()) return segment.text ?? "";
  const { readFile, remove } = await import("@tauri-apps/plugin-fs");
  try {
    const bytes = await readFile(segment.path);
    const blob = new Blob([bytes], { type: "audio/wav" });
    return await transcribeBlob(blob, getDictationSettings().lang, false, translate, {
      ignoreSessionContext: true,
    });
  } finally {
    void remove(segment.path).catch(() => undefined);
  }
}

/**
 * The `captions` window: the last lines of what the system plays and/or what
 * the mic hears, transcribed on-device as each utterance closes, optionally
 * translated to English through whisper. Draggable by its bar; a gear for the
 * sources, translation, size and click-through; started and stopped from the
 * Captions page in dictate (and hidden from its own ×).
 */
export function CaptionsOverlay() {
  const [settings, update] = useCaptionsSettings();
  const running = useCaptionsRunning();
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [gear, setGear] = useState(false);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [, setTick] = useState(0);
  const queue = useRef<CaptureSegment[]>([]);
  const busy = useRef(false);
  const nextId = useRef(1);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const demo = !isTauri();
  const whisperReady = Boolean(status?.engine && status.models.length);
  const parakeetActive = resolveActiveModel(getDictationSettings().model, status)?.engine === "parakeet";
  const translateOn = settings.translate && whisperReady;

  useEffect(() => {
    void dictationStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // The fade is a function of time; repaint while there is something to fade.
  useEffect(() => {
    if (!lines.length) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [lines.length]);

  // Window chrome follows the settings: size, and whether the mouse sees us.
  useEffect(() => {
    void fitCaptionsWindow(settings, gear);
  }, [settings.fontSize, settings.lines, gear, settings]);
  useEffect(() => {
    void applyClickThrough(settings.clickThrough);
    if (settings.clickThrough) setGear(false);
  }, [settings.clickThrough]);

  // Browser preview: a demo feed stands in for the Rust capture.
  useEffect(() => {
    if (!demo) return;
    let i = 0;
    const id = window.setInterval(() => {
      const text = DEMO_LINES[i % DEMO_LINES.length];
      i += 1;
      const detail: CaptureSegment = {
        session: CAPTIONS_SESSION,
        source: i % 4 === 0 ? "mic" : "system",
        startMs: i * 2500,
        endMs: i * 2500 + 2200,
        path: "",
        text,
      };
      window.dispatchEvent(new CustomEvent(AUDIO_CAPTURE_SEGMENT_EVENT, { detail }));
    }, 2600);
    return () => window.clearInterval(id);
  }, [demo]);

  function show(text: string, source: CaptionLine["source"]) {
    const body = text.trim();
    if (!body) return;
    setLines((prev) =>
      pushLine(prev, { id: nextId.current++, text: body, at: Date.now(), source }, settingsRef.current.lines),
    );
  }

  /** One segment at a time; the queue never grows past MAX_QUEUE. */
  async function pump() {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const segment = queue.current.shift()!;
        try {
          const text = await transcribeSegment(segment, settingsRef.current.translate && whisperReady);
          show(text, segment.source);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logInfo("captions", `segment failed: ${message}`);
          show(message, "error");
        }
      }
    } finally {
      busy.current = false;
    }
  }

  useCaptureEvent<unknown>(AUDIO_CAPTURE_SEGMENT_EVENT, (payload) => {
    if (!isCaptureSegment(payload) || payload.session !== CAPTIONS_SESSION) return;
    queue.current.push(payload);
    while (queue.current.length > MAX_QUEUE) {
      const dropped = queue.current.shift()!;
      logInfo("captions", `segment dropped, recognizer behind (${dropped.endMs - dropped.startMs} ms)`);
      if (isTauri() && dropped.path) {
        void import("@tauri-apps/plugin-fs").then(({ remove }) => remove(dropped.path).catch(() => undefined));
      }
    }
    void pump();
  });

  useCaptureEvent<CaptureError>(AUDIO_CAPTURE_ERROR_EVENT, (payload) => {
    if (payload?.session !== CAPTIONS_SESSION) return;
    show(payload.message, "error");
  });

  function setSources(sources: CaptionsSettings["sources"]) {
    const next = update({ sources });
    void next;
    void restartCaptions({ ...settingsRef.current, sources }).catch((err: unknown) =>
      show(err instanceof Error ? err.message : String(err), "error"),
    );
  }

  const now = Date.now();
  const visible = lines.map((line, i) => ({
    line,
    opacity: lineOpacity(lines.length - 1 - i, now - line.at),
  }));
  const allFaded = visible.length > 0 && visible.every((v) => v.opacity === 0);
  const sourcesLabel =
    settings.sources.length === 2 ? "system + mic" : settings.sources[0] === "mic" ? "mic" : "system";
  const engineLabel = demo ? "demo" : parakeetActive ? "Parakeet" : whisperReady ? "Whisper" : "no model";

  return (
    <div className="cap" style={{ fontSize: settings.fontSize }}>
      {gear && !settings.clickThrough ? (
        <div className="cap-gear" role="dialog" aria-label="Captions settings">
          <div className="cap-gear-row">
            <span className="cap-gear-label">Listen to</span>
            <span className="cap-seg" role="radiogroup" aria-label="Sources">
              <button className={sourcesLabel === "system" ? "active" : undefined} onClick={() => setSources(["system"])}>
                System
              </button>
              <button className={sourcesLabel === "mic" ? "active" : undefined} onClick={() => setSources(["mic"])}>
                Mic
              </button>
              <button
                className={sourcesLabel === "system + mic" ? "active" : undefined}
                onClick={() => setSources(["system", "mic"])}
              >
                Both
              </button>
            </span>
          </div>
          <div className="cap-gear-row">
            <span>
              <span className="cap-gear-label">Translate to English</span>
              {!whisperReady && !demo ? (
                <span className="cap-gear-hint">
                  Needs Whisper{parakeetActive ? " — Parakeet is in use" : ""}. Install it in dictate → Models.
                </span>
              ) : null}
            </span>
            <span className="cap-seg" role="radiogroup" aria-label="Translate">
              <button className={!settings.translate ? "active" : undefined} onClick={() => update({ translate: false })}>
                Off
              </button>
              <button
                className={settings.translate ? "active" : undefined}
                disabled={!whisperReady && !demo}
                onClick={() => update({ translate: true })}
              >
                On
              </button>
            </span>
          </div>
          <div className="cap-gear-row">
            <span className="cap-gear-label">Text size</span>
            <span className="cap-step">
              <button
                aria-label="Smaller"
                disabled={settings.fontSize <= MIN_FONT}
                onClick={() => update({ fontSize: settings.fontSize - 2 })}
              >
                −
              </button>
              <span>{settings.fontSize}</span>
              <button
                aria-label="Larger"
                disabled={settings.fontSize >= MAX_FONT}
                onClick={() => update({ fontSize: settings.fontSize + 2 })}
              >
                +
              </button>
            </span>
          </div>
          <div className="cap-gear-row">
            <span className="cap-gear-label">Lines</span>
            <span className="cap-seg" role="radiogroup" aria-label="Lines">
              <button className={settings.lines === 2 ? "active" : undefined} onClick={() => update({ lines: 2 })}>
                2
              </button>
              <button className={settings.lines === 3 ? "active" : undefined} onClick={() => update({ lines: 3 })}>
                3
              </button>
            </span>
          </div>
          <div className="cap-gear-row wide">
            <span>
              <span className="cap-gear-label">Click-through</span>
              <span className="cap-gear-hint">
                The overlay ignores the mouse. Switch it back off in owntools → dictate → Captions.
              </span>
            </span>
            <button className="cap-btn" onClick={() => update({ clickThrough: true })}>
              Turn on
            </button>
          </div>
          <div className="cap-gear-row wide">
            <span className="cap-gear-hint">
              {demo
                ? "Browser preview: demo lines, nothing is captured."
                : `Transcribed on this computer by ${engineLabel}; each clip is deleted once its words are shown.`}
            </span>
            <button className="cap-btn danger" onClick={() => void hideCaptions()}>
              Hide captions
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="cap-bar"
        onMouseDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
          void startCaptionsDragging();
        }}
        title="Drag to move"
      >
        <GripHorizontal aria-hidden style={{ width: 12, height: 12, opacity: 0.6 }} />
        <span className={`cap-dot${running || demo ? "" : " off"}`} aria-hidden />
        <span>{running || demo ? "live" : "paused"}</span>
        <span className="cap-sep">·</span>
        <span>{sourcesLabel}</span>
        <span className="cap-sep">·</span>
        <span>{translateOn ? "→ English" : engineLabel}</span>
        <button aria-label="Captions settings" title="Settings" onClick={() => setGear((g) => !g)}>
          <Settings2 />
        </button>
        <button aria-label="Hide captions" title="Hide" onClick={() => void hideCaptions()}>
          <X />
        </button>
      </div>

      <div className={`cap-lines${!visible.length || allFaded ? " empty" : ""}`} aria-live="polite">
        {visible.length && !allFaded ? (
          visible.map(({ line, opacity }, i) => (
            <div
              key={line.id}
              className={`cap-line${line.source === "error" ? " error" : i < visible.length - 1 ? " older" : ""}`}
              style={{ opacity }}
            >
              {line.text}
            </div>
          ))
        ) : (
          <div className="cap-line muted">{running || demo ? "Listening…" : "Captions are paused"}</div>
        )}
      </div>
    </div>
  );
}
