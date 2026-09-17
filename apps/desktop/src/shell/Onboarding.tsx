import { useEffect, useState } from "react";
import { SUITE_NAME } from "@core/branding";
import { isMac, isTauri } from "@core/env";
import { logError } from "@core/errors";
import { CAPTURE_HOTKEY_LABEL, DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import { BrandMark } from "@ui/BrandMark";
import { ToolGlyph } from "@ui/ToolMark";
import { greetFromBar } from "./barBridge";
import { THEMES } from "@feature-focus/lib/themes";
import { useAppStore } from "@feature-focus/store/useAppStore";
import {
  defaultInstallModel,
  dictationStatus,
  ENGINE,
  formatBytes,
  runtimeFor,
} from "@feature-dictation/engine";
import {
  installPercent,
  pauseInstall,
  startInstall,
  useInstallSession,
  type InstallSession,
} from "@feature-dictation/install";

const FLAG = "owntools-onboarded";

/** brand → nine tools → theme → your data, your call → the bar */
const STEPS = [0, 1, 2, 3, 4] as const;
const LAST = STEPS[STEPS.length - 1];

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return true;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    /* */
  }
}

/** whisper.cpp plus the recommended model — what "Install engine now" fetches. */
/**
 * How big the one-time speech download is, for the platform we are on:
 * whisper plus its model on Windows, Parakeet plus its model on a Mac
 * (whisper has no macOS build — see docs/macos.md).
 */
const DEFAULT_SPEECH_MODEL = defaultInstallModel();
const ENGINE_DOWNLOAD_BYTES =
  (runtimeFor(DEFAULT_SPEECH_MODEL.engine)?.bytes ?? ENGINE.bytes) +
  DEFAULT_SPEECH_MODEL.bytes;

/** All nine, one sentence each; dictate spans the row because it carries the engine download. */
const TOOL_ROWS = [
  {
    name: "dictate",
    desc: `Press ${DICTATION_HOTKEY_LABEL}, speak, press again: an on-device model types in any app. A one-time ${formatBytes(ENGINE_DOWNLOAD_BYTES)} download.`,
  },
  { name: "screeni", desc: "Screen recordings that zoom in on your clicks." },
  { name: "capture", desc: `${CAPTURE_HOTKEY_LABEL}: grab part of the screen, copy its text.` },
  { name: "meet", desc: "A call transcribed on this machine, notes after." },
  { name: "focus", desc: "Timer, tasks, notes and habits." },
  { name: "launch", desc: "A URL becomes a short video." },
  { name: "board", desc: "An endless whiteboard." },
  { name: "social", desc: "Posts scheduled to 30+ networks." },
  { name: "disk", desc: "Where the space went." },
];

const SHORTCUTS = [
  { keys: DICTATION_HOTKEY_LABEL, desc: "Dictate in any app, bar or no bar" },
  { keys: CAPTURE_HOTKEY_LABEL, desc: "Screenshot part of the screen" },
  { keys: "Ctrl+K", desc: "Quick note or task, in focus" },
];

async function enableAutostart(): Promise<void> {
  useAppStore.getState().updateSettings({ autostart: true });
  if (!isTauri()) return;
  try {
    const plugin = await import("@tauri-apps/plugin-autostart");
    await plugin.enable();
  } catch (err) {
    logError("onboarding", "autostart", err);
  }
}

/** "Engine · 3 MB / 8 MB" and a per-step percentage for the bar. */
function describeInstall(session: InstallSession): { text: string; percent: number | null } {
  const { progress } = session;
  if (!progress) return { text: "Preparing…", percent: null };
  const what = progress.step === "engine" ? "Engine" : "Model";
  const of = progress.total ? ` / ${formatBytes(progress.total)}` : "";
  return { text: `${what} · ${formatBytes(progress.loaded)}${of}`, percent: installPercent(progress) };
}

function InstallBar({ percent }: { percent: number | null }) {
  return (
    <span className={`onb-bar${percent === null ? " indeterminate" : ""}`} aria-hidden>
      <span style={{ width: percent === null ? undefined : `${percent}%` }} />
    </span>
  );
}

/**
 * "Install engine now" under the dictate row: the same download dictate
 * offers on first open, started from here so it runs while the rest of
 * onboarding is read. The session lives outside React
 * (feature-dictation/install.ts), so it keeps going after "start" and the
 * dictate view picks it up mid-download instead of offering it again.
 */
