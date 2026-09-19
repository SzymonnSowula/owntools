import "./images.css";
import { useEffect, useState } from "react";
import { isTauri } from "@core/env";
import { confirmDialog } from "@ui/Dialog";
import { MattingModelRows } from "./components/MattingModelRows";
import { ModelPicker } from "./components/ModelPicker";
import { engineDevices } from "./generate/device/engine";
import {
  deviceModelReady,
  installPercent,
  pauseDeviceInstall,
  removeDeviceModel,
  startDeviceInstall,
  useDeviceInstall,
  useDeviceState,
} from "./generate/device/install";
import { DEVICE_MODELS, deviceModel, downloadBytes, formatBytes, runtimeFor, type DeviceModel, type EnginePreference } from "./generate/device/models";
import { sourceName } from "./generate";
import { provider, PROVIDERS } from "./generate/providers";
import { configuredProviders, DEVICE_SOURCE, modelFor, providerConfigured, setImageSettings, useImageSettings } from "./generate/settings";
import { useInstalledMattingModels } from "./matting/install";
import { loadMattingPrefs } from "./prefs";

/**
 * Settings → Intelligence → Images: the one place a person decides where
 * pictures come from (this device, or a provider with their own key) and
 * which background-removal models are on the machine. The two quick tools on
 * the hub read what is decided here.
 *
 * Mounted by focus's SettingsView under the language-model card; the section
 * roots carry `data-settings-section` ("images", "background-removal") for
 * search and for `openSettings()`.
 */

const ENGINES: { value: EnginePreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "gpu", label: "Graphics card" },
  { value: "cpu", label: "Processor" },
];

async function openExternal(url: string): Promise<void> {
  try {
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    }
  } catch {
    /* fall through to the browser */
  }
  window.open(url, "_blank", "noopener");
}

function Tile({ on, title, detail }: { on: boolean; title: string; detail: string }) {
  return (
    <div className={`img-tile${on ? " on" : ""}`}>
      <span className="img-tile-dot" aria-hidden />
      <div className="img-tile-main">
        <div className="img-tile-title">{title}</div>
        <div className="img-tile-detail">{detail}</div>
      </div>
    </div>
  );
}

