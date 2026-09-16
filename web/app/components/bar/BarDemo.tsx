"use client";

/**
 * The owntools bar, working, on the landing: the capsule, the bar, its three
 * widgets, the dictation pill and the recorder's live bar, drawn exactly as
 * apps/desktop/src/bar draws them (BarView.tsx; the styles are copied into
 * bar-demo.css) over a stand-in desktop. Everything answers the way the app
 * does, with the app's own timings: point at the capsule and it opens, leave
 * and it folds, start a focus session or a meeting and the clock runs, dictate
 * and the words land in the window, drag it and the widgets open towards the
 * room. Nothing is recorded: the clocks are real, the take is played.
 *
 * While nobody touches it, a short tour plays with a drawn pointer (a focus
 * session, a take, a meeting) - only while the scene is on screen, never with
 * reduced motion, a few rounds at most. The first real move, click or key
 * hands it over for good.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { MousePointerClick } from "lucide-react";
import "./bar-demo.css";
import {
  AppIcon,
  HideIcon,
  MoreIcon,
  OpenIcon,
  PauseIcon,
  PlayIcon,
  RecBackIcon,
  RecCloseIcon,
  RecDotsIcon,
  RecFolderIcon,
  RecMicIcon,
  RecPauseIcon,
  RecPlayIcon,
  RecRestartIcon,
  RecStopIcon,
  RecTrashIcon,
  Sail,
  SettingsIcon,
  StopIcon,
  ToolGlyph,
} from "./marks";

/* the bar's own timings (apps/desktop/src/bar/BarWindow.tsx) */
const HOVER_OPEN_MS = 260;
const HOVER_CLOSE_MS = 700;
const PANEL_CLOSE_MS = 1_400;
const NOTICE_MS = 3_200;

/* the lengths the focus widget offers (@core/bar FOCUS_CHOICES) */
const FOCUS_CHOICES = [15, 25, 50, 90] as const;
/* the open tasks it offers to name a session after */
const TASKS = ["Finish the slides", "Read chapter 4"];

/* what the takes say, one after another */
const TAKES = [
  "Let's move the review to Thursday and share the notes before lunch.",
  "The second chapter needs a shorter opening and one clear example.",
  "Remind me to book the venue and send the invitations on Monday.",
];
/* the resident recognizer hands a take back in segments while you speak */
const SEGMENT_WORDS = 4;
const FIRST_SEGMENT_MS = 1_100;
const SEGMENT_MS = 950;
/* nobody may press Done here, so a take also ends by itself this long after its last word
   (longer than the tour takes to reach Done) */
const TAKE_TAIL_MS = 2_800;

/* the widest thing the bar row turns into, for keeping a drag inside the scene */
const WIDEST_ROW = 480;
const TOUR_ROUNDS = 3;

type Panel = "focus" | "meet" | "more";

interface Focus {
  running: boolean;
  /** Epoch ms at which a running session reaches zero. */
  endAt: number;
  /** What is left of a paused session. */
  remainingMs: number;
  /** 0 while no session is under way. */
  durationMs: number;
  session: string;
}

const IDLE_FOCUS: Focus = { running: false, endAt: 0, remainingMs: 0, durationMs: 0, session: "" };

type MeetPhase = "idle" | "starting" | "recording" | "paused" | "stopping" | "finished";

interface Meet {
  phase: MeetPhase;
  elapsedMs: number;
  at: number;
}

const IDLE_MEET: Meet = { phase: "idle", elapsedMs: 0, at: 0 };

interface Take {
  sentence: string;
  phase: "listening" | "finishing";
  /** What the segments decoded so far say. */
  partial: string;
  speaking: boolean;
}

interface Recording {
  at: number;
  elapsedMs: number;
  paused: boolean;
  more: boolean;
  muted: boolean;
}

/** Where the bar was dragged: its centre across, the edge it hangs from, and which way widgets open. */
interface Spot {
  x: number;
  edge: number;
  down: boolean;
}

interface Pointer {
  x: number;
  y: number;
  on: boolean;
  press: boolean;
  jump: boolean;
}

interface DragStart {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  z: number;
  w: number;
  h: number;
  rowH: number;
  scale: number;
  moved: boolean;
}

interface DragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}

/* ------------------------------ clocks ------------------------------ */

