/**
 * What the two image tools remember between openings — one small JSON, the
 * way every tool here keeps its preferences. Keys and provider choices for
 * image *generation* live in `generate/settings.ts`; this is only the
 * background remover's last-used look.
 */
import type { EdgeStyle } from "./matting/mask";
import { DEFAULT_MATTING_MODEL, mattingModel, type MattingModelId } from "./matting/models";
import type { CutoutFormat } from "./matting/compose";

export type BackdropChoice = "transparent" | "white" | "black" | "color" | "blur";

export interface MattingPrefs {
  model: MattingModelId;
  edge: EdgeStyle;
  backdrop: BackdropChoice;
  /** Used when `backdrop` is "color". */
  color: string;
  trim: boolean;
  format: CutoutFormat;
  /** Skip the GPU even when there is one — the way out when a driver misbehaves. */
  cpuOnly: boolean;
}

export const MATTING_PREFS_KEY = "owntools-matting-prefs";

export const DEFAULT_MATTING_PREFS: MattingPrefs = {
  model: DEFAULT_MATTING_MODEL,
  edge: "balanced",
  backdrop: "transparent",
  color: "#0a84ff",
  trim: false,
  format: "png",
  cpuOnly: false,
};

const EDGES: EdgeStyle[] = ["soft", "balanced", "crisp"];
const BACKDROPS: BackdropChoice[] = ["transparent", "white", "black", "color", "blur"];
const FORMATS: CutoutFormat[] = ["png", "webp", "jpeg"];

/** Folds whatever was stored onto the current shape; unknown values fall back to the default. */
export function normalizeMattingPrefs(raw: unknown): MattingPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof MattingPrefs, unknown>>;
  const d = DEFAULT_MATTING_PREFS;
  return {
    model: typeof p.model === "string" && mattingModel(p.model) ? (p.model as MattingModelId) : d.model,
    edge: EDGES.includes(p.edge as EdgeStyle) ? (p.edge as EdgeStyle) : d.edge,
    backdrop: BACKDROPS.includes(p.backdrop as BackdropChoice) ? (p.backdrop as BackdropChoice) : d.backdrop,
    color: typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : d.color,
    trim: typeof p.trim === "boolean" ? p.trim : d.trim,
    format: FORMATS.includes(p.format as CutoutFormat) ? (p.format as CutoutFormat) : d.format,
    cpuOnly: typeof p.cpuOnly === "boolean" ? p.cpuOnly : d.cpuOnly,
  };
}

export function loadMattingPrefs(): MattingPrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(MATTING_PREFS_KEY);
    return normalizeMattingPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_MATTING_PREFS;
  }
}

export function saveMattingPrefs(prefs: MattingPrefs): void {
  try {
    localStorage.setItem(MATTING_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / tests */
  }
}
