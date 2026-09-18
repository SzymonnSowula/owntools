/**
 * The `dictation` window's page: the bar, with the dictation pill inside it.
 *
 * What keeps the bar out of the way, in one place:
 * - It rests as a capsule and opens only when the pointer stays on it (a pass
 *   on the way to the taskbar opens nothing) or on a click, and folds back
 *   when the pointer has left.
 * - The window is cut to what it shows, so no invisible margin swallows
 *   clicks meant for the app behind it.
 * - It steps aside while a full-screen app is in front of its monitor, while
 *   the recorder or a screenshot is up, and while the owntools window itself
 *   is in front and covering it (bar.rs watches; nothing about the window in
 *   front is kept beyond its size).
 * - It never takes the foreground: the window is non-activating, and if a
 *   click takes it anyway the app that had it gets it back before a word is
 *   typed.
 * - It stays out of screen recordings, screenshots and screen sharing, unless
 *   "Record owntools itself" is on.
 * - It costs no web view of its own, and draws nothing while nothing changes.
 * - It can be dragged anywhere, hidden from its own menu or the tray, and
 *   switched off in Settings → General; then the pill works as it always did.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BAR_HELLO_EVENT,
  BAR_STATE_EVENT,
  focusTickPhase,
  getBarSettings,
  IDLE_BAR_STATE,
  meetTickPhase,
  setBarSettings,
  subscribeBarSettings,
  type BarCommand,
  type BarState,
} from "@core/bar";
import { isTauri, isWindows } from "@core/env";
import { logInfo } from "@core/errors";
import { useIsPro } from "@licensing/useLicense";
import { recordsItself } from "@core/recorderWindow";
import { DictationPill, standalonePillHost, type PillHost } from "@feature-dictation/DictationPill";
import {
  BarRow,
  Capsule,
  FocusPanel,
  MeetPanel,
  MorePanel,
  Notice,
  Tip,
  type BarPanel,
  type DragHandlers,
} from "./BarView";
import { anchorFrom, monitorAt, pickMonitor, placeWindow, workAreaOf, type Box } from "./geometry";
import * as native from "./native";

/** Why bar.rs says the bar should step aside. */
type Obscured = "fullscreen" | "main" | "recorder" | "capture" | null;

/** The pointer has to rest this long on the capsule before it opens. */
const HOVER_OPEN_MS = 260;
/** Folds back this long after the pointer left. */
const HOVER_CLOSE_MS = 700;
/** A widget waits a little longer: moving towards it can clip the edge. */
const PANEL_CLOSE_MS = 1400;
const TIP_MS = 25_000;
const NOTICE_MS = 3_200;
/** A download that has not reported for this long is no longer shown. */
const DOWNLOAD_STALE_MS = 4_000;
/** Download ids of the speech engines (feature-dictation/engine.ts). */
const SPEECH_DOWNLOAD = /^(engine|parakeet-runtime|model:)/;

function sameBox(a: Box | null, b: Box | null): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * `Date.now()`, re-rendered just after every whole second counted from
 * `phase` (the moment the running clock changes, `focusTickPhase` /
 * `meetTickPhase`), or not at all when `phase` is null. A plain one-second
 * interval drifts against the clock it drives and now and then skips a second
 * or shows one twice.
 */
function useNow(phase: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase === null) return;
    let timer: number | undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const into = (((t - phase) % 1_000) + 1_000) % 1_000;
      timer = window.setTimeout(tick, 1_000 - into + 15);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [phase]);
  return now;
}