function EngineSetup() {
  const session = useInstallSession();
  /** null = not checked yet, or not the desktop app (nothing to offer). */
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    dictationStatus()
      .then((s) => {
        if (alive) setReady(Boolean(s?.engine && s.models.length > 0));
      })
      .catch(() => {
        if (alive) setReady(false);
      });
    return () => {
      alive = false;
    };
  }, [session.generation]);

  if (ready === null) return null;

  if (ready) {
    return (
      <div className="onb-engine">
        <span className="onb-engine-ok">
          ✓ engine ready — {DICTATION_HOTKEY_LABEL} works in any app.
        </span>
      </div>
    );
  }

  if (session.installing) {
    const { text, percent } = describeInstall(session);
    return (
      <div className="onb-engine" aria-live="polite">
        <div className="onb-engine-row">
          <InstallBar percent={percent} />
          <button
            className="onb-btn ghost"
            disabled={session.cancelling}
            onClick={() => void pauseInstall()}
          >
            {session.cancelling ? "Pausing…" : "Pause"}
          </button>
        </div>
        <span className="onb-engine-hint">
          {text} · keeps downloading while you finish setup, even after you press start.
        </span>
      </div>
    );
  }

  const label = session.error
    ? "Try again"
    : session.notice
      ? "Resume download"
      : "Install engine now";
  return (
    <div className="onb-engine">
      <div className="onb-engine-row">
        <button className="onb-btn" onClick={() => void startInstall()}>
          {label}
        </button>
        <span className="onb-engine-hint">
          {DEFAULT_SPEECH_MODEL.family} + its engine, {formatBytes(ENGINE_DOWNLOAD_BYTES)} once — resumes if
          interrupted.
        </span>
      </div>
      {session.notice ? <span className="onb-engine-hint">{session.notice}</span> : null}
      {session.error ? <span className="onb-engine-err">{session.error}</span> : null}
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const theme = useAppStore((s) => s.settings.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [step, setStep] = useState(0);
  // Default on; a re-run of onboarding starts from whatever is set already so
  // "skip" never flips a choice the user made earlier.
  const [tracking, setTracking] = useState<boolean>(
    () => useAppStore.getState().settings.usageTracking !== false,
  );
  const install = useInstallSession();
  // Asked on the last step, next to what it keeps running; ticked there, but
  // only applied by "start" on that step — skipping past it enables nothing.
  const [autostart, setAutostart] = useState<boolean>(() => {
    const current = useAppStore.getState().settings.autostart;
    return current !== false || !isOnboarded();
  });

  // Both "start" and "skip" land here: the native side gets one explicit
  // tracking decision exactly when onboarding ends (App.tsx holds the initial
  // push back until then), so nothing is sampled before the user has seen this.
  const finish = (fromLastStep = false) => {
    useAppStore.getState().setUsageTracking(tracking);
    if (fromLastStep && autostart && !useAppStore.getState().settings.autostart) void enableAutostart();
    markOnboarded();
    onDone();
    // The bar opens by itself once, over this window, and says what it is.
    void greetFromBar();
  };

  const next = () => (step === LAST ? finish(true) : setStep(step + 1));

  // The engine download started on the tools step stays visible on the
  // later steps as a slim strip, so nobody wonders whether it is still going.
  const strip = install.installing && step !== 1 ? describeInstall(install) : null;

  return (
    <div className="onb" role="dialog" aria-label="Welcome">
      <div className="onb-scenery" aria-hidden>
        <span className="scene-sky-a" />
        <span className="scene-sky-b" />
        <span className="scene-hill-a" />
        <span className="scene-hill-b" />
      </div>

      <div className="onb-card wincard">
        <div className="wincard-bar">
          <span className="wincard-dot r" />
          <span className="wincard-dot y" />
          <span className="wincard-dot g" />
          <span className="wincard-title">welcome.app</span>
        </div>

        <div className="onb-body">
          {step === 0 ? (
            <>
              <div className="onb-brand">
                <BrandMark size={30} filled />
                <div className="onb-word">{SUITE_NAME}</div>
              </div>
              <p className="onb-lead">everything you say, record and write — kept on this device.</p>
              <ul className="onb-list">
                <li>No accounts, no cloud — everything stays on this device.</li>
                <li>Nine tools, one desk: dictation, recording, screenshots, a quiet desk, launch videos, call transcripts, a whiteboard, a social scheduler, a disk analyzer.</li>
                <li>Workspaces are sessions: one click opens your apps, links and timer.</li>
                <li>Free to use; Pro unlocks watermark-free exports.</li>
              </ul>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 className="onb-title">one desk, nine tools</h2>
              <div className="onb-tools compact">
                {TOOL_ROWS.map((t) => (
                  <div key={t.name} className={`onb-tool${t.name === "dictate" ? " wide" : ""}`}>
                    <span className="onb-tool-name">{t.name}</span>
                    <span className="onb-tool-desc">{t.desc}</span>
                    {t.name === "dictate" ? <EngineSetup /> : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 className="onb-title">make it yours</h2>
              <p className="onb-lead">Pick a vibe — you can change it anytime from the titlebar.</p>
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-card${theme === t.id ? " active" : ""}`}
                    onClick={() => setTheme(t.id)}
                  >
                    <span className="theme-swatch" aria-hidden>
                      {t.swatch.map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="theme-card-name">{t.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h2 className="onb-title">your data, your call</h2>
              <p className="onb-lead">
                Everything you write, say and record stays on this device. Two features reach
                outside the app, and you decide about them here.
              </p>
              <div className="onb-tools">
                <label className="onb-tool" style={{ cursor: "pointer" }}>
                  <span
                    className="onb-tool-name"
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={tracking}
                      onChange={(e) => setTracking(e.target.checked)}
                    />
                    Track time in apps and on websites
                  </span>
                  <span className="onb-tool-desc">
                    Reads the title of the active window and, for browsers, the site host every 2
                    seconds, so focus can show where your day went. Only on this device — nothing is
                    sent anywhere. Turn it off any time in Settings → Privacy.
                  </span>
                </label>
                <div className="onb-tool">
                  <span className="onb-tool-name">Scroll guard</span>
                  <span className="onb-tool-desc">
                    Installs system-wide keyboard and mouse hooks only while you arm it for a task,
                    and removes them the moment it is disarmed or the task is done. Off until you
                    turn it on.
                  </span>
                </div>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <h2 className="onb-title">your bar</h2>
              <p className="onb-lead">
                A small bar waits at the bottom of the screen: dictate, record, start a focus session or take
                meeting notes, whatever app is in front.
              </p>
              <div className="onb-bar-demo" aria-hidden>
                <BrandMark size={20} filled />
                <span className="onb-bar-demo-sep" />
                <span>
                  <ToolGlyph tool="dictate" size={16} />
                  Dictate
                </span>
                <span>
                  <ToolGlyph tool="screeni" size={16} />
                  Record
                </span>
                <span>
                  <ToolGlyph tool="focus" size={16} />
                  Focus
                </span>
                <span>
                  <ToolGlyph tool="meet" size={16} />
                  Meeting
                </span>
              </div>
              <p className="onb-bar-demo-note">
                It rests as a small capsule and steps aside in full screen. Drag it anywhere; hide it from its menu
                and the tray icon brings it back.
              </p>
              <div className="onb-keys">
                {SHORTCUTS.map((s) => (
                  <div key={s.keys} className="onb-key-row">
                    <kbd>{s.keys}</kbd>
                    <span>{s.desc}</span>
                  </div>
                ))}
              </div>
              {isTauri() ? (
                <label className="onb-check">
                  <input type="checkbox" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} />
                  <span>
                    Start owntools {isMac() ? "when you log in" : "with Windows"}, so the bar and the shortcuts are
                    there after a restart
                  </span>
                </label>
              ) : null}
            </>
          ) : null}
        </div>

        {strip ? (
          <div className="onb-strip" aria-live="polite">
            <InstallBar percent={strip.percent} />
            <span>
              dictation engine · {strip.text}
              {strip.percent !== null ? ` · ${strip.percent}%` : ""}
            </span>
          </div>
        ) : null}

        <div className="onb-foot">
          <button className="onb-skip" onClick={() => finish()}>
            skip
          </button>
          <div className="onb-dots" aria-hidden>
            {STEPS.map((i) => (
              <span key={i} className={i === step ? "on" : ""} />
            ))}
          </div>
          <button className="onb-next" onClick={next}>
            {step === LAST ? "start" : "next"}
          </button>
        </div>
      </div>
    </div>
  );
}
