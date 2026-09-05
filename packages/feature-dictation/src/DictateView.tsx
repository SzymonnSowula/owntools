import { useEffect, useRef, useState } from "react";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { isTauri } from "@core/env";
import { DICTATION_HOTKEY_HINT, DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import {
  clearDictationContext,
  createDictationRecorder,
  dictate,
  dictationHotkeyRegistered,
  dictationStatus,
  DEFAULT_MODEL_FILE,
  ENGINE,
  formatBytes,
  getDictationContext,
  getDictationSettings,
  modelByFile,
  openDictationMic,
  removeModel,
  saveDictationSettings,
  WHISPER_MODELS,
  type DictationLang,
  type DictationQuality,
  type DictationSettings,
  type DictationStatus,
} from "./engine";
import { installPercent, pauseInstall, startInstall, useInstallSession } from "./install";

const QUALITY_HINTS: Record<DictationQuality, string> = {
  fast: "Greedy decoding — quickest, most typos.",
  balanced: "Beam search (whisper's default). Best trade-off.",
  accurate: "Wider beam — a bit slower, steadier on hard audio.",
};

export default function DictateView() {
  const [status, setStatus] = useState<DictationStatus | null>(null);
  // The install itself is a module-level session (install.ts): a download
  // started from onboarding shows up here, still running, instead of being
  // offered again.
  const { installing, progress, cancelling, notice, error: installError, generation } =
    useInstallSession();
  /** Errors from this view's own actions (removing a model). */
  const [error, setError] = useState<string | null>(null);
  /** null = unknown / not Tauri; false = another app owns the hotkey. */
  const [hotkeyOk, setHotkeyOk] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<DictationSettings>(getDictationSettings());
  const [testState, setTestState] = useState<"idle" | "recording" | "working">("idle");
  const [testResult, setTestResult] = useState("");
  const [contextTail, setContextTail] = useState("");
  const testRec = useRef<MediaRecorder | null>(null);

  const refresh = () => void dictationStatus().then(setStatus).catch(() => setStatus(null));
  // On mount and after every finished install attempt — the session may also
  // have adopted the first model, so the settings are re-read as well.
  useEffect(() => {
    refresh();
    setSettings(getDictationSettings());
  }, [generation]);

  useEffect(() => {
    let alive = true;
    void dictationHotkeyRegistered().then((ok) => {
      if (alive) setHotkeyOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const installed = status?.models ?? [];
  const ready = Boolean(status?.engine && installed.length > 0);
  const activeModel = settings.model || installed[0] || "";

  function update(patch: Partial<DictationSettings>) {
    setSettings(saveDictationSettings(patch));
  }

  function install(modelFile: string) {
    setError(null);
    void startInstall(modelFile);
  }

  function cancel() {
    void pauseInstall();
  }

  async function drop(modelFile: string) {
    try {
      await removeModel(modelFile);
      if (settings.model === modelFile) update({ model: "" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the model.");
    }
  }

  async function toggleTest() {
    if (testState === "recording") {
      testRec.current?.stop();
      return;
    }
    setTestResult("");
    try {
      const mic = await openDictationMic();
      const rec = createDictationRecorder(mic);
      testRec.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        mic.getTracks().forEach((t) => t.stop());
        setTestState("working");
        void dictate(new Blob(chunks, { type: rec.mimeType }))
          .then((text) => setTestResult(text || "(nothing was heard)"))
          .catch((err) => setTestResult(`Error: ${err instanceof Error ? err.message : err}`))
          .finally(() => {
            setContextTail(getDictationContext());
            setTestState("idle");
          });
      };
      rec.start(200);
      setTestState("recording");
    } catch {
      setTestResult("Microphone unavailable — check the permission in Windows settings.");
    }
  }

  const installingModel = installing ? modelByFile(installing) : undefined;
  const percent = installPercent(progress);
  const installPanel = installing ? (
    <div className="mt-3 rounded-[10px] border border-line px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full bg-teal transition-[width] ${progress ? "" : "animate-pulse"}`}
              style={{ width: percent !== null ? `${percent}%` : progress ? "50%" : "100%" }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {progress
              ? `${progress.step === "engine" ? "Engine" : "Model"} · ${formatBytes(progress.loaded)}${
                  progress.total ? ` / ${formatBytes(progress.total)}` : ""
                }`
              : `Preparing${installingModel ? ` · ${installingModel.label} · ${installingModel.size}` : ""}`}
            {" · resumes if interrupted"}
          </p>
        </div>
        <button
          className="btn btn-secondary btn-sm shrink-0"
          disabled={cancelling}
          onClick={() => void cancel()}
        >
          {cancelling ? "Pausing…" : "Cancel"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="desktop-bg flex min-h-0 flex-1 justify-center overflow-y-auto px-8 py-10">
      <div className="w-full max-w-2xl pb-10">
        <h1 className="text-[38px] font-bold leading-none tracking-[-0.05em] text-ink">dictate</h1>
        <p className="mt-2 text-sm text-muted">
          In any app, {DICTATION_HOTKEY_HINT} — the words are typed into whatever you're working
          in; on the board they become a text box. Speech never leaves this computer.
        </p>

        {hotkeyOk === false ? (
          <div
            className="mt-4 rounded-[10px] border px-3 py-2 text-xs text-ink"
            style={{
              borderColor: "var(--color-coral)",
              background: "color-mix(in srgb, var(--color-coral) 8%, transparent)",
            }}
          >
            {DICTATION_HOTKEY_LABEL} is taken by another app, so dictation from other apps will not
            start until that app releases it.
          </div>
        ) : null}

        <div className="wincard mt-6" style={{ boxShadow: "0 12px 30px rgba(17,17,17,0.08)" }}>
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.dictate} />
            <span className="wincard-title">engine &amp; models</span>
          </div>
          <div className="wincard-body">
            {!isTauri() ? (
              <p className="text-sm text-muted">Dictation runs in the desktop app.</p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  {ready
                    ? "The bigger the model, the better it handles accents, jargon and inflected languages. Models sit side by side — pick one below."
                    : `One-time setup: downloads whisper.cpp (${formatBytes(ENGINE.bytes)}) plus the model you pick. Downloads resume if interrupted, and everything runs offline afterwards.`}
                </p>

                <div className="mt-4 flex flex-col gap-2">
                  {WHISPER_MODELS.map((model) => {
                    const here = installed.includes(model.file);
                    const active = here && activeModel === model.file;
                    return (
                      <div
                        key={model.id}
                        className="flex items-start gap-3 rounded-[10px] border px-3 py-2.5"
                        style={{
                          borderColor: active ? "var(--color-accent)" : "var(--color-line)",
                          background: active ? "color-mix(in srgb, var(--color-accent) 6%, transparent)" : undefined,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            {model.label}
                            <span className="text-xs font-normal text-muted">{model.size}</span>
                            {model.file === DEFAULT_MODEL_FILE ? (
                              <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                                recommended
                              </span>
                            ) : null}
                            {active ? (
                              <span className="rounded-full bg-teal px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                in use
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-muted">{model.note}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {here ? (
                            <>
                              {!active ? (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => update({ model: model.file })}
                                >
                                  Use
                                </button>
                              ) : null}
                              <button
                                className="btn btn-ghost btn-sm text-muted"
                                title="Delete this model"
                                onClick={() => void drop(model.file)}
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={installing !== null}
                              onClick={() => void install(model.file)}
                            >
                              {installing === model.file ? "Installing…" : "Install"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {installPanel}
                {notice ? <p className="mt-2 text-xs text-muted">{notice}</p> : null}
                {installError ? <p className="mt-2 text-xs text-coral">{installError}</p> : null}
                {error ? <p className="mt-2 text-xs text-coral">{error}</p> : null}
                {installed.some((f) => !modelByFile(f)) ? (
                  <p className="mt-3 text-xs text-muted">
                    Other models found in {status?.dir}: {installed.filter((f) => !modelByFile(f)).join(", ")}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="wincard mt-5" style={{ boxShadow: "0 12px 30px rgba(17,17,17,0.08)" }}>
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.dictate} />
            <span className="wincard-title">recognition</span>
          </div>
          <div className="wincard-body">
            <label className="flex items-center justify-between text-sm">
              Language
              <select
                className="rounded-lg border border-line bg-white px-2 py-1 text-sm"
                value={settings.lang}
                onChange={(e) => update({ lang: e.target.value as DictationLang })}
              >
                <option value="auto">Auto-detect</option>
                <option value="en">English</option>
                <option value="pl">Polski</option>
              </select>
            </label>
            <p className="mt-1.5 text-xs text-muted">
              Naming the language beats auto-detect on short takes — a two-second phrase is
              often too little for whisper to guess from.
            </p>

            <label className="mt-4 flex items-center justify-between text-sm">
              Decoding
              <select
                className="rounded-lg border border-line bg-white px-2 py-1 text-sm"
                value={settings.quality}
                onChange={(e) => update({ quality: e.target.value as DictationQuality })}
              >
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="accurate">Accurate</option>
              </select>
            </label>
            <p className="mt-1.5 text-xs text-muted">{QUALITY_HINTS[settings.quality]}</p>

            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.cleanup}
                onChange={(e) => update({ cleanup: e.target.checked })}
              />
              <span>
                Clean up the result
                <span className="block text-xs text-muted">
                  Drops <code>[BLANK_AUDIO]</code>, subtitle boilerplate ("Napisy stworzone
                  przez…") and repeated-word loops whisper invents out of silence.
                </span>
              </span>
            </label>

            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.useSessionContext}
                onChange={(e) => update({ useSessionContext: e.target.checked })}
              />
              <span>
                Carry context between takes
                <span className="block text-xs text-muted">
                  The tail of what you just dictated is fed back in, so names, tense and
                  terminology stay consistent across a paragraph.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="wincard mt-5" style={{ boxShadow: "0 12px 30px rgba(17,17,17,0.08)" }}>
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.dictate} />
            <span className="wincard-title">vocabulary &amp; context</span>
          </div>
          <div className="wincard-body">
            <p className="text-sm text-muted">
              Whisper guesses unfamiliar words from sound alone. Tell it what you talk about and
              it stops turning names and terms into nonsense.
            </p>

            <label className="mt-4 block text-sm font-medium">
              Words it keeps getting wrong
              <textarea
                className="mt-1.5 w-full rounded-[10px] border border-line bg-white px-3 py-2 text-sm"
                rows={3}
                placeholder="Kubernetes, PostgreSQL, Anna Nowak, Rzeszów"
                value={settings.vocabulary}
                onChange={(e) => update({ vocabulary: e.target.value })}
              />
            </label>
            <p className="mt-1 text-xs text-muted">
              Comma- or line-separated. Also used to fix spelling afterwards, so write each term
              exactly the way you want it typed.
            </p>

            <label className="mt-4 block text-sm font-medium">
              What you usually dictate about
              <textarea
                className="mt-1.5 w-full rounded-[10px] border border-line bg-white px-3 py-2 text-sm"
                rows={2}
                placeholder="Meeting notes and emails about a software project: sprints, customers, invoices."
                value={settings.context}
                onChange={(e) => update({ context: e.target.value })}
              />
            </label>
            <p className="mt-1 text-xs text-muted">
              A plain sentence works best — it primes the decoder the same way the previous
              sentence of a paragraph would.
            </p>
          </div>
        </div>

        {ready ? (
          <div className="wincard mt-5" style={{ boxShadow: "0 12px 30px rgba(17,17,17,0.08)" }}>
            <div className="wincard-bar">
              <WinDots icon={ToolIcons.dictate} />
              <span className="wincard-title">try it</span>
            </div>
            <div className="wincard-body">
              <div className="flex flex-wrap items-center gap-3">
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
                {contextTail ? (
                  <button
                    className="btn btn-ghost text-muted"
                    onClick={() => {
                      clearDictationContext();
                      setContextTail("");
                    }}
                  >
                    Forget carried context
                  </button>
                ) : null}
              </div>
              {testResult ? (
                <p className="mt-3 rounded-[10px] border border-line bg-paper px-3 py-2 text-sm">
                  {testResult}
                </p>
              ) : null}
              {contextTail ? (
                <p className="mt-2 text-xs text-muted">
                  Carried into the next take: “{contextTail.slice(-120)}”
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted">
                The test only shows the transcript here. From any other app,{" "}
                <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[11px]">
                  {DICTATION_HOTKEY_LABEL}
                </kbd>{" "}
                types the words for you.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
