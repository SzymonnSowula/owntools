import { BookA, Copy, Keyboard, Mic, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { DICTATION_HOTKEY_LABEL, microphoneHelp } from "@core/hotkeys";
import { Alert, Card, copyToClipboard, Kbd, PageHead } from "../components";
import {
  clearDictationContext,
  createDictationRecorder,
  dictate,
  getDictationContext,
  openDictationMic,
  PARAKEET_V3_ID,
  accessibilityStatus,
  lastDictationTiming,
  requestAccessibility,
  resolveActiveModel,
  type AccessibilityStatus,
  type DictationTiming,
  type EngineStatus,
} from "../engine";
import { VendorMark } from "../VendorMark";
import { countWords } from "../history";
import { useInstallSession, startInstall } from "../install";
import { useDictationSettings } from "../useSettings";
import { isReplacement } from "../vocabulary";
import { useHistory } from "./HistoryPage";
import type { Page } from "../DictateView";

type TestState = "idle" | "recording" | "working";

const LANG_LABEL = { auto: "auto-detect", en: "English", pl: "Polski" } as const;
const QUALITY_LABEL = { fast: "fast", balanced: "balanced", accurate: "accurate" } as const;

/** The "try it" recorder: mic → whisper → text, with a live level bar. */
function useTestRecorder() {
  const [state, setState] = useState<TestState>("idle");
  const [result, setResult] = useState("");
  const [timing, setTiming] = useState<DictationTiming | null>(null);
  const [level, setLevel] = useState(0);
  const [contextTail, setContextTail] = useState(() => getDictationContext());
  const rec = useRef<MediaRecorder | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const startedAt = useRef(0);

  function stopMeter() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    setLevel(0);
  }

  function startMeter(mic: MediaStream) {
    try {
      const ac = new AudioContext();
      ctx.current = ac;
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      ac.createMediaStreamSource(mic).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel((prev) => Math.max(rms * 4, prev * 0.82));
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch {
      /* the meter is cosmetic */
    }
  }

  useEffect(
    () => () => {
      stopMeter();
      if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    },
    [],
  );

  async function toggle() {
    if (state === "recording") {
      rec.current?.stop();
      return;
    }
    setResult("");
    setTiming(null);
    try {
      const mic = await openDictationMic();
      const recorder = createDictationRecorder(mic);
      rec.current = recorder;
      startMeter(mic);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        mic.getTracks().forEach((t) => t.stop());
        stopMeter();
        setState("working");
        const durationMs = Date.now() - startedAt.current;
        void dictate(new Blob(chunks, { type: recorder.mimeType }), { durationMs })
          .then((text) => setResult(text || "(nothing was heard)"))
          .catch((err) => setResult(`Error: ${err instanceof Error ? err.message : err}`))
          .finally(() => {
            setContextTail(getDictationContext());
            setTiming(lastDictationTiming());
            setState("idle");
          });
      };
      startedAt.current = Date.now();
      recorder.start(200);
      setState("recording");
    } catch {
      setResult(microphoneHelp());
    }
  }

  function forgetContext() {
    clearDictationContext();
    setContextTail("");
  }

  return { state, result, timing, level, contextTail, toggle, forgetContext };
}