/** "4:05", "18:32", "1:02:07" (@core/bar formatClock). */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The recorder's "00:03" (feature-editor formatTime). */
function recorderTime(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

function focusLeftMs(focus: Focus, now: number): number {
  return focus.running ? Math.max(0, focus.endAt - now) : focus.remainingMs;
}

/** A countdown rounds up: 25:00 when it starts, 0:00 only when it is over. */
function focusClock(focus: Focus, now: number): string {
  return formatClock(Math.ceil(focusLeftMs(focus, now) / 1000) * 1000);
}

function meetLive(meet: Meet): boolean {
  return meet.phase === "starting" || meet.phase === "recording" || meet.phase === "paused" || meet.phase === "stopping";
}

function meetClock(meet: Meet, now: number): string {
  const exact = meet.phase === "recording" ? meet.elapsedMs + (now - meet.at) : meet.elapsedMs;
  return formatClock(Math.floor(Math.max(0, exact) / 1000) * 1000);
}

/* ------------------------------ hooks ------------------------------ */

const subscribeNothing = () => () => {};

/** Hotkeys are written the platform's way; the server renders the Windows spelling. */
function useMac(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => /Macintosh|Mac OS X/.test(navigator.userAgent),
    () => false,
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(cb: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", cb);
  return () => query.removeEventListener("change", cb);
}

/** True on the server, so the tour can only ever start in a browser that allows motion. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => true);
}

/** Named groups of timeouts: cancel a group in one call, and all of them go with the component. */
function useTimers() {
  const groups = useRef(new Map<string, Set<number>>());
  useEffect(() => {
    const all = groups.current;
    return () => all.forEach((ids) => ids.forEach((id) => window.clearTimeout(id)));
  }, []);
  const later = useCallback((group: string, fn: () => void, ms: number) => {
    const ids = groups.current.get(group) ?? new Set<number>();
    groups.current.set(group, ids);
    const id = window.setTimeout(() => {
      ids.delete(id);
      fn();
    }, ms);
    ids.add(id);
  }, []);
  const cancel = useCallback((...names: string[]) => {
    for (const name of names) {
      const ids = groups.current.get(name);
      ids?.forEach((id) => window.clearTimeout(id));
      ids?.clear();
    }
  }, []);
  return { later, cancel };
}

/* ------------------------------ the demo ------------------------------ */

export function BarDemo() {
  const mac = useMac();
  const reducedMotion = useReducedMotion();
  const { later, cancel } = useTimers();

  const sceneRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const [hoverOpen, setHoverOpen] = useState(true);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [minutes, setMinutes] = useState(25);
  const [task, setTask] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(IDLE_FOCUS);
  const [meet, setMeet] = useState<Meet>(IDLE_MEET);
  const [take, setTake] = useState<Take | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [away, setAway] = useState<"grab" | "hidden" | null>(null);
  const [shots, setShots] = useState(0);
  const [doc, setDoc] = useState<{ id: number; text: string }[]>([]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [pointer, setPointer] = useState<Pointer>({ x: 0, y: 0, on: false, press: false, jump: true });
  const [dim, setDim] = useState(false);
  const [now, setNow] = useState(0);

  const barVisible = take === null && recording === null && notice === null && away === null;
  const expanded = barVisible && (hoverOpen || panel !== null);
  // The moment the clock in front changes is a whole number of seconds from
  // here (null when nothing runs). Ticking on those boundaries, as the bar
  // does, means a clock never lags a second behind or skips one.
  const tickPhase =
    recording && !recording.paused
      ? recording.at - recording.elapsedMs
      : meet.phase === "recording"
        ? meet.at - meet.elapsedMs
        : focus.running
          ? focus.endAt
          : null;

  useEffect(() => {
    if (tickPhase === null) return;
    let id = 0;
    const untilNext = () => 1000 - ((((Date.now() - tickPhase) % 1000) + 1000) % 1000) + 15;
    const tick = () => {
      setNow(Date.now());
      id = window.setTimeout(tick, untilNext());
    };
    id = window.setTimeout(tick, untilNext());
    return () => window.clearTimeout(id);
  }, [tickPhase]);

  const fold = useCallback(() => {
    setPanel(null);
    setHoverOpen(false);
  }, []);

  /* ---------------- focus ---------------- */

  const startFocus = (length: number, session: string) => {
    const t = Date.now();
    setNow(t);
    setFocus({ running: true, endAt: t + length * 60_000, remainingMs: 0, durationMs: length * 60_000, session });
    setTask(null);
    fold();
  };
  const pauseFocus = () => {
    const t = Date.now();
    setNow(t);
    setFocus((f) => ({ ...f, running: false, remainingMs: Math.max(0, f.endAt - t) }));
  };
  const resumeFocus = () => {
    const t = Date.now();
    setNow(t);
    setFocus((f) => ({ ...f, running: true, endAt: t + f.remainingMs }));
  };

  /* ---------------- meeting ---------------- */

  const startMeet = () => {
    cancel("meet");
    setMeet({ phase: "starting", elapsedMs: 0, at: Date.now() });
    later(
      "meet",
      () => {
        const t = Date.now();
        setNow(t);
        setMeet({ phase: "recording", elapsedMs: 0, at: t });
      },
      400,
    );
  };
  const pauseMeet = () => {
    const t = Date.now();
    setNow(t);
    setMeet((m) => ({ phase: "paused", elapsedMs: m.elapsedMs + (t - m.at), at: t }));
  };
  const resumeMeet = () => {
    const t = Date.now();
    setNow(t);
    setMeet((m) => ({ ...m, phase: "recording", at: t }));
  };
  const stopMeet = () => {
    const t = Date.now();
    setMeet((m) => ({
      phase: "stopping",
      elapsedMs: m.phase === "recording" ? m.elapsedMs + (t - m.at) : m.elapsedMs,
      at: t,
    }));
    later("meet", () => setMeet((m) => (m.phase === "stopping" ? { ...m, phase: "finished" } : m)), 900);
  };

  /* ---------------- dictation ---------------- */

  const takeCount = useRef(0);
  const takeSentence = useRef("");

  const finishTake = useCallback(() => {
    cancel("take");
    setTake((t) => (t && t.phase === "listening" ? { ...t, phase: "finishing", partial: t.sentence, speaking: false } : t));
    later(
      "take",
      () => {
        const text = takeSentence.current;
        takeSentence.current = "";
        setTake(null);
        if (text) setDoc((d) => [...d.slice(-1), { id: takeCount.current, text }]);
      },
      520,
    );
  }, [cancel, later]);

  const cancelTake = useCallback(() => {
    cancel("take");
    takeSentence.current = "";
    setTake(null);
  }, [cancel]);

  const startTake = useCallback(() => {
    fold();
    cancel("take");
    const sentence = TAKES[takeCount.current % TAKES.length];
    takeCount.current += 1;
    takeSentence.current = sentence;
    const words = sentence.split(" ");
    const segments = Math.ceil(words.length / SEGMENT_WORDS);
    setTake({ sentence, phase: "listening", partial: "", speaking: true });
    for (let i = 0; i < segments; i++) {
      const partial = words.slice(0, (i + 1) * SEGMENT_WORDS).join(" ");
      const last = i === segments - 1;
      later(
        "take",
        () => setTake((t) => (t && t.phase === "listening" ? { ...t, partial, speaking: !last } : t)),
        FIRST_SEGMENT_MS + i * SEGMENT_MS,
      );
    }
    later("take", finishTake, FIRST_SEGMENT_MS + (segments - 1) * SEGMENT_MS + TAKE_TAIL_MS);
  }, [cancel, finishTake, fold, later]);

  const listening = take?.phase === "listening";
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelTake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, cancelTake]);

  /* ---------------- recorder, screenshot, hide ---------------- */

  const startRecording = () => {
    fold();
    const t = Date.now();
    setNow(t);
    setRecording({ at: t, elapsedMs: 0, paused: false, more: false, muted: false });
  };
  const pauseRecording = () => {
    const t = Date.now();
    setNow(t);
    setRecording((r) =>
      r && (r.paused ? { ...r, paused: false, at: t } : { ...r, paused: true, elapsedMs: r.elapsedMs + (t - r.at) }),
    );
  };
  const restartRecording = () => {
    const t = Date.now();
    setNow(t);
    setRecording((r) => r && { ...r, paused: false, elapsedMs: 0, at: t });
  };

  const screenshot = () => {
    fold();
    cancel("grab");
    setShots((n) => n + 1);
    setAway("grab");
    later("grab", () => setAway(null), 1_450);
  };

  const hide = () => {
    fold();
    cancel("notice");
    setNotice("Bar hidden. Show it again from the owntools tray icon.");
    later(
      "notice",
      () => {
        setNotice(null);
        setAway("hidden");
        // the tray brings it back in the app; here it comes back by itself
        later("notice", () => setAway(null), 1_600);
      },
      NOTICE_MS,
    );
  };

  /* ---------------- hover, drag ---------------- */

  const touring = useRef(false);
  const dragging = useRef(false);
  const suppressClickUntil = useRef(0);
  // what a drag in progress has to undo if the demo goes away mid-drag
  const dragEnds = useRef(new Set<() => void>());
  useEffect(() => {
    const ends = dragEnds.current;
    return () => ends.forEach((end) => end());
  }, []);

  const onEnter = (e: ReactPointerEvent) => {
    // a bar being dragged slides under the pointer the whole way: that is not a hover
    if (e.pointerType !== "mouse" || touring.current || dragging.current) return;
    cancel("hover-close");
    if (!hoverOpen) {
      cancel("hover-open");
      later("hover-open", () => setHoverOpen(true), HOVER_OPEN_MS);
    }
  };
  const onLeave = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse" || touring.current || dragging.current) return;
    cancel("hover-open", "hover-close");
    later("hover-close", fold, panel ? PANEL_CLOSE_MS : HOVER_CLOSE_MS);
  };

  /**
   * Dragging, mouse only (a finger on the bar scrolls the page). Followed on
   * `window`, because a 26 px capsule is left behind by the first move.
   */
  const dragHandlers: DragHandlers = {
    onPointerDown: (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const scene = sceneRef.current;
      const row = rowRef.current;
      if (!scene || !row || !scene.offsetWidth || !row.offsetHeight) return;
      const s = scene.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const z = s.width / scene.offsetWidth || 1;
      const d: DragStart = {
        x0: e.clientX,
        y0: e.clientY,
        cx: (r.left + r.width / 2 - s.left) / z,
        cy: (r.top + r.height / 2 - s.top) / z,
        z,
        w: scene.offsetWidth,
        h: scene.offsetHeight,
        rowH: r.height / z,
        scale: r.height / z / row.offsetHeight,
        moved: false,
      };

      function onMove(ev: PointerEvent) {
        if ((ev.buttons & 1) === 0) return end();
        const dx = (ev.clientX - d.x0) / d.z;
        const dy = (ev.clientY - d.y0) / d.z;
        if (!d.moved) {
          if (Math.abs(dx) + Math.abs(dy) < 6) return;
          d.moved = true;
          dragging.current = true;
          cancel("hover-open", "hover-close");
          setPanel(null);
          setGrabbing(true);
        }
        ev.preventDefault();
        const half = (WIDEST_ROW / 2) * d.scale + 10;
        const cx = Math.min(Math.max(d.cx + dx, half), Math.max(half, d.w - half));
        const cy = Math.min(Math.max(d.cy + dy, d.rowH / 2 + 10), d.h - d.rowH / 2 - 10);
        const down = cy < d.h / 2;
        setSpot({ x: cx / d.w, edge: (down ? cy - d.rowH / 2 : cy + d.rowH / 2) / d.h, down });
      }
      function end() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        dragEnds.current.delete(end);
        if (!d.moved) return;
        // the click a drag ends with is not a click
        suppressClickUntil.current = Date.now() + 250;
        dragging.current = false;
        setGrabbing(false);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      dragEnds.current.add(end);
    },
  };

  /** A click that ends a drag is not a click. */
  const unlessDragged = (fn: () => void) => {
    if (Date.now() < suppressClickUntil.current) return;
    fn();
  };

  /* ---------------- the tour ---------------- */

  const interacted = useRef(false);
  const roundsLeft = useRef(TOUR_ROUNDS);
  const tour = useRef<{ alive: boolean; timers: number[] } | null>(null);
  const moved = useRef(0);

  const resetAll = useCallback(() => {
    cancel("take", "meet", "notice", "grab", "hover-open", "hover-close");
    takeSentence.current = "";
    setPanel(null);
    setHoverOpen(true);
    setMinutes(25);
    setTask(null);
    setFocus(IDLE_FOCUS);
    setMeet(IDLE_MEET);
    setTake(null);
    setRecording(null);
    setNotice(null);
    setAway(null);
    setDoc([]);
    setSpot(null);
    setDim(false);
  }, [cancel]);

  const stopTour = useCallback(() => {
    const run = tour.current;
    if (!run) return;
    run.alive = false;
    run.timers.forEach((id) => window.clearTimeout(id));
    tour.current = null;
    touring.current = false;
    setPointer((p) => ({ ...p, on: false, press: false }));
    setDim(false);
  }, []);

  const startTour = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene || tour.current || interacted.current || roundsLeft.current <= 0) return;
    const run = { alive: true, timers: [] as number[] };
    tour.current = run;
    touring.current = true;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        run.timers.push(window.setTimeout(resolve, ms));
      });
    const target = (name: string) => scene.querySelector<HTMLElement>(`[data-demo="${name}"]`);
    /** Glide the pointer onto a control; false when it is not there. */
    const move = async (name: string) => {
      const el = target(name);
      if (!el) return false;
      const s = scene.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const z = s.width / scene.offsetWidth || 1;
      setPointer((p) => ({
        ...p,
        x: (r.left + r.width * 0.5 - s.left) / z,
        y: (r.top + r.height * 0.6 - s.top) / z,
        on: true,
        jump: false,
      }));
      await sleep(640);
      return run.alive;
    };
    const click = async (name: string) => {
      if (!(await move(name))) return;
      setPointer((p) => ({ ...p, press: true }));
      await sleep(110);
      if (!run.alive) return;
      target(name)?.click();
      setPointer((p) => ({ ...p, press: false }));
    };

    /** Rest on the capsule until it opens, the way a person's pointer does. */
    const hover = async () => {
      if (!(await move("capsule"))) return;
      await sleep(HOVER_OPEN_MS + 60);
      if (!run.alive) return;
      setHoverOpen(true);
      await sleep(450);
    };
    /** Step off the bar a little, so the capsule can be seen. */
    const stepAside = () => setPointer((p) => ({ ...p, x: p.x + 64, y: p.y + 30 }));

    const round = async () => {
      resetAll();
      await sleep(700);
      if (!run.alive) return;
      const w = scene.offsetWidth;
      const h = scene.offsetHeight;
      setPointer({ x: w * 0.82, y: h * 0.82, on: false, press: false, jump: true });
      await sleep(60);
      setPointer((p) => ({ ...p, on: true, jump: false }));
      await sleep(250);

      // a focus session: starting one folds the bar, and the capsule keeps the clock
      await click("focus");
      await sleep(650);
      if (!run.alive) return;
      await click("focus-start");
      await sleep(200);
      stepAside();
      await sleep(1_500);
      if (!run.alive) return;

      // a take: the words arrive while you speak, then land in the window
      await hover();
      if (!run.alive) return;
      await click("dictate");
      await sleep(4_300);
      if (!run.alive) return;
      await click("done");
      await sleep(300);
      if (!run.alive) return;
      stepAside();
      await sleep(2_400);
      if (!run.alive) return;

      // a meeting
      await hover();
      if (!run.alive) return;
      await click("meet");
      await sleep(700);
      if (!run.alive) return;
      await click("meet-start");
      await sleep(1_700);
      if (!run.alive) return;

      // walk away: it folds, and the capsule is what says a meeting is being recorded
      setPointer((p) => ({ ...p, x: w + 30, y: h * 0.72 }));
      await sleep(PANEL_CLOSE_MS);
      if (!run.alive) return;
      fold();
      setPointer((p) => ({ ...p, on: false }));
      await sleep(3_800);
      if (!run.alive) return;
      setDim(true);
      await sleep(400);
    };

    void (async () => {
      while (run.alive && roundsLeft.current > 0) {
        await round();
        if (run.alive) roundsLeft.current -= 1;
      }
      if (run.alive) {
        stopTour();
        resetAll();
      }
    })();
  }, [fold, resetAll, stopTour]);

  /** A person is here: the tour stops and does not come back. */
  const takeOver = useCallback(() => {
    if (interacted.current) return;
    interacted.current = true;
    stopTour();
  }, [stopTour]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || reducedMotion || typeof IntersectionObserver === "undefined") return;
    let inView = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.55) {
          inView = true;
          if (!document.hidden) startTour();
        } else if (entry.intersectionRatio < 0.2) {
          inView = false;
          stopTour();
        }
      },
      { threshold: [0, 0.2, 0.55] },
    );
    observer.observe(scene);
    const onVisibility = () => {
      if (document.hidden) stopTour();
      else if (inView) startTour();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stopTour();
    };
  }, [reducedMotion, startTour, stopTour]);

  const lastPointer = useRef("mouse");
  const onScenePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    // a finger may only be scrolling the page past the scene; its tap is the sign (below)
    if (e.pointerType !== "touch") takeOver();
  };
  const onSceneClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    // the tour presses buttons with element.click(), which is not a person
    if (!e.nativeEvent.isTrusted) return;
    takeOver();
    // a tap beside the bar folds it (a mouse folds it by leaving)
    if (lastPointer.current !== "mouse" && !(e.target as Element).closest(".bar-stack")) fold();
  };
  const onScenePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // a page scrolling under a resting mouse moves nothing
    if (interacted.current || e.pointerType !== "mouse") return;
    moved.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (moved.current > 14) takeOver();
  };

  /* ---------------- render ---------------- */

  const dictateKey = mac ? "⌃⇧Space" : "Ctrl+Shift+Space";
  const captureKey = mac ? "⌃⇧4" : "Ctrl+Shift+4";

  let row: ReactNode = null;
  if (take) row = <TakePill take={take} onDone={finishTake} />;
  else if (recording)
    row = (
      <Recorder
        recording={recording}
        elapsedMs={recording.paused ? recording.elapsedMs : recording.elapsedMs + Math.max(0, now - recording.at)}
        onPause={pauseRecording}
        onRestart={restartRecording}
        onEnd={() => setRecording(null)}
        onMore={() => setRecording((r) => r && { ...r, more: !r.more })}
        onMute={() => setRecording((r) => r && { ...r, muted: !r.muted })}
      />
    );
  else if (notice !== null)
    row = (
      <div className="bar-notice bar-surface" role="status">
        {notice}
      </div>
    );
  else if (away === null)
    row = expanded ? (
      <BarRow
        focus={focus}
        meet={meet}
        now={now}
        panel={panel}
        dictateKey={dictateKey}
        drag={dragHandlers}
        onMark={() => unlessDragged(fold)}
        onDictate={() => unlessDragged(startTake)}
        onRecord={() => unlessDragged(startRecording)}
        onPanel={(next) =>
          unlessDragged(() => {
            cancel("hover-close");
            setPanel((current) => (current === next ? null : next));
          })
        }
      />
    ) : (
      <Capsule
        focus={focus}
        meet={meet}
        now={now}
        drag={dragHandlers}
        onOpen={() =>
          unlessDragged(() => {
            cancel("hover-open");
            setHoverOpen(true);
          })
        }
      />
    );

  let widget: ReactNode = null;
  if (expanded && panel === "focus")
    widget = (
      <FocusPanel
        focus={focus}
        now={now}
        minutes={minutes}
        task={task}
        onMinutes={setMinutes}
        onTask={setTask}
        onStart={() => startFocus(minutes, task ?? "")}
        onPause={pauseFocus}
        onResume={resumeFocus}
        onStop={() => setFocus(IDLE_FOCUS)}
        onOpen={fold}
      />
    );
  else if (expanded && panel === "meet")
    widget = (
      <MeetPanel
        meet={meet}
        now={now}
        onStart={startMeet}
        onPause={pauseMeet}
        onResume={resumeMeet}
        onStop={stopMeet}
        onOpen={fold}
      />
    );
  else if (expanded && panel === "more")
    widget = <MorePanel captureKey={captureKey} onScreenshot={screenshot} onClose={fold} onHide={hide} />;

  const dockStyle: CSSProperties | undefined = spot
    ? spot.down
      ? { left: `${spot.x * 100}%`, top: `${spot.edge * 100}%`, bottom: "auto" }
      : { left: `${spot.x * 100}%`, bottom: `${(1 - spot.edge) * 100}%` }
    : undefined;

  return (
    <div
      ref={sceneRef}
      className="scene ground bar-demo"
      role="group"
      aria-label="The owntools bar, working. Try it."
      onPointerDown={onScenePointerDown}
      onPointerMove={onScenePointerMove}
      onClickCapture={onSceneClickCapture}
      onKeyDownCapture={takeOver}
      onFocusCapture={takeOver}
    >
      <span className="bd-hint" aria-hidden>
        <MousePointerClick size={13} strokeWidth={2.2} />
        try it
      </span>

      <DocWindow doc={doc} />

      <div
        className={`bd-dock${spot?.down ? " down" : ""}${dim ? " dim" : ""}${grabbing ? " grabbing" : ""}`}
        style={dockStyle}
      >
        <div className="bar-stack" onPointerEnter={onEnter} onPointerLeave={onLeave}>
          {widget}
          <div className="bar-row-slot" ref={rowRef}>
            {row}
          </div>
        </div>
      </div>

      {away === "grab" ? (
        <Fragment key={shots}>
          <div className="bd-select" aria-hidden />
          <div className="bd-flash" aria-hidden />
        </Fragment>
      ) : null}

      <span
        className={`bd-cursor${pointer.on ? " on" : ""}${pointer.press ? " press" : ""}${pointer.jump ? " jump" : ""}`}
        style={{ transform: `translate(${pointer.x - 5}px, ${pointer.y - 2.5}px)` }}
        aria-hidden
      >
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M5 2.5 19 12.2 12.4 13.2 9.6 19.6Z" fill="#fff" stroke="#1d1d1f" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}

/* ------------------------------ the pieces ------------------------------ */

/** Someone else's app, with a caret where the take lands. */
function DocWindow({ doc }: { doc: { id: number; text: string }[] }) {
  const last = doc[doc.length - 1];
  return (
    <div className="bd-window pane" aria-hidden>
      <div className="bd-window-bar">
        <i />
        <i />
        <i />
        <span className="bd-window-title">notes</span>
      </div>
      <div className="bd-doc">
        <span className="bd-line head" />
        <span className="bd-line" style={{ width: "92%" }} />
        <span className="bd-line" style={{ width: "84%" }} />
        <span className="bd-line" style={{ width: "58%" }} />
        <p className="bd-typed">
          {doc.slice(0, -1).map((d) => `${d.text} `)}
          {last ? <Typed key={last.id} text={last.text} /> : null}
          <span className="bd-caret" />
        </p>
      </div>
    </div>
  );
}

/** The take arriving in the window, a couple of characters at a time. */
function Typed({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let n = 0;
    let id = 0;
    const step = () => {
      n = Math.min(text.length, n + 2);
      setCount(n);
      if (n < text.length) id = window.setTimeout(step, 16);
    };
    id = window.setTimeout(step, 30);
    return () => window.clearTimeout(id);
  }, [text]);
  return <>{text.slice(0, count)}</>;
}

