/**
 * What the bar draws: the capsule, the full bar, and the small widgets that
 * open from it. No logic beyond formatting — BarWindow owns state, the window
 * and what every click does.
 */
import { useState, type PointerEventHandler, type ReactNode } from "react";
import {
  FOCUS_CHOICES,
  focusActive,
  focusClockMs,
  focusProgress,
  formatClock,
  formatMinutes,
  meetElapsedMs,
  type BarFocusState,
  type BarMeetState,
  type BarState,
} from "@core/bar";
import { CAPTURE_HOTKEY_LABEL, DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import { BrandMark } from "@ui/BrandMark";
import { ToolGlyph } from "@ui/ToolMark";
import { HideIcon, MoreIcon, OpenIcon, PauseIcon, PlayIcon, SettingsIcon, StopIcon } from "./icons";

export type BarPanel = "focus" | "meet" | "more";

export interface DragHandlers {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
}

/** A meeting is being captured (or is about to start or finish saving). */
export function meetLive(meet: BarMeetState): boolean {
  return meet.phase === "starting" || meet.phase === "recording" || meet.phase === "paused" || meet.phase === "stopping";
}

/**
 * A session's clock, the same in the capsule and in the bar: it counts down
 * second by second (a capsule that read "25 min" for a whole minute looked
 * stuck), and a paused one keeps its time on show, dimmed.
 */
function FocusClock({ focus, now }: { focus: BarFocusState; now: number }) {
  const time = formatClock(focusClockMs(focus, now));
  return (
    <span className={`bar-clock${focus.running ? "" : " bar-muted"}`}>
      {focus.mode === "break" ? `Break ${time}` : time}
    </span>
  );
}

/** The same session for a screen reader, without a number that changes every second. */
function focusLabel(focus: BarFocusState, now: number): string {
  const left = formatMinutes(focusClockMs(focus, now));
  if (focus.stopwatch) return `Stopwatch, ${left}${focus.running ? "" : ", paused"}`;
  const what = focus.mode === "break" ? "Break" : "Focus session";
  return `${what}, ${left} left${focus.running ? "" : ", paused"}`;
}

function RecDot({ phase }: { phase: BarMeetState["phase"] }) {
  return <span className={`bar-dot${phase === "recording" ? "" : " off"}`} aria-hidden />;
}

/** The resting bar: small, quiet, and the only thing that says a recording is running. */
export function Capsule({
  state,
  now,
  onOpen,
  drag,
}: {
  state: BarState;
  now: number;
  onOpen: () => void;
  drag: DragHandlers;
}) {
  let content: ReactNode;
  let label = "owntools bar";
  if (meetLive(state.meet)) {
    const clock = formatClock(meetElapsedMs(state.meet, now));
    label = `Meeting recording, ${clock}`;
    content = (
      <>
        <RecDot phase={state.meet.phase} />
        <span className="bar-clock">{clock}</span>
      </>
    );
  } else if (focusActive(state.focus)) {
    label = focusLabel(state.focus, now);
    content = (
      <>
        <ToolGlyph tool="focus" size={14} />
        <FocusClock focus={state.focus} now={now} />
      </>
    );
  } else {
    content = (
      <>
        <BrandMark size={11} />
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
    <button type="button" className="bar-capsule bar-surface" aria-label={label} onClick={onOpen} {...drag}>
      {content}
    </button>
  );
}

export function BarRow({
  state,
  now,
  panel,
  download,
  onMark,
  onDictate,
  onRecord,
  onPanel,
  drag,
  locked = false,
}: {
  state: BarState;
  now: number;
  panel: BarPanel | null;
  download: number | null;
  /** No Pro key in this install: only Dictate acts, the rest lead to the plans. */
  locked?: boolean;
  onMark: () => void;
  onDictate: () => void;
  onRecord: () => void;
  onPanel: (panel: BarPanel) => void;
  drag: DragHandlers;
}) {
  const focusOn = focusActive(state.focus);
  const live = meetLive(state.meet);
  const proNote = locked ? " · Pro" : "";
  return (
    <div className="bar-row bar-surface" {...drag}>
      <button type="button" className="bar-btn bar-mark" title="Open owntools" aria-label="Open owntools" onClick={onMark}>
        <BrandMark size={24} filled />
      </button>
      <span className="bar-sep" aria-hidden />
      <button type="button" className="bar-btn" title={`Dictate · ${DICTATION_HOTKEY_LABEL}`} onClick={onDictate}>
        <ToolGlyph tool="dictate" size={18} />
        Dictate
        {download !== null ? <span className="bar-muted bar-clock">{download}%</span> : null}
      </button>
      <button type="button" className="bar-btn" title={`Record the screen${proNote}`} onClick={onRecord}>
        <ToolGlyph tool="screeni" size={18} />
        Record
      </button>
      <button
        type="button"
        className="bar-btn"
        data-on={panel === "focus"}
        title={`Focus session${proNote}`}
        onClick={() => onPanel("focus")}
      >
        <ToolGlyph tool="focus" size={18} />
        {focusOn ? <FocusClock focus={state.focus} now={now} /> : "Focus"}
      </button>
      <button
        type="button"
        className="bar-btn"
        data-on={panel === "meet"}
        title={`Meeting notes${proNote}`}
        onClick={() => onPanel("meet")}
      >
        {live ? (
          <>
            <RecDot phase={state.meet.phase} />
            <span className="bar-clock">{formatClock(meetElapsedMs(state.meet, now))}</span>
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

/** Without a key: what the button is for, and the way to the plans. */
function ProPanel({
  tool,
  title,
  text,
  onOpen,
}: {
  tool: "focus" | "meet";
  title: string;
  text: string;
  onOpen: () => void;
}) {
  return (
    <div className="bar-panel bar-surface">
      <div className="bar-panel-head">
        <ToolGlyph tool={tool} size={18} />
        <span>{title}</span>
        <span className="bar-muted bar-push">Pro</span>
      </div>
      <p className="bar-text">{text}</p>
      <button type="button" className="bar-action" onClick={onOpen}>
        <OpenIcon />
        Get Pro in owntools
      </button>
    </div>
  );
}

export function FocusPanel({
  focus,
  now,
  minutes,
  onMinutes,
  onStart,
  onPause,
  onResume,
  onStop,
  onOpen,
  locked = false,
}: {
  focus: BarFocusState;
  now: number;
  /** No Pro key in this install: say so instead of offering Start. */
  locked?: boolean;
  minutes: number;
  onMinutes: (minutes: number) => void;
  onStart: (minutes: number, session: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpen: () => void;
}) {
  const [task, setTask] = useState<string | null>(null);

  if (locked && !focusActive(focus)) {
    return (
      <ProPanel
        tool="focus"
        title="Focus session"
        text="Focus sessions come with owntools Pro. One key unlocks every tool; dictation stays free."
        onOpen={onOpen}
      />
    );
  }

  if (focusActive(focus)) {
    const title = focus.stopwatch ? "Stopwatch" : focus.mode === "break" ? "Break" : "Focus";
    return (
      <div className="bar-panel bar-surface">
        <div className="bar-panel-head">
          <ToolGlyph tool="focus" size={18} />
          <span>{title}</span>
          {!focus.running ? <span className="bar-muted bar-push">paused</span> : null}
        </div>
        {focus.session ? <p className="bar-text bar-ellipsis">{focus.session}</p> : null}
        <div className="bar-big-clock">{formatClock(focusClockMs(focus, now))}</div>
        {!focus.stopwatch ? (
          <div className="bar-progress" aria-hidden>
            <span style={{ width: `${Math.round(focusProgress(focus, now) * 100)}%` }} />
          </div>
        ) : null}
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
      {focus.tasks.length ? (
        <>
          <div className="bar-label">Working on</div>
          <div className="bar-chips" role="radiogroup" aria-label="Working on">
            <button type="button" className="bar-chip" role="radio" aria-checked={task === null} onClick={() => setTask(null)}>
              No task
            </button>
            {focus.tasks.map((t) => (
              <button
                key={t}
                type="button"
                className="bar-chip bar-chip-task"
                role="radio"
                aria-checked={task === t}
                title={t}
                onClick={() => setTask(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <button type="button" className="bar-primary" onClick={() => onStart(minutes, task ?? "")}>
        Start {minutes} min
      </button>
    </div>
  );
}

export function MeetPanel({
  meet,
  now,
  onStart,
  onPause,
  onResume,
  onStop,
  onOpen,
  locked = false,
}: {
  meet: BarMeetState;
  now: number;
  /** No Pro key in this install: say so instead of offering Start. */
  locked?: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpen: () => void;
}) {
  const phase = meet.phase;
  if (locked && !meetLive(meet)) {
    return (
      <ProPanel
        tool="meet"
        title="Meeting notes"
        text="Meeting notes come with owntools Pro. One key unlocks every tool; dictation stays free."
        onOpen={onOpen}
      />
    );
  }
  if (meetLive(meet)) {
    const title =
      phase === "starting" ? "Starting…" : phase === "stopping" ? "Saving…" : phase === "paused" ? "Paused" : "Recording";
    return (
      <div className="bar-panel bar-surface">
        <div className="bar-panel-head">
          <RecDot phase={phase} />
          <span>{title}</span>
          <span className="bar-muted bar-clock bar-push">{formatClock(meetElapsedMs(meet, now))}</span>
        </div>
        <p className="bar-text">Your microphone and this computer's sound, transcribed on this device.</p>
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
      {meet.error ? <p className="bar-text bar-err">{meet.error}</p> : null}
      {phase === "finished" ? (
        <button type="button" className="bar-action" onClick={onOpen}>
          <OpenIcon />
          Open the notes
        </button>
      ) : null}
      <button type="button" className="bar-primary" onClick={onStart}>
        {phase === "finished" ? "Record another" : "Start recording"}
      </button>
    </div>
  );
}

export function MorePanel({
  onScreenshot,
  onOpen,
  onSettings,
  onHide,
  locked = false,
}: {
  /** No Pro key in this install: Screenshot leads to capture's lock screen. */
  locked?: boolean;
  onScreenshot: () => void;
  onOpen: () => void;
  onSettings: () => void;
  onHide: () => void;
}) {
  return (
    <div className="bar-panel bar-menu bar-surface" role="menu">
      <button type="button" className="bar-menu-item" role="menuitem" onClick={onScreenshot}>
        <span className="bar-menu-icon">
          <ToolGlyph tool="capture" size={17} />
        </span>
        Screenshot
        <kbd>{locked ? "Pro" : CAPTURE_HOTKEY_LABEL}</kbd>
      </button>
      <button type="button" className="bar-menu-item" role="menuitem" onClick={onOpen}>
        <span className="bar-menu-icon">
          <BrandMark size={13} />
        </span>
        Open owntools
      </button>
      <button type="button" className="bar-menu-item" role="menuitem" onClick={onSettings}>
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

export function Tip({
  privateToCapture,
  onDismiss,
  locked = false,
}: {
  privateToCapture: boolean;
  onDismiss: () => void;
  /** No Pro key in this install: only dictation works from here. */
  locked?: boolean;
}) {
  return (
    <div className="bar-panel bar-tip bar-surface" role="status">
      <p className="bar-tip-title">Your bar</p>
      <p className="bar-text">
        {locked
          ? "Dictate from any app; recording, focus and meeting notes come with Pro."
          : "Dictate, record, focus and take meeting notes from any app."}{" "}
        Drag it anywhere. It steps aside in full screen
        {privateToCapture ? " and stays out of recordings and screen sharing." : "."}
      </p>
      <button type="button" className="bar-action" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}

export function Notice({ text }: { text: string }) {
  return (
    <div className="bar-notice bar-surface" role="status">
      {text}
    </div>
  );
}
