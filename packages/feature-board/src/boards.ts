import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Board bookkeeping that needs no Excalidraw runtime: the index of boards, the
 * on-disk scene shape and the small helpers around names and file references.
 * Storage adapters (`storage.ts`) move these around; the session
 * (`session.ts`) decides when.
 */

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** When the preview was last rendered (0 = none yet). Doubles as a cache-buster. */
  thumbAt: number;
}

export interface BoardIndex {
  version: 1;
  boards: BoardMeta[];
  lastOpenedId: string | null;
}

/** scene.json: the elements plus the slice of appState worth keeping. Images live next to it, one file each. */
export interface StoredScene {
  type: "shipshape-board";
  version: 1;
  savedAt: number;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
}

export const DEFAULT_BOARD_NAME = "Untitled board";
export const MAX_BOARD_NAME = 80;

export function emptyIndex(): BoardIndex {
  return { version: 1, boards: [], lastOpenedId: null };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isMeta(value: unknown): value is BoardMeta {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<BoardMeta>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.name === "string";
}

/** Tolerant: a damaged or foreign index becomes an empty one instead of an error. */
export function parseIndex(raw: string | null | undefined): BoardIndex {
  if (!raw) return emptyIndex();
  let data: Partial<BoardIndex> | null;
  try {
    data = JSON.parse(raw) as Partial<BoardIndex> | null;
  } catch {
    return emptyIndex();
  }
  const seen = new Set<string>();
  const boards: BoardMeta[] = [];
  for (const b of Array.isArray(data?.boards) ? data.boards : []) {
    if (!isMeta(b) || seen.has(b.id)) continue;
    seen.add(b.id);
    boards.push({
      id: b.id,
      name: normalizeBoardName(b.name) || DEFAULT_BOARD_NAME,
      createdAt: num(b.createdAt),
      updatedAt: num(b.updatedAt),
      thumbAt: num(b.thumbAt),
    });
  }
  const last = data?.lastOpenedId;
  return {
    version: 1,
    boards,
    lastOpenedId: typeof last === "string" && seen.has(last) ? last : null,
  };
}

export function newBoardId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeBoardName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_BOARD_NAME);
}

/** "Untitled board", then "Untitled board 2", … — case-insensitive against what exists. */
export function nextBoardName(boards: readonly BoardMeta[], base = DEFAULT_BOARD_NAME): string {
  const taken = new Set(boards.map((b) => b.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function boardById(index: BoardIndex, id: string): BoardMeta | undefined {
  return index.boards.find((b) => b.id === id);
}

/** Newest edit first. */
export function sortedBoards(index: BoardIndex): BoardMeta[] {
  return [...index.boards].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createBoard(
  index: BoardIndex,
  name?: string,
  now = Date.now(),
): { index: BoardIndex; board: BoardMeta } {
  const board: BoardMeta = {
    id: newBoardId(now),
    name: normalizeBoardName(name ?? "") || nextBoardName(index.boards),
    createdAt: now,
    updatedAt: now,
    thumbAt: 0,
  };
  return {
    index: { ...index, boards: [board, ...index.boards], lastOpenedId: board.id },
    board,
  };
}

export function updateBoard(
  index: BoardIndex,
  id: string,
  patch: Partial<Omit<BoardMeta, "id">>,
): BoardIndex {
  if (!boardById(index, id)) return index;
  return { ...index, boards: index.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/** An empty name keeps the old one; whitespace is collapsed and the length capped. */
export function renameBoard(index: BoardIndex, id: string, name: string, now = Date.now()): BoardIndex {
  const clean = normalizeBoardName(name);
  if (!clean) return index;
  return updateBoard(index, id, { name: clean, updatedAt: now });
}

export function touchBoard(index: BoardIndex, id: string, now = Date.now()): BoardIndex {
  return updateBoard(index, id, { updatedAt: now });
}

export function markOpened(index: BoardIndex, id: string): BoardIndex {
  return boardById(index, id) ? { ...index, lastOpenedId: id } : index;
}

/** Drops a board; if it was the last opened one, the most recently edited survivor takes over. */
export function removeBoard(index: BoardIndex, id: string): BoardIndex {
  const rest: BoardIndex = { ...index, boards: index.boards.filter((b) => b.id !== id) };
  const lastOpenedId =
    index.lastOpenedId === id ? (sortedBoards(rest)[0]?.id ?? null) : index.lastOpenedId;
  return { ...rest, lastOpenedId };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/**
 * The part of appState that belongs to the board rather than to the moment:
 * the view (scroll/zoom), the canvas look and the toolbar defaults
 * (`currentItem*`). Selection, open dialogs, collaborators and the like are
 * never written.
 */
const APP_STATE_KEYS = new Set<string>([
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "zoom",
  "scrollX",
  "scrollY",
  "objectsSnapModeEnabled",
  "zenModeEnabled",
  "exportBackground",
  "exportScale",
  "exportWithDarkMode",
  "exportEmbedScene",
]);

export function pickAppState(appState: Partial<AppState> | null | undefined): Partial<AppState> {
  const out: Record<string, unknown> = {};
  if (!appState) return out;
  for (const [key, value] of Object.entries(appState)) {
    if (value === undefined) continue;
    if (APP_STATE_KEYS.has(key) || key.startsWith("currentItem")) out[key] = value;
  }
  return out as Partial<AppState>;
}

export function liveElements(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  return elements.filter((el) => !el.isDeleted);
}

/** Ids of the image files that live (non-deleted) elements point at. */
export function referencedFileIds(elements: readonly ExcalidrawElement[]): Set<string> {
  const ids = new Set<string>();
  for (const el of elements) {
    if (!el.isDeleted && el.type === "image" && el.fileId) ids.add(el.fileId);
  }
  return ids;
}

export function toStoredScene(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  now = Date.now(),
): StoredScene {
  return {
    type: "shipshape-board",
    version: 1,
    savedAt: now,
    elements: liveElements(elements),
    appState: pickAppState(appState),
  };
}

/** Accepts our scene.json and, leniently, a plain .excalidraw document. */
export function parseStoredScene(raw: string | null | undefined): StoredScene | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<StoredScene> | null;
    if (!data || !Array.isArray(data.elements)) return null;
    return {
      type: "shipshape-board",
      version: 1,
      savedAt: num(data.savedAt),
      elements: data.elements.filter(
        (el): el is ExcalidrawElement =>
          typeof el === "object" && el !== null && typeof (el as ExcalidrawElement).type === "string",
      ),
      appState: pickAppState(
        data.appState && typeof data.appState === "object" ? data.appState : {},
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Cheap change detector for Excalidraw's onChange, which fires on every state
 * update: the element version sum (what Excalidraw itself calls the scene
 * version) plus the persisted appState slice.
 */
export function sceneSignature(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
): string {
  let sum = 0;
  for (const el of elements) sum += el.version;
  return `${elements.length}:${sum}:${JSON.stringify(pickAppState(appState))}`;
}

/* ------------------------------------------------------------------ */
/* Names & time                                                        */
/* ------------------------------------------------------------------ */

/** A board name as a file name: no path or reserved characters, no trailing dots. */
export function safeFileName(name: string, fallback = "board"): string {
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 60);
  return clean || fallback;
}

export function timeAgo(ts: number, now = Date.now()): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
