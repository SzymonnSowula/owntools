"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import { WinDots, ToolIcons } from "../../components/WinDots";
import {
  APPLE_BLUE,
  DURATIONS,
  FORMATS,
  LaunchVideo,
  STYLES,
  buildScript,
  compositionFor,
  defaultLaunchInput,
  dominantAccent,
  exportFileName,
  newSeed,
  normalizeAccent,
  renderLaunchVideo,
  seedFor,
  styleById,
  type DurationId,
  type FormatId,
  type LaunchInput,
  type LaunchIntel,
  type StyleId,
} from "@owntools/launch-engine";

type Stage = "input" | "pipeline" | "studio";

const STEPS = [
  { title: "reading your site", detail: "pulling your copy, colours and screenshots" },
  { title: "building your brand kit", detail: "accent, palette, logo, type" },
  { title: "writing the script", detail: "picking an arc and cutting it to length" },
  { title: "filming & cutting", detail: "warming up fonts and frames" },
] as const;

const DEFAULT_INPUT: LaunchInput = defaultLaunchInput({ name: "yourapp" });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Runs `work` but keeps the step on screen for at least `minMs`. */
async function paced<T>(minMs: number, work: () => Promise<T>): Promise<T> {
  const [result] = await Promise.all([work(), sleep(minMs)]);
  return result;
}

function canEncode(): boolean {
  return typeof window !== "undefined" && typeof (window as { VideoEncoder?: unknown }).VideoEncoder !== "undefined";
}

