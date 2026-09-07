import { create } from "zustand";
import type {
  Caption,
  ImageOverlay,
  MediaUrls,
  Project,
  ProjectMeta,
  Selection,
  SpeechLang,
  TextOverlay,
  Toast,
  Transition,
  View,
  ZoomClip,
} from "../types";
import { clone, defaultProjectName, uid } from "../lib/id";
import {
  DEFAULT_AUDIO,
  DEFAULT_BACKGROUND,
  DEFAULT_CURSOR,
  DEFAULT_CURSOR_ALIGN,
  DEFAULT_FADE,
  DEFAULT_OVERLAY,
  DEFAULT_PROGRESS_BAR,
  DEFAULT_SFX,
  DEFAULT_TEXT,
  DEFAULT_WEBCAM,
  normalizeProject,
} from "../lib/defaults";
import {
  loadIndex,
  loadProjectFromDisk,
  reconcileIndex,
  saveProjectToDisk,
  upsertRecent,
} from "../lib/projectIo";
import { captureRectSuspect, listDisplaySources, reconcileCaptureRect } from "../lib/captureSources";
import { estimateCaptureRect, zoomRect } from "../lib/cursorMap";
import { applyLook, type LookSettings } from "../lib/presets";
import { generateZoomKeyframes } from "../lib/zoom";
import { removeSegment, splitSegment, timelineDuration, timelineToSource } from "../lib/segments";
import { clampTransitionDuration } from "../lib/transitions";

const HISTORY_LIMIT = 50;

export function emptyProject(partial?: Partial<Project>): Project {
  const duration = partial?.duration ?? 0;
  return {
    id: uid("proj"),
    name: defaultProjectName(),
    createdAt: Date.now(),
    duration,
    videoWidth: 1920,
    videoHeight: 1080,
    screenWidth: 1920,
    screenHeight: 1080,
    webcamOffset: 0,
    cursor: [],
    autoZoom: true,
    segments: duration > 0 ? [{ id: uid("seg"), start: 0, end: duration }] : [],
    zooms: [],
    captions: [],
    texts: [],
    overlays: [],
    shares: [],
    webcam: { ...DEFAULT_WEBCAM },
    background: { ...DEFAULT_BACKGROUND },
    cursorStyle: { ...DEFAULT_CURSOR },
    progressBar: { ...DEFAULT_PROGRESS_BAR },
    audio: { ...DEFAULT_AUDIO },
    sfx: { ...DEFAULT_SFX },
    fade: { ...DEFAULT_FADE },
    cursorAlign: { ...DEFAULT_CURSOR_ALIGN },
    aspect: "16:9",
    speechLang: "pl-PL",
    ...partial,
  };
}

interface EditorSnapshot {
  segments: Project["segments"];
  zooms: ZoomClip[];
  captions: Caption[];
  texts: TextOverlay[];
  overlays: ImageOverlay[];
  webcam: Project["webcam"];
  background: Project["background"];
  cursorStyle: Project["cursorStyle"];
  progressBar: Project["progressBar"];
  audio: Project["audio"];
  sfx: Project["sfx"];
  fade: Project["fade"];
  captureRect: Project["captureRect"];
  captureSource: Project["captureSource"];
  captureLabel: Project["captureLabel"];
  cursorAlign: Project["cursorAlign"];
  autoZoom: boolean;
  aspect: Project["aspect"];
}

function snap(project: Project): EditorSnapshot {
  return clone({
    segments: project.segments,
    zooms: project.zooms,
    captions: project.captions,
    texts: project.texts,
    overlays: project.overlays,
    webcam: project.webcam,
    background: project.background,
    cursorStyle: project.cursorStyle,
    progressBar: project.progressBar,
    audio: project.audio,
    sfx: project.sfx,
    fade: project.fade,
    captureRect: project.captureRect,
    captureSource: project.captureSource,
    captureLabel: project.captureLabel,
    cursorAlign: project.cursorAlign,
    autoZoom: project.autoZoom,
    aspect: project.aspect,
  });
}

function applySnap(project: Project, s: EditorSnapshot): Project {
  return { ...project, ...clone(s) };
}

