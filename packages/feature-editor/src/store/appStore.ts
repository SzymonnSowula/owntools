import { create } from "zustand";
import type {
  Caption,
  MediaUrls,
  Project,
  ProjectMeta,
  Selection,
  SpeechLang,
  TextOverlay,
  Toast,
  View,
  ZoomClip,
} from "../types";
import { clone, defaultProjectName, uid } from "../lib/id";
import { loadIndex, loadProjectFromDisk, saveProjectToDisk, upsertRecent } from "../lib/projectIo";
import { generateZoomKeyframes } from "../lib/zoom";
import { removeSegment, splitSegment, timelineDuration, timelineToSource } from "../lib/segments";

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
    webcam: {
      enabled: false,
      corner: "br",
      size: 0.22,
      radius: 28,
      border: true,
      borderColor: "#fffdfb",
    },
    background: {
      presetId: "aurora",
      padding: 0.12,
      windowRadius: 28,
      shadow: 0.65,
    },
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
  webcam: Project["webcam"];
  background: Project["background"];
  autoZoom: boolean;
  aspect: Project["aspect"];
}

function snap(project: Project): EditorSnapshot {
  return clone({
    segments: project.segments,
    zooms: project.zooms,
    captions: project.captions,
    texts: project.texts,
    webcam: project.webcam,
    background: project.background,
    autoZoom: project.autoZoom,
    aspect: project.aspect,
  });
}

function applySnap(project: Project, s: EditorSnapshot): Project {
  return { ...project, ...clone(s) };
}

interface AppState {
  view: View;
  compactChrome: boolean;
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
  deleteSelection: () => void;
  addZoom: (kind: "in" | "out") => void;
  addCaption: () => void;
  addText: () => void;
  regenerateZooms: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "home",
  compactChrome: false,
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
  setSpeechLang: (speechLang) => set({ speechLang }),
  showToast: (message, type = "info") =>
    set({ toast: { id: uid("toast"), message, type } }),
  clearToast: () => set({ toast: null }),

  hydrateRecent: async () => {
    const recent = await loadIndex();
    set({ recent });
  },

  openProject: async (project, media) => {
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
    const { project, timelineTime } = get();
    if (!project) return;
    const source = timelineToSource(timelineTime, project.segments);
    const segments = splitSegment(project.segments, source, uid("seg"));
    if (segments.length === project.segments.length) return;
    get().updateProject({ segments }, true);
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
    if (c && project.screenWidth && project.screenHeight) {
      zoom.x = Math.min(0.92, Math.max(0.08, c.x / project.screenWidth));
      zoom.y = Math.min(0.92, Math.max(0.08, c.y / project.screenHeight));
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
      id: uid("txt"),
      start: source,
      end: Math.min(project.duration, source + 3),
      text: "Heading",
      x: 0.5,
      y: 0.18,
      fontSize: 0.06,
      color: "#fffdfb",
      weight: 700,
      align: "center",
    };
    get().updateProject({ texts: [...project.texts, text] }, true);
    set({ selection: { type: "text", id: text.id } });
  },

  regenerateZooms: () => {
    const { project } = get();
    if (!project) return;
    const generated = generateZoomKeyframes(
      project.cursor,
      project.screenWidth || project.videoWidth,
      project.screenHeight || project.videoHeight,
    );
    const manual = project.zooms.filter((z) => z.source === "manual");
    get().updateProject({ zooms: [...manual, ...generated], autoZoom: true }, true);
  },
}));

export function timelineLen(project: Project | null): number {
  if (!project) return 0;
  return timelineDuration(project.segments);
}
