import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@core/env";
import { listDisplaySources } from "../lib/captureSources";
import { estimateCaptureRect, fitVideoOnMonitor } from "../lib/cursorMap";
import { DEFAULT_CURSOR_ALIGN } from "../lib/defaults";
import {
  LINEAR_GRADIENTS,
  SOLID_COLORS,
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  gradientCss,
  wallpaperThumbnail,
} from "../lib/wallpapers";
import { saveProjectAsset } from "../lib/projectIo";
import { transcribeCaptions, whisperReady } from "../lib/transcribe";
import { isJumpCut } from "../lib/segments";
import { SFX_PACKS, sfxPack, type SfxSoundId } from "../lib/sfx/packs";
import { sfxCounts, sfxPlanFor } from "../lib/sfx/plan";
import { sfxPreview } from "../lib/sfx/player";
import { DEFAULT_TRANSITION, MAX_TRANSITION, MIN_TRANSITION, TRANSITION_KINDS } from "../lib/transitions";
import { useAppStore } from "../store/appStore";
import type {
  BackgroundMode,
  CameraShape,
  CaptionStyle,
  CursorStyle,
  DisplaySources,
  OverlayFont,
  Project,
  TransitionKind,
  WebcamCorner,
} from "../types";

type Tab = "look" | "camera" | "cursor" | "zoom" | "text" | "cuts" | "audio";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "look", label: "Look", icon: <IconLook /> },
  { id: "camera", label: "Camera", icon: <IconCamera /> },
  { id: "cursor", label: "Cursor", icon: <IconCursor /> },
  { id: "zoom", label: "Zoom", icon: <IconZoom /> },
  { id: "text", label: "Text", icon: <IconText /> },
  { id: "cuts", label: "Cuts", icon: <IconCuts /> },
  { id: "audio", label: "Audio", icon: <IconAudio /> },
];

const MODES: { id: BackgroundMode; label: string }[] = [
  { id: "wallpaper", label: "Wallpaper" },
  { id: "image", label: "Image" },
  { id: "color", label: "Color" },
  { id: "gradient", label: "Gradient" },
];

