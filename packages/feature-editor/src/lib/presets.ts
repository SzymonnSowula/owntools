import type {
  BackgroundSettings,
  CursorSettings,
  FadeSettings,
  ProgressBarSettings,
  Project,
  WebcamSettings,
} from "../types";
import {
  DEFAULT_BACKGROUND,
  DEFAULT_CURSOR,
  DEFAULT_FADE,
  DEFAULT_PROGRESS_BAR,
  DEFAULT_WEBCAM,
} from "./defaults";

/**
 * A look is everything about how a video is dressed — background, frame,
 * camera bubble, cursor, progress bar, fades — and nothing about what is in
 * it. Presets copy a look between projects; the camera's on/off switch is
 * left alone because that depends on whether a take has a camera track.
 */
export interface LookSettings {
  background: BackgroundSettings;
  webcam: Omit<WebcamSettings, "enabled">;
  cursorStyle: CursorSettings;
  progressBar: ProgressBarSettings;
  fade: FadeSettings;
}

export interface LookPreset {
  id: string;
  name: string;
  builtIn?: boolean;
  look: LookSettings;
}

const STORAGE_KEY = "screeni-look-presets";

function withoutEnabled(webcam: WebcamSettings): Omit<WebcamSettings, "enabled"> {
  const { enabled: _enabled, ...rest } = webcam;
  return rest;
}

const base = (): LookSettings => ({
  background: { ...DEFAULT_BACKGROUND },
  webcam: withoutEnabled(DEFAULT_WEBCAM),
  cursorStyle: { ...DEFAULT_CURSOR },
  progressBar: { ...DEFAULT_PROGRESS_BAR },
  fade: { ...DEFAULT_FADE },
});

function preset(id: string, name: string, patch: (look: LookSettings) => void): LookPreset {
  const look = base();
  patch(look);
  return { id, name, builtIn: true, look };
}

export const BUILT_IN_PRESETS: LookPreset[] = [
  preset("clean", "Clean", (l) => {
    l.background = { ...l.background, mode: "wallpaper", presetId: "day", padding: 0.1, windowRadius: 18, shadow: 0.45, border: 0.5 };
    l.cursorStyle = { ...l.cursorStyle, clicks: true, clickColor: "#0a84ff" };
  }),
  preset("harbour", "Harbour", (l) => {
    l.background = { ...l.background, mode: "wallpaper", presetId: "harbour", padding: 0.12, windowRadius: 24, shadow: 0.7 };
    l.webcam = { ...l.webcam, shape: "circle", borderWidth: 5 };
  }),
  preset("keynote", "Keynote", (l) => {
    l.background = { ...l.background, mode: "wallpaper", presetId: "graphite", padding: 0.16, windowRadius: 14, shadow: 0.85, frame: "bar", border: 0.25 };
    l.cursorStyle = { ...l.cursorStyle, style: "arrow", size: 1.8, clicks: true, clickColor: "#ffd60a" };
    l.fade = { in: 0.4, out: 0.6 };
  }),
  preset("desk", "Desk", (l) => {
    l.background = { ...l.background, mode: "wallpaper", presetId: "desk", padding: 0.09, windowRadius: 16, shadow: 0.5, frame: "bar", border: 0.6 };
    l.progressBar = { ...l.progressBar, enabled: true, color: "#0a84ff", height: 5 };
  }),
  preset("sunset", "Sunset", (l) => {
    l.background = { ...l.background, mode: "gradient", gradientId: "sunset", gradientAngle: 150, padding: 0.14, windowRadius: 30, shadow: 0.75 };
    l.cursorStyle = { ...l.cursorStyle, clickColor: "#fde047" };
  }),
  preset("spotlight", "Spotlight", (l) => {
    l.background = { ...l.background, mode: "wallpaper", presetId: "noir", padding: 0.08, windowRadius: 20, shadow: 0.9 };
    l.cursorStyle = { ...l.cursorStyle, style: "dot", size: 1.4, color: "#ffd60a", spotlight: true, spotlightSize: 0.2, spotlightDim: 0.5 };
  }),
  preset("minimal", "Minimal", (l) => {
    l.background = { ...l.background, mode: "color", color: "#ffffff", padding: 0.04, windowRadius: 8, shadow: 0.2, border: 0.2 };
    l.cursorStyle = { ...l.cursorStyle, clicks: false };
  }),
  preset("social", "Social", (l) => {
    l.background = { ...l.background, mode: "gradient", gradientId: "royal", gradientAngle: 160, padding: 0.06, windowRadius: 26, shadow: 0.7 };
    l.webcam = { ...l.webcam, shape: "circle", size: 0.26, borderWidth: 6, corner: "bl" };
    l.progressBar = { ...l.progressBar, enabled: true, color: "#ffffff", height: 8 };
    l.fade = { in: 0.3, out: 0.5 };
  }),
];

export function extractLook(project: Project): LookSettings {
  return {
    background: { ...project.background, customImage: undefined },
    webcam: withoutEnabled(project.webcam),
    cursorStyle: { ...project.cursorStyle },
    progressBar: { ...project.progressBar },
    fade: { ...project.fade },
  };
}

export function applyLook(project: Project, look: LookSettings): Project {
  return {
    ...project,
    background:
      look.background.mode === "image"
        ? { ...look.background, mode: project.backgroundPath ? "image" : "wallpaper" }
        : { ...look.background },
    webcam: { ...look.webcam, enabled: project.webcam.enabled },
    cursorStyle: { ...look.cursorStyle },
    progressBar: { ...look.progressBar },
    fade: { ...look.fade },
  };
}

function isPreset(value: unknown): value is LookPreset {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LookPreset).id === "string" &&
    typeof (value as LookPreset).name === "string" &&
    typeof (value as LookPreset).look === "object"
  );
}

export function loadCustomPresets(storage: Storage | null = getStorage()): LookPreset[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isPreset).map((p) => ({ ...p, builtIn: false })) : [];
  } catch {
    return [];
  }
}

export function saveCustomPreset(name: string, look: LookSettings, storage: Storage | null = getStorage()): LookPreset {
  const trimmed = name.trim() || "My look";
  const id = `look_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const next: LookPreset = { id, name: trimmed, look };
  const all = [...loadCustomPresets(storage).filter((p) => p.name !== trimmed), next];
  storage?.setItem(STORAGE_KEY, JSON.stringify(all));
  return next;
}

export function deleteCustomPreset(id: string, storage: Storage | null = getStorage()): void {
  const all = loadCustomPresets(storage).filter((p) => p.id !== id);
  storage?.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function allPresets(storage: Storage | null = getStorage()): LookPreset[] {
  return [...BUILT_IN_PRESETS, ...loadCustomPresets(storage)];
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