/** What a click on the timeline does: pick things, or cut them. */
export type EditorTool = "select" | "cut";

interface AppState {
  view: View;
  compactChrome: boolean;
  tool: EditorTool;
  paletteOpen: boolean;
  project: Project | null;
  media: MediaUrls | null;
  recent: ProjectMeta[];
  playing: boolean;
  timelineTime: number;
  selection: Selection | null;
  toast: Toast | null;
  exportOpen: boolean;
  exportProgress: number | null;
  transcribeOpen: boolean;
  history: EditorSnapshot[];
  historyIndex: number;
  speechLang: SpeechLang;
  setView: (view: View) => Promise<void>;
  setCompactChrome: (v: boolean) => void;
  setTool: (tool: EditorTool) => void;
  setPaletteOpen: (v: boolean) => void;
  setSpeechLang: (lang: SpeechLang) => void;
  showToast: (message: string, type?: Toast["type"]) => void;
  clearToast: () => void;
  hydrateRecent: () => Promise<void>;
  openProject: (project: Project, media: MediaUrls) => Promise<void>;
  openRecent: (id: string) => Promise<void>;
  persistProject: (screen?: Blob, webcam?: Blob, background?: Blob) => Promise<void>;
  updateProject: (patch: Partial<Project> | ((p: Project) => Project), history?: boolean) => void;
  setPlaying: (v: boolean) => void;
  setTimelineTime: (t: number) => void;
  setSelection: (s: Selection | null) => void;
  setExportOpen: (v: boolean) => void;
  setExportProgress: (v: number | null) => void;
  setTranscribeOpen: (v: boolean) => void;
  undo: () => void;
  redo: () => void;
  splitAtPlayhead: () => void;
  /** Cuts at any point on the timeline — the cut tool clicks straight into this. */
  splitAt: (timelineTime: number) => boolean;
  deleteSelection: () => void;
  addZoom: (kind: "in" | "out") => void;
  addCaption: () => void;
  addText: () => void;
  /** `src` is the file name inside the project folder; `url` an object URL to draw from now. */
  addOverlay: (src: string, url: string) => void;
  setSegmentTransition: (id: string, transition: Transition | null) => void;
  applyTransitionToAll: (transition: Transition | null) => void;
  applyLookPreset: (look: LookSettings) => void;
  regenerateZooms: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "home",
  compactChrome: false,
  tool: "select",
  paletteOpen: false,
  project: null,
  media: null,
  recent: [],
  playing: false,
  timelineTime: 0,
  selection: null,
  toast: null,
  exportOpen: false,
  exportProgress: null,
  transcribeOpen: false,
  history: [],
  historyIndex: -1,
  speechLang: "pl-PL",

