/**
 * The main window's side of the bar (apps/desktop/src/bar).
 *
 * The focus timer, meet and the recorder live in this window, so the bar only
 * asks: every `bar-command` is done here, with the same store actions the
 * tools' own buttons use, and the state goes back as `bar-state` whenever
 * something the bar shows has changed. The bar counts its clocks down itself
 * from `endAt`, so a running timer is not re-sent on every tick.
 */
import {
  BAR_COMMAND_EVENT,
  BAR_HELLO_EVENT,
  BAR_STATE_EVENT,
  BAR_STATE_REQUEST_EVENT,
  IDLE_BAR_STATE,
  MEET_PHASE_EVENT,
  type BarCommand,
  type BarFocusState,
  type BarMeetState,
  type BarState,
  type MeetPhaseDetail,
} from "@core/bar";
import { isTauri } from "@core/env";
import { logError, logInfo } from "@core/errors";
import { toolLocked } from "@licensing/plan";
import { useAppStore } from "@feature-focus/store/useAppStore";
import type { Task } from "@feature-focus/types";
import { quietNextTakeover } from "./FocusTimerOverlay";
import { useShellStore, type Tool } from "./shellStore";

const TOOLS: readonly string[] = ["hub", "focus", "create", "capture", "launch", "dictate", "meet", "board", "social", "disk"];

let started = false;
let meet: BarMeetState = IDLE_BAR_STATE.meet;
let lastSent = "";

/** Tasks worth naming a session after: the most important first, then today's. */
function sessionTasks(tasks: readonly Task[]): string[] {
  const rank = (t: Task) => (t.mit ? 0 : t.listId === "today" ? 1 : 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const task of [...tasks].filter((t) => !t.done).sort((a, b) => rank(a) - rank(b))) {
    const title = task.title.trim().slice(0, 80);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
    if (out.length === 3) break;
  }
  return out;
}

function focusState(): BarFocusState {
  const { timer, tasks } = useAppStore.getState();
  return {
    running: timer.running,
    mode: timer.mode === "break" ? "break" : "focus",
    stopwatch: timer.preset === "stopwatch",
    endAt: timer.endAt ?? null,
    startedAt: timer.startedAt ?? null,
    remainingMs: timer.remainingMs,
    durationMs: timer.durationMs,
    session: timer.sessionName ?? "",
    tasks: sessionTasks(tasks),
  };
}

async function send(force = false): Promise<void> {
  const state: BarState = { focus: focusState(), meet };
  // A running clock changes `remainingMs` on every tick; the bar works from
  // `endAt` / `startedAt` then, so that alone is not news.
  const key = JSON.stringify({
    ...state,
    focus: { ...state.focus, remainingMs: state.focus.running ? 0 : state.focus.remainingMs },
  });
  if (!force && key === lastSent) return;
  lastSent = key;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("dictation", BAR_STATE_EVENT, state);
  } catch (err) {
    logError("bar", "state", err);
  }
}

function whenReady(): Promise<void> {
  if (useAppStore.getState().ready) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useAppStore.subscribe((s) => {
      if (!s.ready) return;
      off();
      resolve();
    });
  });
}

function startFocus(minutes: number, session: string): void {
  const store = useAppStore.getState();
  if (store.timer.running) store.pauseTimer();
  if (minutes === 25) store.setTimerPreset("25");
  else if (minutes === 50) store.setTimerPreset("50");
  else store.setCustomMinutes(minutes);
  store.setSessionName(session);
  // Started from the bar, over whatever app is in front: the owntools window
  // must not jump to full screen for it.
  quietNextTakeover();
  useAppStore.getState().startTimer();
  logInfo("bar", `focus session started from the bar (${minutes} min)`);
}

async function showMain(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("capture_show_main");
}

async function handle(command: BarCommand): Promise<void> {
  switch (command.kind) {
    case "focus-start":
      await whenReady();
      startFocus(Math.max(1, Math.round(command.minutes)), command.session);
      return;
    case "focus-pause": {
      const store = useAppStore.getState();
      if (store.timer.running) store.pauseTimer();
      return;
    }
    case "focus-resume": {
      const store = useAppStore.getState();
      if (store.timer.running) return;
      quietNextTakeover();
      store.startTimer();
      return;
    }
    case "focus-stop":
      useAppStore.getState().resetTimer();
      return;
    case "meet-start":
    case "meet-pause":
    case "meet-resume":
    case "meet-stop": {
      if (command.kind === "meet-start" && toolLocked("meet")) {
        // meet comes with Pro: the lock screen, not a capture that goes nowhere
        await handle({ kind: "open", tool: "meet" });
        return;
      }
      const { useMeetStore } = await import("@feature-meet/store");
      const store = useMeetStore.getState();
      if (command.kind === "meet-start") {
        if (store.phase === "finished") store.reset();
        await useMeetStore.getState().start();
      } else if (command.kind === "meet-pause") await store.pause();
      else if (command.kind === "meet-resume") await store.resume();
      else await store.stop();
      return;
    }
    case "record": {
      const { openRecorderOverlay } = await import("@core/recorderWindow");
      await openRecorderOverlay();
      return;
    }
    case "open": {
      await showMain();
      const shell = useShellStore.getState();
      if (command.section) shell.openSettings(command.section);
      else if (command.tool && TOOLS.includes(command.tool)) shell.setTool(command.tool as Tool);
      return;
    }
  }
}

/** Starts listening to the bar. Once per app start; nothing to do outside Tauri. */
export function startBarBridge(): void {
  if (started || !isTauri()) return;
  started = true;

  window.addEventListener(MEET_PHASE_EVENT, (e) => {
    meet = (e as CustomEvent<MeetPhaseDetail>).detail ?? IDLE_BAR_STATE.meet;
    void send();
  });

  useAppStore.subscribe((s, prev) => {
    if (s.timer !== prev.timer || s.tasks !== prev.tasks) void send();
  });

  void (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<BarCommand>(BAR_COMMAND_EVENT, (event) => {
      const command = event.payload;
      if (!command || typeof command !== "object" || !("kind" in command)) return;
      handle(command).catch((err) => logError("bar", command.kind, err));
    });
    await listen(BAR_STATE_REQUEST_EVENT, () => void whenReady().then(() => send(true)));
    await whenReady();
    await send(true);
  })().catch((err) => logError("bar", "bridge", err));
}

/** After the onboarding: the bar shows itself, open, and says what it is. */
export async function greetFromBar(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("dictation", BAR_HELLO_EVENT);
  } catch (err) {
    logError("bar", "hello", err);
  }
}
