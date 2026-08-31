import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { GRADIENT_PRESETS } from "../lib/gradients";
import { transcribeCaptions, whisperReady } from "../lib/transcribe";
import { useAppStore } from "../store/appStore";
import type { CaptionStyle, Easing, WebcamCorner } from "../types";

export function Inspector() {
  const project = useAppStore((s) => s.project);
  const media = useAppStore((s) => s.media);
  const selection = useAppStore((s) => s.selection);
  const updateProject = useAppStore((s) => s.updateProject);
  const regenerateZooms = useAppStore((s) => s.regenerateZooms);
  const setExportOpen = useAppStore((s) => s.setExportOpen);
  const showToast = useAppStore((s) => s.showToast);
  const [whisperOk, setWhisperOk] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    void whisperReady().then(setWhisperOk);
  }, []);

  if (!project) return null;

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

  return (
    <aside className="scroll-thin flex w-[260px] shrink-0 flex-col overflow-y-auto border-l border-line bg-card min-[1180px]:w-[300px]">
      <Section title="Background">
        <div className="grid grid-cols-3 gap-2">
          {GRADIENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`h-12 rounded-[10px] border shadow-sm ${
                project.background.presetId === preset.id ? "ring-2 ring-violet" : "border-line"
              }`}
              title={preset.name}
              style={{
                background: `radial-gradient(circle at 30% 20%, ${preset.blobs[0].color}, ${preset.base})`,
              }}
              onClick={() =>
                updateProject({
                  background: { ...project.background, presetId: preset.id, customImage: undefined },
                })
              }
            />
          ))}
        </div>
        <label className="mt-3 block text-xs text-muted">
          Custom background
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full text-xs"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const url = URL.createObjectURL(file);
              useAppStore.setState((s) => ({
                media: s.media ? { ...s.media, backgroundUrl: url } : s.media,
              }));
              updateProject({ background: { ...project.background, customImage: file.name } });
            }}
          />
        </label>
        <Slider
          label="Padding"
          min={0.04}
          max={0.22}
          step={0.005}
          value={project.background.padding}
          onChange={(padding) => updateProject({ background: { ...project.background, padding } })}
        />
        <Slider
          label="Corner radius"
          min={8}
          max={48}
          step={1}
          value={project.background.windowRadius}
          onChange={(windowRadius) =>
            updateProject({ background: { ...project.background, windowRadius } })
          }
        />
        <Slider
          label="Shadow"
          min={0}
          max={1}
          step={0.01}
          value={project.background.shadow}
          onChange={(shadow) => updateProject({ background: { ...project.background, shadow } })}
        />
      </Section>

      <Section title="Zoom">
        <label className="flex items-center justify-between text-sm">
          Auto-zoom
          <input
            type="checkbox"
            checked={project.autoZoom}
            onChange={(e) => updateProject({ autoZoom: e.target.checked }, true)}
          />
        </label>
        <button className="btn btn-secondary mt-2 w-full text-xs" onClick={regenerateZooms}>
          Generate from cursor
        </button>
        {zoom ? (
          <div className="mt-3 space-y-2">
            <Slider
              label="Scale"
              min={1}
              max={3}
              step={0.05}
              value={zoom.scale}
              onChange={(scale) =>
                updateProject({
                  zooms: project.zooms.map((z) => (z.id === zoom.id ? { ...z, scale } : z)),
                })
              }
            />
            <Slider
              label="Position X"
              min={0.05}
              max={0.95}
              step={0.01}
              value={zoom.x}
              onChange={(x) =>
                updateProject({
                  zooms: project.zooms.map((z) => (z.id === zoom.id ? { ...z, x } : z)),
                })
              }
            />
            <Slider
              label="Position Y"
              min={0.05}
              max={0.95}
              step={0.01}
              value={zoom.y}
              onChange={(y) =>
                updateProject({
                  zooms: project.zooms.map((z) => (z.id === zoom.id ? { ...z, y } : z)),
                })
              }
            />
            <label className="flex items-center justify-between text-sm">
              Follow cursor
              <input
                type="checkbox"
                checked={zoom.followCursor}
                onChange={(e) =>
                  updateProject({
                    zooms: project.zooms.map((z) =>
                      z.id === zoom.id ? { ...z, followCursor: e.target.checked } : z,
                    ),
                  })
                }
              />
            </label>
            <label className="block text-xs text-muted">
              Easing
              <select
                className="field mt-1"
                value={zoom.easing}
                onChange={(e) =>
                  updateProject({
                    zooms: project.zooms.map((z) =>
                      z.id === zoom.id ? { ...z, easing: e.target.value as Easing } : z,
                    ),
                  })
                }
              >
                <option value="ease-in-out">ease-in-out</option>
                <option value="ease-out">ease-out</option>
                <option value="linear">linear</option>
              </select>
            </label>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Select a zoom block on the timeline to edit it.</p>
        )}
      </Section>

      <Section title="Camera">
        <label className="flex items-center justify-between text-sm">
          Show camera
          <input
            type="checkbox"
            checked={project.webcam.enabled}
            onChange={(e) =>
              updateProject({ webcam: { ...project.webcam, enabled: e.target.checked } }, true)
            }
          />
        </label>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {(["tl", "tr", "bl", "br"] as WebcamCorner[]).map((corner) => (
            <button
              key={corner}
              className={`rounded-[8px] border py-1.5 text-[11px] font-semibold uppercase ${
                project.webcam.corner === corner
                  ? "border-teal bg-teal/10 text-teal-2"
                  : "border-line text-muted"
              }`}
              onClick={() => updateProject({ webcam: { ...project.webcam, corner } })}
            >
              {corner}
            </button>
          ))}
        </div>
        <Slider
          label="Size"
          min={0.12}
          max={0.4}
          step={0.01}
          value={project.webcam.size}
          onChange={(size) => updateProject({ webcam: { ...project.webcam, size } })}
        />
        <Slider
          label="Radius"
          min={8}
          max={48}
          step={1}
          value={project.webcam.radius}
          onChange={(radius) => updateProject({ webcam: { ...project.webcam, radius } })}
        />
        <label className="mt-2 flex items-center justify-between text-sm">
          Border
          <input
            type="checkbox"
            checked={project.webcam.border}
            onChange={(e) =>
              updateProject({ webcam: { ...project.webcam, border: e.target.checked } })
            }
          />
        </label>
      </Section>

      <Section title="Captions & text">
        {whisperOk ? (
          <button
            className="btn btn-secondary mb-3 w-full text-xs"
            disabled={transcribing}
            onClick={() => void autoCaptions()}
          >
            {transcribing ? "Transcribing…" : "Auto-captions (Whisper, on-device)"}
          </button>
        ) : null}
        {caption ? (
          <div className="space-y-2">
            <textarea
              className="field min-h-20"
              value={caption.text}
              onChange={(e) =>
                updateProject({
                  captions: project.captions.map((c) =>
                    c.id === caption.id ? { ...c, text: e.target.value, words: undefined } : c,
                  ),
                })
              }
            />
            <div className="flex gap-1">
              {(["tiktok", "subtitle"] as CaptionStyle[]).map((style) => (
                <button
                  key={style}
                  className={`btn flex-1 text-xs ${
                    caption.style === style ? "btn-primary" : "btn-secondary"
                  }`}
                  onClick={() =>
                    updateProject({
                      captions: project.captions.map((c) =>
                        c.id === caption.id ? { ...c, style } : c,
                      ),
                    })
                  }
                >
                  {style === "tiktok" ? "TikTok" : "Subtitles"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Num
                label="Start"
                value={caption.start}
                onChange={(start) =>
                  updateProject({
                    captions: project.captions.map((c) =>
                      c.id === caption.id ? { ...c, start } : c,
                    ),
                  })
                }
              />
              <Num
                label="End"
                value={caption.end}
                onChange={(end) =>
                  updateProject({
                    captions: project.captions.map((c) => (c.id === caption.id ? { ...c, end } : c)),
                  })
                }
              />
            </div>
          </div>
        ) : text ? (
          <div className="space-y-2">
            <input
              className="field"
              value={text.text}
              onChange={(e) =>
                updateProject({
                  texts: project.texts.map((t) => (t.id === text.id ? { ...t, text: e.target.value } : t)),
                })
              }
            />
            <Slider
              label="Size"
              min={0.02}
              max={0.14}
              step={0.005}
              value={text.fontSize}
              onChange={(fontSize) =>
                updateProject({
                  texts: project.texts.map((t) => (t.id === text.id ? { ...t, fontSize } : t)),
                })
              }
            />
            <label className="block text-xs text-muted">
              Color
              <input
                type="color"
                className="ml-2 h-7 w-12 rounded border border-line"
                value={text.color}
                onChange={(e) =>
                  updateProject({
                    texts: project.texts.map((t) =>
                      t.id === text.id ? { ...t, color: e.target.value } : t,
                    ),
                  })
                }
              />
            </label>
            <Slider
              label="Weight"
              min={400}
              max={800}
              step={100}
              value={text.weight}
              onChange={(weight) =>
                updateProject({
                  texts: project.texts.map((t) => (t.id === text.id ? { ...t, weight } : t)),
                })
              }
            />
          </div>
        ) : (
          <p className="text-xs text-muted">Select a caption or text on the timeline.</p>
        )}
      </Section>

      <div className="mt-auto border-t border-line p-4">
        <button className="btn btn-primary w-full" onClick={() => setExportOpen(true)}>
          Export
        </button>
      </div>
    </aside>
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

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mt-3 block text-xs text-muted">
      <span className="mb-1 flex justify-between">
        {label}
        <span className="tabular-nums text-ink">{Number(value.toFixed(2))}</span>
      </span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <input
        className="field mt-1"
        type="number"
        step={0.05}
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
