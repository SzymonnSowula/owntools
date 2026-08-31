import { useEffect, useMemo, useRef, useState } from "react";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { isPro } from "@licensing/license";
import { blobToFileDownload } from "@feature-editor/lib/exportVideo";
import { exportBlobToPath } from "@feature-editor/lib/projectIo";
import { analyzeUrl } from "./pageIntel";
import { buildScenes, drawAtTime, totalDuration, TEMPLATES, type LaunchSpec, type TemplateId } from "./scenes";
import { renderLaunchVideo } from "./renderLaunch";

const DEFAULT_ACCENT = "#6b5bff";

export default function LaunchView() {
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [featuresText, setFeaturesText] = useState("");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [template, setTemplate] = useState<TemplateId>("keynote");
  const [playing, setPlaying] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const spec: LaunchSpec = useMemo(
    () => ({
      name: name.trim() || "your product",
      tagline: tagline.trim() || "one line about why it matters",
      features: featuresText
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
        .slice(0, 4),
      url: url.trim(),
      accent,
      image,
    }),
    [name, tagline, featuresText, url, accent, image],
  );

  const scenes = useMemo(() => buildScenes(template, spec), [template, spec]);
  const duration = totalDuration(scenes);

  // Preview loop — deterministic drawAtTime, so it matches the export exactly.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      if (playing && !exporting) {
        timeRef.current = (timeRef.current + dt) % duration;
      }
      drawAtTime(ctx, canvas.width, canvas.height, timeRef.current, scenes, spec);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scenes, spec, playing, duration, exporting]);

  async function analyze() {
    if (!url.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const intel = await analyzeUrl(url.trim());
      setName(intel.name);
      setTagline(intel.tagline);
      setFeaturesText(intel.features.join("\n"));
      if (intel.accent && /^#([0-9a-f]{3}){1,2}$/i.test(intel.accent)) setAccent(intel.accent);
      if (intel.imageDataUrl) {
        const img = new Image();
        img.onload = () => setImage(img);
        img.src = intel.imageDataUrl;
      } else {
        setImage(null);
      }
      timeRef.current = 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that page.");
    } finally {
      setAnalyzing(false);
    }
  }

  function loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setImage(img);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function exportVideo() {
    setExporting(true);
    setExportProgress(0);
    abortRef.current = new AbortController();
    try {
      const { blob, ext } = await renderLaunchVideo(template, spec, {
        watermark: !isPro(),
        signal: abortRef.current.signal,
        onProgress: setExportProgress,
      });
      const base = (spec.name || "launch").replace(/[^\w-]+/g, "_");
      const saved = await exportBlobToPath(blob, `${base}-launch.${ext}`, ext);
      if (!saved) await blobToFileDownload(blob, `${base}-launch.${ext}`);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Export failed.");
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="desktop-bg flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6 lg:flex-row lg:overflow-hidden">
      {/* Left: brief */}
      <div className="scroll-thin w-full shrink-0 pr-1 lg:w-[340px] lg:overflow-y-auto">
        <h1 className="text-[34px] font-bold leading-none tracking-[-0.05em] text-ink">launch</h1>
        <p className="mt-2 text-sm text-muted">
          Paste your product's URL — we'll pull the name, tagline, colors and hero shot. Tweak
          anything, pick a template, export MP4.
        </p>

        <div className="mt-5 flex gap-2">
          <input
            className="field"
            placeholder="https://yourproduct.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void analyze()}
          />
          <button className="btn btn-primary shrink-0" disabled={analyzing} onClick={() => void analyze()}>
            {analyzing ? "Reading…" : "Fetch"}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-coral">{error}</p> : null}

        <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          Name
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          Tagline
          <input className="field mt-1" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          Features (one per line, max 4)
          <textarea
            className="field mt-1 min-h-24"
            value={featuresText}
            onChange={(e) => setFeaturesText(e.target.value)}
          />
        </label>
        <div className="mt-3 flex items-center gap-4">
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
            Accent
            <input
              type="color"
              className="ml-2 h-7 w-12 rounded border border-line align-middle"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
            />
          </label>
          <button className="btn btn-secondary h-8 px-3 text-xs" onClick={() => imageInputRef.current?.click()}>
            {image ? "Replace image" : "Add image"}
          </button>
          {image ? (
            <button className="btn btn-ghost h-8 px-2 text-xs" onClick={() => setImage(null)}>
              Remove
            </button>
          ) : null}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadImageFile(f);
              e.currentTarget.value = "";
            }}
          />
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.1em] text-muted">Template</p>
        <div className="mt-2 grid gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`rounded-[12px] border px-3 py-2.5 text-left text-sm ${
                template === t.id ? "border-teal bg-teal/10" : "border-line bg-card"
              }`}
              onClick={() => {
                setTemplate(t.id);
                timeRef.current = 0;
              }}
            >
              <span className="font-semibold">{t.label}</span>
              <span className="ml-2 text-xs text-muted">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: preview */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="wincard flex-1" style={{ minHeight: 0 }}>
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.launch} />
            <span className="wincard-title">
              {(spec.name || "launch").toLowerCase()}-launch.mp4 · {duration.toFixed(1)}s
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-[#111015] p-4">
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              className="max-h-full max-w-full rounded-[10px]"
              style={{ aspectRatio: "16 / 9" }}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn btn-secondary h-9 w-9 p-0" onClick={() => setPlaying((p) => !p)}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button
            className="btn btn-ghost h-9 px-3 text-xs"
            onClick={() => {
              timeRef.current = 0;
            }}
          >
            Restart
          </button>
          <div className="flex-1" />
          {exporting ? (
            <div className="flex items-center gap-3">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-teal transition-[width]"
                  style={{ width: `${Math.round(exportProgress * 100)}%` }}
                />
              </div>
              <button className="btn btn-secondary h-9 px-3 text-xs" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => void exportVideo()}>
              Export MP4
            </button>
          )}
        </div>
        {!isPro() ? (
          <p className="mt-2 text-right text-xs text-muted">
            Free version adds a small "made with shipshape" badge — a Pro key removes it.
          </p>
        ) : null}
      </div>
    </div>
  );
}
