import { OPEN_TOOL_EVENT } from "@core/handoff";
import { AlertTriangle, Circle, Info, Loader2, MessageSquare, Mic, Pause, Play, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Card, Meter, PageHead, Switch } from "../components";
import { formatClock } from "../lib/format";
import { speakerLabel } from "../lib/transcript";
import { useMeetSettings } from "../settings";
import { useMeetStore } from "../store";
import type { LiveLine } from "../types";
import { SummaryPanel } from "./SummaryPanel";

function openDictate() {
  window.dispatchEvent(new CustomEvent(OPEN_TOOL_EVENT, { detail: { tool: "dictate" } }));
}

/**
 * The call itself: Start / Pause / Stop with the clock, a meter per side,
 * the two-sided transcript filling in as each of you finishes a sentence,
 * and your own notes beside it. After Stop the session card becomes the
 * summary panel; the transcript and notes stay.
 */
export function LivePage() {
  const phase = useMeetStore((s) => s.phase);
  const elapsedMs = useMeetStore((s) => s.elapsedMs);
  const levels = useMeetStore((s) => s.levels);
  const lines = useMeetStore((s) => s.lines);
  const pending = useMeetStore((s) => s.pending);
  const transcribing = useMeetStore((s) => s.transcribing);
  const notes = useMeetStore((s) => s.notes);
  const error = useMeetStore((s) => s.error);
  const engine = useMeetStore((s) => s.engine);
  const devices = useMeetStore((s) => s.devices);
  const unavailable = useMeetStore((s) => s.unavailable);
  const finished = useMeetStore((s) => s.finished);
  const summary = useMeetStore((s) => s.summary);
  const { start, pause, resume, stop, reset, setNotes } = useMeetStore.getState();
  const [settings, update] = useMeetSettings();

  const recording = phase === "recording" || phase === "paused";
  const locked = recording || phase === "starting" || phase === "stopping";
  const noSource = !settings.mic && !settings.system;

  const stateText =
    phase === "starting"
      ? "opening the devices…"
      : phase === "recording"
        ? "recording"
        : phase === "paused"
          ? "paused"
          : phase === "stopping"
            ? pending > 0 || transcribing
              ? `finishing the transcript… ${pending + (transcribing ? 1 : 0)} left`
              : "saving…"
            : unavailable
              ? "not available here"
              : "ready";
  const dotClass = phase === "recording" ? "live" : phase === "paused" ? "paused" : phase === "starting" || phase === "stopping" ? "busy" : unavailable ? "off" : "ok";

  return (
    <div className="mt-page">
      <PageHead
        title="live"
        sub="Record any call on this machine - Zoom, Meet, Teams, a lecture in a browser tab - with a transcript that says who spoke. Mic and system audio, both on this device; nothing leaves it."
        actions={<EngineChip engine={engine} />}
      />

      {unavailable ? (
        <div className="mt-alert warn">
          <AlertTriangle />
          <div>{unavailable}</div>
        </div>
      ) : null}
      {engine && !engine.ready ? (
        <div className="mt-alert warn">
          <AlertTriangle />
          <div>
            No speech model is installed, so the call will be recorded without a transcript.{" "}
            <button type="button" className="mt-link" onClick={openDictate}>
              Install one in dictate → Models
            </button>
            .
          </div>
        </div>
      ) : engine && engine.ready && !engine.parakeet ? (
        <div className="mt-alert info">
          <Info />
          <div>
            Only whisper is installed. Parakeet transcribes a live call about 5× faster -{" "}
            <button type="button" className="mt-link" onClick={openDictate}>
              add it in dictate → Models
            </button>
            .
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="mt-alert error">
          <AlertTriangle />
          <div>{error}</div>
        </div>
      ) : null}

      {phase === "finished" && finished ? (
        <SummaryPanel meeting={finished} summary={summary} onNew={reset} />
      ) : (
        <section className={`mt-card mt-session${recording ? " recording" : ""}`}>
          <div className="mt-session-main">
            <div className="mt-session-state">
              <i className={`mt-dot ${dotClass}`} aria-hidden />
              {stateText}
            </div>
            <div className="mt-clock" aria-live="off">
              {formatClock(elapsedMs)}
            </div>
            <div className="mt-session-actions">
              {phase === "idle" ? (
                <button type="button" className="mt-btn primary big" onClick={() => void start()} disabled={!!unavailable || noSource}>
                  <Circle className="mt-rec-icon" /> Start recording
                </button>
              ) : phase === "starting" ? (
                <button type="button" className="mt-btn primary big" disabled>
                  <Loader2 className="mt-spin" /> Starting…
                </button>
              ) : phase === "recording" ? (
                <>
                  <button type="button" className="mt-btn big" onClick={() => void pause()}>
                    <Pause /> Pause
                  </button>
                  <button type="button" className="mt-btn danger big" onClick={() => void stop()}>
                    <Square /> Stop
                  </button>
                </>
              ) : phase === "paused" ? (
                <>
                  <button type="button" className="mt-btn primary big" onClick={() => void resume()}>
                    <Play /> Resume
                  </button>
                  <button type="button" className="mt-btn danger big" onClick={() => void stop()}>
                    <Square /> Stop
                  </button>
                </>
              ) : (
                <button type="button" className="mt-btn big" disabled>
                  <Loader2 className="mt-spin" /> Stopping…
                </button>
              )}
            </div>
            {noSource && phase === "idle" ? <div className="mt-note error">Turn on at least one source below.</div> : null}
          </div>

          <div className="mt-sources">
            <div className={`mt-source${settings.mic ? "" : " off"}`}>
              <div className="mt-source-head">
                <span className="mt-source-icon you">
                  <Mic />
                </span>
                <div className="mt-source-text">
                  <div className="mt-source-label">you</div>
                  <div className="mt-source-sub">microphone</div>
                </div>
                <Switch checked={settings.mic} onCheckedChange={(v) => update({ mic: v })} label="Record the microphone" disabled={locked} />
              </div>
              <Meter level={levels.mic} muted={!settings.mic || !recording || phase === "paused"} label="Your level" />
              <select
                className="mt-select mt-device"
                value={settings.micDevice}
                onChange={(e) => update({ micDevice: e.target.value })}
                disabled={locked || !settings.mic}
                aria-label="Microphone device"
              >
                <option value="">Default microphone</option>
                {(devices?.inputs ?? [])
                  .filter((d) => !d.default || settings.micDevice === d.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className={`mt-source${settings.system ? "" : " off"}`}>
              <div className="mt-source-head">
                <span className="mt-source-icon them">
                  <Volume2 />
                </span>
                <div className="mt-source-text">
                  <div className="mt-source-label">them</div>
                  <div className="mt-source-sub">system audio</div>
                </div>
                <Switch checked={settings.system} onCheckedChange={(v) => update({ system: v })} label="Record the system audio" disabled={locked} />
              </div>
              <Meter level={levels.system} muted={!settings.system || !recording || phase === "paused"} label="Their level" />
              <div className="mt-source-note">
                {devices?.outputs.find((o) => o.default)?.name ?? "Whatever plays through the speakers or headphones"}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="mt-split">
        <Card
          title="Transcript"
          desc={
            phase === "idle" && !lines.length
              ? "Lines appear here as each of you finishes a sentence."
              : undefined
          }
          action={<TranscriptStatus phase={phase} pending={pending} transcribing={transcribing} count={lines.filter((l) => !l.pending).length} />}
          flush
          className="mt-transcript-card"
        >
          <Transcript lines={lines} phase={phase} />
        </Card>
        <Card title="Your notes" desc="Only yours - typed, not transcribed." className="mt-notes-card">
          <textarea
            className="mt-textarea mt-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Things to remember, questions to ask, what you promised…"
            spellCheck
          />
        </Card>
      </div>
    </div>
  );
}

function EngineChip({ engine }: { engine: { ready: boolean; parakeet: boolean; whisper: boolean } | null }) {
  if (!engine) return null;
  const label = engine.parakeet ? "Parakeet" : engine.whisper ? "whisper" : "no model";
  return <span className={`mt-badge ${engine.ready ? "ok" : "line"}`}>{label}</span>;
}

function TranscriptStatus({ phase, pending, transcribing, count }: { phase: string; pending: number; transcribing: boolean; count: number }) {
  if (transcribing || pending > 0) {
    const n = pending + (transcribing ? 1 : 0);
    return (
      <span className="mt-status busy">
        <Loader2 className="mt-spin" /> transcribing… {n > 1 ? `${n - 1} queued` : ""}
      </span>
    );
  }
  if (phase === "recording") return <span className="mt-status live">listening</span>;
  if (phase === "paused") return <span className="mt-status">paused</span>;
  if (count) return <span className="mt-status">{count} lines</span>;
  return null;
}

function Transcript({ lines, phase }: { lines: LiveLine[]; phase: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!lines.length) {
    return (
      <div className="mt-transcript-empty">
        <MessageSquare />
        <div>{phase === "recording" ? "Listening - the first line lands a moment after someone stops talking." : phase === "paused" ? "Paused." : "Nothing yet."}</div>
      </div>
    );
  }
  return (
    <div
      className="mt-transcript"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {lines.map((line) => (
        <TranscriptLine key={`${line.source}-${line.startMs}`} line={line} />
      ))}
    </div>
  );
}

export function TranscriptLine({
  line,
  active,
  onClick,
}: {
  line: LiveLine;
  active?: boolean;
  onClick?: () => void;
}): ReactNode {
  const who = speakerLabel(line.source);
  const body = (
    <>
      <span className="mt-line-meta">
        <span className="mt-line-who">{who}</span>
        <span className="mt-line-time">{formatClock(line.startMs)}</span>
      </span>
      <span className={`mt-bubble${line.pending ? " pending" : ""}`}>
        {line.pending ? (
          <span className="mt-dots" aria-label="transcribing">
            <i />
            <i />
            <i />
          </span>
        ) : (
          line.text
        )}
      </span>
    </>
  );
  const className = `mt-line ${who}${active ? " active" : ""}${onClick ? " clickable" : ""}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={`Play from ${formatClock(line.startMs)}`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