export function Inspector() {
  const project = useAppStore((s) => s.project);
  const media = useAppStore((s) => s.media);
  const selection = useAppStore((s) => s.selection);
  const updateProject = useAppStore((s) => s.updateProject);
  const regenerateZooms = useAppStore((s) => s.regenerateZooms);
  const setExportOpen = useAppStore((s) => s.setExportOpen);
  const setSegmentTransition = useAppStore((s) => s.setSegmentTransition);
  const applyTransitionToAll = useAppStore((s) => s.applyTransitionToAll);
  const addCaption = useAppStore((s) => s.addCaption);
  const addText = useAppStore((s) => s.addText);
  const addOverlay = useAppStore((s) => s.addOverlay);
  const persistProject = useAppStore((s) => s.persistProject);
  const showToast = useAppStore((s) => s.showToast);
  const [tab, setTab] = useState<Tab>("look");
  const [category, setCategory] = useState(WALLPAPER_CATEGORIES[0].id);
  const [whisperOk, setWhisperOk] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sources, setSources] = useState<DisplaySources | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const overlayFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void whisperReady().then(setWhisperOk);
    void listDisplaySources().then(setSources).catch(() => setSources(null));
  }, []);

  // A click on the timeline opens the panel that edits what was clicked.
  useEffect(() => {
    if (!selection) return;
    if (selection.type === "zoom") setTab("zoom");
    else if (selection.type === "segment") setTab("cuts");
    else setTab("text");
  }, [selection]);

  useEffect(() => {
    if (!project) return;
    const wp = WALLPAPERS.find((w) => w.id === project.background.presetId);
    if (wp) setCategory(wp.category);
    // Only when the project changes identity, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  if (!project) return null;

  const bg = project.background;
  const patchBg = (patch: Partial<Project["background"]>, history = false) =>
    updateProject({ background: { ...project.background, ...patch } }, history);
  const patchCam = (patch: Partial<Project["webcam"]>, history = false) =>
    updateProject({ webcam: { ...project.webcam, ...patch } }, history);
  const patchCursor = (patch: Partial<Project["cursorStyle"]>, history = false) =>
    updateProject({ cursorStyle: { ...project.cursorStyle, ...patch } }, history);
  const patchBar = (patch: Partial<Project["progressBar"]>, history = false) =>
    updateProject({ progressBar: { ...project.progressBar, ...patch } }, history);
  const patchAudio = (patch: Partial<Project["audio"]>, history = false) =>
    updateProject({ audio: { ...project.audio, ...patch } }, history);
  const patchSfx = (patch: Partial<Project["sfx"]>, history = false) =>
    updateProject({ sfx: { ...project.sfx, ...patch } }, history);

  async function pickBackground(file: File) {
    if (!project) return;
    const url = URL.createObjectURL(file);
    useAppStore.setState((s) => ({ media: s.media ? { ...s.media, backgroundUrl: url } : s.media }));
    try {
      const saved = await saveProjectAsset(project.id, file, file.name, "bg");
      updateProject(
        {
          backgroundPath: saved?.rel ?? project.backgroundPath,
          background: { ...project.background, mode: "image", customImage: file.name },
        },
        true,
      );
      if (saved) await persistProject();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save the image.", "error");
    }
  }

  async function pickOverlay(file: File) {
    if (!project) return;
    const url = URL.createObjectURL(file);
    try {
      const saved = await saveProjectAsset(project.id, file, file.name, "img");
      addOverlay(saved?.name ?? file.name, url);
      if (saved) await persistProject();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't add the image.", "error");
    }
  }

  async function autoCaptions() {
    if (!media?.screenUrl || !project) return;
    setTranscribing(true);
    try {
      const captions = await transcribeCaptions(media.screenUrl, project.speechLang);
      if (!captions.length) {
        showToast("No speech detected in the recording.", "info");
      } else {
        updateProject({ captions: [...project.captions, ...captions] }, true);
        showToast(`Added ${captions.length} captions.`, "info");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Transcription failed.", "error");
    } finally {
      setTranscribing(false);
    }
  }

  const zoom = selection?.type === "zoom" ? project.zooms.find((z) => z.id === selection.id) : undefined;
  const caption =
    selection?.type === "caption" ? project.captions.find((c) => c.id === selection.id) : undefined;
  const text = selection?.type === "text" ? project.texts.find((t) => t.id === selection.id) : undefined;
  const overlay =
    selection?.type === "overlay" ? project.overlays.find((o) => o.id === selection.id) : undefined;
  const segmentIndex =
    selection?.type === "segment" ? project.segments.findIndex((s) => s.id === selection.id) : -1;
  const segment = segmentIndex >= 0 ? project.segments[segmentIndex] : undefined;
  const cursorOk = Boolean(project.captureRect);
  const monitors = sources?.monitors ?? [];
  const align = project.cursorAlign ?? DEFAULT_CURSOR_ALIGN;
  const patchAlign = (patch: Partial<typeof align>) =>
    updateProject({ cursorAlign: { ...align, ...patch } });
  const hasCameraTrack = Boolean(media?.webcamUrl);

  return (
    <aside className="flex w-[268px] shrink-0 flex-col border-l border-line bg-card min-[1180px]:w-[308px]">
      <div className="grid grid-cols-7 border-b border-line px-1.5 pt-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`flex flex-col items-center gap-0.5 rounded-[9px] px-1 py-1.5 text-[9.5px] font-semibold ${
              tab === t.id ? "bg-teal/10 text-teal-2" : "text-muted hover:text-ink"
            }`}
            title={t.label}
            onClick={() => setTab(t.id)}
          >
            <span className="h-4 w-4">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "look" ? (
          <>
            <Section title="Background">
              <div className="grid grid-cols-4 gap-1">
                {MODES.map((m) => (
                  <Chip key={m.id} active={bg.mode === m.id} onClick={() => patchBg({ mode: m.id }, true)}>
                    {m.label}
                  </Chip>
                ))}
              </div>

              {bg.mode === "wallpaper" ? (
                <>
                  <div className="scroll-thin mt-3 flex gap-1 overflow-x-auto pb-1">
                    {WALLPAPER_CATEGORIES.map((c) => (
                      <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)} small>
                        {c.name}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {WALLPAPERS.filter((w) => w.category === category).map((w) => (
                      <button
                        key={w.id}
                        className={`aspect-video overflow-hidden rounded-[9px] border bg-paper shadow-sm ${
                          bg.presetId === w.id ? "border-teal ring-2 ring-teal" : "border-line"
                        }`}
                        title={w.name}
                        onClick={() => patchBg({ presetId: w.id }, true)}
                      >
                        <img src={wallpaperThumbnail(w.id)} alt={w.name} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {bg.mode === "image" ? (
                <div className="mt-3">
                  {media?.backgroundUrl ? (
                    <div className="mb-2 overflow-hidden rounded-[10px] border border-line">
                      <img src={media.backgroundUrl} alt="" className="h-20 w-full object-cover" />
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <button className="btn btn-secondary flex-1 !py-1.5 text-xs" onClick={() => bgFileRef.current?.click()}>
                      {media?.backgroundUrl ? "Replace image…" : "Choose image…"}
                    </button>
                    {media?.backgroundUrl ? (
                      <button
                        className="btn btn-ghost !py-1.5 text-xs text-muted"
                        onClick={() => {
                          useAppStore.setState((s) => ({ media: s.media ? { ...s.media, backgroundUrl: undefined } : s.media }));
                          updateProject({ backgroundPath: undefined, background: { ...bg, mode: "wallpaper", customImage: undefined } }, true);
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={bgFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void pickBackground(file);
                      e.currentTarget.value = "";
                    }}
                  />
                  {!isTauri() ? <p className="mt-2 text-[11px] text-muted">In the browser preview the image lasts until reload.</p> : null}
                </div>
              ) : null}

              {bg.mode === "color" ? (
                <div className="mt-3">
                  <div className="grid grid-cols-6 gap-1.5">
                    {SOLID_COLORS.map((c) => (
                      <button
                        key={c.id}
                        className={`h-8 rounded-[8px] border ${
                          bg.color.toLowerCase() === c.color ? "border-teal ring-2 ring-teal" : "border-line"
                        }`}
                        style={{ background: c.color }}
                        title={c.name}
                        onClick={() => patchBg({ color: c.color }, true)}
                      />
                    ))}
                  </div>
                  <ColorField label="Custom" value={bg.color} onChange={(color) => patchBg({ color })} />
                </div>
              ) : null}

              {bg.mode === "gradient" ? (
                <div className="mt-3">
                  <div className="grid grid-cols-4 gap-1.5">
                    {LINEAR_GRADIENTS.map((g) => (
                      <button
                        key={g.id}
                        className={`h-10 rounded-[8px] border ${
                          bg.gradientId === g.id ? "border-teal ring-2 ring-teal" : "border-line"
                        }`}
                        style={{ background: gradientCss(g.stops, bg.gradientAngle) }}
                        title={g.name}
                        onClick={() => patchBg({ gradientId: g.id }, true)}
                      />
                    ))}
                  </div>
                  <Slider label="Angle" min={0} max={360} step={5} value={bg.gradientAngle} unit="°" onChange={(gradientAngle) => patchBg({ gradientAngle })} />
                </div>
              ) : null}

              {bg.mode !== "color" ? (
                <Slider label="Blur" min={0} max={1} step={0.02} value={bg.blur} onChange={(blur) => patchBg({ blur })} />
              ) : null}
            </Section>

            <Section title="Window">
              <Slider label="Padding" min={0.02} max={0.24} step={0.005} value={bg.padding} onChange={(padding) => patchBg({ padding })} />
              <Slider label="Corner radius" min={0} max={48} step={1} value={bg.windowRadius} onChange={(windowRadius) => patchBg({ windowRadius })} />
              <Slider label="Shadow" min={0} max={1} step={0.01} value={bg.shadow} onChange={(shadow) => patchBg({ shadow })} />
              <Slider label="Edge highlight" min={0} max={1} step={0.05} value={bg.border} onChange={(border) => patchBg({ border })} />
              <div className="mt-3 grid grid-cols-2 gap-1">
                <Chip active={bg.frame === "none"} onClick={() => patchBg({ frame: "none" }, true)}>
                  Plain
                </Chip>
                <Chip active={bg.frame === "bar"} onClick={() => patchBg({ frame: "bar" }, true)}>
                  Window bar
                </Chip>
              </div>
            </Section>

            <Section title="Fades">
              <Slider label="Fade in" min={0} max={2} step={0.1} value={project.fade.in} unit="s" onChange={(v) => updateProject({ fade: { ...project.fade, in: v } })} />
              <Slider label="Fade out" min={0} max={2} step={0.1} value={project.fade.out} unit="s" onChange={(v) => updateProject({ fade: { ...project.fade, out: v } })} />
            </Section>
          </>
        ) : null}

        {tab === "camera" ? (
          <>
            <Section title="Camera">
              {!hasCameraTrack ? (
                <p className="mb-3 text-xs text-muted">This take has no camera track. Turn the camera on in the recorder next time.</p>
              ) : null}
              <Toggle label="Show camera" checked={project.webcam.enabled} onChange={(enabled) => patchCam({ enabled }, true)} />
              <div className="mt-3 grid grid-cols-3 gap-1">
                {(["rounded", "circle", "square"] as CameraShape[]).map((shape) => (
                  <Chip key={shape} active={project.webcam.shape === shape} onClick={() => patchCam({ shape }, true)}>
                    {shape[0].toUpperCase() + shape.slice(1)}
                  </Chip>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {(["tl", "tr", "bl", "br"] as WebcamCorner[]).map((corner) => (
                  <Chip key={corner} active={project.webcam.corner === corner} onClick={() => patchCam({ corner }, true)}>
                    {corner.toUpperCase()}
                  </Chip>
                ))}
              </div>
              <Slider label="Size" min={0.12} max={0.42} step={0.01} value={project.webcam.size} onChange={(size) => patchCam({ size })} />
              <Slider label="Margin" min={0} max={0.1} step={0.005} value={project.webcam.margin} onChange={(margin) => patchCam({ margin })} />
              {project.webcam.shape === "rounded" ? (
                <Slider label="Radius" min={0} max={60} step={1} value={project.webcam.radius} onChange={(radius) => patchCam({ radius })} />
              ) : null}
              <Slider label="Shadow" min={0} max={1} step={0.05} value={project.webcam.shadow} onChange={(shadow) => patchCam({ shadow })} />
            </Section>
            <Section title="Border">
              <Toggle label="Border" checked={project.webcam.border} onChange={(border) => patchCam({ border })} />
              {project.webcam.border ? (
                <>
                  <Slider label="Width" min={1} max={14} step={1} value={project.webcam.borderWidth} onChange={(borderWidth) => patchCam({ borderWidth })} />
                  <ColorField label="Color" value={project.webcam.borderColor} onChange={(borderColor) => patchCam({ borderColor })} />
                </>
              ) : null}
              <div className="mt-3">
                <Toggle label="Mirror" checked={project.webcam.mirror} onChange={(mirror) => patchCam({ mirror })} />
              </div>
            </Section>
          </>
        ) : null}

        {tab === "cursor" ? (
          <>
            <Section title="Recorded area">
              <p className="text-xs leading-relaxed text-muted">
                {project.captureRect
                  ? `Cursor positions are measured against ${project.captureLabel ?? "the recorded area"}.`
                  : "This take doesn't say which screen it shows, so cursor effects stay off rather than land in the wrong place. Pick the screen it was recorded on:"}
              </p>
              {project.captureSource === "estimated" ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                  Worked out from where the pointer went during the take. If it sits slightly off, nudge it below.
                </p>
              ) : null}
              {monitors.length ? (
                <select
                  className="field mt-2 text-xs"
                  value=""
                  onChange={(e) => {
                    const monitor = monitors.find((m) => m.id === e.target.value);
                    if (!monitor) return;
                    // A video shaped unlike the screen is a window on it; a
                    // maximized one fills the work area from the top-left.
                    const rect = fitVideoOnMonitor(monitor, project.videoWidth, project.videoHeight);
                    const whole = rect.width === monitor.width && rect.height === monitor.height;
                    const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
                    updateProject(
                      {
                        captureRect: rect,
                        captureSource: "manual",
                        captureLabel: whole ? `${monitor.name} · ${size}` : `a window on ${monitor.name} · ${size}`,
                        surfaceTrack: undefined,
                      },
                      true,
                    );
                  }}
                >
                  <option value="">Recorded on…</option>
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {Math.round(m.width)}×{Math.round(m.height)}
                      {m.primary ? " (main)" : ""}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                className="btn btn-secondary mt-2 w-full !py-1.5 text-xs"
                onClick={() => {
                  const guess = sources ? estimateCaptureRect(project, sources.monitors) : null;
                  if (!guess) {
                    showToast("Couldn't work out which screen this take shows.", "info");
                    return;
                  }
                  updateProject(
                    { captureRect: guess.rect, captureSource: guess.source, captureLabel: guess.label },
                    true,
                  );
                  showToast(`Lined up with ${guess.label}.`, "info");
                }}
              >
                Work it out from the take
              </button>
              {project.captureRect ? (
                <>
                  <Slider
                    label="Nudge across"
                    min={-0.25}
                    max={0.25}
                    step={0.002}
                    value={align.dx}
                    onChange={(dx) => patchAlign({ dx })}
                  />
                  <Slider
                    label="Nudge down"
                    min={-0.25}
                    max={0.25}
                    step={0.002}
                    value={align.dy}
                    onChange={(dy) => patchAlign({ dy })}
                  />
                  <Slider
                    label="Spread"
                    min={0.75}
                    max={1.3}
                    step={0.005}
                    value={align.scale}
                    unit="×"
                    onChange={(scale) => patchAlign({ scale })}
                  />
                  <button
                    className="btn btn-ghost mt-2 w-full !py-1.5 text-xs text-muted"
                    onClick={() => updateProject({ cursorAlign: { ...DEFAULT_CURSOR_ALIGN } }, true)}
                  >
                    Reset the nudge
                  </button>
                </>
              ) : null}
            </Section>

            <Section title="Pointer">
              {!cursorOk ? (
                <p className="mb-3 text-xs text-muted">
                  Cursor effects are off for this take until the recorded area above is set.
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-1">
                {(["system", "arrow", "dot"] as CursorStyle[]).map((style) => (
                  <Chip key={style} active={project.cursorStyle.style === style} onClick={() => patchCursor({ style }, true)}>
                    {style === "system" ? "As recorded" : style[0].toUpperCase() + style.slice(1)}
                  </Chip>
                ))}
              </div>
              {project.cursorStyle.style !== "system" ? (
                <>
                  <Slider label="Size" min={1} max={3} step={0.1} value={project.cursorStyle.size} unit="×" onChange={(size) => patchCursor({ size })} />
                  <ColorField label="Color" value={project.cursorStyle.color} onChange={(color) => patchCursor({ color })} />
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">
                    Drawn over the recorded pointer, which can't be removed from a Windows capture — 1.4× or larger covers it.
                  </p>
                </>
              ) : null}
            </Section>
            <Section title="Clicks">
              <Toggle label="Click ripples" checked={project.cursorStyle.clicks} onChange={(clicks) => patchCursor({ clicks }, true)} />
              {project.cursorStyle.clicks ? (
                <ColorField label="Color" value={project.cursorStyle.clickColor} onChange={(clickColor) => patchCursor({ clickColor })} />
              ) : null}
            </Section>
            <Section title="Spotlight">
              <Toggle label="Spotlight" checked={project.cursorStyle.spotlight} onChange={(spotlight) => patchCursor({ spotlight }, true)} />
              {project.cursorStyle.spotlight ? (
                <>
                  <Slider label="Size" min={0.08} max={0.5} step={0.01} value={project.cursorStyle.spotlightSize} onChange={(spotlightSize) => patchCursor({ spotlightSize })} />
                  <Slider label="Dim" min={0} max={0.85} step={0.05} value={project.cursorStyle.spotlightDim} onChange={(spotlightDim) => patchCursor({ spotlightDim })} />
                </>
              ) : null}
            </Section>
          </>
        ) : null}

        {tab === "zoom" ? (
          <Section title="Zoom">
            <Toggle label="Auto-zoom" checked={project.autoZoom} onChange={(autoZoom) => updateProject({ autoZoom }, true)} />
            <button className="btn btn-secondary mt-2 w-full text-xs" onClick={regenerateZooms}>
              Generate from cursor
            </button>
            {zoom ? (
              <div className="mt-3 space-y-1">
                <Slider label="Scale" min={1} max={3} step={0.05} value={zoom.scale} unit="×" onChange={(scale) => updateProject({ zooms: project.zooms.map((z) => (z.id === zoom.id ? { ...z, scale } : z)) })} />
                <Slider label="Position X" min={0} max={1} step={0.01} value={zoom.x} onChange={(x) => updateProject({ zooms: project.zooms.map((z) => (z.id === zoom.id ? { ...z, x } : z)) })} />
                <Slider label="Position Y" min={0} max={1} step={0.01} value={zoom.y} onChange={(y) => updateProject({ zooms: project.zooms.map((z) => (z.id === zoom.id ? { ...z, y } : z)) })} />
                <div className="pt-2">
                  <Toggle label="Follow cursor" checked={zoom.followCursor} onChange={(followCursor) => updateProject({ zooms: project.zooms.map((z) => (z.id === zoom.id ? { ...z, followCursor } : z)) })} />
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted">Select a zoom block on the timeline to edit it.</p>
            )}
          </Section>
        ) : null}

        {tab === "text" ? (
          <>
            <Section title="Add">
              <div className="grid grid-cols-3 gap-1">
                <button className="btn btn-secondary !px-2 !py-1.5 text-xs" onClick={addCaption}>Caption</button>
                <button className="btn btn-secondary !px-2 !py-1.5 text-xs" onClick={addText}>Text</button>
                <button className="btn btn-secondary !px-2 !py-1.5 text-xs" onClick={() => overlayFileRef.current?.click()}>Image</button>
              </div>
              <input
                ref={overlayFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void pickOverlay(file);
                  e.currentTarget.value = "";
                }}
              />
              {whisperOk ? (
                <button className="btn btn-secondary mt-2 w-full text-xs" disabled={transcribing} onClick={() => void autoCaptions()}>
                  {transcribing ? "Transcribing…" : "Auto-captions (Whisper, on-device)"}
                </button>
              ) : null}
            </Section>

            {caption ? (
              <Section title="Caption">
                <textarea
                  className="field min-h-20"
                  value={caption.text}
                  onChange={(e) => updateProject({ captions: project.captions.map((c) => (c.id === caption.id ? { ...c, text: e.target.value, words: undefined } : c)) })}
                />
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {(["tiktok", "subtitle"] as CaptionStyle[]).map((style) => (
                    <Chip key={style} active={caption.style === style} onClick={() => updateProject({ captions: project.captions.map((c) => (c.id === caption.id ? { ...c, style } : c)) })}>
                      {style === "tiktok" ? "Karaoke" : "Subtitles"}
                    </Chip>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Num label="Start" value={caption.start} onChange={(start) => updateProject({ captions: project.captions.map((c) => (c.id === caption.id ? { ...c, start } : c)) })} />
                  <Num label="End" value={caption.end} onChange={(end) => updateProject({ captions: project.captions.map((c) => (c.id === caption.id ? { ...c, end } : c)) })} />
                </div>
              </Section>
            ) : null}

            {text ? (
              <Section title="Text">
                <input className="field" value={text.text} onChange={(e) => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, text: e.target.value } : t)) })} />
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {(["outfit", "inter", "mono"] as OverlayFont[]).map((font) => (
                    <Chip key={font} active={text.font === font} onClick={() => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, font } : t)) })}>
                      {font === "outfit" ? "Outfit" : font === "inter" ? "Inter" : "Mono"}
                    </Chip>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {(["left", "center", "right"] as const).map((align) => (
                    <Chip key={align} active={text.align === align} onClick={() => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, align } : t)) })}>
                      {align[0].toUpperCase() + align.slice(1)}
                    </Chip>
                  ))}
                </div>
                <Slider label="Size" min={0.02} max={0.14} step={0.005} value={text.fontSize} onChange={(fontSize) => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, fontSize } : t)) })} />
                <Slider label="Weight" min={400} max={800} step={100} value={text.weight} onChange={(weight) => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, weight } : t)) })} />
                <Slider label="X" min={0} max={1} step={0.01} value={text.x} onChange={(x) => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, x } : t)) })} />
                <Slider label="Y" min={0} max={1} step={0.01} value={text.y} onChange={(y) => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, y } : t)) })} />
                <ColorField label="Color" value={text.color} onChange={(color) => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, color } : t)) })} />
                <div className="mt-3">
                  <Toggle label="Pill background" checked={text.background} onChange={(background) => updateProject({ texts: project.texts.map((t) => (t.id === text.id ? { ...t, background } : t)) })} />
                </div>
              </Section>
            ) : null}

            {overlay ? (
              <Section title="Image">
                <p className="truncate text-xs text-muted" title={overlay.src}>{overlay.src}</p>
                <Slider label="X" min={0} max={1} step={0.01} value={overlay.x} onChange={(x) => updateProject({ overlays: project.overlays.map((o) => (o.id === overlay.id ? { ...o, x } : o)) })} />
                <Slider label="Y" min={0} max={1} step={0.01} value={overlay.y} onChange={(y) => updateProject({ overlays: project.overlays.map((o) => (o.id === overlay.id ? { ...o, y } : o)) })} />
                <Slider label="Width" min={0.04} max={1} step={0.01} value={overlay.width} onChange={(width) => updateProject({ overlays: project.overlays.map((o) => (o.id === overlay.id ? { ...o, width } : o)) })} />
                <Slider label="Opacity" min={0.05} max={1} step={0.05} value={overlay.opacity} onChange={(opacity) => updateProject({ overlays: project.overlays.map((o) => (o.id === overlay.id ? { ...o, opacity } : o)) })} />
                <Slider label="Corner radius" min={0} max={80} step={1} value={overlay.radius} onChange={(radius) => updateProject({ overlays: project.overlays.map((o) => (o.id === overlay.id ? { ...o, radius } : o)) })} />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Num label="Start" value={overlay.start} onChange={(start) => updateProject({ overlays: project.overlays.map((o) => (o.id === overlay.id ? { ...o, start } : o)) })} />
                  <Num label="End" value={overlay.end} onChange={(end) => updateProject({ overlays: project.overlays.map((o) => (o.id === overlay.id ? { ...o, end } : o)) })} />
                </div>
              </Section>
            ) : null}

            {!caption && !text && !overlay ? (
              <Section title="Selected">
                <p className="text-xs text-muted">Select a caption, text or image on the timeline to edit it.</p>
              </Section>
            ) : null}

            <Section title="Progress bar">
              <Toggle label="Show progress bar" checked={project.progressBar.enabled} onChange={(enabled) => patchBar({ enabled }, true)} />
              {project.progressBar.enabled ? (
                <>
                  <ColorField label="Color" value={project.progressBar.color} onChange={(color) => patchBar({ color })} />
                  <Slider label="Height" min={2} max={16} step={1} value={project.progressBar.height} onChange={(height) => patchBar({ height })} />
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <Chip active={project.progressBar.position === "bottom"} onClick={() => patchBar({ position: "bottom" })}>Bottom</Chip>
                    <Chip active={project.progressBar.position === "top"} onClick={() => patchBar({ position: "top" })}>Top</Chip>
                  </div>
                </>
              ) : null}
            </Section>
          </>
        ) : null}

        {tab === "cuts" ? (
          <>
            <Section title="Transition">
              {segment && segmentIndex > 0 ? (
                <>
                  <p className="mb-2 text-xs text-muted">Leads into clip {segmentIndex + 1} of {project.segments.length}.</p>
                  {!isJumpCut(project.segments, segmentIndex) ? (
                    <p className="mb-2 text-[11px] leading-relaxed text-muted">
                      These two clips still run back to back in the recording, so a blend has
                      nothing to cross to — trim one of them, or delete a clip, and the
                      transition will show.
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-1">
                    {TRANSITION_KINDS.map((k) => (
                      <Chip
                        key={k.id}
                        active={(segment.transition?.kind ?? "none") === k.id}
                        title={k.hint}
                        onClick={() =>
                          setSegmentTransition(
                            segment.id,
                            k.id === "none" ? null : { kind: k.id, duration: segment.transition?.duration ?? DEFAULT_TRANSITION.duration },
                          )
                        }
                      >
                        {k.name}
                      </Chip>
                    ))}
                  </div>
                  {segment.transition && segment.transition.kind !== "none" ? (
                    <Slider
                      label="Duration"
                      min={MIN_TRANSITION}
                      max={MAX_TRANSITION}
                      step={0.05}
                      unit="s"
                      value={segment.transition.duration}
                      onChange={(duration) =>
                        updateProject({
                          segments: project.segments.map((s) =>
                            s.id === segment.id && s.transition ? { ...s, transition: { ...s.transition, duration } } : s,
                          ),
                        })
                      }
                    />
                  ) : null}
                </>
              ) : segment ? (
                <p className="text-xs text-muted">The first clip has nothing before it. Select a later clip on the video track.</p>
              ) : (
                <p className="text-xs text-muted">Select a clip on the video track — the transition blends from the clip before it. Split with S to make cuts.</p>
              )}
            </Section>
            <Section title="All cuts">
              <p className="mb-2 text-xs text-muted">
                {project.segments.length <= 1 ? "No cuts yet." : `${project.segments.length - 1} ${project.segments.length === 2 ? "cut" : "cuts"} on the timeline.`}
              </p>
              <div className="grid grid-cols-2 gap-1">
                {TRANSITION_KINDS.filter((k) => k.id !== "none").map((k) => (
                  <Chip key={k.id} onClick={() => applyTransitionToAll({ kind: k.id as TransitionKind, duration: DEFAULT_TRANSITION.duration })} title={`Use ${k.name.toLowerCase()} on every cut`}>
                    {k.name}
                  </Chip>
                ))}
              </div>
              <button className="btn btn-ghost mt-2 w-full text-xs text-muted" onClick={() => applyTransitionToAll(null)}>
                Remove all transitions
              </button>
            </Section>
          </>
        ) : null}

        {tab === "audio" ? (
          <>
            <Section title="Audio">
              <Toggle label="Mute" checked={project.audio.muted} onChange={(muted) => patchAudio({ muted }, true)} />
              <Slider label="Volume" min={0} max={2} step={0.05} value={project.audio.volume} unit="×" onChange={(volume) => patchAudio({ volume })} />
              <Slider label="Fade in" min={0} max={3} step={0.1} value={project.audio.fadeIn} unit="s" onChange={(fadeIn) => patchAudio({ fadeIn })} />
              <Slider label="Fade out" min={0} max={3} step={0.1} value={project.audio.fadeOut} unit="s" onChange={(fadeOut) => patchAudio({ fadeOut })} />
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                Mute and volume play in the preview; fades and gain above 1× apply on export. Microphone and system sound are recorded as one track; Auto-cut in the toolbar trims the silences.
              </p>
            </Section>
            <SoundEffectsSection project={project} patchSfx={patchSfx} />
          </>
        ) : null}
      </div>

      <div className="border-t border-line p-4">
        <button className="btn btn-primary w-full" onClick={() => setExportOpen(true)}>
          Export & share
        </button>
      </div>
    </aside>
  );
}

/**
 * Generated sound effects: one switch, a pack, then a row per source with its
 * own switch, level and a "hear" button. Counts come from the same plan the
 * preview plays and the export mixes, so what the row promises is what lands.
 */
function SoundEffectsSection({
  project,
  patchSfx,
}: {
  project: Project;
  patchSfx: (patch: Partial<Project["sfx"]>, history?: boolean) => void;
}) {
  const sfx = project.sfx;
  const pack = sfxPack(sfx.pack);
  const counts = sfxCounts(sfxPlanFor(project));
  const total = counts.click + counts.key + counts.zoom + counts.transition;
  const hasInputs = Boolean(project.inputs);
  const hasKeys = Boolean(project.inputs?.keys.length);
  const hear = (sound: SfxSoundId, id: Project["sfx"]["pack"] = sfx.pack) =>
    sfxPreview().audition(sfxPack(id), sound, 0.5);
  return (
    <Section title="Sound effects">
      <Toggle label="Sound effects" checked={sfx.enabled} onChange={(enabled) => patchSfx({ enabled }, true)} />
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        Clicks, typing, zooms and transitions, generated on your device to match the take.
        {sfx.enabled ? ` ${total} ${total === 1 ? "sound" : "sounds"} on the timeline.` : ""}
      </p>
      {sfx.enabled ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-1">
            {SFX_PACKS.map((p) => (
              <Chip
                key={p.id}
                active={sfx.pack === p.id}
                title={p.hint}
                onClick={() => {
                  patchSfx({ pack: p.id }, true);
                  hear("clickFull", p.id);
                }}
              >
                {p.name}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted">{pack.hint}</p>
          <Slider label="Volume" min={0} max={2} step={0.05} value={sfx.volume} unit="×" onChange={(volume) => patchSfx({ volume })} />
          <SfxRow
            label="Clicks"
            count={counts.click}
            checked={sfx.clicks}
            volume={sfx.clickVolume}
            onToggle={(clicks) => patchSfx({ clicks }, true)}
            onVolume={(clickVolume) => patchSfx({ clickVolume })}
            onHear={() => hear("clickFull")}
            note={hasInputs ? undefined : "Timed off the cursor track — this take predates click timing, so each lands up to a frame late."}
          />
          <SfxRow
            label="Typing"
            count={counts.key}
            checked={sfx.typing}
            volume={sfx.typingVolume}
            onToggle={(typing) => patchSfx({ typing }, true)}
            onVolume={(typingVolume) => patchSfx({ typingVolume })}
            onHear={() => hear("key")}
            note={
              hasKeys
                ? undefined
                : hasInputs
                  ? "No keys were pressed during this take."
                  : "This take has no key timing — record with “Click & key timing” on to get typing sounds."
            }
          />
          <SfxRow
            label="Zooms"
            count={counts.zoom}
            checked={sfx.zooms}
            volume={sfx.zoomVolume}
            onToggle={(zooms) => patchSfx({ zooms }, true)}
            onVolume={(zoomVolume) => patchSfx({ zoomVolume })}
            onHear={() => hear("zoomIn")}
          />
          <SfxRow
            label="Transitions"
            count={counts.transition}
            checked={sfx.transitions}
            volume={sfx.transitionVolume}
            onToggle={(transitions) => patchSfx({ transitions }, true)}
            onVolume={(transitionVolume) => patchSfx({ transitionVolume })}
            onHear={() => hear("whoosh")}
          />
          <div className="mt-3">
            <Toggle label="Pan by position" checked={sfx.spatial} onChange={(spatial) => patchSfx({ spatial }, true)} />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            A click on the left of the frame sounds from the left. Needs the recorded area (Cursor tab).
          </p>
        </>
      ) : null}
    </Section>
  );
}

function SfxRow({
  label,
  count,
  checked,
  volume,
  note,
  onToggle,
  onVolume,
  onHear,
}: {
  label: string;
  count: number;
  checked: boolean;
  volume: number;
  note?: string;
  onToggle: (v: boolean) => void;
  onVolume: (v: number) => void;
  onHear: () => void;
}) {
  return (
    <div className="mt-3 rounded-[10px] border border-line px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <label className="flex min-w-0 items-center gap-2">
          <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
          <span className="truncate">{label}</span>
          <span className="rounded-full bg-paper px-1.5 text-[10px] tabular-nums text-muted">{count}</span>
        </label>
        <button
          type="button"
          className="btn btn-ghost !h-6 !px-2 !py-0 text-[11px] text-muted"
          title={`Hear the ${label.toLowerCase()} sound`}
          onClick={onHear}
        >
          ▶ hear
        </button>
      </div>
      {checked ? <Slider label="Level" min={0} max={2} step={0.05} value={volume} unit="×" onChange={onVolume} /> : null}
      {note ? <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{note}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
  title,
  small,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  small?: boolean;
}) {
  return (
    <button
      className={`shrink-0 rounded-[9px] border font-semibold ${small ? "px-2.5 py-1 text-[11px]" : "px-2 py-1.5 text-[11px]"} ${
        active ? "border-teal bg-teal/10 text-teal-2" : "border-line text-muted hover:text-ink"
      }`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-sm">
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mt-3 flex items-center justify-between text-xs text-muted">
      {label}
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink">{value}</span>
        <input type="color" className="h-7 w-10 rounded border border-line bg-card" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mt-3 block text-xs text-muted">
      <span className="mb-1 flex justify-between">
        {label}
        <span className="tabular-nums text-ink">
          {Number(value.toFixed(2))}
          {unit ?? ""}
        </span>
      </span>
      <input className="slider" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <input className="field mt-1" type="number" step={0.05} value={Number(value.toFixed(2))} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function IconLook() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="m2 11 3.5-3.5 3 3 2-2L14 12" />
      <circle cx="10.5" cy="6" r="1" />
    </svg>
  );
}
function IconCamera() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="8.5" height="8" rx="2" />
      <path d="m10.5 7 3.5-2v6l-3.5-2" />
    </svg>
  );
}
function IconCursor() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M3 2.5 13 7l-4.2 1.4L7 13z" />
    </svg>
  );
}
function IconZoom() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3M7 5v4M5 7h4" />
    </svg>
  );
}
function IconText() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10M8 4v9M5.5 13h5" />
    </svg>
  );
}
function IconCuts() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="4.5" cy="4.5" r="2" />
      <circle cx="4.5" cy="11.5" r="2" />
      <path d="M6 6l8 6M6 10l8-6" />
    </svg>
  );
}
function IconAudio() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6.5h2.5L8 3.5v9l-3.5-3H2z" />
      <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" />
    </svg>
  );
}