function FocusClock({ focus, now }: { focus: Focus; now: number }) {
  return <span className={`bar-clock${focus.running ? "" : " bar-muted"}`}>{focusClock(focus, now)}</span>;
}

function RecDot({ phase }: { phase: MeetPhase }) {
  return <span className={`bar-dot${phase === "recording" ? "" : " off"}`} aria-hidden />;
}

function Capsule({
  focus,
  meet,
  now,
  drag,
  onOpen,
}: {
  focus: Focus;
  meet: Meet;
  now: number;
  drag: DragHandlers;
  onOpen: () => void;
}) {
  let content: ReactNode;
  let label = "owntools bar";
  if (meetLive(meet)) {
    const clock = meetClock(meet, now);
    label = `Meeting recording, ${clock}`;
    content = (
      <>
        <RecDot phase={meet.phase} />
        <span className="bar-clock">{clock}</span>
      </>
    );
  } else if (focus.durationMs > 0) {
    label = `Focus session, ${focusClock(focus, now)} left`;
    content = (
      <>
        <ToolGlyph tool="focus" size={14} />
        <FocusClock focus={focus} now={now} />
      </>
    );
  } else {
    content = (
      <>
        <Sail size={11} />
        <span className="bar-dots" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      </>
    );
  }
  return (
    <button
      type="button"
      className="bar-capsule bar-surface"
      data-demo="capsule"
      aria-label={label}
      onClick={onOpen}
      {...drag}
    >
      {content}
    </button>
  );
}

