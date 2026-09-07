import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { logInfo } from "@core/errors";
import { showMainWindow } from "@core/recorderWindow";
import {
  createDictationRecorder,
  dictate,
  dictationReady,
  dictationStatus,
  dictationTarget,
  getDictationSettings,
  openDictationMic,
  typeText,
  type EngineStatus,
} from "./engine";
import { requestInsertInMain, type InsertOutcome } from "./insert";

type PillState = "idle" | "listening" | "transcribing" | "setup" | "error";

/** Below this a take is a mis-press, not speech — whisper would hallucinate. */
const MIN_TAKE_MS = 350;

/**
 * Logical size of the `dictation` window (tauri.conf.json) and how far above
 * the bottom of the work area it floats.
 */
const PILL_WIDTH = 320;
const PILL_HEIGHT = 76;
const PILL_BOTTOM_GAP = 54;

type WindowApi = typeof import("@tauri-apps/api/window");

async function hideSelf(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

/**
 * The monitor the mouse is on: that is where the user is working, so that is
 * where the pill belongs. Falls back to the primary monitor.
 */
async function monitorUnderCursor(api: WindowApi) {
  const [cursor, monitors] = await Promise.all([api.cursorPosition(), api.availableMonitors()]);
  const hit = monitors.find(
    (m) =>
      cursor.x >= m.position.x &&
      cursor.x < m.position.x + m.size.width &&
      cursor.y >= m.position.y &&
      cursor.y < m.position.y + m.size.height,
  );
  return hit ?? (await api.primaryMonitor()) ?? (await api.currentMonitor());
}

/**
 * Bottom-centre of the monitor under the cursor, just above its taskbar.
 * Monitors report physical pixels while the pill's size is logical, so the size
 * is scaled by that monitor's factor and the result is applied as a physical
 * position. (A logical position would be converted back with the pill's
 * *current* monitor's scale factor — the wrong one the moment the cursor is on
 * a display with a different DPI.)
 */
async function positionSelf(): Promise<void> {
  if (!isTauri()) return;
  try {
    const api = await import("@tauri-apps/api/window");
    const win = api.getCurrentWindow();
    try {
      const monitor = await monitorUnderCursor(api);
      if (!monitor) throw new Error("no monitor");
      const scale = monitor.scaleFactor > 0 ? monitor.scaleFactor : 1;
      // Work area = the monitor minus taskbar/dock; older runtimes only know the full monitor.
      const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
      const x = area.position.x + (area.size.width - PILL_WIDTH * scale) / 2;
      const y = area.position.y + area.size.height - (PILL_HEIGHT + PILL_BOTTOM_GAP) * scale;
      await win.setPosition(new api.PhysicalPosition(Math.round(x), Math.round(y)));
    } catch {
      // The primary screen as the webview sees it — the pre-multi-monitor behaviour.
      const x = Math.round((screen.availWidth - PILL_WIDTH) / 2);
      const y = Math.max(0, screen.availHeight - PILL_HEIGHT - PILL_BOTTOM_GAP);
      await win.setPosition(new api.LogicalPosition(x, y));
    }
  } catch {
    /* positioning is cosmetic; the window still shows where it last was */
  }
}

/**
 * Escape is claimed as a *global* shortcut only while a take runs (this window
 * never has focus, so a DOM keydown could never reach it). Calls are queued so
 * an enable and the disable that follows it can never apply out of order.
 */
let escapeQueue: Promise<void> = Promise.resolve();
function setEscapeHotkey(enable: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  escapeQueue = escapeQueue
    .then(async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("dictation_cancel_hotkey", { enable });
    })
    .catch(() => undefined);
  return escapeQueue;
}

/**
 * Subscribes to a Tauri event for the component's lifetime. The handler is read
 * through a ref, so toggles never stack listeners and never see stale state;
 * the cleanup also covers StrictMode's mount → unmount → mount, where it can
 * run before `listen()` has resolved.
 */
