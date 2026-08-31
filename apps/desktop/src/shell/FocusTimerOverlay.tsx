import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { formatMs } from "@feature-focus/lib/dates";
import { useAppStore } from "@feature-focus/store/useAppStore";

async function setOsFullscreen(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
  } catch {
    /* window may not support it — the in-app takeover still works */
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
  const [dismissed, setDismissed] = useState(false);
  const wasRunning = useRef(false);

  // A fresh start un-dismisses the takeover.
  useEffect(() => {
    if (timer.running && !wasRunning.current) setDismissed(false);
    wasRunning.current = timer.running;
  }, [timer.running]);

  const active =
    fullscreenPref && !dismissed && (timer.running || (timer.preset !== "stopwatch" && timer.remainingMs < timer.durationMs && timer.remainingMs > 0) || (timer.preset === "stopwatch" && timer.remainingMs > 0));

  useEffect(() => {
    if (!active) return;
    void setOsFullscreen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      void setOsFullscreen(false);
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
