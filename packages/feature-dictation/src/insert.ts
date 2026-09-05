/**
 * Delivering a transcript *inside* the app.
 *
 * When another application is in front, the pill types the words with
 * SendInput and that is the end of it. When our own main window is in front,
 * keystrokes are the wrong tool: on the board every letter is a tool shortcut,
 * in focus the space bar toggles the timer. So the pill hands the text to the
 * main window as an event and this module decides where it lands:
 *
 *   1. the focused text field (input / textarea / contenteditable) — at the
 *      caret, with a space before when the caret follows a word;
 *   2. the registered sink — the view that is open registers one while it can
 *      take free-standing text (the board adds a text box);
 *   3. the clipboard, so the words are not lost.
 *
 * The main window answers with the outcome and the pill shows it.
 */

export const DICTATION_INSERT_EVENT = "dictation-insert";
export const DICTATION_INSERTED_EVENT = "dictation-inserted";

export type InsertOutcome = "field" | "sink" | "clipboard" | "none";

export interface DictationSink {
  /** For the log; the pill does not show it. */
  name: string;
  /** Returns false to say "not here", which falls through to the clipboard. */
  insert: (text: string) => boolean;
}

let sink: DictationSink | null = null;

/**
 * Registers the view that can take dictated text when no field is focused.
 * Returns the unregister function; a later registration replaces an earlier
 * one, and unregistering only removes the sink it was given.
 */
export function registerDictationSink(next: DictationSink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

/** Test seam: what is registered right now. */
export function currentDictationSink(): DictationSink | null {
  return sink;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password"]);

type Field = HTMLInputElement | HTMLTextAreaElement;

function isField(el: Element): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.disabled && !el.readOnly && TEXT_INPUT_TYPES.has(el.type.toLowerCase());
  }
  return false;
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  return isField(el) || el.isContentEditable;
}

/** The character just before the caret, or "" at the start / when unknown. */
function charBeforeCaret(el: HTMLElement): string {
  if (isField(el)) {
    const at = el.selectionStart ?? el.value.length;
    return el.value.charAt(at - 1);
  }
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (sel && node && node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").charAt(sel.anchorOffset - 1);
  }
  return "";
}

/** "word|" + "more" → "word more ", "word |" → "word more ". */
function spaced(el: HTMLElement, words: string): string {
  const before = charBeforeCaret(el);
  const lead = before !== "" && !/\s/.test(before) ? " " : "";
  return `${lead}${words} `;
}

/**
 * Inserts at the caret. `execCommand("insertText")` is the path that keeps
 * undo history and fires a real `input` event (React sees it); the manual
 * splice below is for fields where it is unavailable.
 */
function insertIntoField(el: HTMLElement, text: string): boolean {
  el.focus();
  try {
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) {
      return true;
    }
  } catch {
    /* fall through */
  }
  if (!isField(el)) return false;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const value = el.value.slice(0, start) + text + el.value.slice(end);
  // Through the prototype setter, so React's value tracker notices the change
  // and the `input` event below reaches its onChange.
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  const caret = start + text.length;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* email inputs refuse selection ranges */
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** Puts dictated words where they belong in this window (see the module note). */
export async function insertDictatedText(text: string): Promise<InsertOutcome> {
  const words = text.trim();
  if (!words) return "none";
  const active = document.activeElement;
  if (isEditable(active) && insertIntoField(active, spaced(active, words))) return "field";
  if (sink) {
    try {
      if (sink.insert(words)) return "sink";
    } catch {
      /* a broken sink must not lose the words: on to the clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(words);
    return "clipboard";
  } catch {
    return "none";
  }
}

/**
 * Main window: takes insert requests from the pill and answers with the
 * outcome. Resolves with the unlisten function.
 */
export async function listenForDictation(): Promise<() => void> {
  const { listen, emitTo } = await import("@tauri-apps/api/event");
  return listen<{ text?: string }>(DICTATION_INSERT_EVENT, (event) => {
    void (async () => {
      const where = await insertDictatedText(event.payload?.text ?? "");
      await emitTo("dictation", DICTATION_INSERTED_EVENT, { where }).catch(() => undefined);
    })();
  });
}

/**
 * Pill: asks the main window to place the text and waits for its answer.
 * `null` when it did not answer in time (webview still loading, say) — the
 * caller then types the text instead.
 */
export async function requestInsertInMain(text: string, timeoutMs = 2500): Promise<InsertOutcome | null> {
  const { listen, emitTo } = await import("@tauri-apps/api/event");
  return new Promise<InsertOutcome | null>((resolve) => {
    let off: (() => void) | null = null;
    let settled = false;
    const finish = (outcome: InsertOutcome | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      off?.();
      resolve(outcome);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    listen<{ where?: InsertOutcome }>(DICTATION_INSERTED_EVENT, (event) =>
      finish(event.payload?.where ?? null),
    )
      .then((unlisten) => {
        off = unlisten;
        if (settled) unlisten();
        else emitTo("main", DICTATION_INSERT_EVENT, { text }).catch(() => finish(null));
      })
      .catch(() => finish(null));
  });
}
