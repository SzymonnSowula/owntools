import "../images.css";
import { useState } from "react";
import { confirmDialog } from "@ui/Dialog";
import {
  installPercent,
  pauseMattingInstall,
  removeMattingModel,
  startMattingInstall,
  useInstalledMattingModels,
  useMattingInstall,
} from "../matting/install";
import { formatModelBytes, MATTING_MODELS, type MattingModel, type MattingModelId } from "../matting/models";

/**
 * The background-removal models as rows: install, progress with pause, remove.
 * The quick tool shows the one row it needs (`only`) when that model is
 * missing; Settings → Intelligence shows them all.
 */
export function MattingModelRows({ only, inUse }: { only?: MattingModelId; inUse?: MattingModelId }) {
  const installed = useInstalledMattingModels();
  const session = useMattingInstall();
  const [error, setError] = useState<string | null>(null);
  const models = only ? MATTING_MODELS.filter((m) => m.id === only) : MATTING_MODELS;

  async function drop(model: MattingModel) {
    const ok = await confirmDialog({
      title: `Remove the ${model.label} model?`,
      message: `Deletes the ${formatModelBytes(model.bytes)} file from this device. You can download it again any time.`,
      okLabel: "Remove",
      kind: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await removeMattingModel(model.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the model.");
    }
  }

  const percent = installPercent(session);

  return (
    <div className="flex flex-col gap-2">
      <div className="img-rows">
        {models.map((model) => {
          const here = installed?.[model.id] === true;
          const busy = session.installing === model.id;
          return (
            <div key={model.id} className={`img-row${inUse === model.id && here ? " active" : ""}`}>
              <div className="img-row-main">
                <div className="img-row-name">
                  {model.label}
                  <span className="img-row-size">{formatModelBytes(model.bytes)}</span>
                  {model.tags.includes("recommended") ? <span className="img-badge accent">recommended</span> : null}
                  {here ? <span className="img-badge ok">installed</span> : null}
                </div>
                <div className="img-row-note">
                  {model.goodFor} {model.cost}
                </div>
                <div className="img-row-meta">
                  {model.family} · {model.license} · runs on this device
                </div>
              </div>
              <div className="img-row-actions">
                {here ? (
                  <button type="button" className="img-btn ghost danger" onClick={() => void drop(model)}>
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    className="img-btn primary"
                    disabled={session.installing !== null || installed === null}
                    onClick={() => {
                      setError(null);
                      void startMattingInstall(model.id);
                    }}
                  >
                    {busy ? "Installing…" : `Install · ${formatModelBytes(model.bytes)}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {session.installing && models.some((m) => m.id === session.installing) ? (
          <div className="img-install" aria-live="polite">
            <div className="img-install-bar">
              <div className={`img-progress${percent === null ? " indeterminate" : ""}`} aria-hidden>
                <span style={{ width: percent === null ? undefined : `${percent}%` }} />
              </div>
              <div className="img-install-text">
                {formatModelBytes(session.loaded)} / {formatModelBytes(session.total)} · pinned and verified · resumes if
                interrupted
              </div>
            </div>
            <button type="button" className="img-btn" disabled={session.cancelling} onClick={() => void pauseMattingInstall()}>
              {session.cancelling ? "Pausing…" : "Pause"}
            </button>
          </div>
        ) : null}
      </div>
      {session.notice ? <p className="img-note">{session.notice}</p> : null}
      {session.error ? <p className="img-note error">{session.error}</p> : null}
      {error ? <p className="img-note error">{error}</p> : null}
    </div>
  );
}
