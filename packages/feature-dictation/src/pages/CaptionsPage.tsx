import { Captions, Languages, MonitorSpeaker, MousePointerClick } from "lucide-react";
import { useState } from "react";
import { isTauri } from "@core/env";
import { Alert, Card, PageHead, Row, Segmented, Switch } from "../components";
import { MAX_FONT, MIN_FONT, type CaptionSource } from "../captions/captions";
import { hideCaptions, restartCaptions, showCaptions } from "../captions/captionsControl";
import { useCaptionsRunning, useCaptionsSettings } from "../captions/useCaptionsSettings";
import { resolveActiveModel, type EngineStatus } from "../engine";
import { useDictationSettings } from "../useSettings";

type SourceChoice = "system" | "mic" | "both";

function toChoice(sources: CaptionSource[]): SourceChoice {
  if (sources.length === 2) return "both";
  return sources[0] === "mic" ? "mic" : "system";
}

function fromChoice(choice: SourceChoice): CaptionSource[] {
  return choice === "both" ? ["system", "mic"] : [choice];
}

/**
 * dictate → Captions: live subtitles for what the computer plays and/or what
 * the mic hears, in the always-on-top `captions` window. This page starts
 * and stops the capture and holds the same settings the overlay's gear does.
 */
export function CaptionsPage({ status }: { status: EngineStatus | null }) {
  const [settings, update] = useCaptionsSettings();
  const [dictation] = useDictationSettings();
  const running = useCaptionsRunning();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const native = isTauri();
  const whisperReady = Boolean(status?.engine && status.models.length);
  const active = resolveActiveModel(dictation.model, status);
  const parakeet = active?.engine === "parakeet";
  const ready = native ? active !== null : true;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (running) await hideCaptions();
      else await showCaptions(settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function setSources(choice: SourceChoice) {
    const sources = fromChoice(choice);
    update({ sources });
    void restartCaptions({ ...settings, sources }).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }

  return (
    <div className="dt-page">
      <PageHead
        title="captions"
        sub="Live subtitles for whatever is playing — a call, a lecture, a video — and for what you say. Each utterance is transcribed on this computer the moment it ends and its audio is deleted; nothing is recorded."
        actions={
          <button className={`dt-btn ${running ? "live" : "primary"}`} disabled={busy || !ready} onClick={() => void toggle()}>
            <Captions /> {running ? "Hide captions" : "Show captions"}
          </button>
        }
      />

      {!ready ? (
        <Alert kind="warn" icon={<Captions />}>
          Captions need a speech model. Install one in Models first.
        </Alert>
      ) : null}

      {error ? (
        <Alert kind="error" icon={<Captions />}>
          Captions could not start: {error}
        </Alert>
      ) : null}

      {!native ? (
        <Alert kind="info" icon={<Captions />}>
          Browser preview: “Show captions” opens the overlay in a new tab with demo lines. The real capture runs in the
          desktop app.
        </Alert>
      ) : null}

      <Card title="Live captions" flush>
        <Row
          label={running ? "Showing" : "Hidden"}
          hint={
            running
              ? "The overlay sits at the bottom of your screen, above every window. Drag its bar to move it."
              : "Shows a small always-on-top overlay with the last few lines."
          }
        >
          <span className={`dt-badge ${running ? "ok" : "line"}`}>{running ? "live" : "off"}</span>
        </Row>
        <Row
          label="Listen to"
          hint="System audio is what your speakers play — the other side of a call, a video. The mic is you. Both mixes them into one stream of lines."
        >
          <Segmented<SourceChoice>
            label="Sources"
            value={toChoice(settings.sources)}
            onChange={setSources}
            options={[
              { value: "system", label: "System" },
              { value: "mic", label: "Mic" },
              { value: "both", label: "Both" },
            ]}
          />
        </Row>
        <Row
          label="Translate to English"
          hint={
            whisperReady || !native
              ? "Every line is translated as it is transcribed. Whisper does this; it is a little slower than plain captions."
              : parakeet
                ? "Translation is a Whisper feature and Parakeet is the model in use. Install a Whisper model in Models to translate; plain captions work with Parakeet."
                : "Translation needs a Whisper model. Install one in Models."
          }
        >
          <Switch
            label="Translate to English"
            checked={settings.translate && (whisperReady || !native)}
            disabled={native && !whisperReady}
            onCheckedChange={(translate) => update({ translate })}
          />
        </Row>
        <Row label="Text size" hint="Line height in pixels. The overlay grows upwards to fit.">
          <span className="dt-row-ctl">
            <button
              className="dt-btn sm"
              aria-label="Smaller text"
              disabled={settings.fontSize <= MIN_FONT}
              onClick={() => update({ fontSize: settings.fontSize - 2 })}
            >
              −
            </button>
            <span className="dt-num">{settings.fontSize}</span>
            <button
              className="dt-btn sm"
              aria-label="Larger text"
              disabled={settings.fontSize >= MAX_FONT}
              onClick={() => update({ fontSize: settings.fontSize + 2 })}
            >
              +
            </button>
          </span>
        </Row>
        <Row label="Lines on screen" hint="Older lines fade; after nine seconds of silence they go.">
          <Segmented<"2" | "3">
            label="Lines"
            value={String(settings.lines) as "2" | "3"}
            onChange={(v) => update({ lines: Number(v) })}
            options={[
              { value: "2", label: "2" },
              { value: "3", label: "3" },
            ]}
          />
        </Row>
        <Row
          label="Click-through"
          hint="The overlay ignores the mouse, so you can click whatever is under it. Its gear and × stop working — turn it off here."
        >
          <Switch
            label="Click-through"
            checked={settings.clickThrough}
            onCheckedChange={(clickThrough) => update({ clickThrough })}
          />
        </Row>
      </Card>

      <Card flush>
        <div className="dt-steps">
          <div className="dt-step">
            <span className="dt-step-n">
              <MonitorSpeaker style={{ width: 12, height: 12 }} />
            </span>
            <div className="dt-step-t">Captured natively</div>
            <div className="dt-step-d">
              System sound is taken from the audio device itself (WASAPI loopback on Windows), so it works with any
              app — no browser tab, no virtual cable.
            </div>
          </div>
          <div className="dt-step">
            <span className="dt-step-n">
              <Languages style={{ width: 12, height: 12 }} />
            </span>
            <div className="dt-step-t">Cut on pauses</div>
            <div className="dt-step-d">
              Speech is split where the speaker breathes (0.4 s) and never runs past 8 s, so a line lands about a
              second after the words.
            </div>
          </div>
          <div className="dt-step">
            <span className="dt-step-n">
              <MousePointerClick style={{ width: 12, height: 12 }} />
            </span>
            <div className="dt-step-t">Yours to place</div>
            <div className="dt-step-d">
              Drag the bar anywhere; the gear on it has the same switches as this page. Nothing leaves this computer.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