export function OverviewPage({
  status,
  hotkeyOk,
  onNavigate,
}: {
  status: EngineStatus | null;
  hotkeyOk: boolean | null;
  onNavigate: (page: Page) => void;
}) {
  const [settings] = useDictationSettings();
  const takes = useHistory();
  const install = useInstallSession();
  const test = useTestRecorder();
  const [copied, setCopied] = useState(false);

  const native = isTauri();
  const active = resolveActiveModel(settings.model, status);
  const ready = active !== null;
  const activeLabel = active?.model?.label ?? active?.id ?? "—";
  const parakeet = active?.engine === "parakeet";

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = takes.filter((t) => t.at >= startOfToday.getTime());
  const wordsToday = today.reduce((n, t) => n + countWords(t.text), 0);
  const rules = settings.entries.filter(isReplacement).length;

  async function copyResult() {
    if (await copyToClipboard(test.result)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  const stateLabel = !native
    ? "Browser preview"
    : install.installing
      ? "Installing…"
      : ready
        ? "Ready to dictate"
        : "Not set up yet";
  // macOS only: whether the app may type into other applications. Read once
  // when the page mounts, and again from the button below — macOS gives no
  // notification when the user flips the switch in System Settings, and
  // polling for it would be a timer running forever for one banner.
  const [access, setAccess] = useState<AccessibilityStatus>("not-needed");
  useEffect(() => {
    let live = true;
    void accessibilityStatus().then((s) => {
      if (live) setAccess(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const dotClass = install.installing ? "busy" : ready && native ? "" : "off";

  return (
    <div className="dt-page">
      <PageHead
        title="dictate"
        sub={
          <>
            Press <Kbd>{DICTATION_HOTKEY_LABEL}</Kbd> in any app, speak, press again — the words are typed
            where you were working. The model runs on this computer; speech never leaves it.
          </>
        }
      />

      {access === "denied" ? (
        <Alert kind="warn" icon={<Keyboard />}>
          macOS has not let owntools type into other apps yet, so a take will land on the
          clipboard instead of in the window you were working in.{" "}
          <button
            className="dt-btn ghost sm"
            onClick={() => void requestAccessibility().then(setAccess)}
          >
            Open Accessibility settings
          </button>
        </Alert>
      ) : null}

      {hotkeyOk === false ? (
        <Alert kind="warn" icon={<Keyboard />}>
          {DICTATION_HOTKEY_LABEL} is taken by another app, so dictation from other apps will not start until
          that app releases it.
        </Alert>
      ) : null}

      <Card flush>
        <div className="dt-hero">
          <div>
            <div className="dt-hero-state">
              <span className={`dt-hero-dot ${dotClass}`} aria-hidden />
              {stateLabel}
            </div>
            <div className="dt-hero-meta">
              <span className="dt-hero-model">
                model{" "}
                {active?.model ? <VendorMark vendor={active.model.vendor} size={18} /> : null}
                <b>{activeLabel}</b>
              </span>
              <span>
                language <b>{parakeet ? "auto-detect · 25 languages" : LANG_LABEL[settings.lang]}</b>
              </span>
              <span>
                decoding <b>{parakeet ? "greedy · Parakeet" : QUALITY_LABEL[settings.quality]}</b>
              </span>
              <span>
                vocabulary <b>{settings.entries.length}</b>
                {rules ? ` (${rules} replacement${rules === 1 ? "" : "s"})` : ""}
              </span>
            </div>
          </div>
          <div className="dt-hero-actions">
            {native && !ready && !install.installing ? (
              <button
                className="dt-btn primary"
                onClick={() => {
                  void startInstall(PARAKEET_V3_ID);
                  onNavigate("models");
                }}
              >
                Install Parakeet · fastest
              </button>
            ) : null}
            {install.installing ? (
              <button className="dt-btn" onClick={() => onNavigate("models")}>
                Show download
              </button>
            ) : null}
            {ready ? (
              <button className="dt-btn" onClick={() => onNavigate("models")}>
                Change model
              </button>
            ) : null}
            <button className="dt-btn ghost sm" onClick={() => onNavigate("vocabulary")}>
              <BookA /> Vocabulary
            </button>
          </div>
        </div>
      </Card>

      <div className="dt-stats">
        <div className="dt-stat">
          <div className="dt-stat-value">{today.length}</div>
          <div className="dt-stat-label">{today.length === 1 ? "take" : "takes"} today</div>
        </div>
        <div className="dt-stat">
          <div className="dt-stat-value">{wordsToday}</div>
          <div className="dt-stat-label">words dictated today</div>
        </div>
        <div className="dt-stat">
          <div className="dt-stat-value">{settings.entries.length}</div>
          <div className="dt-stat-label">vocabulary {settings.entries.length === 1 ? "entry" : "entries"}</div>
        </div>
      </div>

      {ready ? (
        <Card
          title="Try it here"
          desc="The transcript shows below instead of being typed. From any other app the shortcut types for you."
          action={
            test.contextTail ? (
              <button className="dt-btn ghost sm" onClick={test.forgetContext} title="Drop the context carried between takes">
                <RotateCcw /> Forget context
              </button>
            ) : null
          }
        >
          <div className="dt-try">
            <button
              className={`dt-btn${test.state === "recording" ? " live" : " primary"}`}
              disabled={test.state === "working"}
              onClick={() => void test.toggle()}
            >
              {test.state === "recording" ? (
                <>
                  <Square /> Stop &amp; transcribe
                </>
              ) : test.state === "working" ? (
                "Transcribing…"
              ) : (
                <>
                  <Mic /> Record a test
                </>
              )}
            </button>
            {test.state === "recording" ? (
              <>
                <span className="dt-rec-dot" aria-hidden />
                <span className="dt-meter" aria-hidden>
                  <span
                    style={{
                      width: `${Math.min(100, Math.round(test.level * 100))}%`,
                      background: test.level > 0.06 ? undefined : "#febc2e",
                    }}
                  />
                </span>
                <span className="dt-note">listening — speak normally</span>
              </>
            ) : null}
            {test.result && test.state === "idle" ? (
              <button className="dt-btn ghost sm" onClick={() => void copyResult()} style={{ marginLeft: "auto" }}>
                <Copy /> {copied ? "Copied" : "Copy"}
              </button>
            ) : null}
          </div>
          {test.result ? (
            <div className={`dt-result${test.result.startsWith("(") ? " muted" : ""}`}>{test.result}</div>
          ) : null}
          {test.timing ? (
            <p className="dt-note" style={{ marginTop: 10 }}>
              {Math.round(test.timing.audioMs / 100) / 10}s of speech transcribed in{" "}
              <strong>{test.timing.ms} ms</strong>
              {test.timing.warm
                ? ""
                : " — the model had to load first; the next take skips that"}
              .
            </p>
          ) : null}
          {test.contextTail ? (
            <p className="dt-note" style={{ marginTop: 10 }}>
              Carried into the next take: “{test.contextTail.slice(-120)}”
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card flush>
        <div className="dt-steps">
          <div className="dt-step">
            <span className="dt-step-n">1</span>
            <div className="dt-step-t">Press the shortcut</div>
            <div className="dt-step-d">
              <Kbd>{DICTATION_HOTKEY_LABEL}</Kbd> from any app. A small pill shows it is listening.
            </div>
          </div>
          <div className="dt-step">
            <span className="dt-step-n">2</span>
            <div className="dt-step-t">Say it</div>
            <div className="dt-step-d">
              A sentence or a paragraph. Names from the vocabulary are recognised; phrases with a replacement
              become their text.
            </div>
          </div>
          <div className="dt-step">
            <span className="dt-step-n">3</span>
            <div className="dt-step-t">Press again</div>
            <div className="dt-step-d">
              The words are typed where the cursor was. <Kbd>Esc</Kbd> cancels a take.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