export function BarWindow() {
  const pro = useIsPro();
  const settings = useSyncExternalStore(subscribeBarSettings, getBarSettings, getBarSettings);
  const [notice, setNotice] = useState<string | null>(null);
  // "Hide the bar" shows a notice first, and the notice needs the bar's layout.
  const [hiding, setHiding] = useState(false);
  const mode: "bar" | "pill" = settings.enabled || hiding ? "bar" : "pill";
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const [pillActive, setPillActive] = useState(false);
  const pillActiveRef = useRef(pillActive);
  pillActiveRef.current = pillActive;
  // `place` is defined further down, with the window code; the pill's host reaches it here.
  const placeRef = useRef<() => Promise<void>>(async () => {});
  const pillHost = useMemo<PillHost>(
    () => ({
      prepare: () => {
        if (modeRef.current === "pill") standalonePillHost.prepare();
      },
      present: async () => {
        if (modeRef.current === "pill") return standalonePillHost.present();
        setPillActive(true);
      },
      resize: async (expanded) => {
        if (modeRef.current === "pill") await standalonePillHost.resize(expanded);
      },
      changed: () => {
        if (modeRef.current === "bar") void placeRef.current();
      },
      dismiss: async () => {
        if (modeRef.current === "pill") return standalonePillHost.dismiss();
        setPillActive(false);
      },
      focusTarget: () => native.restoreForeground(),
    }),
    [],
  );

  const [state, setState] = useState<BarState>(IDLE_BAR_STATE);
  const [obscured, setObscured] = useState<Obscured>(null);
  // Nothing shows before bar.rs has said whether something is in the way: at
  // start-up the owntools window is often in front and covering the spot, and
  // the bar would flash for a moment before stepping aside.
  const [watched, setWatched] = useState(() => !isTauri());
  const [hello, setHello] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [download, setDownload] = useState<number | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [panel, setPanel] = useState<BarPanel | null>(null);
  const [openDown, setOpenDown] = useState(false);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  const tipWanted = hello || !settings.introduced;
  // The onboarding's hello may show the bar over the owntools window, which is
  // where the person is looking at that moment; a full-screen app still wins.
  const allowed = watched && (obscured === null || (hello && obscured === "main"));
  const shown = mode === "bar" && (pillActive || notice !== null || (!grabbing && allowed));
  const barVisible = shown && !pillActive && notice === null;
  const showTip = barVisible && tipWanted;
  const expanded = barVisible && (hoverOpen || panel !== null || showTip);

  // One clock drives every tick; with a meeting and a session both running,
  // the meeting's (the capsule shows it) sets the beat.
  const tickPhase = meetTickPhase(state.meet) ?? focusTickPhase(state.focus);
  const now = useNow(barVisible ? tickPhase : null);

  /* ---------------- what the rest of the app says ---------------- */

  // The watcher reports once as soon as it starts, so it is started only after
  // the listener for that report is in place (the effect below this one).
  const obscuredListening = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    // Out of every capture, unless the person records owntools on purpose.
    let applied: boolean | null = null;
    const apply = () => {
      const exclude = !recordsItself();
      if (exclude === applied) return;
      applied = exclude;
      void native.setCaptureExclusion(exclude);
    };
    apply();
    window.addEventListener("storage", apply);
    return () => window.removeEventListener("storage", apply);
  }, []);

  useEffect(() => {
    // If the watcher never reports (it could not start), show the bar anyway.
    const fallback = window.setTimeout(() => setWatched(true), 2_000);
    const obscuredListener = native.listenTauriReady<Obscured>("bar-obscured", (reason) => {
      setObscured(reason === "fullscreen" || reason === "main" || reason === "recorder" || reason === "capture" ? reason : null);
      setWatched(true);
    });
    obscuredListening.current = obscuredListener.ready;
    const offs = [
      () => window.clearTimeout(fallback),
      obscuredListener.off,
      native.listenTauri(BAR_HELLO_EVENT, () => {
        setHello(true);
        if (!getBarSettings().enabled) setBarSettings({ enabled: true });
      }),
      native.listenTauri("bar-toggle", () => {
        const enabled = !getBarSettings().enabled;
        setBarSettings({ enabled });
        logInfo("bar", enabled ? "shown from the tray" : "hidden from the tray");
      }),
    ];
    let staleTimer: number | undefined;
    offs.push(
      native.listenTauri<{ id: string; loaded: number; total: number | null }>("download-progress", (p) => {
        if (!p || !SPEECH_DOWNLOAD.test(p.id) || !p.total) return;
        setDownload(Math.min(99, Math.floor((p.loaded / p.total) * 100)));
        window.clearTimeout(staleTimer);
        staleTimer = window.setTimeout(() => setDownload(null), DOWNLOAD_STALE_MS);
      }),
    );
    return () => {
      offs.forEach((off) => off());
      window.clearTimeout(staleTimer);
    };
  }, []);

  useEffect(() => {
    const enabled = settings.enabled;
    void obscuredListening.current.then(() => native.syncNative(enabled));
  }, [settings.enabled]);

  useEffect(() => {
    // Listen first, then ask: an answer sent before the listener exists is lost.
    if (!isTauri()) return;
    let off: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<BarState>(BAR_STATE_EVENT, (e) => {
        if (e.payload?.focus && e.payload?.meet) setState(e.payload);
      });
      if (disposed) {
        un();
        return;
      }
      off = un;
      await native.requestState();
    })().catch(() => undefined);
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  /* ---------------- the window: size, place, show ---------------- */

  const stackRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const lastBox = useRef<Box | null>(null);
  const dragging = useRef(false);
  const monitorCache = useRef<{ at: number; value: Awaited<ReturnType<typeof native.monitors>> } | null>(null);

  const getMonitors = useCallback(async (fresh = false) => {
    const cached = monitorCache.current;
    if (!fresh && cached && Date.now() - cached.at < 5_000) return cached.value;
    const value = await native.monitors();
    monitorCache.current = { at: Date.now(), value };
    return value;
  }, []);

  // What the last placement was worked out from. A clock ticking every second
  // re-renders without changing a pixel of the layout; then nothing is asked
  // of Rust. Anything that moves the ground (a drag, a monitor or scale
  // change) clears `lastBox` and forces the full pass.
  const lastLayout = useRef("");

  const placeOnce = useCallback(async () => {
    if (modeRef.current !== "bar" || dragging.current) return;
    const stack = stackRef.current;
    const row = rowRef.current;
    if (!stack || !row) return;
    const size = stack.getBoundingClientRect();
    const rowHeight = row.getBoundingClientRect().height;
    if (size.width < 1 || size.height < 1) return;
    const anchor = getBarSettings().anchor;
    const layout = `${size.width}x${size.height}/${rowHeight}/${anchor ? `${anchor.monitor}:${anchor.x}:${anchor.gap}` : "-"}`;
    if (lastBox.current && layout === lastLayout.current) return;
    const { all, primary } = await getMonitors();
    const monitor = pickMonitor(all, primary, anchor?.monitor ?? null);
    if (!monitor) return;
    const placement = placeWindow(workAreaOf(monitor), monitor.scaleFactor, anchor, size, rowHeight);
    setOpenDown(placement.openDown);
    const box = { x: placement.x, y: placement.y, width: placement.width, height: placement.height };
    if (dragging.current) return;
    lastLayout.current = layout;
    if (sameBox(box, lastBox.current)) return;
    lastBox.current = box;
    await native.setBounds(box);
  }, [getMonitors]);

  // One placement at a time; a request that arrives meanwhile runs once more
  // after it, and every caller waits for the last pass.
  const inflight = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const place = useCallback((): Promise<void> => {
    dirty.current = true;
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        while (dirty.current) {
          dirty.current = false;
          await placeOnce();
        }
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [placeOnce]);
  placeRef.current = place;

  // After every render: what the window shows may have changed size.
  useLayoutEffect(() => {
    if (mode === "bar") void place();
  });

  // ...and between them: the pill renders on its own (a message, the live
  // text), without this component rendering at all.
  useEffect(() => {
    const stack = stackRef.current;
    if (mode !== "bar" || !stack || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => void place());
    observer.observe(stack);
    return () => observer.disconnect();
  }, [mode, place]);

  useEffect(() => {
    // Resized by someone else: Windows fits a window to a new display scale
    // (a change in Settings, a drag onto a monitor with another one) without
    // moving it, and then no "moved" event says so.
    if (mode !== "bar") return;
    const onResize = () => {
      const box = lastBox.current;
      if (!box || dragging.current) return;
      const scale = window.devicePixelRatio || 1;
      const width = Math.round(window.innerWidth * scale);
      const height = Math.round(window.innerHeight * scale);
      if (Math.abs(width - box.width) <= 2 && Math.abs(height - box.height) <= 2) return;
      lastBox.current = null;
      monitorCache.current = null;
      void place();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mode, place]);

  const shownRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (mode !== "bar") {
      shownRef.current = null;
      return;
    }
    if (shown === shownRef.current) return;
    shownRef.current = shown;
    if (shown) void place().then(() => native.showWindow());
    else void native.hideWindow();
  }, [mode, shown, place]);

  useEffect(() => {
    if (mode === "bar") return;
    // Switched off: the pill takes the window back, hidden until a take. Only
    // on the switch itself; a take in the pill's own mode hides by itself.
    setPanel(null);
    setHoverOpen(false);
    lastBox.current = null;
    if (!pillActiveRef.current) void native.hideWindow();
    setPillActive(false);
  }, [mode]);

  useEffect(() => {
    // Whenever the bar itself is not on screen — a take took its place, a
    // full-screen app sent it away — it comes back folded: the pointer that
    // opened it is long gone, and no "leave" will ever say so.
    if (barVisible) return;
    setPanel(null);
    setHoverOpen(false);
  }, [barVisible]);

  useEffect(() => {
    // Moved by something other than us (Windows re-fitting the window after a
    // change of display scale, a monitor unplugged): place it again.
    let off: () => void = () => {};
    let disposed = false;
    let timer: number | undefined;
    void native
      .onMoved(() => {
        if (dragging.current || modeRef.current !== "bar") return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          void native.windowBox().then((box) => {
            if (!box || !lastBox.current || sameBox(box, lastBox.current) || dragging.current) return;
            lastBox.current = null;
            monitorCache.current = null;
            void place();
          });
        }, 200);
      })
      .then((un) => {
        if (disposed) un();
        else off = un;
      });
    return () => {
      disposed = true;
      off();
      window.clearTimeout(timer);
    };
  }, [place]);

  /* ---------------- tip, hover, drag ---------------- */

  const dismissTip = useCallback(() => {
    setHello(false);
    if (!getBarSettings().introduced) setBarSettings({ introduced: true });
  }, []);

  useEffect(() => {
    if (!showTip) return;
    const timer = window.setTimeout(dismissTip, TIP_MS);
    return () => window.clearTimeout(timer);
  }, [showTip, dismissTip]);

  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const onPointerEnter = () => {
    native.noteForeground();
    window.clearTimeout(closeTimer.current);
    if (!hoverOpen) {
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => setHoverOpen(true), HOVER_OPEN_MS);
    }
  };
  const onPointerLeave = () => {
    window.clearTimeout(openTimer.current);
    if (dragging.current) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(
      () => {
        setPanel(null);
        setHoverOpen(false);
      },
      panelRef.current ? PANEL_CLOSE_MS : HOVER_CLOSE_MS,
    );
  };
  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);

  const finishDrag = useCallback(async () => {
    const [box, mons] = await Promise.all([native.windowBox(), getMonitors(true)]);
    const row = rowRef.current?.getBoundingClientRect();
    dragging.current = false;
    if (box && row) {
      const scale = window.devicePixelRatio || 1;
      const rowBox: Box = {
        x: Math.round(box.x + row.left * scale),
        y: Math.round(box.y + row.top * scale),
        width: Math.round(row.width * scale),
        height: Math.round(row.height * scale),
      };
      const monitor =
        monitorAt(mons.all, rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2) ??
        pickMonitor(mons.all, mons.primary, null);
      if (monitor) {
        const anchor = anchorFrom(workAreaOf(monitor), monitor.scaleFactor, rowBox, monitor.name);
        setBarSettings({ anchor });
        logInfo("bar", `moved to ${monitor.name ?? "a monitor"} at ${Math.round(anchor.x * 100)}% / ${anchor.gap} px`);
      }
    }
    lastBox.current = null;
    void place();
  }, [getMonitors, place]);

  useEffect(() => native.listenTauri("bar-drag-end", () => void finishDrag()), [finishDrag]);

  const drag: DragHandlers = {
    onPointerDown: (e) => {
      if (e.button === 0) dragStart.current = { x: e.screenX, y: e.screenY };
    },
    onPointerMove: (e) => {
      const start = dragStart.current;
      if (!start) return;
      if ((e.buttons & 1) === 0) {
        dragStart.current = null;
        return;
      }
      if (Math.abs(e.screenX - start.x) + Math.abs(e.screenY - start.y) < 6) return;
      dragStart.current = null;
      dragging.current = true;
      suppressClickUntil.current = Date.now() + 800;
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      setPanel(null);
      if (showTip) dismissTip();
      void native.beginDrag();
    },
    onPointerUp: () => {
      dragStart.current = null;
    },
  };

  /* ---------------- what the buttons do ---------------- */

  const act = (fn: () => void) => () => {
    if (Date.now() < suppressClickUntil.current) return;
    if (tipWanted) dismissTip();
    fn();
  };
  const fold = () => {
    setPanel(null);
    setHoverOpen(false);
  };
  const send = (command: BarCommand) => void native.sendCommand(command);

  const onScreenshot = async () => {
    fold();
    // Hidden before the grab: with "Record owntools itself" on, the bar is not
    // excluded from captures and would be in the picture.
    setGrabbing(true);
    await new Promise((r) => window.setTimeout(r, 160));
    try {
      await native.screenshot();
    } finally {
      // bar.rs sees the capture overlay by then and keeps the bar away.
      window.setTimeout(() => setGrabbing(false), 1_200);
    }
  };

  const onHide = () => {
    fold();
    setHiding(true);
    setNotice("Bar hidden. Show it again from the owntools tray icon.");
    window.setTimeout(() => {
      setBarSettings({ enabled: false });
      setNotice(null);
      setHiding(false);
    }, NOTICE_MS);
  };

  /* ---------------- render ---------------- */

  const privateToCapture = isWindows() && !recordsItself();

  const extras =
    barVisible && expanded ? (
      <>
        {showTip ? <Tip privateToCapture={privateToCapture} onDismiss={dismissTip} /> : null}
        {panel === "focus" ? (
          <FocusPanel
            focus={state.focus}
            now={now}
            minutes={settings.focusMinutes}
            onMinutes={(focusMinutes) => setBarSettings({ focusMinutes })}
            onStart={(minutes, session) => {
              send({ kind: "focus-start", minutes, session });
              fold();
            }}
            onPause={() => send({ kind: "focus-pause" })}
            onResume={() => send({ kind: "focus-resume" })}
            onStop={() => send({ kind: "focus-stop" })}
            onOpen={() => {
              send({ kind: "open", tool: "focus" });
              fold();
            }}
          />
        ) : panel === "meet" ? (
          <MeetPanel
            locked={!pro}
            meet={state.meet}
            now={now}
            onStart={() => send({ kind: "meet-start" })}
            onPause={() => send({ kind: "meet-pause" })}
            onResume={() => send({ kind: "meet-resume" })}
            onStop={() => send({ kind: "meet-stop" })}
            onOpen={() => {
              send({ kind: "open", tool: "meet" });
              fold();
            }}
          />
        ) : panel === "more" ? (
          <MorePanel
            onScreenshot={() => void onScreenshot()}
            onOpen={() => {
              fold();
              void native.showMain();
            }}
            onSettings={() => {
              send({ kind: "open", section: "bar" });
              fold();
            }}
            onHide={onHide}
          />
        ) : null}
      </>
    ) : null;

  let row = null;
  if (mode === "bar" && !pillActive) {
    if (notice !== null) row = <Notice text={notice} />;
    else if (expanded)
      row = (
        <BarRow
          state={state}
          now={now}
          panel={panel}
          download={download}
          drag={drag}
          onMark={act(() => {
            fold();
            void native.showMain();
          })}
          onDictate={act(() => {
            fold();
            void native.restoreForeground().then(() => native.toggleDictation());
          })}
          onRecord={act(() => {
            fold();
            send({ kind: "record" });
          })}
          onPanel={(next) =>
            act(() => {
              window.clearTimeout(closeTimer.current);
              setPanel((current) => (current === next ? null : next));
            })()
          }
        />
      );
    else
      row = (
        <Capsule
          state={state}
          now={now}
          drag={drag}
          onOpen={act(() => {
            window.clearTimeout(openTimer.current);
            setHoverOpen(true);
          })}
        />
      );
  }

  return (
    <div className={mode === "bar" ? `bar-root${openDown ? " down" : ""}` : "pill-root"}>
      <div
        className={mode === "bar" ? "bar-stack" : "pill-fill"}
        ref={stackRef}
        onPointerEnter={mode === "bar" ? onPointerEnter : undefined}
        onPointerLeave={mode === "bar" ? onPointerLeave : undefined}
        // A click the bar took the foreground with goes back to the app it came from.
        onClickCapture={mode === "bar" ? () => void native.restoreForeground() : undefined}
      >
        {extras}
        <div className={mode === "bar" ? "bar-row-slot" : "pill-fill"} ref={rowRef}>
          {row}
          <div className={mode === "bar" ? "bar-pill" : "pill-fill"} hidden={mode === "bar" && !pillActive}>
            <DictationPill host={pillHost} embedded={mode === "bar"} />
          </div>
        </div>
      </div>
    </div>
  );
}
