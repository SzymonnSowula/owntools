import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import { appendWrapped, wrapLimit, wrapWords } from "./wrap";

/**
 * Where dictated words land on the board.
 *
 * - A text box being edited: not handled here — Excalidraw's textarea has
 *   focus, so the caret path in `feature-dictation/insert.ts` takes it.
 * - Exactly one selected, free-standing text box: the words are appended
 *   (a box a take just made stays selected, so the next take continues it).
 * - Otherwise a new text box, in the current style, under the box the last
 *   take made when that is still on screen, else in the middle of the view —
 *   selected, so it can be dragged into place right away.
 * Either way the words are wrapped at a paragraph's width (see wrap.ts).
 */

const GAP = 16;
let lastInsertedId: string | null = null;

/** Test seam. */
export function resetDictationPlacement(): void {
  lastInsertedId = null;
}

export function insertTextOnBoard(api: ExcalidrawImperativeAPI, text: string): boolean {
  const words = text.trim();
  if (!words) return false;
  const appState = api.getAppState();
  if (appState.editingTextElement) return false;
  const all = api.getSceneElementsIncludingDeleted();
  const live = all.filter((el) => !el.isDeleted);
  const selected = live.filter((el) => appState.selectedElementIds[el.id]);
  if (selected.length === 1 && isPlainText(selected[0])) {
    appendTo(api, all, selected[0], words);
    return true;
  }
  addTextBox(api, all, live, appState, words);
  return true;
}

function isPlainText(el: ExcalidrawElement): el is ExcalidrawTextElement {
  return el.type === "text" && !el.containerId && el.autoResize !== false;
}

type Font = Pick<ExcalidrawTextElement, "fontFamily" | "fontSize"> &
  Partial<Pick<ExcalidrawTextElement, "lineHeight">>;

function measure(text: string, font: Font): { width: number; height: number } {
  const [probe] = convertToExcalidrawElements([{ type: "text", x: 0, y: 0, text, ...font }]);
  return { width: probe.width, height: probe.height };
}

function appendTo(
  api: ExcalidrawImperativeAPI,
  all: readonly ExcalidrawElement[],
  el: ExcalidrawTextElement,
  words: string,
): void {
  const text = appendWrapped(el.text, words, wrapLimit(el.fontSize));
  const { width, height } = measure(text, {
    fontFamily: el.fontFamily,
    fontSize: el.fontSize,
    lineHeight: el.lineHeight,
  });
  // Keep the anchor Excalidraw keeps while typing: the left edge, the centre
  // or the right edge, depending on the alignment.
  const grow = width - el.width;
  const x = el.textAlign === "center" ? el.x - grow / 2 : el.textAlign === "right" ? el.x - grow : el.x;
  const next = newElementWith(el, { text, originalText: text, width, height, x });
  api.updateScene({
    elements: all.map((e) => (e.id === el.id ? next : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  lastInsertedId = el.id;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The visible part of the scene, in scene coordinates. */
function viewport(appState: AppState): Rect {
  const zoom = appState.zoom.value || 1;
  return {
    x: -appState.scrollX,
    y: -appState.scrollY,
    width: appState.width / zoom,
    height: appState.height / zoom,
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Nudges the box down until it sits on nothing (a handful of tries, the box
 * has to stay in view); otherwise the original spot — the box is selected, so
 * dragging it off whatever it landed on is one gesture.
 */
function clearSpot(want: Rect, live: readonly ExcalidrawElement[], view: Rect): Rect {
  let spot = want;
  for (let tries = 0; tries < 8; tries++) {
    const hit = live.filter((el) => overlaps(spot, el));
    if (hit.length === 0) return spot;
    const bottom = Math.max(...hit.map((el) => el.y + el.height));
    spot = { ...spot, y: bottom + GAP };
    if (!contains(view, spot)) return want;
  }
  return want;
}

function addTextBox(
  api: ExcalidrawImperativeAPI,
  all: readonly ExcalidrawElement[],
  live: readonly ExcalidrawElement[],
  appState: AppState,
  words: string,
): void {
  const [created] = convertToExcalidrawElements([
    {
      type: "text",
      x: 0,
      y: 0,
      text: wrapWords(words, wrapLimit(appState.currentItemFontSize)),
      fontFamily: appState.currentItemFontFamily,
      fontSize: appState.currentItemFontSize,
      strokeColor: appState.currentItemStrokeColor,
      textAlign: appState.currentItemTextAlign,
      opacity: appState.currentItemOpacity,
      roughness: appState.currentItemRoughness,
    },
  ]);
  const view = viewport(appState);
  const previous = lastInsertedId ? live.find((el) => el.id === lastInsertedId) : undefined;
  const centre = {
    x: view.x + (view.width - created.width) / 2,
    y: view.y + (view.height - created.height) / 2,
    width: created.width,
    height: created.height,
  };
  let spot = clearSpot(centre, live, view);
  if (previous) {
    const below = { ...centre, x: previous.x, y: previous.y + previous.height + GAP };
    if (contains(view, previous) && contains(view, below)) spot = clearSpot(below, live, view);
  }
  const placed = newElementWith(created, { x: spot.x, y: spot.y });
  api.updateScene({
    elements: [...all, placed],
    appState: { selectedElementIds: { [placed.id]: true }, selectedGroupIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  lastInsertedId = placed.id;
}
