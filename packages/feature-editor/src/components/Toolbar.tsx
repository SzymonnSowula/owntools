import type { ReactNode } from "react";
import type { Project } from "../types";
import { useAppStore } from "../store/appStore";
import {
  AutoCutGlyph,
  CaptionGlyph,
  CommandGlyph,
  HomeGlyph,
  ImageGlyph,
  ImportGlyph,
  PauseGlyph,
  PlayGlyph,
  RedoGlyph,
  ScriptGlyph,
  SoundGlyph,
  SoundOffGlyph,
  SplitGlyph,
  TextGlyph,
  TrashGlyph,
  UndoGlyph,
  ZoomInGlyph,
  ZoomOutGlyph,
} from "./icons";
import { PresetsMenu } from "./PresetsMenu";
import { sfxCounts, sfxPlanFor } from "../lib/sfx/plan";

/**
 * The editor's toolbar. Icons with their shortcut in the tooltip, grouped by
 * what they do, and a cut tool that stays pressed: with it on, a click on the
 * timeline cuts there instead of selecting.
 */
export function Toolbar({
  autoCutBusy,
  onAutoCut,
  onImport,
  onAddImage,
}: {
  autoCutBusy: boolean;
  onAutoCut: () => void;
  onImport: () => void;
  onAddImage: () => void;
}) {
  const playing = useAppStore((s) => s.playing);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setView = useAppStore((s) => s.setView);
  const project = useAppStore((s) => s.project);
  const updateProject = useAppStore((s) => s.updateProject);
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const splitAtPlayhead = useAppStore((s) => s.splitAtPlayhead);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const selection = useAppStore((s) => s.selection);
  const addZoom = useAppStore((s) => s.addZoom);
  const setSfxEnabled = useAppStore((s) => s.setSfxEnabled);
  const addCaption = useAppStore((s) => s.addCaption);
  const addText = useAppStore((s) => s.addText);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const historyIndex = useAppStore((s) => s.historyIndex);
  const history = useAppStore((s) => s.history);
  const scriptOpen = useAppStore((s) => s.scriptOpen);
  const setScriptOpen = useAppStore((s) => s.setScriptOpen);

  if (!project) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line/80 px-3 py-2">
      <Tool icon={<HomeGlyph />} title="Back to the recordings list" onClick={() => void setView("home")} />
      <input
        className="field h-8 min-w-0 max-w-[200px] flex-1 basis-32"
        value={project.name}
        onChange={(e) => updateProject({ name: e.target.value })}
      />

      <Divider />
      <Tool
        icon={playing ? <PauseGlyph /> : <PlayGlyph />}
        label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={() => setPlaying(!playing)}
      />
      <Tool icon={<SplitGlyph />} label="Split" title="Split at the playhead (S)" onClick={splitAtPlayhead} />
      <Tool
        icon={<SplitGlyph />}
        label="Cut"
        title={
          tool === "cut"
            ? "Cut tool on — click the video track to cut there (C, Esc to stop)"
            : "Cut tool: click anywhere on the video track to cut there (C)"
        }
        active={tool === "cut"}
        onClick={() => setTool(tool === "cut" ? "select" : "cut")}
      />
      <Tool
        icon={<AutoCutGlyph />}
        label={autoCutBusy ? "Analyzing…" : "Auto-cut"}
        title="Remove the silent pauses"
        disabled={autoCutBusy}
        onClick={onAutoCut}
      />

      <Divider />
      <Tool icon={<ZoomInGlyph />} label="Zoom in" title="Zoom in at the playhead (Z)" onClick={() => addZoom("in")} />
      <Tool icon={<ZoomOutGlyph />} title="Zoom back out (Shift+Z)" onClick={() => addZoom("out")} />

      <Divider />
      <Tool
        icon={project.sfx.enabled ? <SoundGlyph /> : <SoundOffGlyph />}
        label="Sound"
        title={sfxTitle(project)}
        active={project.sfx.enabled}
        onClick={() => setSfxEnabled()}
      />

      <Divider />
      <Tool
        icon={<ScriptGlyph />}
        label="Script"
        title={
          scriptOpen
            ? "Hide the Script panel (Shift+S)"
            : project.captions.length
              ? "Script: edit the video as text — cut sentences, remove fillers, chapters, short clips (Shift+S)"
              : "Script: transcribe the take and edit the video as text (Shift+S)"
        }
        active={scriptOpen}
        onClick={() => setScriptOpen(!scriptOpen)}
      />

      <Divider />
      <Tool icon={<CaptionGlyph />} label="Caption" title="Add a caption (K)" onClick={addCaption} />
      <Tool icon={<TextGlyph />} label="Text" title="Add a text overlay (T)" onClick={addText} />
      <Tool icon={<ImageGlyph />} label="Image" title="Add an image or logo (I)" onClick={onAddImage} />
      <Tool
        icon={<TrashGlyph />}
        title="Delete what's selected (Del)"
        disabled={!selection}
        onClick={deleteSelection}
      />

      <Divider />
      <PresetsMenu />
      <Tool icon={<UndoGlyph />} title="Undo (Ctrl+Z)" disabled={historyIndex <= 0} onClick={undo} />
      <Tool
        icon={<RedoGlyph />}
        title="Redo (Ctrl+Shift+Z)"
        disabled={historyIndex >= history.length - 1}
        onClick={redo}
      />
      <Tool icon={<ImportGlyph />} title="Open another video file" onClick={onImport} />
      <Tool
        icon={<CommandGlyph />}
        label="Actions"
        title="All actions and their shortcuts (Ctrl+K)"
        onClick={() => setPaletteOpen(true)}
      />
      <TimeReadout />
    </div>
  );
}

