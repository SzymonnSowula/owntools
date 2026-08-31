import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import {
  dictationStatus,
  getDictationLang,
  installDictation,
  setDictationLang,
  transcribeBlob,
  type DictationLang,
  type DictationStatus,
  type InstallProgress,
} from "./engine";

function fmtMB(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export default function DictateView() {
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<DictationLang>(getDictationLang());
  const [testState, setTestState] = useState<"idle" | "recording" | "working">("idle");
  const [testResult, setTestResult] = useState("");
  const testRec = useRef<MediaRecorder | null>(null);

  const refresh = () => void dictationStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(refresh, []);

  const ready = Boolean(status?.engine && status?.model);

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      await installDictation(setProgress);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }

  async function toggleTest() {
    if (testState === "recording") {
      testRec.current?.stop();
      return;
    }
    setTestResult("");
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(mic);
      testRec.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        mic.getTracks().forEach((t) => t.stop());
        setTestState("working");
        void transcribeBlob(new Blob(chunks, { type: rec.mimeType }), lang)
          .then((text) => setTestResult(text || "(silence)"))
          .catch((err) => setTestResult(`Error: ${err instanceof Error ? err.message : err}`))
          .finally(() => setTestState("idle"));
      };
      rec.start(200);
      setTestState("recording");
    } catch {
      setTestResult("Microphone unavailable.");
    }
  }

  return (
    <div className="desktop-bg flex min-h-0 flex-1 justify-center overflow-y-auto px-8 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-[38px] font-bold leading-none tracking-[-0.05em] text-ink">dictate</h1>
        <p className="mt-2 text-sm text-muted">
          Press <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-xs">Ctrl+Shift+Space</kbd>{" "}
          anywhere, speak, press it again — the words are typed into whatever app you're in.
          Speech never leaves this computer.
        </p>

        <div className="wincard mt-6" style={{ boxShadow: "0 12px 30px rgba(17,17,17,0.08)" }}>
          <div className="wincard-bar">
            <span className="wincard-dot r" />
            <span className="wincard-dot y" />
            <span className="wincard-dot g" />
            <span className="wincard-title">engine</span>
          </div>
          <div className="wincard-body">
            {!isTauri() ? (
              <p className="text-sm text-muted">Dictation runs in the desktop app.</p>
            ) : ready ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-teal" />
                Whisper engine and model installed — dictation is live.
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted">
                  One-time setup: downloads whisper.cpp (~8 MB) and the multilingual base model
                  (~148 MB) into your app data. Everything runs offline afterwards.
                </p>
                {progress ? (
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full bg-teal transition-[width]"
                        style={{
                          width: progress.total
                            ? `${Math.round((progress.loaded / progress.total) * 100)}%`
                            : "50%",
                        }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {progress.step === "engine" ? "Engine" : "Model"} · {fmtMB(progress.loaded)}
                      {progress.total ? ` / ${fmtMB(progress.total)}` : ""}
                    </p>
                  </div>
                ) : null}
                {error ? <p className="mt-2 text-xs text-coral">{error}</p> : null}
                <button
                  className="btn btn-primary mt-4"
                  disabled={installing}
                  onClick={() => void install()}
                >
                  {installing ? "Downloading…" : "Download engine + model"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="wincard mt-5" style={{ boxShadow: "0 12px 30px rgba(17,17,17,0.08)" }}>
          <div className="wincard-bar">
            <span className="wincard-dot r" />
            <span className="wincard-dot y" />
            <span className="wincard-dot g" />
            <span className="wincard-title">settings</span>
          </div>
          <div className="wincard-body">
            <label className="flex items-center justify-between text-sm">
              Language
              <select
                className="rounded-lg border border-line bg-white px-2 py-1 text-sm"
                value={lang}
                onChange={(e) => {
                  const v = e.target.value as DictationLang;
                  setLang(v);
                  setDictationLang(v);
                }}
              >
                <option value="auto">Auto-detect</option>
                <option value="en">English</option>
                <option value="pl">Polski</option>
              </select>
            </label>
            <p className="mt-2 text-xs text-muted">
              The hotkey works system-wide while the app runs in the tray.
            </p>
          </div>
        </div>

        {ready ? (
          <div className="wincard mt-5" style={{ boxShadow: "0 12px 30px rgba(17,17,17,0.08)" }}>
            <div className="wincard-bar">
              <span className="wincard-dot r" />
              <span className="wincard-dot y" />
              <span className="wincard-dot g" />
              <span className="wincard-title">try it</span>
            </div>
            <div className="wincard-body">
              <div className="flex items-center gap-3">
                <button className="btn btn-secondary" onClick={() => void toggleTest()}>
                  {testState === "recording"
                    ? "Stop & transcribe"
                    : testState === "working"
                      ? "Transcribing…"
                      : "Record a test"}
                </button>
                {testState === "recording" ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-coral" />
                ) : null}
              </div>
              {testResult ? (
                <p className="mt-3 rounded-[10px] border border-line bg-paper px-3 py-2 text-sm">
                  {testResult}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
