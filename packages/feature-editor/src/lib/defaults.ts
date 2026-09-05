import type {
  AudioSettings,
  BackgroundSettings,
  CursorAlign,
  CursorSettings,
  FadeSettings,
  ImageOverlay,
  Project,
  ProgressBarSettings,
  Segment,
  TextOverlay,
  TransitionKind,
  WebcamSettings,
} from "../types";

/**
 * One place for every default. `normalizeProject` folds a project.json
 * written by an older build onto these, so a field added later never shows
 * up as `undefined` in the compositor or the inspector.
 */

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  mode: "wallpaper",
  presetId: "aurora",
  gradientId: "ocean",
  gradientAngle: 135,
  color: "#1d1d1f",
  blur: 0,
  padding: 0.12,
  windowRadius: 28,
  shadow: 0.65,
  border: 0.35,
  frame: "none",
};

export const DEFAULT_WEBCAM: WebcamSettings = {
  enabled: false,
  corner: "br",
  size: 0.22,
  radius: 28,
  border: true,
  borderColor: "#fffdfb",
  shape: "rounded",
  borderWidth: 4,
  shadow: 0.6,
  mirror: false,
  margin: 0.03,
};

/** No correction: the recorded rectangle is taken at face value. */
export const DEFAULT_CURSOR_ALIGN: CursorAlign = { dx: 0, dy: 0, scale: 1 };

export const DEFAULT_CURSOR: CursorSettings = {
  style: "system",
  size: 1.6,
  color: "#ffffff",
  clicks: true,
  clickColor: "#0a84ff",
  spotlight: false,
  spotlightSize: 0.22,
  spotlightDim: 0.45,
};

export const DEFAULT_PROGRESS_BAR: ProgressBarSettings = {
  enabled: false,
  color: "#0a84ff",
  height: 6,
  position: "bottom",
};

export const DEFAULT_AUDIO: AudioSettings = {
  volume: 1,
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
};

export const DEFAULT_FADE: FadeSettings = { in: 0, out: 0 };

export const DEFAULT_TEXT: Omit<TextOverlay, "id" | "start" | "end" | "text"> = {
  x: 0.5,
  y: 0.18,
  fontSize: 0.06,
  color: "#fffdfb",
  weight: 700,
  align: "center",
  background: false,
  font: "outfit",
};

export const DEFAULT_OVERLAY: Omit<ImageOverlay, "id" | "start" | "end" | "src"> = {
  x: 0.86,
  y: 0.12,
  width: 0.14,
  opacity: 1,
  radius: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merge<T extends object>(defaults: T, value: unknown): T {
  if (!isRecord(value)) return { ...defaults };
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function list<T>(value: unknown, fix: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const fixed = fix(item);
    if (fixed) out.push(fixed);
  }
  return out;
}

/**
 * Brings any stored project up to the current shape without touching what it
 * already says. Older files have no `background.mode`: a custom image means
 * "image", anything else is the wallpaper they were saved with.
 */
export function normalizeProject(raw: Project | (Partial<Project> & Record<string, unknown>)): Project {
  const r = raw as Partial<Project> & Record<string, unknown>;
  const background = merge(DEFAULT_BACKGROUND, r.background);
  const legacy = r.background as Partial<BackgroundSettings> | undefined;
  if (!legacy?.mode) {
    background.mode = r.backgroundPath || legacy?.customImage ? "image" : "wallpaper";
  }

  const segments = list<Segment>(r.segments, (s) =>
    isRecord(s) && typeof s.start === "number" && typeof s.end === "number"
      ? {
          id: typeof s.id === "string" ? s.id : `seg_${Math.random().toString(36).slice(2, 8)}`,
          start: s.start,
          end: s.end,
          ...(isRecord(s.transition) && typeof s.transition.kind === "string"
            ? {
                transition: {
                  kind: s.transition.kind as TransitionKind,
                  duration:
                    typeof s.transition.duration === "number" ? s.transition.duration : 0.5,
                },
              }
            : {}),
        }
      : null,
  );

  const texts = list<TextOverlay>(r.texts, (t) =>
    isRecord(t) && typeof t.text === "string"
      ? (merge({ ...DEFAULT_TEXT, id: "", start: 0, end: 0, text: "" }, t) as TextOverlay)
      : null,
  );
  const overlays = list<ImageOverlay>(r.overlays, (o) =>
    isRecord(o) && typeof o.src === "string"
      ? (merge({ ...DEFAULT_OVERLAY, id: "", start: 0, end: 0, src: "" }, o) as ImageOverlay)
      : null,
  );

  // The sampler used to stamp a sample after its IPC returned, so a slow call
  // could land one out of order — and every lookup binary-searches on time.
  const cursor = Array.isArray(r.cursor) ? [...r.cursor] : [];
  for (let i = 1; i < cursor.length; i++) {
    if (cursor[i].t < cursor[i - 1].t) {
      cursor.sort((a, b) => a.t - b.t);
      break;
    }
  }

  return {
    ...(raw as Project),
    cursor,
    segments,
    zooms: Array.isArray(r.zooms) ? r.zooms : [],
    captions: Array.isArray(r.captions) ? r.captions : [],
    texts,
    overlays,
    shares: Array.isArray(r.shares) ? r.shares : [],
    webcam: merge(DEFAULT_WEBCAM, r.webcam),
    background,
    cursorStyle: merge(DEFAULT_CURSOR, r.cursorStyle),
    progressBar: merge(DEFAULT_PROGRESS_BAR, r.progressBar),
    audio: merge(DEFAULT_AUDIO, r.audio),
    fade: merge(DEFAULT_FADE, r.fade),
    cursorAlign: merge(DEFAULT_CURSOR_ALIGN, r.cursorAlign),
    autoZoom: typeof r.autoZoom === "boolean" ? r.autoZoom : true,
    webcamOffset: typeof r.webcamOffset === "number" ? r.webcamOffset : 0,
    aspect: r.aspect ?? "16:9",
    speechLang: r.speechLang ?? "pl-PL",
  };
}
