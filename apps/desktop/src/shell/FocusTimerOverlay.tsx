import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { formatMs } from "@feature-focus/lib/dates";
import { useAppStore } from "@feature-focus/store/useAppStore";

type TauriWindow = { isFullscreen(): Promise<boolean>; setFullscreen(on: boolean): Promise<void> };

async function currentWindow(): Promise<TauriWindow | null> {
  if (!isTauri()) return null;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * Full-screen focus session. Appears when the timer starts (if the user keeps
 * "fullscreen" on), leaves instantly on Esc / ✕ — the session keeps running
 * in the background either way.
 */
export function FocusTimerOverlay() {
  const timer = useAppStore((s) => s.timer);
  const fullscreenPref = useAppStore((s) => s.settings.timerFullscreen);
  const toggleTimer = useAppStore((s) => s.toggleTimer);
  const resetTimer = useAppStore((s) => s.resetTimer);
  // Starts dismissed: a session restored from disk must never cover the hub
  // on launch. Only a start happening in THIS app session shows the takeover.
  const [dismissed, setDismissed] = useState(true);
  const wasRunning = useRef(false);

  // A fresh start un-dismisses the takeover.
  useEffect(() => {
    if (timer.running && !wasRunning.current) setDismissed(false);
    wasRunning.current = timer.running;
  }, [timer.running]);

  const active =
    fullscreenPref && !dismissed && (timer.running || (timer.preset !== "stopwatch" && timer.remainingMs < timer.durationMs && timer.remainingMs > 0) || (timer.preset === "stopwatch" && timer.remainingMs > 0));

  // The takeover is only a real takeover when the OS window goes full screen
  // too — otherwise it just fills the app window. Needs
  // `core:window:allow-set-fullscreen` in src-tauri/capabilities/default.json.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let leaveFullscreen: (() => Promise<void>) | null = null;

    void (async () => {
      const win = await currentWindow();
      if (!win || cancelled) return;
      try {
        // Already full screen (user pressed F11) — leave the window as we found it.
        if (await win.isFullscreen()) return;
        await win.setFullscreen(true);
        if (cancelled) {
          await win.setFullscreen(false);
          return;
        }
        leaveFullscreen = () => win.setFullscreen(false);
      } catch (err) {
        console.warn("[focus] could not enter OS full screen", err);
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey, true);
      void leaveFullscreen?.().catch(() => {});
    };
  }, [active]);

  if (!active) return null;

  const isStopwatch = timer.preset === "stopwatch";
  const progress =
    !isStopwatch && timer.durationMs > 0 ? 1 - timer.remainingMs / timer.durationMs : 0;

  return (
    <div className="timer-overlay" role="dialog" aria-label="Focus session">
      <button className="timer-overlay-exit" onClick={() => setDismissed(true)} title="Exit full screen (Esc)">
        ✕
      </button>
      <div className="timer-overlay-kicker">
        {isStopwatch ? "stopwatch" : timer.mode === "break" ? "break" : "deep focus"}
      </div>
      <div className="timer-overlay-time">{formatMs(timer.remainingMs)}</div>
      {timer.sessionName ? <div className="timer-overlay-name">{timer.sessionName}</div> : null}
      {!isStopwatch ? (
        <div className="timer-overlay-bar">
          <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      ) : null}
      <div className="timer-overlay-actions">
        <button className="timer-overlay-btn primary" onClick={toggleTimer}>
          {timer.running ? "Pause" : "Resume"}
        </button>
        <button className="timer-overlay-btn" onClick={resetTimer}>
          Reset
        </button>
        <button className="timer-overlay-btn" onClick={() => setDismissed(true)}>
          Background mode
        </button>
      </div>
      <div className="timer-overlay-hint">Esc leaves full screen — the session keeps running</div>
    </div>
  );
}