function useTauriEvent<T = unknown>(name: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<T>(name, (event) => handlerRef.current(event.payload)))
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name]);
}

/**
 * Tiny always-on-top pill. The global hotkey (Ctrl+Shift+Space) toggles it:
 * first press = start listening, second press = stop → transcribe → type the
 * text into whatever app has focus. This window never takes focus itself, so
 * Escape reaches it as the `dictation-cancel` event from a global shortcut the
 * Rust side holds only while a take is running.
 */
export function DictationPill() {
  const [state, setState] = useState<PillState>("idle");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const meterFrame = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const starting = useRef(false);
  const stateRef = useRef<PillState>("idle");
  stateRef.current = state;

  useEffect(() => {
    void positionSelf();
    return () => {
      clearLater();
      void setEscapeHotkey(false);
    };
  }, []);

  useTauriEvent("dictation-toggle", () => {
    logInfo("dictation", `hotkey while ${stateRef.current}`);
    if (stateRef.current === "listening") {
      stopRecorder();
    } else if (stateRef.current === "idle" || stateRef.current === "error") {
      void startListening();
    }
    // "transcribing" and "setup" ignore the press on purpose.
  });

  useTauriEvent("dictation-cancel", () => {
    if (stateRef.current !== "listening") return;
    cancelled.current = true;
    stopRecorder();
  });

  /** Drops a pending `later` — a new take must not be hidden by an old message's timer. */
  function clearLater() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  /** Runs `fn` later, replacing any pending one so two hides never race. */
  function later(fn: () => void, ms: number) {
    clearLater();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      fn();
    }, ms);
  }

  function stopRecorder() {
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function stopMeter() {
    if (meterFrame.current !== null) cancelAnimationFrame(meterFrame.current);
    meterFrame.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setLevel(0);
  }

  /** A live level bar so a muted or far-away mic is obvious before you speak. */
  function startMeter(mic: MediaStream) {
    try {
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(mic).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel((prev) => Math.max(rms * 4, prev * 0.82));
        meterFrame.current = requestAnimationFrame(tick);
      };
      meterFrame.current = requestAnimationFrame(tick);
    } catch {
      /* metering is cosmetic */
    }
  }

  /**
   * No engine or model yet: hand over to the dictate tool instead of opening a
   * mic nothing could transcribe. The message shows at once; the main window
   * follows.
   */
  async function openSetup() {
    setState("setup");
    setMessage("Whisper isn't set up yet — opening dictate…");
    later(() => {
      setState("idle");
      setMessage("");
      void hideSelf();
    }, 2400);
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("open-tool", { tool: "dictate" });
      await showMainWindow();
    } catch {
      /* the message alone still says where to go */
    }
  }

  async function startListening() {
    if (starting.current) return;
    starting.current = true;
    clearLater();
    setMessage("");
    cancelled.current = false;
    try {
      await positionSelf();
      let status: EngineStatus | null = null;
      try {
        status = await dictationStatus();
      } catch {
        status = null;
      }
      if (!dictationReady(status)) {
        await openSetup();
        return;
      }
      try {
        const mic = await openDictationMic();
        stream.current = mic;
        startMeter(mic);
        const rec = createDictationRecorder(mic);
        recorder.current = rec;
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.onstop = () => {
          // Every way out of a take lets go of Escape first.
          void setEscapeHotkey(false);
          mic.getTracks().forEach((t) => t.stop());
          stream.current = null;
          stopMeter();
          const took = Date.now() - startedAt.current;
          const tooShort = took < MIN_TAKE_MS;
          if (cancelled.current || tooShort) {
            logInfo("dictation", cancelled.current ? "take cancelled" : `take dropped (${took} ms)`);
            setState("idle");
            void hideSelf();
            return;
          }
          logInfo("dictation", `take ended after ${took} ms`);
          void finish(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), took);
        };
        startedAt.current = Date.now();
        rec.start(200);
        setState("listening");
        logInfo("dictation", "listening");
        await setEscapeHotkey(true);
      } catch (err) {
        stopMeter();
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        void setEscapeHotkey(false);
        logInfo("dictation", `microphone failed: ${err instanceof Error ? err.message : String(err)}`);
        setState("error");
        setMessage("Microphone unavailable — check the permission in Windows settings.");
        later(() => {
          setState("idle");
          void hideSelf();
        }, 2600);
      }
    } finally {
      starting.current = false;
    }
  }

  /**
   * Our own main window in front: hand the words to it (the focused field,
   * the board, or the clipboard) and report what it did. Any other window:
   * type them. Typing is also the fallback when the main window stays silent.
   */
  async function deliver(text: string): Promise<InsertOutcome | "typed"> {
    if ((await dictationTarget()) === "main") {
      const outcome = await requestInsertInMain(text);
      if (outcome) return outcome;
      logInfo("dictation", "main window did not answer; typing instead");
    }
    await typeText(text.endsWith(" ") ? text : `${text} `);
    return "typed";
  }

  function showThenHide(text: string, ms: number) {
    setState("idle");
    setMessage(text);
    later(() => {
      setMessage("");
      void hideSelf();
    }, ms);
  }

  async function finish(blob: Blob, durationMs: number) {
    setState("transcribing");
    try {
      const text = await dictate(blob, { durationMs });
      if (!text) {
        logInfo("dictation", "nothing was heard");
        showThenHide("Nothing was heard", 1400);
        return;
      }
      const outcome = await deliver(text);
      logInfo("dictation", `${text.length} chars: ${outcome}`);
      if (outcome === "clipboard") {
        showThenHide("No text field here — copied to the clipboard", 2200);
      } else if (outcome === "none") {
        showThenHide("No text field here to type into", 1800);
      } else {
        setState("idle");
        await hideSelf();
      }
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Transcription failed");
      later(() => {
        setState("idle");
        void hideSelf();
      }, 2600);
    } finally {
      // The recorder's onstop already released Escape; this covers a take that
      // got here by any other route.
      void setEscapeHotkey(false);
    }
  }

  const settings = getDictationSettings();
  const langBadge =
    settings.lang === "auto" ? "auto" : settings.lang === "pl" ? "polski" : "english";
  // Messages may need two lines; the listening row must stay on one.
  const wrap = state !== "listening";

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderRadius: 999,
          background: "rgba(17,17,17,0.92)",
          color: "#fffdfb",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.3,
          boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
          maxWidth: 310,
          overflow: "hidden",
          whiteSpace: wrap ? "normal" : "nowrap",
          textAlign: wrap ? "center" : "left",
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            flexShrink: 0,
            borderRadius: 999,
            background:
              state === "listening"
                ? "#ff453a"
                : state === "transcribing" || state === "setup"
                  ? "#febc2e"
                  : "#666",
            animation: state === "listening" ? "pill-pulse 1.1s ease-in-out infinite" : undefined,
          }}
        />
        {state === "listening" ? (
          <>
            <span>Listening</span>
            <span
              style={{
                width: 54,
                height: 4,
                borderRadius: 999,
                background: "rgba(255,255,255,0.18)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.min(100, Math.round(level * 100))}%`,
                  background: level > 0.06 ? "#32d74b" : "#febc2e",
                  transition: "width 90ms linear",
                }}
              />
            </span>
            <span style={{ opacity: 0.55, fontWeight: 500 }}>{langBadge} · esc cancels</span>
          </>
        ) : state === "transcribing" ? (
          "Transcribing…"
        ) : state === "setup" ? (
          message
        ) : state === "error" ? (
          message || "Something went wrong"
        ) : (
          message || "Ready"
        )}
      </div>
      <style>{`@keyframes pill-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  );
}
