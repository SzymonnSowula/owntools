import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { DICTATION_TAKE_EVENT, emitToolEvent, type DictationTake } from "@core/events";
import { microphoneHelp } from "@core/hotkeys";
import { logInfo } from "@core/errors";
import { showMainWindow } from "@core/recorderWindow";
import {
  createDictationRecorder,
  createDictationStream,
  dictateDetailed,
  dictateStreamed,
  dictationReady,
  dictationStatus,
  dictationTargetInfo,
  getDictationSettings,
  openDictationMic,
  pressEnter,
  sessionAudioBlob,
  streamingAvailable,
  StreamingFailed,
  warmUpDictation,
  typeText,
  type DictateOutcome,
  type DictationStream,
  type EngineStatus,
  type ForegroundTarget,
} from "./engine";
import { requestInsertInMain, type InsertOutcome } from "./insert";

type PillState = "idle" | "listening" | "transcribing" | "setup" | "error";

/** Below this a take is a mis-press, not speech — whisper would hallucinate. */
const MIN_TAKE_MS = 350;

/**
 * Logical size of the `dictation` window (tauri.conf.json) and how far above
 * the bottom of the work area it floats. While a streamed take shows its live
 * text the pill grows to the second pair, bottom edge staying put.
 */
const PILL_WIDTH = 320;
const PILL_HEIGHT = 76;
const PILL_WIDE = 440;
const PILL_TALL = 118;
const PILL_BOTTOM_GAP = 54;

/**
 * The microphone is tapped at the recognizer's rate so a closed utterance is
 * ready to send as it is; Chromium resamples the stream into the context.
 */
const TAP_RATE = 16000;
/** 64 ms of audio per callback at 16 kHz: fine-grained enough for a 600 ms hangover. */
const TAP_BUFFER = 1024;

type WindowApi = typeof import("@tauri-apps/api/window");

const NO_TARGET: ForegroundTarget = { main: false, app: null, title: null };

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
async function positionSelf(width = PILL_WIDTH, height = PILL_HEIGHT): Promise<void> {
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
      const x = area.position.x + (area.size.width - width * scale) / 2;
      const y = area.position.y + area.size.height - (height + PILL_BOTTOM_GAP) * scale;
      await win.setPosition(new api.PhysicalPosition(Math.round(x), Math.round(y)));
    } catch {
      // The primary screen as the webview sees it — the pre-multi-monitor behaviour.
      const x = Math.round((screen.availWidth - width) / 2);
      const y = Math.max(0, screen.availHeight - height - PILL_BOTTOM_GAP);
      await win.setPosition(new api.LogicalPosition(x, y));
    }
  } catch {
    /* positioning is cosmetic; the window still shows where it last was */
  }
}

/** Grows the window for the live text, or shrinks it back; the bottom edge stays. */
async function resizeSelf(expanded: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const api = await import("@tauri-apps/api/window");
    const width = expanded ? PILL_WIDE : PILL_WIDTH;
    const height = expanded ? PILL_TALL : PILL_HEIGHT;
    await api.getCurrentWindow().setSize(new api.LogicalSize(width, height));
    await positionSelf(width, height);
  } catch {
    /* cosmetic */
  }
}

/**
 * Who owns the window the pill is drawn in. On its own (the bar switched off)
 * the pill moves, sizes and hides its window itself; inside the bar
 * (apps/desktop/src/bar) the bar does, and the pill only says when it has
 * something to show.
 */
export interface PillHost {
  /** Mount: get ready for the first take. */
  prepare(): void;
  /** A take, or a message about one, is about to show. */
  present(): Promise<void>;
  /** The live text needs the second row, or no longer does. */
  resize(expanded: boolean): Promise<void>;
  /** What the pill shows has changed and may have changed size (a message, the live text). */
  changed(): void;
  /** Nothing left to show. */
  dismiss(): Promise<void>;
  /**
   * Before text is typed after a click on the pill: give the foreground back
   * to the app the words are for, in case the click took it.
   */
  focusTarget(): Promise<void>;
}

/** The pill in a window of its own, placed at the bottom of the monitor under the pointer. */
export const standalonePillHost: PillHost = {
  prepare: () => void positionSelf(),
  // The window may still be the size of something else (the bar was switched
  // off a moment ago), so present sets the size as well as the place.
  present: () => resizeSelf(false),
  resize: (expanded) => resizeSelf(expanded),
  changed: () => {},
  dismiss: () => hideSelf(),
  focusTarget: async () => {},
};

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

/** The last ~140 characters, so the newest words are always on screen. */
function tailOf(text: string, max = 140): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const space = cut.indexOf(" ");
  return `…${space > 0 && space < 24 ? cut.slice(space + 1) : cut}`;
}