export default function LaunchMakerClient() {
  const [stage, setStage] = useState<Stage>("input");
  const [url, setUrl] = useState("");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [input, setInput] = useState<LaunchInput>(DEFAULT_INPUT);
  const [featuresText, setFeaturesText] = useState(DEFAULT_INPUT.features.join("\n"));
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  // elapsed clock for the pipeline card
  useEffect(() => {
    if (stage !== "pipeline") return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, [stage]);

  const host = useMemo(() => {
    try {
      return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
    } catch {
      return url || "your-site";
    }
  }, [url]);

  const composition = useMemo(() => compositionFor(input), [input]);
  const script = useMemo(() => buildScript(input), [input]);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      active ? "border-accent bg-accent/10 text-accent" : "border-line bg-card text-muted hover:text-ink"
    }`;

  const applyFeatures = useCallback((text: string) => {
    setFeaturesText(text);
    setInput((s) => ({
      ...s,
      features: text.split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 3),
    }));
  }, []);

  async function runPipeline() {
    if (!url.trim()) return;
    const runId = ++runIdRef.current;
    setError(null);
    setElapsed(0);
    setStage("pipeline");
    setStep(0);
    try {
      // 1 · reading your site
      const intel = await paced(900, async () => {
        const res = await fetch(`/api/launch-intel?url=${encodeURIComponent(url.trim())}`);
        const body = (await res.json()) as LaunchIntel & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Couldn't read that page.");
        return body;
      });
      if (runId !== runIdRef.current) return;

      // 2 · building your brand kit
      setStep(1);
      const accent = await paced(800, async () => {
        if (intel.accent) return normalizeAccent(intel.accent);
        const source = intel.logoDataUrl ?? intel.imageDataUrl;
        if (source) {
          const dominant = await dominantAccent(source);
          if (dominant) return dominant;
        }
        return APPLE_BLUE;
      });
      if (runId !== runIdRef.current) return;

      // 3 · writing the script
      setStep(2);
      const nextInput: LaunchInput = {
        ...input, // keep whatever style / format / length the studio is set to
        name: intel.name || DEFAULT_INPUT.name,
        tagline: intel.tagline || DEFAULT_INPUT.tagline,
        features: intel.features.slice(0, 4),
        url: intel.url,
        accent,
        imageDataUrl: intel.imageDataUrl,
        logoDataUrl: intel.logoDataUrl,
        watermark: true,
        seed: seedFor(intel.name || DEFAULT_INPUT.name, intel.url),
      };
      await paced(800, async () => {
        buildScript(nextInput); // deterministic — instant, but it IS the writer
      });
      if (runId !== runIdRef.current) return;

      // 4 · filming & cutting — fonts + image decode, then the player takes over
      setStep(3);
      await paced(900, async () => {
        try {
          await document.fonts.ready;
        } catch {
          /* fonts API unavailable — the player will still render */
        }
      });
      if (runId !== runIdRef.current) return;

      setInput(nextInput);
      setFeaturesText(nextInput.features.join("\n"));
      setStep(4);
      await sleep(350);
      if (runId !== runIdRef.current) return;
      setStage("studio");
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStage("input");
    }
  }

  function startBlank() {
    setInput(DEFAULT_INPUT);
    setFeaturesText(DEFAULT_INPUT.features.join("\n"));
    setStage("studio");
  }

  function loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setInput((s) => ({ ...s, imageDataUrl: reader.result as string }));
    reader.readAsDataURL(file);
  }

  async function exportVideo() {
    setExporting(true);
    setExportError(null);
    setExportProgress(0);
    abortRef.current = new AbortController();
    try {
      const { blob, ext } = await renderLaunchVideo(input, {
        signal: abortRef.current.signal,
        onProgress: setExportProgress,
      });
      const dl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dl;
      a.download = exportFileName(input, ext);
      a.click();
      setTimeout(() => URL.revokeObjectURL(dl), 2000);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setExportError(err instanceof Error ? err.message : "Export failed.");
      }
    } finally {
      setExporting(false);
    }
  }

  /* --------------------------------- input -------------------------------- */

  if (stage === "input") {
    return (
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-10">
        <div className="wincard">
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.launch} />
            <span className="wincard-title">new-launch.mp4 · 0:30</span>
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-sm text-muted">
              paste your product&apos;s URL - we read the page, build a brand kit, write a
              30-second script and cut the video. all in your browser.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                className="w-full rounded-full border border-line bg-card px-5 py-3 text-[15px] outline-none focus:border-accent"
                placeholder="yourproduct.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runPipeline()}
                autoFocus
              />
              <button
                className="btn btn-accent shrink-0 rounded-full px-6 text-sm font-semibold"
                onClick={() => void runPipeline()}
                disabled={!url.trim()}
              >
                make my video
              </button>
            </div>
            {error ? <p className="mt-3 text-xs font-medium text-[#ff453a]">{error}</p> : null}
            <button className="mt-4 text-xs font-semibold text-muted underline decoration-line underline-offset-4 hover:text-ink" onClick={startBlank}>
              or start from a blank brief →
            </button>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          nothing is uploaded - the page is fetched once, the video renders on your device.
        </p>
      </div>
    );
  }

  /* -------------------------------- pipeline ------------------------------- */

  if (stage === "pipeline") {
    const progress = Math.min(1, (step + 0.5) / STEPS.length);
    return (
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-10">
        <div className="wincard">
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.launch} />
            <span className="wincard-title">making your video…</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              <span className="ml-1.5 font-sans font-normal">elapsed</span>
            </span>
          </div>
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                <span className="absolute inset-0 animate-spin rounded-full border-2 border-line border-t-accent" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{host}</p>
                <p className="truncate text-xs text-muted">{STEPS[Math.min(step, 3)].detail}</p>
              </div>
            </div>

            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-700"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>

            <ol className="mt-5 grid gap-2">
              {STEPS.map((s, i) => {
                const state = i < step ? "done" : i === step ? "active" : "todo";
                return (
                  <li
                    key={s.title}
                    className={`flex items-center gap-3 rounded-[12px] border px-4 py-3 transition-colors ${
                      state === "active"
                        ? "border-accent/40 bg-accent/10"
                        : state === "done"
                          ? "border-line bg-card"
                          : "border-transparent"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        state === "done"
                          ? "bg-accent text-white"
                          : state === "active"
                            ? "border border-accent text-accent"
                            : "border border-line text-muted"
                      }`}
                    >
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    <span className={`text-sm font-semibold ${state === "todo" ? "text-muted" : "text-ink"}`}>
                      {s.title}
                    </span>
                    {state === "active" ? (
                      <span className="ml-auto text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
                        working
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            <div className="mt-5 flex aspect-video items-center justify-center rounded-[12px] border border-line bg-[#101014]">
              <p className="text-xs text-[#9a9aa1]">your 30-second cut appears here</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------- studio -------------------------------- */

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-5 pb-24 pt-10 lg:grid-cols-[340px_1fr]">
      <div>
        <div className="flex gap-2">
          <input
            className="w-full rounded-full border border-line bg-card px-4 py-2 text-sm outline-none focus:border-accent"
            placeholder="yourproduct.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runPipeline()}
          />
          <button className="shrink-0 rounded-full border border-line bg-card px-4 py-2 text-xs font-semibold hover:border-accent/50" onClick={() => void runPipeline()}>
            remake
          </button>
        </div>
        {error ? <p className="mt-2 text-xs font-medium text-[#ff453a]">{error}</p> : null}

        <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          product name
          <input
            className="mt-1 w-full rounded-[12px] border border-line bg-card px-3 py-2 text-sm"
            value={input.name}
            onChange={(e) => setInput((s) => ({ ...s, name: e.target.value }))}
          />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          tagline
          <input
            className="mt-1 w-full rounded-[12px] border border-line bg-card px-3 py-2 text-sm"
            value={input.tagline}
            onChange={(e) => setInput((s) => ({ ...s, tagline: e.target.value }))}
          />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          features (one per line, max 4)
          <textarea
            className="mt-1 min-h-24 w-full rounded-[12px] border border-line bg-card px-3 py-2 text-sm"
            value={featuresText}
            onChange={(e) => applyFeatures(e.target.value)}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
            accent
            <input
              type="color"
              className="ml-2 h-7 w-12 rounded border border-line align-middle"
              value={input.accent}
              onChange={(e) => setInput((s) => ({ ...s, accent: e.target.value }))}
            />
          </label>
          <div className="flex overflow-hidden rounded-full border border-line">
            {(["day", "night"] as const).map((t) => (
              <button
                key={t}
                className={`px-3 py-1.5 text-xs font-semibold ${input.theme === t ? "bg-ink text-paper" : "bg-card text-muted"}`}
                onClick={() => setInput((s) => ({ ...s, theme: t }))}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold hover:border-accent/50" onClick={() => imageInputRef.current?.click()}>
            {input.imageDataUrl ? "replace screenshot" : "add screenshot"}
          </button>
          {input.imageDataUrl ? (
            <button className="text-xs text-muted underline" onClick={() => setInput((s) => ({ ...s, imageDataUrl: null }))}>
              remove
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


        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.1em] text-muted">style</p>
        <div className="mt-2 grid gap-2">
          {STYLES.map((st) => (
            <button
              key={st.id}
              className={`rounded-[12px] border px-3 py-2.5 text-left transition ${
                input.style === st.id ? "border-accent bg-accent/10" : "border-line bg-card hover:border-accent/40"
              }`}
              onClick={() => setInput((s) => ({ ...s, style: st.id as StyleId }))}
            >
              <span className="text-sm font-semibold text-ink">{st.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{st.desc}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">format</p>
            <div className="mt-2 flex gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  title={f.desc}
                  className={chip(input.format === f.id)}
                  onClick={() => setInput((s) => ({ ...s, format: f.id as FormatId }))}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">length</p>
            <div className="mt-2 flex gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.id}
                  title={d.desc}
                  className={chip(input.seconds === d.id)}
                  onClick={() => setInput((s) => ({ ...s, seconds: d.id as DurationId }))}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold hover:border-accent/50"
            onClick={() => setInput((s) => ({ ...s, seed: newSeed() }))}
          >
            new take
          </button>
          <p className="text-xs text-muted">
            take #{input.seed} · {script.arc} arc · {script.beats.length} shots
          </p>
        </div>

        <div className="mt-5 rounded-[12px] border border-line bg-card px-3 py-2.5 text-xs text-muted">
          every cut runs exactly{" "}
          <span className="font-semibold text-ink">{input.seconds} seconds</span>. the free
          web version adds a &quot;made with owntools&quot; badge —{" "}
          <Link className="font-semibold text-accent underline" href="/#pricing">the desktop app</Link>{" "}
          removes it with a Pro key.
        </div>
      </div>

      <div className="min-w-0">
        <div className="wincard">
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.launch} />
            <span className="wincard-title">
              {(input.name || "launch").toLowerCase().replace(/\s+/g, "-")}-launch.mp4 ·{" "}
              {DURATIONS.find((d) => d.id === input.seconds)?.label ?? `${input.seconds}s`}
            </span>
          </div>
          <div className="bg-[#101014] p-3">
            <Player
              key={`${input.format}-${input.seconds}`}
              component={LaunchVideo}
              inputProps={{ input }}
              durationInFrames={composition.durationInFrames}
              fps={composition.fps}
              compositionWidth={composition.width}
              compositionHeight={composition.height}
              controls
              loop
              autoPlay
              acknowledgeRemotionLicense
              style={{
                width: "100%",
                maxHeight: "70vh",
                aspectRatio: `${composition.width} / ${composition.height}`,
                borderRadius: 8,
                overflow: "hidden",
                margin: "0 auto",
              }}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted">
            {composition.width}×{composition.height} · {composition.fps} fps · {styleById(input.style).label} ·
            renders on your device
          </p>
          <div className="flex-1" />
          {!canEncode() ? (
            <p className="text-xs text-muted">export needs Chrome or Edge — or grab the desktop app.</p>
          ) : exporting ? (
            <div className="flex items-center gap-3">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(exportProgress * 100)}%` }} />
              </div>
              <span className="text-xs tabular-nums text-muted">{Math.round(exportProgress * 100)}% · filming &amp; cutting…</span>
              <button className="text-xs font-semibold text-muted underline" onClick={() => abortRef.current?.abort()}>
                cancel
              </button>
            </div>
          ) : (
            <button className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:opacity-90" onClick={() => void exportVideo()}>
              export mp4 — free
            </button>
          )}
        </div>
        {exportError ? <p className="mt-2 text-xs font-medium text-[#ff453a]">{exportError}</p> : null}
      </div>
    </div>
  );
}
