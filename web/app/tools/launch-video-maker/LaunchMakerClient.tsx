"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WinDots, ToolIcons } from "../../components/WinDots";
import { buildScenes, drawAtTime, totalDuration, TEMPLATES, type LaunchSpec, type TemplateId } from "../../../lib/scenes";
import { canRenderInBrowser, renderInBrowser } from "../../../lib/renderWeb";

export default function LaunchMakerClient() {
  const [name, setName] = useState("yourapp");
  const [tagline, setTagline] = useState("the fastest way to do the thing");
  const [featuresText, setFeaturesText] = useState("set up in 30 seconds\nworks offline\nno subscription");
  const [accent, setAccent] = useState("#0a84ff");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [template, setTemplate] = useState<TemplateId>("keynote");
  const [playing, setPlaying] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const encodable = useMemo(() => (typeof window === "undefined" ? true : canRenderInBrowser()), []);

  const spec: LaunchSpec = useMemo(
    () => ({
      name: name.trim() || "yourapp",
      tagline: tagline.trim() || "one line about why it matters",
      features: featuresText.split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 4),
      url: "",
      accent,
      image,
    }),
    [name, tagline, featuresText, accent, image],
  );

  const scenes = useMemo(() => buildScenes(template, spec), [template, spec]);
  const duration = totalDuration(scenes);

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
      if (playing && !exporting) timeRef.current = (timeRef.current + dt) % duration;
      drawAtTime(ctx, canvas.width, canvas.height, timeRef.current, scenes, spec);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scenes, spec, playing, duration, exporting]);

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
    setError(null);
    setProgress(0);
    try {
      const { blob, ext } = await renderInBrowser(template, spec, setProgress);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${spec.name.replace(/[^\w-]+/g, "_")}-launch.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Export failed.");
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-5 pb-20 pt-10 lg:grid-cols-[340px_1fr]">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          product name
          <input className="mt-1 w-full rounded-[12px] border border-line bg-card px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          tagline
          <input className="mt-1 w-full rounded-[12px] border border-line bg-card px-3 py-2 text-sm" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          features (one per line, max 4)
          <textarea className="mt-1 min-h-24 w-full rounded-[12px] border border-line bg-card px-3 py-2 text-sm" value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
            accent
            <input type="color" className="ml-2 h-7 w-12 rounded border border-line align-middle" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </label>
          <button className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold hover:bg-white" onClick={() => imageInputRef.current?.click()}>
            {image ? "replace screenshot" : "add screenshot"}
          </button>
          {image ? (
            <button className="text-xs text-muted underline" onClick={() => setImage(null)}>remove</button>
          ) : null}
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImageFile(f); e.currentTarget.value = ""; }} />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-muted">template</p>
        <div className="mt-2 grid gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`rounded-[12px] border px-3 py-2.5 text-left text-sm ${template === t.id ? "border-accent bg-accent/10" : "border-line bg-card"}`}
              onClick={() => { setTemplate(t.id); timeRef.current = 0; }}
            >
              <span className="font-semibold">{t.label}</span>
              <span className="ml-2 text-xs text-muted">{t.desc}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-[12px] border border-line bg-card px-3 py-2.5 text-xs text-muted">
          The free web version renders 720p/30 with a "made with shipshape" badge.{" "}
          <a className="font-semibold text-accent underline" href="/#pricing">The desktop app</a> does 1080p/60,
          pulls everything from your URL automatically — and Pro removes the badge.
        </div>
      </div>

      <div className="min-w-0">
        <div className="wincard">
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.launch} />
            <span className="wincard-title">{name.trim().toLowerCase().replace(/\s+/g, "-") || "yourapp"}-launch.mp4 · {duration.toFixed(1)}s</span>
          </div>
          <div className="flex items-center justify-center bg-[#101012] p-3">
            <canvas ref={canvasRef} width={1280} height={720} className="max-h-[62vh] w-full max-w-full rounded-[8px]" style={{ aspectRatio: "16 / 9" }} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="h-9 w-9 rounded-full border border-line bg-card font-semibold" onClick={() => setPlaying((p) => !p)}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold" onClick={() => { timeRef.current = 0; }}>
            restart
          </button>
          <div className="flex-1" />
          {!encodable ? (
            <p className="text-xs text-muted">Export needs Chrome or Edge — or grab the desktop app.</p>
          ) : exporting ? (
            <div className="flex items-center gap-3">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="text-xs text-muted">rendering…</span>
            </div>
          ) : (
            <button className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-black" onClick={() => void exportVideo()}>
              export video — free
            </button>
          )}
        </div>
        {error ? <p className="mt-2 text-xs text-[#ff453a]">{error}</p> : null}
      </div>
    </div>
  );
}
