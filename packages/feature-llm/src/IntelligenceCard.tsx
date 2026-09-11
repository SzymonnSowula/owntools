import "./llm.css";
import { useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@core/env";
import {
  DEFAULT_CLOUD_MODELS,
  lastLlmTiming,
  llmBackendStatus,
  llmComplete,
  openIntelligenceSettings,
  type LlmBackendStatus,
  type LlmCloudSettings,
  type LlmSettings,
  type LlmStatus,
  type LlmTiming,
} from "@core/llm";
import { confirmDialog } from "@ui/Dialog";
import { installPercent, pauseInstall, startInstall, useInstallSession, type InstallSession } from "./install";
import { removeModel } from "./installer";
import {
  formatBytes,
  LLM_MODELS,
  LLM_RUNTIME,
  modelById,
  modelInstalled,
  modelReady,
  runtimeFor,
  VENDOR_NAMES,
  type LlmModel,
} from "./models";
import { useLlm, useLlmSettings } from "./useLlm";
import { VendorMark } from "./VendorMark";

/**
 * Settings → Intelligence: the one place a person decides which language
 * model every tool uses. Status hero, the two on-device models with
 * install / use / remove, the Auto / On-device / Cloud / Off switch, the
 * optional cloud provider, and "Try it", which prints the answer *and* what
 * it cost — so "is this thing working" is a number, not a feeling.
 *
 * Mounted by focus's SettingsView (`<IntelligenceCard />`), reached from any
 * tool through `openIntelligenceSettings()`; the root carries
 * `data-settings-section="intelligence"` for the shell to scroll to.
 */

const PREFER_OPTIONS: { value: LlmSettings["prefer"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "local", label: "On-device" },
  { value: "cloud", label: "Cloud" },
  { value: "off", label: "Off" },
];

const PROVIDER_NAMES: Record<LlmCloudSettings["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI-compatible",
};

const TRY_SYSTEM =
  "You are the language model inside owntools, a local-first desktop studio (dictation, screen recording, meeting notes, social posts). Answer in one short, plain sentence.";
const TRY_PROMPT = "Reply with one short sentence about what you can do for this person.";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="llm-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "active" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Progress({ percent }: { percent: number | null }) {
  return (
    <div className={`llm-progress${percent === null ? " indeterminate" : ""}`} aria-hidden>
      <span style={{ width: percent === null ? undefined : `${percent}%` }} />
    </div>
  );
}

