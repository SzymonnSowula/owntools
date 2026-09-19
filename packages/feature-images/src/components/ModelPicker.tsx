import "../images.css";
import { useEffect, useState } from "react";
import { deviceModelReady, useDeviceState } from "../generate/device/install";
import { DEVICE_MODELS } from "../generate/device/models";
import { provider } from "../generate/providers";
import { credsFor, DEVICE_SOURCE, modelFor, providerConfigured, setImageSettings, useImageSettings } from "../generate/settings";
import type { ImageModel } from "../generate/types";

/**
 * Model ids go out of date faster than an app ships — half of what anyone
 * remembered about image APIs in spring 2026 was gone by autumn — so the list
 * a provider publishes itself is the real one. It is fetched when the person
 * asks ("Refresh list"), kept for next time, and the curated few stay as the
 * fallback and as the labels people recognise.
 */
const LISTS_KEY = "owntools-image-model-lists";
const LIST_LIMIT = 400;

function storedLists(): Record<string, ImageModel[]> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LISTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ImageModel[]>) : {};
  } catch {
    return {};
  }
}

function storeList(id: string, models: ImageModel[]): void {
  try {
    const all = storedLists();
    all[id] = models.slice(0, LIST_LIMIT).map((m) => ({ id: m.id, label: m.label }));
    localStorage.setItem(LISTS_KEY, JSON.stringify(all));
  } catch {
    /* private mode / quota */
  }
}

/** Curated entries first (they carry the notes), then whatever else the provider lists. */
export function mergeModels(curated: ImageModel[], live: ImageModel[]): ImageModel[] {
  const seen = new Set(curated.map((m) => m.id));
  const liveIds = new Set(live.map((m) => m.id));
  // A curated id the provider no longer lists is gone; keep it only while there is no live list to say so.
  const kept = live.length ? curated.filter((m) => liveIds.has(m.id) || m.id === "") : curated;
  return [...kept, ...live.filter((m) => !seen.has(m.id))];
}

export function ModelPicker({ source, disabled, compact }: { source: string; disabled?: boolean; compact?: boolean }) {
  const settings = useImageSettings();
  const device = useDeviceState();
  const [lists, setLists] = useState<Record<string, ImageModel[]>>(storedLists);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const model = modelFor(source, settings);

  useEffect(() => {
    setError(null);
    setTyping(false);
  }, [source]);

  const choose = (id: string) => setImageSettings({ models: { ...settings.models, [source]: id } });

  if (source === DEVICE_SOURCE) {
    return (
      <label className="img-field">
        <span>Model</span>
        <select className="field h-9 w-full" value={model} disabled={disabled} onChange={(e) => choose(e.target.value)}>
          {DEVICE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {device && !deviceModelReady(device, m.id) ? " (not installed)" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const p = provider(source);
  if (!p) return null;
  const options = mergeModels(p.models, lists[p.id] ?? []);
  const known = options.some((m) => m.id === model);
  const note = options.find((m) => m.id === model)?.note;

  async function refresh() {
    if (!p?.listModels || loading) return;
    setLoading(true);
    setError(null);
    try {
      const live = await p.listModels(credsFor(p, settings));
      storeList(p.id, live);
      setLists(storedLists());
      if (!live.length) setError(`${p.name} listed no image models for this key.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch the list.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="img-field">
      <span>Model</span>
      <div className="img-field-row">
        {typing || (!known && model) || !options.length ? (
          <input
            className="field h-9 w-full"
            value={model}
            spellCheck={false}
            autoFocus={typing}
            placeholder={p.models[0]?.id || "model id"}
            disabled={disabled}
            onChange={(e) => choose(e.target.value.trim())}
          />
        ) : (
          <select
            className="field h-9 w-full"
            value={model}
            disabled={disabled}
            onChange={(e) => (e.target.value === "__type-a-model-id__" ? setTyping(true) : choose(e.target.value))}
          >
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {p.customModel ? <option value={"__type-a-model-id__"}>Type a model id…</option> : null}
          </select>
        )}
        {(typing || !known) && options.length ? (
          <button
            type="button"
            className="img-btn"
            disabled={disabled}
            onClick={() => {
              setTyping(false);
              choose(options[0].id);
            }}
          >
            List
          </button>
        ) : null}
        {p.listModels ? (
          <button
            type="button"
            className="img-btn"
            disabled={disabled || loading || (p.needsKey && !providerConfigured(p, settings))}
            title="Ask the provider which image models it has today"
            onClick={() => void refresh()}
          >
            {loading ? "Asking…" : "Refresh list"}
          </button>
        ) : null}
      </div>
      {note && !compact ? <p className="img-note">{note}</p> : null}
      {error ? <p className="img-note error">{error}</p> : null}
    </div>
  );
}
