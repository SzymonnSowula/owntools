import "../images.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilePicker } from "@feature-tools/components/FilePicker";
import { SavedLine, ToolError, ToolModal, ToolNote, ToolProgress, ToolRow } from "@feature-tools/components/ToolModal";
import { baseName, formatBytes, saveBlob, zipBlobs, type SaveOutcome } from "@feature-tools/lib/save";
import { CUTOUT_EXT } from "../matting/compose";
import { releaseMatting } from "../matting/engine";
import type { EdgeStyle } from "../matting/mask";
import { MATTING_MODELS, mattingModel, type MattingModelId } from "../matting/models";
import { effectiveFormat, removeBackground, type Cutout } from "../matting/remove";
import { loadMattingPrefs, saveMattingPrefs, type BackdropChoice, type MattingPrefs } from "../prefs";
import { MattingModelRows } from "./MattingModelRows";
import { useInstalledMattingModels, useMattingInstall } from "../matting/install";

/** What the model can read. SVG has no pixels to segment; an animated GIF gives its first frame. */
function isPhoto(file: File): boolean {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return false;
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

const BACKDROPS: { value: BackdropChoice; label: string }[] = [
  { value: "transparent", label: "Transparent" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "color", label: "Colour" },
  { value: "blur", label: "Blurred" },
];

const EDGES: { value: EdgeStyle; label: string; hint: string }[] = [
  { value: "soft", label: "Soft", hint: "The matte as the model drew it - best for hair on a dark page." },
  { value: "balanced", label: "Balanced", hint: "Clears the faint haze around the subject, keeps soft hair." },
  { value: "crisp", label: "Crisp", hint: "A hard edge - products, logos, screenshots." },
];

interface Done {
  name: string;
  source: File;
  cutout: Cutout;
  url: string;
}

export interface RemoveBackgroundModalProps {
  open: boolean;
  onClose: () => void;
  /** Pictures handed over by another tool (a freshly generated image); they replace whatever was picked. */
  initialFiles?: File[];
}

export function RemoveBackgroundModal({ open, onClose, initialFiles }: RemoveBackgroundModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [prefs, setPrefs] = useState<MattingPrefs>(loadMattingPrefs);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Done[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const installed = useInstalledMattingModels();
  const install = useMattingInstall();
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open || !initialFiles?.length) return;
    setFiles(initialFiles);
    setResults(null);
    setSaved(null);
    setError(null);
  }, [open, initialFiles]);

  // The worker holds the model and the runtime: a few hundred MB that should
  // not outlive the tool.
  useEffect(() => {
    if (open) return;
    releaseMatting();
  }, [open]);
  useEffect(() => () => releaseMatting(), []);

  const urls = useRef<string[]>([]);
  function dropResults() {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setResults(null);
    setSaved(null);
    setCopied(false);
    setError(null);
    setSelected(0);
  }
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const current = results?.[Math.min(selected, results.length - 1)] ?? null;
  const originalUrl = useMemo(() => (current ? URL.createObjectURL(current.source) : null), [current]);
  useEffect(
    () => () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    },
    [originalUrl],
  );

  if (!open) return null;

  function update(patch: Partial<MattingPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveMattingPrefs(next);
    dropResults();
  }

  const model = mattingModel(prefs.model) ?? MATTING_MODELS[0];
  const ready = installed?.[model.id] === true;
  const format = effectiveFormat(prefs);

  async function run() {
    if (!files.length || busy || !ready) return;
    setBusy(true);
    dropResults();
    cancelled.current = false;
    const out: Done[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        if (cancelled.current) break;
        const file = files[i];
        setProgress({ done: i, total: files.length, name: file.name });
        const cutout = await removeBackground(file, prefs);
        const url = URL.createObjectURL(cutout.blob);
        urls.current.push(url);
        out.push({ name: `${baseName(file.name, "image")}-cutout.${CUTOUT_EXT[cutout.format]}`, source: file, cutout, url });
        setResults([...out]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Background removal failed.");
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  async function save() {
    if (!results?.length) return;
    try {
      if (results.length === 1) {
        setSaved(await saveBlob(results[0].cutout.blob, results[0].name));
        return;
      }
      const entries = await Promise.all(
        results.map(async (r) => ({ name: r.name, data: new Uint8Array(await r.cutout.blob.arrayBuffer()) })),
      );
      setSaved(await saveBlob(await zipBlobs(entries), "cutouts.zip"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the file.");
    }
  }

  async function copy() {
    if (!current) return;
    try {
      // The clipboard takes PNG only; a WebP or JPG result is re-encoded for it.
      let blob = current.cutout.blob;
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
      setError(err instanceof Error ? err.message : "Couldn't copy the image.");
    }
  }

  const slow = current && current.cutout.backend === "wasm" && model.backends.includes("webgpu");
  const nothingFound = current && current.cutout.coverage < 0.004;

  return (
    <ToolModal
      title="Remove background"
      subtitle="Photos in, the subject out - on a transparent, coloured or blurred background. Nothing leaves this device."
      onClose={onClose}
      busy={busy}
      wide="xl"
      status={<SavedLine outcome={saved} />}
      footer={
        <>
          <button
            className="btn btn-secondary flex-1"
            onClick={() => {
              if (busy) cancelled.current = true;
              else onClose();
            }}
          >
            {busy ? "Stop after this one" : "Close"}
          </button>
          {results && !busy ? (
            <>
              {results.length === 1 ? (
                <button className="btn btn-secondary flex-1" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy"}
                </button>
              ) : null}
              <button className="btn btn-primary flex-1" onClick={() => void save()}>
                {results.length === 1 ? `Save .${CUTOUT_EXT[results[0].cutout.format]}` : `Save ${results.length} files (.zip)`}
              </button>
            </>
          ) : (
            <button className="btn btn-primary flex-1" disabled={busy || !files.length || !ready} onClick={() => void run()}>
              {busy ? "Working…" : files.length > 1 ? `Remove ${files.length} backgrounds` : "Remove background"}
            </button>
          )}
        </>
      }
    >
      <div className="img-split">
        <div className="img-split-side">
          <FilePicker
            files={files}
            onChange={(next) => {
              setFiles(next);
              dropResults();
            }}
            accept="image/png,image/jpeg,image/webp,image/avif,image/bmp,image/gif"
            multiple
            disabled={busy}
            hint="…or drop photos here"
            filter={isPhoto}
          />

          <ToolRow label="Model">
            <select
              className="field h-9 w-full"
              value={prefs.model}
              disabled={busy}
              onChange={(e) => update({ model: e.target.value as MattingModelId })}
            >
              {MATTING_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {installed && !installed[m.id] ? " (not installed)" : ""}
                </option>
              ))}
            </select>
          </ToolRow>
          <ToolNote>{model.goodFor}</ToolNote>

          {installed && !ready ? <MattingModelRows only={model.id} /> : null}

          <ToolRow label="Background">
            <select
              className="field h-9 w-full"
              value={prefs.backdrop}
              disabled={busy}
              onChange={(e) => update({ backdrop: e.target.value as BackdropChoice })}
            >
              {BACKDROPS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            {prefs.backdrop === "color" ? (
              <input
                type="color"
                className="img-color"
                aria-label="Background colour"
                value={prefs.color}
                disabled={busy}
                onChange={(e) => update({ color: e.target.value })}
              />
            ) : null}
          </ToolRow>

          <ToolRow label="Edge">
            <select
              className="field h-9 w-full"
              value={prefs.edge}
              disabled={busy}
              onChange={(e) => update({ edge: e.target.value as EdgeStyle })}
            >
              {EDGES.map((edge) => (
                <option key={edge.value} value={edge.value}>
                  {edge.label}
                </option>
              ))}
            </select>
          </ToolRow>
          <ToolNote>{EDGES.find((edge) => edge.value === prefs.edge)?.hint}</ToolNote>

          <ToolRow label="Format">
            <select
              className="field h-9 w-full"
              value={format}
              disabled={busy}
              onChange={(e) => update({ format: e.target.value as MattingPrefs["format"] })}
            >
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
              {prefs.backdrop !== "transparent" ? <option value="jpeg">JPG</option> : null}
            </select>
          </ToolRow>

          <label className="img-check">
            <input
              type="checkbox"
              checked={prefs.trim && prefs.backdrop !== "blur"}
              disabled={busy || prefs.backdrop === "blur"}
              onChange={(e) => update({ trim: e.target.checked })}
            />
            Crop to the subject
          </label>
          <label className="img-check">
            <input type="checkbox" checked={prefs.cpuOnly} disabled={busy} onChange={(e) => update({ cpuOnly: e.target.checked })} />
            Don't use the graphics card
          </label>
        </div>

        <div className="img-split-main">
          <div className={`img-stage${current ? " has-image" : ""}`}>
            {current ? (
              <img
                src={comparing && originalUrl ? originalUrl : current.url}
                alt={comparing ? "Original" : "Background removed"}
                draggable={false}
              />
            ) : (
              <p className="img-stage-empty">
                {busy ? "Working on the first one…" : "The cut-out shows up here."}
              </p>
            )}
            {current ? (
              <button
                type="button"
                className="img-compare"
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") setComparing(true);
                }}
                onKeyUp={() => setComparing(false)}
              >
                {comparing ? "Original" : "Hold to compare"}
              </button>
            ) : null}
          </div>

          {results && results.length > 1 ? (
            <div className="img-strip" role="listbox" aria-label="Results">
              {results.map((r, i) => (
                <button
                  key={r.url}
                  type="button"
                  role="option"
                  aria-selected={i === selected}
                  className={`img-thumb${i === selected ? " active" : ""}`}
                  title={r.name}
                  onClick={() => setSelected(i)}
                >
                  <img src={r.url} alt="" draggable={false} />
                </button>
              ))}
            </div>
          ) : null}

          {current ? (
            <ToolNote>
              {current.cutout.width}×{current.cutout.height} · {formatBytes(current.cutout.blob.size)} ·{" "}
              {(current.cutout.ms / 1000).toFixed(1)} s on the {current.cutout.backend === "webgpu" ? "graphics card" : "processor"}
            </ToolNote>
          ) : null}
          {nothingFound ? (
            <ToolNote>The model found no subject in this one. The other model may see it differently.</ToolNote>
          ) : null}
          {slow && !prefs.cpuOnly ? (
            <ToolNote>No usable graphics card was found, so this ran on the processor - it works, just slower.</ToolNote>
          ) : null}
        </div>
      </div>

      {busy && progress ? (
        <ToolProgress
          value={progress.total > 1 ? progress.done / progress.total : null}
          label={
            install.installing
              ? undefined
              : `${progress.done + 1} of ${progress.total} · ${progress.name}${progress.done === 0 ? " · the first one also starts the model" : ""}`
          }
        />
      ) : null}
      {error ? <ToolError>{error}</ToolError> : null}
    </ToolModal>
  );
}
