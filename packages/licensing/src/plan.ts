import { isPro } from "./license";

/**
 * What a key unlocks (2026-09-18, second cut the same day).
 *
 * Free is dictate - the hotkey, the pill, live captions, its models - and the
 * quick file tools. Every other tool on the hub comes with a key. This list is
 * the one source: the hub and the rail tag the cards, the tool mounts show the
 * lock screen (`@ui/ProGate`), the bar's Record / Focus / Meeting / Screenshot
 * say so instead of starting, social's runner stays quiet, and Rust hears
 * about the key through `license_set_pro`, so the screenshot hotkey, the
 * tray's items and the agent server's writes answer the same way.
 * A tool moves between free and Pro here and nowhere else (plus the copy).
 *
 * The ids are the shell's tool ids: `create` is screeni.
 */
export const PRO_TOOLS = ["focus", "create", "capture", "launch", "meet", "board", "disk", "social"] as const;
export type ProTool = (typeof PRO_TOOLS)[number];

export function isProTool(tool: string): tool is ProTool {
  return (PRO_TOOLS as readonly string[]).includes(tool);
}

/** True when `tool` needs a key this install does not have. */
export function toolLocked(tool: string): boolean {
  return isProTool(tool) && !isPro();
}

/** The name a person knows the tool by (the shell calls screeni `create`). */
export const PRO_TOOL_NAME: Record<ProTool, string> = {
  focus: "focus",
  create: "screeni",
  capture: "capture",
  launch: "launch",
  meet: "meet",
  board: "board",
  disk: "disk",
  social: "social",
};

/**
 * Quick tools are free. The one exception is not a file tool at all: the voice
 * note is a page inside focus, so it goes where focus goes.
 */
const QUICK_TOOL_HOME: Readonly<Record<string, ProTool>> = { voicenote: "focus" };

/** The Pro tool a quick tool lives in, if it lives in one. */
export function quickToolHome(key: string): ProTool | null {
  return QUICK_TOOL_HOME[key] ?? null;
}

/** True when this quick tool opens a tool that needs a key this install does not have. */
export function quickToolLocked(key: string): boolean {
  const home = quickToolHome(key);
  return home !== null && toolLocked(home);
}

/** One sentence per Pro tool, for the lock screen. */
export const PRO_PITCH: Record<ProTool, string> = {
  focus: "A quiet desk: a timer, tasks, a notebook, habits and a map of where the day went, with records to work to.",
  create: "Records the screen, zooms in on your clicks by itself, and exports MP4 - edited on this machine.",
  capture: "Grabs any part of the screen with one shortcut, marks it up and copies the text out of it.",
  launch: "Turns a URL into a launch video in six styles, rendered on this machine.",
  meet: "Records both sides of a call, writes the transcript as it happens and the notes after - all on this machine.",
  board: "An endless whiteboard for screenshots, sketches, boxes and arrows. Every board is a folder on your disk.",
  disk: "Shows where the space went, finds duplicates and cleans up - into the Recycle Bin, never further.",
  social: "Schedules posts to 30+ networks from one calendar, and lets your agents queue them for review.",
};

/** What the key buys, in the order the lock screen lists it. */
export const PRO_INCLUDES: readonly string[] = [
  "focus, screeni, capture, board, meet, social, disk and launch",
  "one payment, an offline key, every update",
  "dictate and the quick file tools stay free",
];