function BarRow({
  focus,
  meet,
  now,
  panel,
  dictateKey,
  drag,
  onMark,
  onDictate,
  onRecord,
  onPanel,
}: {
  focus: Focus;
  meet: Meet;
  now: number;
  panel: Panel | null;
  dictateKey: string;
  drag: DragHandlers;
  onMark: () => void;
  onDictate: () => void;
  onRecord: () => void;
  onPanel: (panel: Panel) => void;
}) {
  return (
    <div className="bar-row bar-surface" {...drag}>
      <button type="button" className="bar-btn bar-mark" title="Open owntools" aria-label="Open owntools" onClick={onMark}>
        <AppIcon size={24} />
      </button>
      <span className="bar-sep" aria-hidden />
      <button type="button" className="bar-btn" data-demo="dictate" title={`Dictate · ${dictateKey}`} onClick={onDictate}>
        <ToolGlyph tool="dictate" size={18} />
        Dictate
      </button>
      <button type="button" className="bar-btn" data-demo="record" title="Record the screen" onClick={onRecord}>
        <ToolGlyph tool="screeni" size={18} />
        Record
      </button>
      <button
        type="button"
        className="bar-btn"
        data-demo="focus"
        data-on={panel === "focus"}
        title="Focus session"
        onClick={() => onPanel("focus")}
      >
        <ToolGlyph tool="focus" size={18} />
        {focus.durationMs > 0 ? <FocusClock focus={focus} now={now} /> : "Focus"}
      </button>
      <button
        type="button"
        className="bar-btn"
        data-demo="meet"
        data-on={panel === "meet"}
        title="Meeting notes"
        onClick={() => onPanel("meet")}
      >
        {meetLive(meet) ? (
          <>
            <RecDot phase={meet.phase} />
            <span className="bar-clock">{meetClock(meet, now)}</span>
          </>
        ) : (
          <>
            <ToolGlyph tool="meet" size={18} />
            Meeting
          </>
        )}
      </button>
      <span className="bar-sep" aria-hidden />
      <button
        type="button"
        className="bar-btn bar-icon"
        data-demo="more"
        data-on={panel === "more"}
        title="More"
        aria-label="More"
        onClick={() => onPanel("more")}
      >
        <MoreIcon />
      </button>
    </div>
  );
}

