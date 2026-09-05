import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { PRICING_URL } from "@core/branding";
import { isPro } from "@licensing/license";
import { blobToFileDownload, probeExportSupport } from "@feature-editor/lib/exportVideo";
import { exportBlobToPath } from "@feature-editor/lib/projectIo";
import { analyzeUrl } from "./pageIntel";
import {
  DURATIONS,
  FORMATS,
  LaunchVideo,
  STYLES,
  buildScript,
  compositionFor,
  defaultLaunchInput,
  dominantAccent,
  exportFileName,
  normalizeAccent,
  renderLaunchVideo,
  newSeed,
  seedFor,
  styleById,
  type DurationId,
  type FormatId,
  type LaunchInput,
  type StyleId,
} from "./engine";
import {
  STORE_GROUPS,
  targetById,
  targetRatio,
  targetSize,
  targetsFor,
  type StoreId,
} from "./shots/targets";
import { buildShotPrompts, shotsToMarkdown } from "./shots/prompts";

type Mode = "video" | "shots";

/**
 * The launch studio. One brief — name, tagline, features, accent, screenshot —
 * feeds two outputs: a rendered launch video, and a set of store-screenshot
 * prompts. The brief panel is shared, so switching modes never means retyping.
 */
export default function LaunchView() {
  const [mode, setMode] = useState<Mode>("video");
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<LaunchInput>(() => defaultLaunchInput({ name: "", tagline: "" }));
  const [featuresText, setFeaturesText] = useState(defaultLaunchInput().features.join("\n"));
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [targetId, setTargetId] = useState("ios-6-9");
  const [shotCount, setShotCount] = useState(5);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((next: Partial<LaunchInput>) => setInput((s) => ({ ...s, ...next })), []);

  const style = styleById(input.style);
  const pro = isPro();

  // The brief the video actually renders from: blanks fall back to placeholders
  // so the preview is never empty, and the free tier always carries the badge.
  const spec: LaunchInput = useMemo(
    () => ({
      ...input,
      name: input.name.trim() || "your product",
      tagline: input.tagline.trim() || "one line about why it matters",
      features: featuresText
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
        .slice(0, 4),
      theme: style.forceTheme ?? input.theme,
      watermark: !pro,
    }),
    [input, featuresText, style, pro],
  );

  const composition = compositionFor(spec);
  const script = useMemo(() => buildScript(spec), [spec]);

  const target = targetById(targetId);
  const prompts = useMemo(
    () => buildShotPrompts(spec, target, shotCount),
    [spec, target, shotCount],
  );

  // Each target has its own idea of how many images the store wants.
  useEffect(() => {
    setShotCount(target.suggested);
  }, [target.id, target.suggested]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function analyze() {
    if (!url.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const intel = await analyzeUrl(url.trim());
      let accent = intel.accent ? normalizeAccent(intel.accent) : null;
      if (!accent) {
        const source = intel.logoDataUrl ?? intel.imageDataUrl;
        if (source) accent = await dominantAccent(source);
      }
      setFeaturesText(intel.features.join("\n"));
      patch({
        name: intel.name,
        tagline: intel.tagline,
        url: intel.url,
        accent: accent ?? input.accent,
        imageDataUrl: intel.imageDataUrl,
        logoDataUrl: intel.logoDataUrl,
        seed: seedFor(intel.name, intel.url),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that page.");
    } finally {
      setAnalyzing(false);
    }
  }

  function loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => patch({ imageDataUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setError("Clipboard is blocked — select the text and copy it manually.");
    }
  }

  async function saveShots() {
    const md = shotsToMarkdown(spec, target, prompts);
    const name = `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${target.id}-prompts.md`;
    const blob = new Blob([md], { type: "text/markdown" });
    const saved = await exportBlobToPath(blob, name, "md");
    if (!saved) await blobToFileDownload(blob, name);
  }

  async function exportVideo() {
    setExporting(true);
    setError(null);
    setExportProgress(0);
    abortRef.current = new AbortController();
    try {
      const support = await probeExportSupport(composition.width, composition.height);
      if (!support) throw new Error("Video encoding is unavailable in this environment.");
      const { blob, ext } = await renderLaunchVideo(spec, {
        container: support.container,
        signal: abortRef.current.signal,
        onProgress: setExportProgress,
      });
      const name = exportFileName(spec, ext);
      const saved = await exportBlobToPath(blob, name, ext);
      if (!saved) await blobToFileDownload(blob, name);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Export failed.");
      }
    } finally {
      setExporting(false);
    }
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      active ? "border-accent bg-accent/10 text-accent" : "border-line bg-card text-muted hover:text-ink"
    }`;

  const legend = "text-[11px] font-bold uppercase tracking-[0.14em] text-muted";

  return (
    <div className="desktop-bg mod-create flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 lg:flex-row lg:overflow-hidden">
      {/* ------------------------------ the brief ------------------------------ */}
      {/* Not a flex column: as flex items the cards would shrink against the
          scroller's bounded height and .wincard's overflow:hidden would clip
          their fields away. */}
      <div className="scroll-thin w-full shrink-0 space-y-4 pr-1 lg:w-[390px] lg:overflow-y-auto">
        <div>
          <h1 className="text-[32px] font-bold leading-none tracking-[-0.05em] text-ink">launch</h1>
          <p className="mt-2 text-[13px] leading-5 text-muted">
            One brief, two outputs: a launch video, and the store screenshots that go with it.
          </p>
        </div>

        {/* mode switch */}
        <div className="flex rounded-full border border-line bg-card p-1 shadow-sm">
          {(
            [
              ["video", "Video"],
              ["shots", "Store shots"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                mode === id ? "bg-accent text-white shadow" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="wincard">
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.launch} />
            <span className="wincard-title">brief</span>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex gap-2">
              <input
                className="field"
                placeholder="https://yourproduct.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void analyze()}
              />
              <button
                className="btn btn-primary shrink-0"
                disabled={analyzing}
                onClick={() => void analyze()}
              >
                {analyzing ? "Reading…" : "Fetch"}
              </button>
            </div>
            <p className="-mt-1 text-[11px] text-muted">
              Reads the page for a name, tagline, colors and a hero shot. Or just type it below.
            </p>

            <label className={`${legend} block`}>
              Name
              <input
                className="field mt-1.5"
                value={input.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label className={`${legend} block`}>
              Tagline
              <input
                className="field mt-1.5"
                value={input.tagline}
                onChange={(e) => patch({ tagline: e.target.value })}
              />
            </label>
            <label className={`${legend} block`}>
              Features — one per line, max 4
              <textarea
                className="field mt-1.5 min-h-20"
                value={featuresText}
                onChange={(e) => setFeaturesText(e.target.value)}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <label className={`${legend} flex items-center gap-2`}>
                Accent
                <input
                  type="color"
                  className="h-7 w-10 cursor-pointer rounded border border-line"
                  value={input.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                />
              </label>
              <div className="flex-1" />
              {input.imageDataUrl ? (
                <img
                  src={input.imageDataUrl}
                  alt=""
                  className="h-8 w-12 rounded border border-line object-cover"
                />
              ) : null}
              <button
                className="btn btn-secondary !h-8 !px-3 text-xs"
                onClick={() => imageInputRef.current?.click()}
              >
                {input.imageDataUrl ? "Replace" : "Add screenshot"}
              </button>
              {input.imageDataUrl ? (
                <button
                  className="btn btn-ghost !h-8 !px-2 text-xs"
                  onClick={() => patch({ imageDataUrl: null })}
                >
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
          </div>
        </div>

        {/* ------------------------------ the look ------------------------------ */}
        <div className="wincard">
          <div className="wincard-bar">
            <WinDots icon={ToolIcons.launch} />
            <span className="wincard-title">style</span>
          </div>
          <div className="flex flex-col gap-2 p-4">
            {STYLES.map((s) => (
              <button
                key={s.id}
                className={`rounded-[10px] border px-3 py-2 text-left transition ${
                  input.style === s.id
                    ? "border-accent bg-accent/8"
                    : "border-line bg-card hover:border-accent/40"
                }`}
                onClick={() => patch({ style: s.id as StyleId })}
              >
                <span className="text-[13px] font-semibold text-ink">{s.label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-4 text-muted">{s.desc}</span>
              </button>
            ))}
            <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className={legend}>Look</span>
              {(["day", "night"] as const).map((t) => (
                <button
                  key={t}
                  disabled={Boolean(style.forceTheme)}
                  className={`${pill(spec.theme === t)} ${style.forceTheme ? "opacity-40" : ""}`}
                  onClick={() => patch({ theme: t })}
                >
                  {t === "day" ? "Day" : "Night"}
                </button>
              ))}
              {style.forceTheme ? (
                <span className="text-[11px] text-muted">
                  {style.label} is always {style.forceTheme}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---------------------------- mode settings ---------------------------- */}
        {mode === "video" ? (
          <div className="wincard">
            <div className="wincard-bar">
              <WinDots icon={ToolIcons.launch} />
              <span className="wincard-title">the cut</span>
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div>
                <p className={legend}>Format</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      title={f.desc}
                      className={pill(input.format === f.id)}
                      onClick={() => patch({ format: f.id as FormatId })}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className={legend}>Length</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.id}
                      title={d.desc}
                      className={pill(input.seconds === d.id)}
                      onClick={() => patch({ seconds: d.id as DurationId })}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className={legend}>Take</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="btn btn-secondary !h-8 shrink-0 whitespace-nowrap !px-3 text-xs"
                    onClick={() => patch({ seed: newSeed() })}
                  >
                    New take
                  </button>
                  <input
                    className="field !h-8 !w-24 text-xs"
                    value={String(input.seed)}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, "").slice(0, 6));
                      if (Number.isFinite(n)) patch({ seed: n });
                    }}
                  />
                </div>
                <p className="mt-2 text-[11.5px] leading-4 text-muted">
                  #{input.seed} · {script.arc} arc · {script.beats.length} shots. Same number, same
                  cut — reroll until one clicks.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="wincard">
            <div className="wincard-bar">
              <WinDots icon={ToolIcons.launch} />
              <span className="wincard-title">where it's going</span>
            </div>
            <div className="flex flex-col gap-4 p-4">
              {STORE_GROUPS.map((group) => (
                <div key={group.id}>
                  <p className={legend}>{group.label}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {targetsFor(group.id as StoreId).map((t) => (
                      <button
                        key={t.id}
                        title={`${targetSize(t)} px`}
                        className={pill(targetId === t.id)}
                        onClick={() => setTargetId(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="border-t border-line pt-3">
                <p className={legend}>How many shots</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="btn btn-secondary !h-8 !w-8 !px-0 text-base"
                    onClick={() => setShotCount((c) => Math.max(1, c - 1))}
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{shotCount}</span>
                  <button
                    className="btn btn-secondary !h-8 !w-8 !px-0 text-base"
                    onClick={() => setShotCount((c) => Math.min(10, c + 1))}
                  >
                    +
                  </button>
                  <span className="ml-1 text-[11.5px] leading-4 text-muted">{target.requirement}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {error ? <p className="text-xs text-coral">{error}</p> : null}
        <div className="h-2" />
      </div>

      {/* ------------------------------- the output ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === "video" ? (
          <>
            <div className="wincard flex-1" style={{ minHeight: 0 }}>
              <div className="wincard-bar">
                <WinDots icon={ToolIcons.launch} />
                <span className="wincard-title">
                  {(spec.name || "launch").toLowerCase()}-launch.mp4 · {spec.seconds}s ·{" "}
                  {composition.width}×{composition.height}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-[#111015] p-4">
                <Player
                  key={`${spec.format}-${spec.seconds}`}
                  component={LaunchVideo}
                  inputProps={{ input: spec }}
                  durationInFrames={composition.durationInFrames}
                  fps={composition.fps}
                  compositionWidth={composition.width}
                  compositionHeight={composition.height}
                  style={{
                    maxHeight: "100%",
                    maxWidth: "100%",
                    aspectRatio: `${composition.width} / ${composition.height}`,
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                  controls
                  loop
                  autoPlay
                  acknowledgeRemotionLicense
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-muted">
                {style.label} · {script.arc}
              </span>
              <div className="flex-1" />
              {exporting ? (
                <div className="flex items-center gap-3">
                  <div className="h-2 w-40 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{ width: `${Math.round(exportProgress * 100)}%` }}
                    />
                  </div>
                  <button
                    className="btn btn-secondary !h-9 !px-3 text-xs"
                    onClick={() => abortRef.current?.abort()}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn btn-primary" onClick={() => void exportVideo()}>
                  Export MP4
                </button>
              )}
            </div>
            {!pro ? (
              <p className="mt-2 flex items-center justify-end gap-2 text-xs text-muted">
                <span>
                  Free version adds a small "made with shipshape" badge — a Pro key removes it.
                </span>
                <button
                  type="button"
                  className="btn btn-secondary !h-7 !px-2.5 text-xs"
                  onClick={() =>
                    void import("@tauri-apps/plugin-opener")
                      .then((m) => m.openUrl(PRICING_URL))
                      .catch(() => window.open(PRICING_URL, "_blank", "noopener,noreferrer"))
                  }
                >
                  Get Pro
                </button>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="wincard flex min-h-0 flex-1 flex-col">
              <div className="wincard-bar">
                <WinDots icon={ToolIcons.launch} />
                <span className="wincard-title">
                  {target.label} · {targetSize(target)} px · {targetRatio(target)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                <p className="min-w-0 flex-1 text-[12.5px] leading-5 text-muted">
                  {input.imageDataUrl
                    ? "Paste a prompt into your image tool and attach the screenshot above with it."
                    : "Add your app screenshot in the brief — every prompt below is written to wrap around it."}
                </p>
                <button
                  className="btn btn-secondary !h-8 !px-3 text-xs"
                  onClick={() =>
                    void copy(prompts.map((p) => p.prompt).join("\n\n———\n\n"), "all")
                  }
                >
                  {copied === "all" ? "Copied" : "Copy all"}
                </button>
                <button className="btn btn-primary !h-8 !px-3 text-xs" onClick={() => void saveShots()}>
                  Save .md
                </button>
              </div>

              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-3">
                  {prompts.map((p) => (
                    <div key={p.n} className="rounded-[12px] border border-line bg-card p-4">
                      <div className="flex items-start gap-3">
                        <span className="font-mono text-[11px] font-bold text-accent">
                          {String(p.n).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold leading-5 text-ink">{p.headline}</p>
                          {p.subhead ? (
                            <p className="mt-0.5 text-[12.5px] text-muted">{p.subhead}</p>
                          ) : null}
                          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                            {p.role} · show {p.screen}
                          </p>
                        </div>
                        <button
                          className="btn btn-secondary !h-8 shrink-0 !px-3 text-xs"
                          onClick={() => void copy(p.prompt, `p${p.n}`)}
                        >
                          {copied === `p${p.n}` ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <pre className="scroll-thin mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-[8px] border border-line bg-paper p-3 font-mono text-[11px] leading-[1.55] text-muted">
                        {p.prompt}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-2 text-right text-xs text-muted">
              Prompts, not pixels — a real image model does the render, this writes the brief it needs.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
