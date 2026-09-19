import "../images.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { openSettings } from "@core/navigation";
import { SavedLine, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "@feature-tools/components/ToolModal";
import { formatBytes, saveBlob, zipBlobs, type SaveOutcome } from "@feature-tools/lib/save";
import { generateImages, modelLabel, type GenerationResult } from "../generate";
import { deviceModelReady, useDeviceState } from "../generate/device/install";
import { deviceModel } from "../generate/device/models";
import { provider } from "../generate/providers";
import { DEVICE_SOURCE, configuredProviders, modelFor, setImageSettings, useImageSettings } from "../generate/settings";
import { ASPECT_RATIOS, isAbort, ProviderError, type AspectRatio, type GenProgress, type Quality } from "../generate/types";
import { ModelPicker } from "./ModelPicker";

const QUALITIES: { value: Quality; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

interface Shown {
  blob: Blob;
  url: string;
  name: string;
  seed: number | null;
}

function extensionFor(blob: Blob): string {
  return blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
}

/** "a lighthouse at dusk, oil paint" → "a-lighthouse-at-dusk-oil-paint" */
export function fileStem(prompt: string): string {
  const stem = prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return stem || "image";
}

export interface GenerateImageModalProps {
  open: boolean;
  onClose: () => void;
  /** Hands a finished picture to the background remover. */
  onRemoveBackground?: (file: File) => void;
}

export function GenerateImageModal({ open, onClose, onRemoveBackground }: GenerateImageModalProps) {
  const settings = useImageSettings();
  const device = useDeviceState();
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [seedText, setSeedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [error, setError] = useState<ProviderError | Error | null>(null);
  const [shown, setShown] = useState<Shown[]>([]);
  const [selected, setSelected] = useState(0);
  const [meta, setMeta] = useState<GenerationResult | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(
    () => () => {
      abort.current?.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const source = settings.source;
  const onDevice = source === DEVICE_SOURCE;
  const current = onDevice ? null : provider(source);
  const model = modelFor(source, settings);
  const sources = useMemo(() => configuredProviders(settings), [settings]);

  if (!open) return null;

  const ready = onDevice ? deviceModelReady(device, model) : Boolean(current && sources.some((p) => p.id === current.id));
  const takesNegative = onDevice ? Boolean(deviceModel(model)?.negativePrompt) : Boolean(current?.supportsNegative);
  const takesSeed = onDevice || Boolean(current?.supportsSeed);
  const picture = shown[Math.min(selected, shown.length - 1)] ?? null;

  function setUp() {
    onClose();
    openSettings("images");
  }

  async function run() {
    if (busy || !prompt.trim() || !ready) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    setProgress({ note: onDevice ? "Starting the engine" : `Asking ${current?.name ?? "the provider"}`, fraction: null });
    const controller = new AbortController();
    abort.current = controller;
    const seed = seedText.trim() && Number.isFinite(Number(seedText)) ? Math.abs(Math.round(Number(seedText))) : null;
    try {
      const result = await generateImages({
        prompt,
        negativePrompt: negative,
        aspect: settings.aspect,
        count: settings.count,
        quality: settings.quality,
        seed,
        signal: controller.signal,
        onProgress: setProgress,
      });
      const stem = fileStem(prompt);
      const fresh = result.images.map((image, i) => {
        const url = URL.createObjectURL(image.blob);
        urls.current.push(url);
        return { blob: image.blob, url, name: `${stem}${result.images.length > 1 ? `-${i + 1}` : ""}.${extensionFor(image.blob)}`, seed: image.seed ?? null };
      });
      // Newest first; what was made earlier in this sitting stays within reach.
      setShown((before) => [...fresh, ...before].slice(0, 24));
      setSelected(0);
      setMeta(result);
    } catch (err) {
      if (!isAbort(err)) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      abort.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  async function save() {
    if (!picture) return;
    try {
      setSaved(await saveBlob(picture.blob, picture.name));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Couldn't save the file."));
    }
  }

  async function saveAll() {
    try {
      const entries = await Promise.all(shown.map(async (s) => ({ name: s.name, data: new Uint8Array(await s.blob.arrayBuffer()) })));
      setSaved(await saveBlob(await zipBlobs(entries), "images.zip"));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Couldn't save the files."));
    }
  }

  async function copy() {
    if (!picture) return;
    try {
      let blob = picture.blob;
      if (blob.type !== "image/png") {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't copy the image."))), "image/png"),
        );
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Couldn't copy the image."));
    }
  }

  const needsSetup = error instanceof ProviderError && (error.kind === "auth" || error.kind === "billing");

  return (
    <ToolModal
      title="Generate an image"
      subtitle={
        onDevice
          ? "A prompt in, a picture out - made on this device, nothing sent anywhere."
          : `A prompt in, a picture out - through ${current?.name ?? "your provider"}, with your own key.`
      }
      onClose={onClose}
      busy={busy}
      wide="xl"
      status={<SavedLine outcome={saved} />}
      footer={
        <>
          <button className="btn btn-secondary flex-1" onClick={() => (busy ? abort.current?.abort() : onClose())}>
            {busy ? "Cancel" : "Close"}
          </button>
          {picture && !busy ? (
            <>
              <button className="btn btn-secondary flex-1" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="btn btn-secondary flex-1" onClick={() => void save()}>
                Save
              </button>
            </>
          ) : null}
          <button className="btn btn-primary flex-1" disabled={busy || !prompt.trim() || !ready} onClick={() => void run()}>
            {busy ? "Generating…" : shown.length ? "Generate again" : "Generate"}
          </button>
        </>
      }
    >
      <div className="img-split">
        <div className="img-split-side">
          <textarea
            className="field img-prompt"
            value={prompt}
            autoFocus
            rows={5}
            placeholder="A lighthouse at dusk, long exposure, soft fog over the water"
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run();
            }}
          />
          {takesNegative ? (
            <input
              className="field h-9 w-full"
              value={negative}
              placeholder="Leave out: blurry, text, watermark"
              disabled={busy}
              onChange={(e) => setNegative(e.target.value)}
            />
          ) : null}

          <ToolRow label="Made by">
            <select
              className="field h-9 w-full"
              value={source}
              disabled={busy}
              onChange={(e) => setImageSettings({ source: e.target.value })}
            >
              <option value={DEVICE_SOURCE}>This device</option>
              {sources.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {current && !sources.some((p) => p.id === current.id) ? <option value={current.id}>{current.name} (not set up)</option> : null}
            </select>
          </ToolRow>

          <ModelPicker source={source} disabled={busy} compact />

          {!ready ? (
            <div className="img-callout">
              <p>
                {onDevice
                  ? "No on-device model is installed yet. Install one - or add your own key for a provider - in Settings."
                  : `${current?.name ?? "This provider"} is not set up yet.`}
              </p>
              <button type="button" className="img-btn primary" onClick={setUp}>
                Set up image generation
              </button>
            </div>
          ) : null}

          <ToolRow label="Shape">
            <select
              className="field h-9 w-full"
              value={settings.aspect}
              disabled={busy}
              onChange={(e) => setImageSettings({ aspect: e.target.value as AspectRatio })}
            >
              {ASPECT_RATIOS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </ToolRow>
          <ToolRow label="Quality">
            <div className="img-seg" role="radiogroup" aria-label="Quality">
              {QUALITIES.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.quality === q.value}
                  className={settings.quality === q.value ? "active" : undefined}
                  disabled={busy}
                  onClick={() => setImageSettings({ quality: q.value })}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </ToolRow>
          <ToolRow label="Pictures">
            <div className="img-seg" role="radiogroup" aria-label="How many pictures">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={settings.count === n}
                  className={settings.count === n ? "active" : undefined}
                  disabled={busy}
                  onClick={() => setImageSettings({ count: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </ToolRow>
          {takesSeed ? (
            <ToolRow label="Seed">
              <input
                className="field h-9 w-full"
                value={seedText}
                inputMode="numeric"
                placeholder="Random - type a number to repeat a picture"
                disabled={busy}
                onChange={(e) => setSeedText(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
              />
            </ToolRow>
          ) : null}
        </div>

        <div className="img-split-main">
          <div className="img-stage">
            {picture ? (
              <img src={picture.url} alt={prompt} draggable={false} />
            ) : (
              <p className="img-stage-empty">{busy ? (progress?.note ?? "Working…") : "The picture shows up here. Ctrl + Enter generates."}</p>
            )}
          </div>

          {shown.length > 1 ? (
            <div className="img-strip" role="listbox" aria-label="Pictures from this sitting">
              {shown.map((s, i) => (
                <button
                  key={s.url}
                  type="button"
                  role="option"
                  aria-selected={i === selected}
                  className={`img-thumb${i === selected ? " active" : ""}`}
                  title={s.name}
                  onClick={() => setSelected(i)}
                >
                  <img src={s.url} alt="" draggable={false} />
                </button>
              ))}
            </div>
          ) : null}

          {picture && meta ? (
            <ToolNote>
              {modelLabel(meta.source, meta.model) || meta.sourceName} · {meta.sourceName.toLowerCase()} · {(meta.ms / 1000).toFixed(1)} s ·{" "}
              {formatBytes(picture.blob.size)}
              {picture.seed != null ? ` · seed ${picture.seed}` : ""}
            </ToolNote>
          ) : null}

          {picture && !busy ? (
            <div className="img-actions">
              {onRemoveBackground ? (
                <button
                  type="button"
                  className="img-btn"
                  onClick={() => onRemoveBackground(new File([picture.blob], picture.name, { type: picture.blob.type }))}
                >
                  Remove its background
                </button>
              ) : null}
              {shown.length > 1 ? (
                <button type="button" className="img-btn" onClick={() => void saveAll()}>
                  Save all {shown.length} (.zip)
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {busy && progress ? <ToolProgress value={progress.fraction} label={progress.note} /> : null}
      {error ? (
        <>
          <ToolError>{error.message}</ToolError>
          {needsSetup ? (
            <button type="button" className="img-btn self-start" onClick={setUp}>
              Open Settings → Intelligence
            </button>
          ) : null}
        </>
      ) : null}
    </ToolModal>
  );
}