export default function ImagesCard() {
  const settings = useImageSettings();
  const device = useDeviceState();
  const install = useDeviceInstall();
  const matting = useInstalledMattingModels();
  const [devices, setDevices] = useState<[string, string][]>([]);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inApp = isTauri();

  const onDevice = settings.source === DEVICE_SOURCE;
  // The provider being edited: the active one, or the first in the list while "This device" is active.
  const [editing, setEditing] = useState<string>(() => (settings.source === DEVICE_SOURCE ? PROVIDERS[0].id : settings.source));
  const current = provider(editing) ?? PROVIDERS[0];
  const configured = configuredProviders(settings);

  useEffect(() => {
    if (!device?.status?.runtime) return;
    let live = true;
    void engineDevices().then((list) => {
      if (live) setDevices(list);
    });
    return () => {
      live = false;
    };
  }, [device?.status?.runtime, device?.status?.build]);

  const generationOn = onDevice ? deviceModelReady(device, modelFor(DEVICE_SOURCE, settings)) : providerConfigured(provider(settings.source) ?? current, settings);
  const mattingOn = Boolean(matting && (matting.general || matting.portrait));
  const activeModel = modelFor(settings.source, settings);
  const runtime = runtimeFor(settings.device.engine, device?.status ?? { vulkan: false });
  const gpu = devices.find(([name]) => !/^cpu/i.test(name));

  async function drop(model: DeviceModel) {
    const own = model.files.filter((f) => !f.shared).reduce((n, f) => n + f.bytes, 0);
    const ok = await confirmDialog({
      title: `Remove ${model.label}?`,
      message: `Deletes ${formatBytes(own)} from this device. ${model.files.some((f) => f.shared) ? "The Qwen3 text encoder stays - the language model uses it too. " : ""}You can download it again any time.`,
      okLabel: "Remove",
      kind: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await removeDeviceModel(model.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the model.");
    }
  }

  const patchMap = (key: "keys" | "baseUrls" | "extras", value: string) => setImageSettings({ [key]: { ...settings[key], [current.id]: value } });
  const percent = installPercent(install);

  return (
    <section className="card stack img-card" data-settings-section="images">
      <div className="img-head">
        <strong>Images</strong>
        <p>
          Two quick tools on the hub read this: <em>Generate an image</em> and <em>Remove background</em>. Both run on this device;
          generation can also go through a provider with your own key.
        </p>
      </div>

      <div className="img-tiles">
        <Tile
          on={mattingOn}
          title="Background removal"
          detail={mattingOn ? "Enabled · on this device" : matting === null ? "Checking…" : "Not installed yet"}
        />
        <Tile
          on={generationOn}
          title="Image generation"
          detail={
            generationOn
              ? `Enabled · ${onDevice ? (deviceModel(activeModel)?.label ?? "this device") : sourceName(settings.source)}`
              : onDevice
                ? "No on-device model yet"
                : "Needs a key"
          }
        />
      </div>

      {/* ---- where pictures come from ------------------------------------ */}
      <div className="img-block">
        <div className="img-block-head">
          <div>
            <div className="img-label">Where pictures come from</div>
            <div className="img-hint">
              On this device nothing leaves the machine. With a provider, the prompt goes to that provider and the request is listed in
              Settings → Privacy.
            </div>
          </div>
          <div className="img-seg" role="radiogroup" aria-label="Where pictures come from">
            <button type="button" role="radio" aria-checked={onDevice} className={onDevice ? "active" : undefined} onClick={() => setImageSettings({ source: DEVICE_SOURCE })}>
              This device
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!onDevice}
              className={!onDevice ? "active" : undefined}
              onClick={() => setImageSettings({ source: current.id })}
            >
              My own key
            </button>
          </div>
        </div>

        {onDevice ? (
          <>
            <div className="img-rows">
              {DEVICE_MODELS.map((model) => {
                const present = device?.present[model.id] ?? new Set<string>();
                const ready = deviceModelReady(device, model.id);
                const inUse = ready && activeModel === model.id;
                const busy = install.installing === model.id;
                const toFetch = downloadBytes(model, present) + (device?.status?.runtime ? 0 : (runtime?.bytes ?? 0));
                return (
                  <div key={model.id} className={`img-row${inUse ? " active" : ""}`}>
                    <div className="img-row-main">
                      <div className="img-row-name">
                        {model.label}
                        <span className="img-row-size">{formatBytes(model.files.reduce((n, f) => n + f.bytes, 0))}</span>
                        {model.tags.map((tag) => (
                          <span key={tag} className={`img-badge ${tag === "recommended" ? "accent" : "line"}`}>
                            {tag}
                          </span>
                        ))}
                        {inUse ? <span className="img-badge accent">in use</span> : ready ? <span className="img-badge ok">installed</span> : null}
                      </div>
                      <div className="img-row-note">
                        {model.goodFor} {model.needs}
                      </div>
                      <div className="img-row-meta">
                        {model.maker} ·{" "}
                        <button type="button" className="img-link" onClick={() => void openExternal(model.licenseUrl)}>
                          {model.license}
                        </button>
                        {model.files.some((f) => f.shared) ? " · shares its 2.5 GB text encoder with the language model" : ""}
                      </div>
                    </div>
                    <div className="img-row-actions">
                      {ready ? (
                        <>
                          {!inUse ? (
                            <button type="button" className="img-btn" onClick={() => setImageSettings({ models: { ...settings.models, [DEVICE_SOURCE]: model.id } })}>
                              Use
                            </button>
                          ) : null}
                          <button type="button" className="img-btn ghost danger" onClick={() => void drop(model)}>
                            Remove
                          </button>
                        </>
                      ) : inApp && device && !runtime ? (
                        <span className="img-row-size">not for this machine yet</span>
                      ) : (
                        <button
                          type="button"
                          className="img-btn primary"
                          disabled={install.installing !== null || !inApp}
                          title={!inApp ? "Desktop app only" : undefined}
                          onClick={() => {
                            setError(null);
                            void startDeviceInstall(model.id, settings.device.engine).then((ok) => {
                              if (ok && !deviceModelReady(device, modelFor(DEVICE_SOURCE, settings))) {
                                setImageSettings({ models: { ...settings.models, [DEVICE_SOURCE]: model.id } });
                              }
                            });
                          }}
                        >
                          {busy ? "Installing…" : `Install · ${formatBytes(toFetch)}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {install.installing ? (
                <div className="img-install" aria-live="polite">
                  <div className="img-install-bar">
                    <div className={`img-progress${percent === null ? " indeterminate" : ""}`} aria-hidden>
                      <span style={{ width: percent === null ? undefined : `${percent}%` }} />
                    </div>
                    <div className="img-install-text">
                      {install.step ?? "Preparing"} · {formatBytes(install.loaded)}
                      {install.total ? ` / ${formatBytes(install.total)}` : ""} · pinned and verified · resumes if interrupted
                    </div>
                  </div>
                  <button type="button" className="img-btn" disabled={install.cancelling} onClick={() => void pauseDeviceInstall()}>
                    {install.cancelling ? "Pausing…" : "Pause"}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="img-block-head">
              <div>
                <div className="img-label">Runs on</div>
                <div className="img-hint">
                  {device?.status?.runtime
                    ? gpu
                      ? `The engine sees ${gpu[1] || gpu[0]}.`
                      : device.status.build === "cpu"
                        ? "The processor build is installed."
                        : "The engine is installed."
                    : runtime
                      ? `${runtime.label} · ${formatBytes(runtime.bytes)} · fetched with the first model.`
                      : "No engine for this machine yet."}
                  {device?.status?.runtime && runtime && device.status.build !== runtime.build ? " The next install switches the engine to match." : ""}
                </div>
              </div>
              <div className="img-seg" role="radiogroup" aria-label="Which engine to use">
                {ENGINES.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.device.engine === e.value}
                    className={settings.device.engine === e.value ? "active" : undefined}
                    onClick={() => setImageSettings({ device: { engine: e.value, cpuOnly: e.value === "cpu" } })}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            {!inApp ? <p className="img-note">On-device models run in the desktop app - this is the browser preview, so nothing can be installed here.</p> : null}
            {install.notice ? <p className="img-note">{install.notice}</p> : null}
            {install.error ? <p className="img-note error">{install.error}</p> : null}
            {error ? <p className="img-note error">{error}</p> : null}
          </>
        ) : (
          <div className="img-form">
            <label className="img-field">
              <span>Provider</span>
              <select
                className="field h-9 w-full"
                value={current.id}
                onChange={(e) => {
                  setEditing(e.target.value);
                  setShowKey(false);
                  setImageSettings({ source: e.target.value });
                }}
              >
                <optgroup label="With your own key">
                  {PROVIDERS.filter((p) => p.group === "cloud").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {configured.some((c) => c.id === p.id) ? "  ✓" : ""}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="A server on your own machine">
                  {PROVIDERS.filter((p) => p.group === "server").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {configured.some((c) => c.id === p.id) ? "  ✓" : ""}
                    </option>
                  ))}
                </optgroup>
              </select>
              <p className="img-note">{current.blurb}</p>
            </label>

            {current.baseUrl ? (
              <label className="img-field">
                <span>{current.baseUrl.label}</span>
                <input
                  className="field h-9 w-full"
                  value={settings.baseUrls[current.id] ?? ""}
                  placeholder={current.baseUrl.default}
                  spellCheck={false}
                  onChange={(e) => patchMap("baseUrls", e.target.value)}
                />
                {current.baseUrl.hint ? <p className="img-note">{current.baseUrl.hint}</p> : null}
              </label>
            ) : null}

            {current.needsKey || current.keyPlaceholder ? (
              <label className="img-field">
                <span>
                  {current.needsKey ? "API key" : "Login (optional)"} - stored on this device only
                  {current.keyUrl ? (
                    <>
                      {" · "}
                      <button type="button" className="img-link" onClick={() => void openExternal(current.keyUrl as string)}>
                        Get a key
                      </button>
                    </>
                  ) : null}
                </span>
                <span className="img-field-row">
                  <input
                    className="field h-9 w-full"
                    type={showKey ? "text" : "password"}
                    value={settings.keys[current.id] ?? ""}
                    placeholder={current.keyPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => patchMap("keys", e.target.value)}
                  />
                  <button type="button" className="img-btn" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? "Hide" : "Show"}
                  </button>
                </span>
              </label>
            ) : null}

            {current.extra ? (
              <label className="img-field">
                <span>{current.extra.label}</span>
                <input
                  className="field h-9 w-full"
                  value={settings.extras[current.id] ?? ""}
                  placeholder={current.extra.placeholder}
                  spellCheck={false}
                  onChange={(e) => patchMap("extras", e.target.value)}
                />
              </label>
            ) : null}

            <ModelPicker source={current.id} />

            {configured.length > 1 ? (
              <p className="img-note">
                Set up: {configured.map((p) => p.name).join(" · ")}. The tool's "Made by" menu switches between them.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* ---- background removal ------------------------------------------ */}
      <div className="img-block" data-settings-section="background-removal">
        <div>
          <div className="img-label">Background removal</div>
          <div className="img-hint">
            Runs on this device, on the graphics card when there is one. Pick the model in the tool; install or remove them here.
          </div>
        </div>
        <MattingModelRows inUse={loadMattingPrefs().model} />
      </div>
    </section>
  );
}