function Badge({ kind, children }: { kind: "accent" | "line" | "ok"; children: ReactNode }) {
  return <span className={`llm-badge ${kind}`}>{children}</span>;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function modelLabel(id: string | null): string {
  if (!id) return "";
  return modelById(id)?.label ?? id;
}

interface Hero {
  dot: "ok" | "off" | "busy";
  title: string;
  sub: string;
}

/** The one line that says where things stand — exported for tests and the badge. */
export function describeStatus(
  status: LlmStatus | null,
  backend: LlmBackendStatus | null,
  session: InstallSession,
  timing: LlmTiming | null,
): Hero {
  if (session.installing) {
    const percent = installPercent(session.progress);
    const step = session.progress?.step === "runtime" ? "the runtime" : modelLabel(session.installing);
    return {
      dot: "busy",
      title: `Downloading ${step}…`,
      sub: `${percent === null ? "Starting" : `${percent}%`} · pinned and verified · resumes if interrupted`,
    };
  }
  if (!status) return { dot: "off", title: "Checking the model…", sub: "" };
  if (status.available && status.provider === "local") {
    const local = timing && timing.provider === "local" ? timing : null;
    const sub = local
      ? `${seconds(local.ms)} for the last answer${local.loadMs > 0 ? ` (${seconds(local.loadMs)} of it loading the model)` : ""} · runs offline`
      : backend?.server === "ready"
        ? "Loaded and waiting · runs offline"
        : backend?.server === "loading"
          ? "Loading into memory…"
          : "Loads on first use (a few seconds) · runs offline";
    return { dot: "ok", title: `On-device model ready · ${modelLabel(status.model)}`, sub };
  }
  const provider = status.provider;
  if (status.available && provider && provider !== "local") {
    return {
      dot: "ok",
      title: `Cloud model · ${PROVIDER_NAMES[provider]} · ${status.model ?? ""}`,
      sub: "Requests leave this machine and are listed in Settings → Privacy.",
    };
  }
  return { dot: "off", title: "No model yet", sub: status.reason ?? "" };
}

export default function IntelligenceCard() {
  const { status, refresh } = useLlm();
  const [settings, update] = useLlmSettings();
  const session = useInstallSession();
  const [backend, setBackend] = useState<LlmBackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // What is on disk, re-read whenever the status moves or an install ends.
  useEffect(() => {
    let live = true;
    void llmBackendStatus().then((b) => {
      if (live) setBackend(b);
    });
    return () => {
      live = false;
    };
  }, [status, session.generation]);

  const hero = describeStatus(status, backend, session, lastLlmTiming());
  const inApp = isTauri();
  const runtime = runtimeFor(backend?.arch ?? null);

  async function drop(model: LlmModel) {
    const ok = await confirmDialog({
      title: `Remove ${model.label}?`,
      message: `Deletes the ${model.size} model file from this device. You can download it again any time.`,
      okLabel: "Remove",
      kind: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await removeModel(model.id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the model.");
    }
  }

  return (
    <section className="card stack llm-card" data-settings-section="intelligence">
      <div className="llm-head">
        <div className="llm-head-text">
          <strong>Intelligence</strong>
          <p>
            One language model for every tool — meeting notes, post drafts, video chapters, tidy transcripts. On this device by
            default; a cloud provider only if you add one.
          </p>
        </div>
        <Segmented
          label="Which model to use"
          value={settings.prefer}
          options={PREFER_OPTIONS}
          onChange={(prefer) => update({ prefer })}
        />
      </div>

      <div className={`llm-hero${hero.dot === "off" ? " off" : ""}`} aria-live="polite">
        <span className={`llm-hero-dot ${hero.dot}`} />
        <div className="llm-hero-main">
          <div className="llm-hero-title">{hero.title}</div>
          {hero.sub ? <div className="llm-hero-sub">{hero.sub}</div> : null}
        </div>
      </div>

      <div className="llm-models">
        {LLM_MODELS.map((model) => {
          const here = modelInstalled(backend, model.id);
          const ready = modelReady(backend, model.id);
          const inUse = status?.provider === "local" && status.model === model.id;
          const chosen = settings.local.model === model.id;
          const busy = session.installing === model.id;
          return (
            <div key={model.id} className={`llm-model${inUse ? " active" : ""}`}>
              <VendorMark vendor={model.vendor} />
              <div className="llm-model-main">
                <div className="llm-model-name">
                  {model.label}
                  <span className="llm-model-size">{model.size}</span>
                  {model.tags.map((tag) => (
                    <Badge key={tag} kind={tag === "recommended" ? "accent" : "line"}>
                      {tag}
                    </Badge>
                  ))}
                  {inUse ? <Badge kind="accent">in use</Badge> : ready ? <Badge kind="ok">installed</Badge> : null}
                </div>
                <div className="llm-model-note">
                  {model.goodFor} {model.ram}
                </div>
                <div className="llm-model-meta">
                  {VENDOR_NAMES[model.vendor]} · {model.params} · {model.quant} · {Math.round(model.contextLength / 1024)}k
                  context
                  {here && !ready ? " · runtime missing — install again to fetch it" : ""}
                </div>
              </div>
              <div className="llm-model-actions">
                {ready ? (
                  <>
                    {!chosen ? (
                      <button type="button" className="llm-btn sm" onClick={() => update({ local: { model: model.id } })}>
                        Use
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="llm-btn ghost sm danger"
                      onClick={() => void drop(model)}
                      title="Delete this model from the device"
                    >
                      Remove
                    </button>
                  </>
                ) : inApp && backend && !runtime ? (
                  <span className="llm-model-size">not for this machine yet</span>
                ) : (
                  <button
                    type="button"
                    className="llm-btn primary sm"
                    disabled={session.installing !== null || !inApp}
                    title={!inApp ? "Desktop app only" : undefined}
                    onClick={() => {
                      setError(null);
                      void startInstall(model.id);
                    }}
                  >
                    {busy ? "Installing…" : here ? "Install runtime" : `Install · ${model.size}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {session.installing ? (
          <div className="llm-install" aria-live="polite">
            <div className="llm-install-bar">
              <Progress percent={installPercent(session.progress)} />
              <div className="llm-install-text">
                {session.progress
                  ? `${session.progress.step === "runtime" ? LLM_RUNTIME.label : modelLabel(session.installing)} · ${formatBytes(
                      session.progress.loaded,
                    )}${session.progress.total ? ` / ${formatBytes(session.progress.total)}` : ""}`
                  : `Preparing · ${modelLabel(session.installing)}`}
                {" · resumes if interrupted"}
              </div>
            </div>
            <button type="button" className="llm-btn sm" disabled={session.cancelling} onClick={() => void pauseInstall()}>
              {session.cancelling ? "Pausing…" : "Pause"}
            </button>
          </div>
        ) : null}
        <div className="llm-runtime">
          <span>
            Runtime <code>{LLM_RUNTIME.label}</code> · CPU build, {formatBytes(LLM_RUNTIME.bytes)}
            {backend?.runtime ? "" : " · fetched with the first model"}
          </span>
          {backend?.runtime ? <Badge kind="ok">installed</Badge> : <Badge kind="line">not yet</Badge>}
        </div>
      </div>

      {!inApp ? (
        <p className="llm-note">
          On-device models run in the desktop app — this is the browser preview, so nothing can be installed here. A cloud
          provider below still works.
        </p>
      ) : null}
      {session.notice ? <p className="llm-note">{session.notice}</p> : null}
      {session.error ? <p className="llm-note error">{session.error}</p> : null}
      {error ? <p className="llm-note error">{error}</p> : null}

      <CloudBlock settings={settings} update={update} />

      <TryIt status={status} onAnswered={refresh} />

      {backend?.dir ? (
        <p className="llm-note">
          Model files live in <code>{backend.dir}</code>. The on-device model is unloaded after ten idle minutes and never
          talks to the network.
        </p>
      ) : null}
    </section>
  );
}

function CloudBlock({ settings, update }: { settings: LlmSettings; update: (patch: Partial<LlmSettings>) => void }) {
  const [draft, setDraft] = useState<LlmCloudSettings>(settings.cloud);
  const [showKey, setShowKey] = useState(false);
  useEffect(() => setDraft(settings.cloud), [settings.cloud]);

  const commit = (next: LlmCloudSettings) => {
    setDraft(next);
    const same =
      next.provider === settings.cloud.provider &&
      next.apiKey === settings.cloud.apiKey &&
      next.baseUrl === settings.cloud.baseUrl &&
      next.model === settings.cloud.model;
    if (!same) update({ cloud: next });
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="llm-row">
        <div>
          <div className="llm-row-label">Cloud provider (optional)</div>
          <div className="llm-row-hint">
            Your own key. Cloud requests leave this machine and are listed in Settings → Privacy with what each one was for.
          </div>
        </div>
      </div>
      <div className="llm-cloud">
        <label className="llm-field">
          <span>Provider</span>
          <select
            className="llm-input"
            value={draft.provider}
            onChange={(e) => {
              const provider = e.target.value as LlmCloudSettings["provider"];
              commit({
                ...draft,
                provider,
                baseUrl: provider === "openai" && !draft.baseUrl ? "https://api.openai.com/v1" : draft.baseUrl,
              });
            }}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio…)</option>
          </select>
        </label>
        <label className="llm-field">
          <span>Model</span>
          <input
            className="llm-input"
            value={draft.model}
            placeholder={DEFAULT_CLOUD_MODELS[draft.provider]}
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            onBlur={() => commit(draft)}
          />
        </label>
        {draft.provider === "openai" ? (
          <label className="llm-field wide">
            <span>Base URL — Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1</span>
            <input
              className="llm-input"
              value={draft.baseUrl}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              onBlur={() => commit(draft)}
            />
          </label>
        ) : null}
        <label className="llm-field wide">
          <span>API key {draft.provider === "openai" ? "(local servers usually need none)" : ""} — stored on this device</span>
          <span className="llm-key">
            <input
              className="llm-input"
              type={showKey ? "text" : "password"}
              value={draft.apiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              onBlur={() => commit(draft)}
            />
            <button type="button" className="llm-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </span>
        </label>
      </div>
    </div>
  );
}

function TryIt({ status, onAnswered }: { status: LlmStatus | null; onAnswered: () => void }) {
  const [trying, setTrying] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; ms: number; timing: LlmTiming | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tryIt = async () => {
    setTrying(true);
    setError(null);
    const started = Date.now();
    try {
      const text = await llmComplete({ system: TRY_SYSTEM, prompt: TRY_PROMPT, maxTokens: 80, purpose: "settings test" });
      setAnswer({ text, ms: Date.now() - started, timing: lastLlmTiming() });
      // The hero line prints the last timing; give the parent a reason to re-read it.
      onAnswered();
    } catch (err) {
      setAnswer(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrying(false);
    }
  };

  const where =
    answer?.timing?.provider === "local"
      ? "on this device"
      : answer?.timing
        ? PROVIDER_NAMES[answer.timing.provider as LlmCloudSettings["provider"]] ?? answer.timing.provider
        : "";

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="llm-try">
        <button
          type="button"
          className="llm-btn"
          disabled={trying || !status?.available}
          title={status && !status.available ? status.reason : undefined}
          onClick={() => void tryIt()}
        >
          {trying ? "Asking…" : "Try it"}
        </button>
        <span className="llm-note">
          Asks: “{TRY_PROMPT}” — and prints how long the answer took.
        </span>
      </div>
      {answer ? (
        <div className="llm-answer">
          {answer.text}
          <div className="llm-answer-meta">
            {answer.ms} ms · {where}
            {answer.timing ? ` · ${modelLabel(answer.timing.model)}` : ""}
            {answer.timing && answer.timing.loadMs > 0 ? ` · ${answer.timing.loadMs} ms of it loading the model` : ""}
            {answer.timing?.completionTokens ? ` · ${answer.timing.completionTokens} tokens` : ""}
          </div>
        </div>
      ) : null}
      {error ? <p className="llm-note error">{error}</p> : null}
    </div>
  );
}

/**
 * The small chip other tools show next to a model-backed action: where the
 * model runs, or that there is none. Clicking it opens the card.
 */
export function IntelligenceBadge() {
  const { status } = useLlm();
  const session = useInstallSession();
  const state = session.installing ? "busy" : status?.available ? "ok" : "";
  const text = session.installing
    ? "model downloading"
    : !status
      ? "model…"
      : status.available
        ? status.provider === "local"
          ? "on-device model"
          : "cloud model"
        : "no model";
  return (
    <button
      type="button"
      className={`llm-chip ${state}`}
      title={status?.available ? modelLabel(status.model) : status?.reason}
      onClick={() => openIntelligenceSettings()}
    >
      <i aria-hidden />
      {text}
    </button>
  );
}