function FocusPanel({
  focus,
  now,
  minutes,
  task,
  onMinutes,
  onTask,
  onStart,
  onPause,
  onResume,
  onStop,
  onOpen,
}: {
  focus: Focus;
  now: number;
  minutes: number;
  task: string | null;
  onMinutes: (minutes: number) => void;
  onTask: (task: string | null) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpen: () => void;
}) {
  if (focus.durationMs > 0) {
    const progress = Math.min(1, Math.max(0, 1 - focusLeftMs(focus, now) / focus.durationMs));
    return (
      <div className="bar-panel bar-surface">
        <div className="bar-panel-head">
          <ToolGlyph tool="focus" size={18} />
          <span>Focus</span>
          {!focus.running ? <span className="bar-muted bar-push">paused</span> : null}
        </div>
        {focus.session ? <p className="bar-text bar-ellipsis">{focus.session}</p> : null}
        <div className="bar-big-clock">{focusClock(focus, now)}</div>
        <div className="bar-progress" aria-hidden>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="bar-actions">
          {focus.running ? (
            <button type="button" className="bar-action" onClick={onPause}>
              <PauseIcon />
              Pause
            </button>
          ) : (
            <button type="button" className="bar-action" onClick={onResume}>
              <PlayIcon />
              Resume
            </button>
          )}
          <button type="button" className="bar-action" onClick={onStop}>
            <StopIcon />
            Stop
          </button>
          <button type="button" className="bar-action" title="Open focus in owntools" onClick={onOpen}>
            <OpenIcon />
            Open
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bar-panel bar-surface">
      <div className="bar-panel-head">
        <ToolGlyph tool="focus" size={18} />
        <span>Focus session</span>
      </div>
      <div className="bar-chips lengths" role="radiogroup" aria-label="Length">
        {FOCUS_CHOICES.map((m) => (
          <button
            key={m}
            type="button"
            className="bar-chip"
            role="radio"
            aria-checked={m === minutes}
            onClick={() => onMinutes(m)}
          >
            {m} min
          </button>
        ))}
      </div>
      <div className="bar-label">Working on</div>
      <div className="bar-chips" role="radiogroup" aria-label="Working on">
        <button type="button" className="bar-chip" role="radio" aria-checked={task === null} onClick={() => onTask(null)}>
          No task
        </button>
        {TASKS.map((t) => (
          <button
            key={t}
            type="button"
            className="bar-chip bar-chip-task"
            role="radio"
            aria-checked={task === t}
            title={t}
            onClick={() => onTask(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <button type="button" className="bar-primary" data-demo="focus-start" onClick={onStart}>
        Start {minutes} min
      </button>
    </div>
  );
}

function MeetPanel({
  meet,
  now,
  onStart,
  onPause,
  onResume,
  onStop,
  onOpen,
}: {
  meet: Meet;
  now: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpen: () => void;
}) {
  const phase = meet.phase;
  if (meetLive(meet)) {
    const title =
      phase === "starting" ? "Starting…" : phase === "stopping" ? "Saving…" : phase === "paused" ? "Paused" : "Recording";
    return (
      <div className="bar-panel bar-surface">
        <div className="bar-panel-head">
          <RecDot phase={phase} />
          <span>{title}</span>
          <span className="bar-muted bar-clock bar-push">{meetClock(meet, now)}</span>
        </div>
        <p className="bar-text">Your microphone and this computer&apos;s sound, transcribed on this device.</p>
        <div className="bar-actions">
          {phase === "paused" ? (
            <button type="button" className="bar-action" onClick={onResume}>
              <PlayIcon />
              Resume
            </button>
          ) : (
            <button type="button" className="bar-action" onClick={onPause} disabled={phase !== "recording"}>
              <PauseIcon />
              Pause
            </button>
          )}
          <button
            type="button"
            className="bar-action danger"
            onClick={onStop}
            disabled={phase === "starting" || phase === "stopping"}
          >
            <StopIcon />
            Stop
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="bar-panel bar-surface">
      <div className="bar-panel-head">
        <ToolGlyph tool="meet" size={18} />
        <span>Meeting notes</span>
      </div>
      <p className="bar-text">
        {phase === "finished"
          ? "Saved. The transcript and a summary are waiting in owntools."
          : "Records your microphone and this computer's sound, and writes the transcript on this device."}
      </p>
      {phase === "finished" ? (
        <button type="button" className="bar-action" onClick={onOpen}>
          <OpenIcon />
          Open the notes
        </button>
      ) : null}
      <button type="button" className="bar-primary" data-demo="meet-start" onClick={onStart}>
        {phase === "finished" ? "Record another" : "Start recording"}
      </button>
    </div>
  );
}

function MorePanel({
  captureKey,
  onScreenshot,
  onClose,
  onHide,
}: {
  captureKey: string;
  onScreenshot: () => void;
  onClose: () => void;
  onHide: () => void;
}) {
  return (
    <div className="bar-panel bar-menu bar-surface" role="menu">
      <button type="button" className="bar-menu-item" role="menuitem" onClick={onScreenshot}>
        <span className="bar-menu-icon">
          <ToolGlyph tool="capture" size={17} />
        </span>
        Screenshot
        <kbd>{captureKey}</kbd>
      </button>
      <button type="button" className="bar-menu-item" role="menuitem" onClick={onClose}>
        <span className="bar-menu-icon">
          <Sail size={13} />
        </span>
        Open owntools
      </button>
      <button type="button" className="bar-menu-item" role="menuitem" onClick={onClose}>
        <span className="bar-menu-icon">
          <SettingsIcon />
        </span>
        Bar settings
      </button>
      <span className="bar-menu-sep" aria-hidden />
      <button type="button" className="bar-menu-item" role="menuitem" onClick={onHide}>
        <span className="bar-menu-icon">
          <HideIcon />
        </span>
        Hide the bar
      </button>
    </div>
  );
}

/** The dictation pill as the bar draws it (DictationPill.tsx, `embedded`). */
function TakePill({ take, onDone }: { take: Take; onDone: () => void }) {
  const listening = take.phase === "listening";
  const wide = take.partial !== "";
  return (
    <div className={`bd-pill bar-surface${listening ? " listening" : ""}${wide ? " wide" : ""}`} role="status">
      <div className="bd-pill-row">
        <span className={`bd-pill-dot ${listening ? "rec" : "busy"}`} />
        {listening ? (
          <>
            <span>Listening</span>
            <LevelMeter speaking={take.speaking} />
            <span className="bd-pill-hint">english · live · esc cancels</span>
            <button type="button" className="bar-pill-done" data-demo="done" onClick={onDone}>
              Done
            </button>
          </>
        ) : (
          <span style={{ flex: 1, textAlign: wide ? "left" : "center" }}>{wide ? "Finishing…" : "Transcribing…"}</span>
        )}
      </div>
      {wide ? (
        <div className="bd-partial">
          {take.partial}
          {take.speaking || !listening ? <span style={{ opacity: 0.5 }}> …</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The pill's level meter, moving the way a voice does (and nearly still between words). */
function LevelMeter({ speaking }: { speaking: boolean }) {
  const [level, setLevel] = useState(0.04);
  useEffect(() => {
    let t = 0;
    const id = window.setInterval(() => {
      t += 1;
      setLevel(
        speaking
          ? 0.28 + 0.62 * Math.abs(Math.sin(t * 0.9) * Math.cos(t * 0.37))
          : 0.02 + 0.03 * Math.abs(Math.sin(t * 0.7)),
      );
    }, 90);
    return () => window.clearInterval(id);
  }, [speaking]);
  return (
    <span className="bd-meter" aria-hidden>
      <span style={{ width: `${Math.min(100, Math.round(level * 100))}%`, background: level > 0.06 ? "#32d74b" : "#febc2e" }} />
    </span>
  );
}

function RecButton({
  title,
  on,
  onClick,
  children,
}: {
  title: string;
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="bd-rec-btn" data-on={!!on} title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}

/** The recorder's live bar (RecorderOverlay.tsx); the bar steps aside while it is up. */
function Recorder({
  recording,
  elapsedMs,
  onPause,
  onRestart,
  onEnd,
  onMore,
  onMute,
}: {
  recording: Recording;
  elapsedMs: number;
  onPause: () => void;
  onRestart: () => void;
  onEnd: () => void;
  onMore: () => void;
  onMute: () => void;
}) {
  const { paused, more, muted } = recording;
  return (
    <div className="bd-rec" role="group" aria-label="Screen recording">
      <div className="bd-rec-left">
        <span className={`bd-rec-dot${paused ? " off" : ""}`} aria-hidden />
        <span className={`bd-rec-time${paused ? " off" : ""}`}>{recorderTime(elapsedMs)}</span>
        {muted ? <span className="bd-rec-flag">muted</span> : null}
      </div>
      <div className="bd-rec-right">
        {more ? (
          <>
            <RecButton title={muted ? "Unmute microphone" : "Mute microphone"} on={muted} onClick={onMute}>
              <RecMicIcon muted={muted} />
            </RecButton>
            <RecButton title="Open recordings folder" onClick={onMore}>
              <RecFolderIcon />
            </RecButton>
            <RecButton title="Close the recorder (discards this take)" onClick={onEnd}>
              <RecCloseIcon />
            </RecButton>
            <RecButton title="Back" onClick={onMore}>
              <RecBackIcon />
            </RecButton>
          </>
        ) : (
          <>
            <RecButton title={paused ? "Resume" : "Pause"} on={paused} onClick={onPause}>
              {paused ? <RecPlayIcon /> : <RecPauseIcon />}
            </RecButton>
            <RecButton title="Restart this take" onClick={onRestart}>
              <RecRestartIcon />
            </RecButton>
            <RecButton title="Delete this take" onClick={onEnd}>
              <RecTrashIcon />
            </RecButton>
            <RecButton title="More" onClick={onMore}>
              <RecDotsIcon />
            </RecButton>
            <button type="button" className="bd-rec-stop" title="Stop and open the editor" onClick={onEnd}>
              <RecStopIcon />
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
