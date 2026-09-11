/**
 * Passing one tool's output to another without a detour through the disk.
 *
 * The case this exists for: you finish a recording in screeni and want it
 * posted. Everything needed is already in memory in this window — the tools
 * are lazy chunks of one page, not separate apps — so the handoff is a
 * module-level slot plus an event, and no file is written, re-read or
 * copied. It deliberately does not survive a reload: a handoff is something
 * you just asked for, not a queue.
 */

export interface HandoffFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

export interface Handoff {
  /** Which tool is meant to pick this up. */
  tool: "social" | "board" | "focus";
  file?: HandoffFile;
  /** Text to start the post with (social), to place on the canvas (board), or the note body (focus). */
  text?: string;
  /** Separate items — to-dos for focus, one task each. */
  items?: string[];
  /** A title for what is handed over (a meeting, a capture). */
  title?: string;
  /** Where it came from, for the toast the receiving tool shows. */
  from?: string;
}

export const HANDOFF_EVENT = "owntools:handoff";
export const OPEN_TOOL_EVENT = "owntools:open-tool";

let pending: Handoff | null = null;

/**
 * Hands something to another tool and asks the shell to switch to it. The
 * shell listens for `OPEN_TOOL_EVENT`; the receiving tool calls
 * `takeHandoff` on mount and again on `HANDOFF_EVENT` (it may already be
 * mounted).
 */
export function handOff(item: Handoff): void {
  pending = item;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_TOOL_EVENT, { detail: { tool: item.tool } }));
  window.dispatchEvent(new CustomEvent(HANDOFF_EVENT, { detail: { tool: item.tool } }));
}

/** The waiting handoff for this tool, cleared as it is read. */
export function takeHandoff(tool: Handoff["tool"]): Handoff | null {
  if (!pending || pending.tool !== tool) return null;
  const item = pending;
  pending = null;
  return item;
}

/** Fires when something is handed to a tool that may already be open. */
export function onHandoff(tool: Handoff["tool"], cb: () => void): () => void {
  const handler = (e: Event) => {
    if ((e as CustomEvent<{ tool?: string }>).detail?.tool === tool) cb();
  };
  window.addEventListener(HANDOFF_EVENT, handler);
  return () => window.removeEventListener(HANDOFF_EVENT, handler);
}
