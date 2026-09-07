import { Cpu } from "lucide-react";
import { useState } from "react";
import { isTauri } from "@core/env";
import { Alert, Card, PageHead, Progress, Row } from "../components";
import {
  formatBytes,
  modelById,
  modelInstalled,
  MODELS,
  PARAKEET_RUNTIME,
  removeModel,
  resolveActiveModel,
  runtimeInstalled,
  WHISPER_RUNTIME,
  type DictationModel,
  type Engine,
  type EngineStatus,
} from "../engine";
import { installPercent, pauseInstall, startInstall, useInstallSession } from "../install";
import { useDictationSettings } from "../useSettings";
import { VendorMark, VENDORS } from "../VendorMark";

const ENGINE_NOTE: Record<Engine, string> = {
  whisper:
    "Runs every Whisper model. Also behind transcribe, subtitles and translation, and the only engine that takes the vocabulary as a prompt.",
  parakeet:
    "Runs NVIDIA Parakeet. Dictation only: no translation, no subtitle timestamps — the vocabulary still fixes spellings and applies replacements afterwards.",
};

function TagBadge({ tag }: { tag: DictationModel["tags"][number] }) {
  return <span className={`dt-badge ${tag === "recommended" ? "accent" : "line"}`}>{tag}</span>;
}

export function ModelsPage({ status, refresh }: { status: EngineStatus | null; refresh: () => void }) {
  const [settings, update] = useDictationSettings();
  const { installing, progress, cancelling, notice, error: installError } = useInstallSession();
  const [error, setError] = useState<string | null>(null);

  const active = resolveActiveModel(settings.model, status);
  const installingModel = installing ? modelById(installing) : undefined;
  const percent = installPercent(progress);
  const unknownWhisper = (status?.models ?? []).filter((f) => !modelById(f));

  async function drop(model: DictationModel) {
    setError(null);
    try {
      await removeModel(model.id);
      if (settings.model === model.id) update({ model: "" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the model.");
    }
  }

  const runtimeRows: { engine: Engine; name: string; label: string; runtime: typeof WHISPER_RUNTIME }[] = [
    { engine: "parakeet", name: "sherpa-onnx", label: PARAKEET_RUNTIME.label, runtime: PARAKEET_RUNTIME },
    { engine: "whisper", name: "whisper.cpp", label: WHISPER_RUNTIME.label, runtime: WHISPER_RUNTIME },
  ];

  return (
    <div className="dt-page">
      <PageHead
        title="models"
        sub={
          active
            ? "Two engines, one picker. Parakeet is the fast one for dictation; a Whisper model is what transcribe, subtitles and translation run on. Models sit side by side — pick the one dictation uses."
            : "One-time setup: the engine plus the model you pick. Downloads are pinned and verified, resume if interrupted, and everything runs offline afterwards."
        }
      />

      {!isTauri() ? (
        <Alert kind="info" icon={<Cpu />}>
          Dictation runs in the desktop app — this is the browser preview, so nothing can be installed here.
        </Alert>
      ) : null}

      <Card title="Models" desc="Pinned downloads, verified by checksum before they are used." flush>
        {MODELS.map((model) => {
          const here = modelInstalled(status, model);
          const runtime = runtimeInstalled(status, model.engine);
          const inUse = active?.id === model.id;
          const busy = installing === model.id;
          return (
            <div key={model.id} className={`dt-model${inUse ? " active" : ""}`}>
              <VendorMark vendor={model.vendor} />
              <div className="dt-model-main">
                <div className="dt-model-name">
                  {model.label}
                  <span className="dt-model-size">{model.size}</span>
                  {model.tags.map((tag) => (
                    <TagBadge key={tag} tag={tag} />
                  ))}
                  {inUse ? <span className="dt-badge accent">in use</span> : null}
                </div>
                <div className="dt-model-note">{model.note}</div>
                <div className="dt-model-meta">
                  {VENDORS[model.vendor].name} · {model.languages}
                  {here && !runtime ? " · engine missing — install again to fetch it" : ""}
                </div>
              </div>
              <div className="dt-model-actions">
                {here && runtime ? (
                  <>
                    {!inUse ? (
                      <button className="dt-btn sm" onClick={() => update({ model: model.id })}>
                        Use
                      </button>
                    ) : null}
                    <button className="dt-btn ghost sm danger" onClick={() => void drop(model)} title="Delete this model">
                      Remove
                    </button>
                  </>
                ) : (
                  <button
                    className="dt-btn primary sm"
                    disabled={installing !== null || !isTauri()}
                    onClick={() => {
                      setError(null);
                      void startInstall(model.id);
                    }}
                  >
                    {busy ? "Installing…" : here ? "Install engine" : "Install"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {installing ? (
          <div className="dt-install" aria-live="polite">
            <div className="dt-install-bar">
              <Progress percent={percent} />
              <div className="dt-install-text">
                {progress
                  ? `${progress.step === "engine" ? "Engine" : installingModel?.label ?? "Model"} · ${formatBytes(progress.loaded)}${
                      progress.total ? ` / ${formatBytes(progress.total)}` : ""
                    }`
                  : `Preparing${installingModel ? ` · ${installingModel.label} · ${installingModel.size}` : ""}`}
                {" · resumes if interrupted"}
              </div>
            </div>
            <button className="dt-btn sm" disabled={cancelling} onClick={() => void pauseInstall()}>
              {cancelling ? "Pausing…" : "Pause"}
            </button>
          </div>
        ) : null}
      </Card>

      <Card title="Engines" desc="The programs that run the models; each is fetched with the first model that needs it." flush>
        {runtimeRows.map((row) => {
          const ok = runtimeInstalled(status, row.engine);
          return (
            <Row
              key={row.engine}
              label={
                <>
                  {row.name} <span className="dt-model-size">{row.label}</span>
                </>
              }
              hint={ok ? ENGINE_NOTE[row.engine] : `${ENGINE_NOTE[row.engine]} ${formatBytes(row.runtime.bytes)} download.`}
            >
              {ok ? <span className="dt-badge ok">installed</span> : <span className="dt-badge line">not yet</span>}
            </Row>
          );
        })}
      </Card>

      {notice ? <p className="dt-note" style={{ marginTop: 12 }}>{notice}</p> : null}
      {installError ? <p className="dt-note error" style={{ marginTop: 12 }}>{installError}</p> : null}
      {error ? <p className="dt-note error" style={{ marginTop: 12 }}>{error}</p> : null}
      {status?.dir ? (
        <p className="dt-note" style={{ marginTop: 12 }}>
          Files live in {status.dir}
          {status.parakeet.dir ? ` and ${status.parakeet.dir}` : ""}.
          {unknownWhisper.length ? ` Other whisper models found: ${unknownWhisper.join(", ")}.` : ""}
        </p>
      ) : null}
    </div>
  );
}