  setView: async (view) => {
    set({ view, compactChrome: view === "recorder" });
  },
  setCompactChrome: (compactChrome) => set({ compactChrome }),
  setTool: (tool) => set({ tool }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSpeechLang: (speechLang) => set({ speechLang }),
  showToast: (message, type = "info") =>
    set({ toast: { id: uid("toast"), message, type } }),
  clearToast: () => set({ toast: null }),

  hydrateRecent: async () => {
    // Repairs index.json against the folders on disk; falls back to the raw index if that fails.
    const recent = await reconcileIndex().catch(() => loadIndex());
    set({ recent });
  },

  openProject: async (raw, media) => {
    let project = normalizeProject(raw);
    // Takes recorded before the editor stored the recorded rectangle only kept
    // the size of the whole desktop. Their cursor track gives them away: match
    // it against the screens attached now and cursor effects line up again.
    if (!project.captureRect && project.cursor.length) {
      const sources = await listDisplaySources().catch(() => null);
      const guess = sources ? estimateCaptureRect(project, sources.monitors) : null;
      if (guess) {
        project = {
          ...project,
          captureRect: guess.rect,
          captureSource: guess.source,
          captureLabel: guess.label,
        };
      }
    } else if (captureRectSuspect(project)) {
      // A take the recorder matched to the wrong frame size — the screen a
      // window sits on instead of the window. Repaired here, or cleared: a
      // pointer in the wrong place is worse than none.
      const sources = await listDisplaySources().catch(() => null);
      const fixed = reconcileCaptureRect(project, sources);
      project = {
        ...project,
        captureRect: fixed?.rect,
        captureSource: fixed?.source,
        captureLabel: fixed?.label,
        surfaceTrack: undefined,
      };
    }
    set({
      project,
      media,
      view: "editor",
      compactChrome: false,
      playing: false,
      timelineTime: 0,
      selection: null,
      history: [snap(project)],
      historyIndex: 0,
    });
    const recent = await upsertRecent({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      duration: project.duration,
    });
    set({ recent });
  },

  openRecent: async (id) => {
    const loaded = await loadProjectFromDisk(id);
    if (!loaded || !loaded.media.screenUrl) {
      get().showToast("Couldn't open the project.", "error");
      return;
    }
    await get().openProject(loaded.project, loaded.media);
  },

  persistProject: async (screen, webcam, background) => {
    const { project } = get();
    if (!project) return;
    const saved = await saveProjectToDisk(project, screen, webcam, background);
    const recent = await loadIndex();
    set({ project: saved, recent });
  },

  updateProject: (patch, history = false) => {
    const { project } = get();
    if (!project) return;
    const next = typeof patch === "function" ? patch(project) : { ...project, ...patch };
    if (history) {
      const base = get().history.slice(0, get().historyIndex + 1);
      const historyNext = [...base, snap(next)].slice(-HISTORY_LIMIT);
      set({
        project: next,
        history: historyNext,
        historyIndex: historyNext.length - 1,
      });
    } else {
      set({ project: next });
    }
  },

  setPlaying: (playing) => set({ playing }),
  setTimelineTime: (timelineTime) => set({ timelineTime }),
  setSelection: (selection) => set({ selection }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  setTranscribeOpen: (transcribeOpen) => set({ transcribeOpen }),

  undo: () => {
    const { project, history, historyIndex } = get();
    if (!project || historyIndex <= 0) return;
    const idx = historyIndex - 1;
    set({
      project: applySnap(project, history[idx]),
      historyIndex: idx,
      playing: false,
    });
  },
  redo: () => {
    const { project, history, historyIndex } = get();
    if (!project || historyIndex >= history.length - 1) return;
    const idx = historyIndex + 1;
    set({
      project: applySnap(project, history[idx]),
      historyIndex: idx,
      playing: false,
    });
  },

  splitAtPlayhead: () => {
    get().splitAt(get().timelineTime);
  },

  splitAt: (timelineTime) => {
    const { project } = get();
    if (!project) return false;
    const source = timelineToSource(timelineTime, project.segments);
    const segments = splitSegment(project.segments, source, uid("seg"));
    if (segments.length === project.segments.length) return false;
    get().updateProject({ segments }, true);
    return true;
  },

  deleteSelection: () => {
    const { project, selection } = get();
    if (!project || !selection) return;
    if (selection.type === "segment") {
      const segments = removeSegment(project.segments, selection.id);
      if (!segments.length) {
        get().showToast("Keep at least one video segment.", "info");
        return;
      }
      get().updateProject({ segments, duration: project.duration }, true);
    } else if (selection.type === "zoom") {
      get().updateProject({ zooms: project.zooms.filter((z) => z.id !== selection.id) }, true);
    } else if (selection.type === "caption") {
      get().updateProject(
        { captions: project.captions.filter((c) => c.id !== selection.id) },
        true,
      );
    } else if (selection.type === "text") {
      get().updateProject({ texts: project.texts.filter((t) => t.id !== selection.id) }, true);
    } else if (selection.type === "overlay") {
      get().updateProject(
        { overlays: project.overlays.filter((o) => o.id !== selection.id) },
        true,
      );
    }
    set({ selection: null });
  },

  addZoom: (kind) => {
    const { project, timelineTime } = get();
    if (!project) return;
    const source = timelineToSource(timelineTime, project.segments);
    if (kind === "out") {
      const active = project.zooms.find((z) => source >= z.start && source <= z.end);
      if (active) {
        get().updateProject(
          {
            zooms: project.zooms.map((z) =>
              z.id === active.id ? { ...z, end: Math.max(z.start + 0.45, source + 0.45) } : z,
            ),
          },
          true,
        );
        return;
      }
    }
    const zoom: ZoomClip = {
      id: uid("zoom"),
      start: source,
      end: Math.min(project.duration, source + 1.8),
      scale: kind === "in" ? 1.85 : 1.15,
      x: 0.5,
      y: 0.5,
      easing: "ease-in-out",
      followCursor: true,
      source: "manual",
    };
    const c = project.cursor.find((s) => Math.abs(s.t - source) < 0.05) ?? project.cursor[0];
    if (c) {
      const rect = zoomRect(project);
      zoom.x = Math.min(1, Math.max(0, (c.x - rect.x) / rect.width));
      zoom.y = Math.min(1, Math.max(0, (c.y - rect.y) / rect.height));
    }
    get().updateProject({ zooms: [...project.zooms, zoom] }, true);
    set({ selection: { type: "zoom", id: zoom.id } });
  },

  addCaption: () => {
    const { project, timelineTime } = get();
    if (!project) return;
    const source = timelineToSource(timelineTime, project.segments);
    const caption: Caption = {
      id: uid("cap"),
      start: source,
      end: Math.min(project.duration, source + 2.4),
      text: "Your caption",
      style: "tiktok",
    };
    get().updateProject({ captions: [...project.captions, caption] }, true);
    set({ selection: { type: "caption", id: caption.id } });
  },

  addText: () => {
    const { project, timelineTime } = get();
    if (!project) return;
    const source = timelineToSource(timelineTime, project.segments);
    const text: TextOverlay = {
      ...DEFAULT_TEXT,
      id: uid("txt"),
      start: source,
      end: Math.min(project.duration, source + 3),
      text: "Heading",
    };
    get().updateProject({ texts: [...project.texts, text] }, true);
    set({ selection: { type: "text", id: text.id } });
  },

  addOverlay: (src, url) => {
    const { project, media } = get();
    if (!project) return;
    const overlay: ImageOverlay = {
      ...DEFAULT_OVERLAY,
      id: uid("img"),
      start: 0,
      end: project.duration,
      src,
    };
    set({
      media: media
        ? { ...media, overlayUrls: { ...(media.overlayUrls ?? {}), [src]: url } }
        : media,
    });
    get().updateProject({ overlays: [...project.overlays, overlay] }, true);
    set({ selection: { type: "overlay", id: overlay.id } });
  },

  setSegmentTransition: (id, transition) => {
    const { project } = get();
    if (!project) return;
    const clean = transition
      ? { kind: transition.kind, duration: clampTransitionDuration(transition.duration) }
      : undefined;
    get().updateProject(
      {
        segments: project.segments.map((s) => {
          if (s.id !== id) return s;
          const { transition: _old, ...rest } = s;
          return clean && clean.kind !== "none" ? { ...rest, transition: clean } : rest;
        }),
      },
      true,
    );
  },

  applyTransitionToAll: (transition) => {
    const { project } = get();
    if (!project) return;
    const clean = transition
      ? { kind: transition.kind, duration: clampTransitionDuration(transition.duration) }
      : undefined;
    get().updateProject(
      {
        segments: project.segments.map((s, i) => {
          const { transition: _old, ...rest } = s;
          if (i === 0 || !clean || clean.kind === "none") return rest;
          return { ...rest, transition: { ...clean } };
        }),
      },
      true,
    );
  },

  applyLookPreset: (look) => {
    const { project } = get();
    if (!project) return;
    get().updateProject(applyLook(project, look), true);
  },

  regenerateZooms: () => {
    const { project } = get();
    if (!project) return;
    const generated = generateZoomKeyframes(project.cursor, zoomRect(project));
    const manual = project.zooms.filter((z) => z.source === "manual");
    get().updateProject({ zooms: [...manual, ...generated], autoZoom: true }, true);
  },
}));

export function timelineLen(project: Project | null): number {
  if (!project) return 0;
  return timelineDuration(project.segments);
}