/**
 * Announces a delivered take to the rest of the app: a DOM event in this
 * window and the Tauri event to `main`, where automations listen.
 */
async function announceTake(payload: DictationTake): Promise<void> {
  emitToolEvent(DICTATION_TAKE_EVENT, payload);
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", DICTATION_TAKE_EVENT, payload);
  } catch {
    /* the main window may be gone; the take was still delivered */
  }
}

/**
 * Tiny always-on-top pill. The global hotkey (Ctrl+Shift+Space) toggles it:
 * first press = start listening, second press = stop → transcribe → type the
 * text into whatever app has focus. This window never takes focus itself, so
 * Escape reaches it as the `dictation-cancel` event from a global shortcut the
 * Rust side holds only while a take is running.
 *
 * Two ways to listen. With Parakeet's resident recognizer the microphone is
 * tapped and cut into utterances that are decoded *while you speak*; the pill
 * shows the words as they land and the stop leaves only the tail to wait for.
 * Otherwise (whisper, an old engine, the setting off) the take is recorded
 * whole and decoded after the stop, as before.
 *
 * `embedded`: drawn inside the bar, which sizes the window around it — no
 * full-window centring, no shadow that needs a margin, and a Done button,
 * because a pill sitting in a bar invites a click.
 */
export function DictationPill({
  host = standalonePillHost,
  embedded = false,
}: {
  host?: PillHost;
  embedded?: boolean;
} = {}) {
  const [state, setState] = useState<PillState>("idle");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [pending, setPending] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const tap = useRef<ScriptProcessorNode | null>(null);
  const live = useRef<DictationStream | null>(null);
  const meterFrame = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const starting = useRef(false);
  const target = useRef<ForegroundTarget>(NO_TARGET);
  const stateRef = useRef<PillState>("idle");
  stateRef.current = state;
  // Read at call time: the bar can be switched on or off between two takes.
  const hostRef = useRef(host);
  hostRef.current = host;
  // Every "hide" below goes through the host, which hides the window or hands
  // it back to the bar.
  const hideSelf = () => hostRef.current.dismiss();

  useEffect(() => {
    hostRef.current.prepare();
    return () => {
      clearLater();
      void setEscapeHotkey(false);
    };
  }, []);

  // The live text needs the second row; give it back when the take is over.
  const expanded = partial !== "" && (state === "listening" || state === "transcribing");
  useEffect(() => {
    void hostRef.current.resize(expanded);
  }, [expanded]);

  useEffect(() => {
    hostRef.current.changed();
  }, [state, message, partial, pending]);

  useTauriEvent("dictation-toggle", () => {
    logInfo("dictation", `hotkey while ${stateRef.current}`);
    if (stateRef.current === "listening") {
      stopListening();
    } else if (stateRef.current === "idle" || stateRef.current === "error") {
      void startListening();
    }
    // "transcribing" and "setup" ignore the press on purpose.
  });

  useTauriEvent("dictation-cancel", () => {
    if (stateRef.current !== "listening") return;
    cancelled.current = true;
    stopListening();
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

  /** Second press or Escape: ends whichever kind of take is running. */
  function stopListening() {
    if (live.current) {
      endStreamedTake();
      return;
    }
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function stopMeter() {
    if (meterFrame.current !== null) cancelAnimationFrame(meterFrame.current);
    meterFrame.current = null;
    tap.current?.disconnect();
    tap.current = null;
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
   * Streaming: the mic goes through a 16 kHz context, an 80 Hz high-pass (the
   * same one the whole-take path applies offline) and a ScriptProcessor tap
   * that feeds the segmenter. The tap doubles as the level meter.
   */
  function startTap(mic: MediaStream, ctx: AudioContext, take: DictationStream) {
    const source = ctx.createMediaStreamSource(mic);
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    highpass.Q.value = 0.707;
    const node = ctx.createScriptProcessor(TAP_BUFFER, 1, 1);
    node.onaudioprocess = (e) => {
      take.session.push(e.inputBuffer.getChannelData(0));
      const rms = take.session.level();
      setLevel((prev) => Math.max(rms * 4, prev * 0.82));
    };
    source.connect(highpass);
    highpass.connect(node);
    // A ScriptProcessor only runs when it reaches the destination; its output
    // buffer stays silent, so nothing is played back.
    node.connect(ctx.destination);
    tap.current = node;
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

  function releaseMic() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function startListening() {
    if (starting.current) return;
    starting.current = true;
    clearLater();
    setMessage("");
    setPartial("");
    setPending(0);
    cancelled.current = false;
    try {
      await hostRef.current.present();
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
      // The app in front *now* is the one the words are for; read it before
      // anything else so a window that changes mid-take changes nothing.
      target.current = await dictationTargetInfo();
      try {
        const mic = await openDictationMic();
        stream.current = mic;
        startedAt.current = Date.now();

        let streamed: DictationStream | null = null;
        if (streamingAvailable(status)) {
          let ctx: AudioContext | null = null;
          try {
            ctx = new AudioContext({ sampleRate: TAP_RATE });
          } catch {
            // A context that will not open at 16 kHz still works at its own
            // rate: the segments are resampled before they go out.
            try {
              ctx = new AudioContext();
            } catch {
              ctx = null;
            }
          }
          if (ctx) {
            streamed = await createDictationStream(
              ctx.sampleRate,
              (p) => {
                setPartial(p.text);
                setPending(p.pending);
              },
              status,
            );
            if (streamed) {
              audioCtx.current = ctx;
              live.current = streamed;
              startTap(mic, ctx, streamed);
            } else {
              void ctx.close().catch(() => undefined);
            }
          }
        }

        if (!streamed) {
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
            releaseMic();
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
            void finishWhole(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), took);
          };
          rec.start(200);
        }

        setState("listening");
        logInfo(
          "dictation",
          `listening (${streamed ? "streaming" : "whole take"}${target.current.app ? ` → ${target.current.app}` : ""})`,
        );
        // Load the speech model *while* the take is being spoken. It is
        // the single biggest thing between pressing the hotkey and
        // reading the words: cold, the model load alone is ~4.5 s.
        void warmUpDictation();
        await setEscapeHotkey(true);
      } catch (err) {
        stopMeter();
        releaseMic();
        live.current?.session.cancel();
        live.current = null;
        void setEscapeHotkey(false);
        logInfo("dictation", `microphone failed: ${err instanceof Error ? err.message : String(err)}`);
        setState("error");
        setMessage(microphoneHelp());
        later(() => {
          setState("idle");
          void hideSelf();
        }, 2600);
      }
    } finally {
      starting.current = false;
    }
  }

  /** The streamed take's second press: stop the tap, decode the tail, deliver. */
  function endStreamedTake() {
    const take = live.current;
    live.current = null;
    void setEscapeHotkey(false);
    releaseMic();
    stopMeter();
    if (!take) return;
    const took = Date.now() - startedAt.current;
    if (cancelled.current || took < MIN_TAKE_MS) {
      take.session.cancel();
      logInfo("dictation", cancelled.current ? "take cancelled" : `take dropped (${took} ms)`);
      setPartial("");
      setState("idle");
      void hideSelf();
      return;
    }
    logInfo("dictation", `take ended after ${took} ms (streamed)`);
    void finishStreamed(take, took);
  }

  /**
   * Our own main window in front: hand the words to it (the focused field,
   * the board, or the clipboard) and report what it did. Any other window:
   * type them. Typing is also the fallback when the main window stays silent.
   */
  async function deliver(text: string): Promise<InsertOutcome | "typed"> {
    if (target.current.main) {
      const outcome = await requestInsertInMain(text);
      if (outcome) return outcome;
      logInfo("dictation", "main window did not answer; typing instead");
    }
    // A take that ends in a line break ("new line") wants no space after it.
    await typeText(/\s$/.test(text) ? text : `${text} `);
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

  async function finishWhole(blob: Blob, durationMs: number) {
    setState("transcribing");
    try {
      const outcome = await dictateDetailed(blob, { durationMs, target: target.current });
      await settle(outcome, durationMs);
    } catch (err) {
      fail(err);
    } finally {
      // The recorder's onstop already released Escape; this covers a take that
      // got here by any other route.
      void setEscapeHotkey(false);
    }
  }

  async function finishStreamed(take: DictationStream, durationMs: number) {
    setState("transcribing");
    try {
      let outcome: DictateOutcome;
      try {
        outcome = await dictateStreamed(take, { durationMs, target: target.current });
      } catch (err) {
        if (!(err instanceof StreamingFailed)) throw err;
        // A segment could not be decoded (the recognizer went away mid-take):
        // the session kept every sample, so decode the take whole instead.
        logInfo("dictation", `streaming failed (${err.message}); decoding the whole take`);
        setPartial("");
        outcome = await dictateDetailed(sessionAudioBlob(take.session), { durationMs, target: target.current });
      }
      await settle(outcome, durationMs);
    } catch (err) {
      fail(err);
    } finally {
      void setEscapeHotkey(false);
    }
  }

  function fail(err: unknown) {
    setPartial("");
    setState("error");
    setMessage(err instanceof Error ? err.message : "Transcription failed");
    later(() => {
      setState("idle");
      void hideSelf();
    }, 2600);
  }

  /** Deliver the finished take, press Enter if asked, tell the app, show the outcome. */
  async function settle(outcome: DictateOutcome, durationMs: number) {
    setPartial("");
    if (!outcome.text) {
      if (outcome.undo) {
        logInfo("dictation", "undo asked for; not available");
        showThenHide("Undo isn't available yet — Ctrl+Z in the app does it", 2200);
      } else {
        logInfo("dictation", "nothing was heard");
        showThenHide("Nothing was heard", 1400);
      }
      return;
    }
    const delivered = await deliver(outcome.text);
    logInfo(
      "dictation",
      `${outcome.text.length} chars: ${delivered}${outcome.commands.length ? ` · commands ${outcome.commands.join(",")}` : ""}${
        outcome.profile ? ` · profile ${outcome.profile.appPattern}` : ""
      }${outcome.formattingSkipped ? ` · formatting skipped: ${outcome.formattingSkipped}` : ""}`,
    );
    let sent = false;
    if (outcome.send && delivered === "typed") {
      try {
        await pressEnter();
        sent = true;
      } catch (err) {
        logInfo("dictation", `Enter not pressed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (delivered !== "none") {
      void announceTake({
        text: outcome.text,
        ms: durationMs,
        app: target.current.app,
        target: delivered === "typed" ? "app" : delivered,
        engine: outcome.engine,
      });
    }
    if (outcome.undo) {
      showThenHide("Undo isn't available yet — Ctrl+Z in the app does it", 2200);
    } else if (delivered === "clipboard") {
      showThenHide("No text field here — copied to the clipboard", 2200);
    } else if (delivered === "none") {
      showThenHide("No text field here to type into", 1800);
    } else if (sent) {
      showThenHide("Sent", 900);
    } else {
      setState("idle");
      await hideSelf();
    }
  }

  const settings = getDictationSettings();
  const langBadge =
    settings.lang === "auto" ? "auto" : settings.lang === "pl" ? "polski" : "english";
  // Messages may need two lines; the listening row must stay on one.
  const wrap = state !== "listening";
  const showPartial = expanded;

  return (
    <div
      style={
        embedded
          ? { display: "flex", justifyContent: "center", background: "transparent" }
          : {
              height: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
            }
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: showPartial ? "10px 18px 11px" : embedded && state === "listening" ? "5px 5px 5px 16px" : "10px 18px",
          borderRadius: showPartial ? 18 : 999,
          background: embedded ? "rgba(22,22,24,0.96)" : "rgba(17,17,17,0.92)",
          color: "#fffdfb",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.3,
          // Inside the bar the window is cut to the pill, so a shadow would be
          // clipped; a hairline keeps it apart from a dark background instead.
          boxShadow: embedded ? "none" : "0 12px 32px rgba(0,0,0,0.35)",
          border: embedded ? "1px solid rgba(255,255,255,0.13)" : undefined,
          maxWidth: showPartial ? PILL_WIDE - 10 : embedded ? 460 : PILL_WIDTH - 10,
          width: showPartial ? PILL_WIDE - 10 : undefined,
          overflow: "hidden",
          whiteSpace: wrap ? "normal" : "nowrap",
          textAlign: wrap ? "center" : "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
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
              <span style={{ opacity: 0.55, fontWeight: 500 }}>
                {langBadge}
                {live.current ? " · live" : ""} · esc cancels
              </span>
              {embedded ? (
                <button
                  type="button"
                  className="bar-pill-done"
                  onClick={() => {
                    // The click may have brought this window to the front:
                    // the words have to land in the app they are for.
                    void hostRef.current.focusTarget().then(() => {
                      if (stateRef.current === "listening") stopListening();
                    });
                  }}
                >
                  Done
                </button>
              ) : null}
            </>
          ) : state === "transcribing" ? (
            <span style={{ flex: 1, textAlign: showPartial ? "left" : "center" }}>
              {showPartial ? "Finishing…" : "Transcribing…"}
            </span>
          ) : state === "setup" ? (
            <span style={{ flex: 1 }}>{message}</span>
          ) : state === "error" ? (
            <span style={{ flex: 1 }}>{message || "Something went wrong"}</span>
          ) : (
            <span style={{ flex: 1 }}>{message || "Ready"}</span>
          )}
        </div>
        {showPartial ? (
          <div
            data-partial
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              lineHeight: 1.35,
              color: "rgba(255,253,251,0.88)",
              whiteSpace: "normal",
              textAlign: "left",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              maxHeight: 34,
            }}
          >
            {tailOf(partial)}
            {pending > 0 || state === "transcribing" ? <span style={{ opacity: 0.5 }}> …</span> : null}
          </div>
        ) : null}
      </div>
      <style>{`@keyframes pill-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  );
}