/** What the Sound button promises, counted off the same plan the export mixes. */
function sfxTitle(project: Project): string {
  const { click, key, zoom, transition } = sfxCounts(sfxPlanFor(project));
  const total = click + key + zoom + transition;
  if (!project.sfx.enabled) {
    return total
      ? `Sound effects are off — turn them on to hear ${total} ${total === 1 ? "sound" : "sounds"} (clicks, keys, zooms). Levels in Audio.`
      : "Sound effects are off. This take has no clicks or zooms to sound yet.";
  }
  const parts = [
    click ? `${click} click${click === 1 ? "" : "s"}` : "",
    key ? `${key} key${key === 1 ? "" : "s"}` : "",
    zoom ? `${zoom} zoom${zoom === 1 ? "" : "s"}` : "",
    transition ? `${transition} transition${transition === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length
    ? `Sound effects on: ${parts.join(", ")}. Levels and pack in Audio; click to switch off.`
    : "Sound effects on — nothing to sound in this take yet. Levels and pack in Audio.";
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 self-center bg-line" aria-hidden />;
}

function Tool({
  icon,
  label,
  title,
  onClick,
  disabled,
  active,
}: {
  icon: ReactNode;
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-2 text-xs font-semibold transition disabled:opacity-40 ${
        active
          ? "border-teal bg-teal/12 text-teal-2"
          : "border-line bg-card text-ink hover:border-teal/50 hover:text-teal-2"
      }`}
    >
      {icon}
      {label ? <span className="hidden min-[1180px]:inline">{label}</span> : null}
    </button>
  );
}

/** Isolated so 60 fps time updates re-render only this node. */
function TimeReadout() {
  const time = useAppStore((s) => s.timelineTime);
  const project = useAppStore((s) => s.project);
  const duration = project ? timelineLength(project.segments) : 0;
  return (
    <span className="ml-auto pl-2 font-mono text-xs tabular-nums text-muted">
      {format(time, true)} / {format(duration)}
    </span>
  );
}

function timelineLength(segments: { start: number; end: number }[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

function format(seconds: number, withCentis = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  const base = `${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  if (!withCentis) return base;
  return `${base}.${String(Math.floor((s % 1) * 100)).padStart(2, "0")}`;
}
