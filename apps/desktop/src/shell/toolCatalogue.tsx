/**
 * The nine tools, in the one order the brand depends on.
 *
 * `ToolMark` paints each tile on a blue -> indigo -> cyan arc, and that arc only
 * reads as a spectrum if the tools are shown in this sequence. The hub grid and
 * the rail both render from here so they can never drift apart - a tool added
 * in one place and forgotten in the other is exactly how the spectrum breaks.
 */
import type { ReactElement } from "react";
import { DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import { ToolIcons } from "@ui/WinDots";
import type { ToolMarkName } from "@ui/ToolMark";
import type { QuickToolKey } from "@feature-tools/keys";
import { useAppStore as useFocusStore } from "@feature-focus/store/useAppStore";
import { useShellStore, type Tool } from "./shellStore";

export interface ToolCard {
  tool: Tool;
  /** Title on the card's fake window chrome. */
  window: string;
  name: string;
  /** Full sentence for the hub card. */
  desc: string;
  /** Three or four words for the rail tooltip, where there is no room to read. */
  blurb: string;
  mark: ToolMarkName;
  dots: ReactElement;
  tilt: number;
}

export const TOOL_CARDS: ToolCard[] = [
  {
    tool: "focus",
    window: "focus.app",
    name: "focus",
    desc: "A quiet desk: timer, tasks, notebook, habits and a time heatmap.",
    blurb: "timer, tasks, notes",
    tilt: -1.1,
    mark: "focus",
    dots: ToolIcons.focus,
  },
  {
    tool: "create",
    window: "screeni.app",
    name: "screeni",
    desc: "Screen recordings that follow your cursor. Edit, zoom, export MP4.",
    blurb: "record and edit the screen",
    tilt: 1.2,
    mark: "screeni",
    dots: ToolIcons.video,
  },
  {
    tool: "capture",
    window: "capture.app",
    name: "capture",
    desc: "Grab any part of the screen, mark it up, copy the text out of it. One shortcut.",
    blurb: "screenshot, annotate, OCR",
    tilt: 0.7,
    mark: "capture",
    dots: ToolIcons.capture,
  },
  {
    tool: "launch",
    window: "launch.app",
    name: "launch",
    desc: "Paste a URL, get a short video out of it. Rendered on-device.",
    blurb: "a URL becomes a video",
    tilt: -0.9,
    mark: "launch",
    dots: ToolIcons.launch,
  },
  {
    tool: "dictate",
    window: "dictate.app",
    name: "dictate",
    desc: `Press ${DICTATION_HOTKEY_LABEL}, speak, press again — an on-device model types for you anywhere.`,
    blurb: "speak, it types",
    tilt: 0.8,
    mark: "dictate",
    dots: ToolIcons.dictate,
  },
  {
    tool: "meet",
    window: "meet.app",
    name: "meet",
    desc: "Record any call on this machine. A live transcript, who said what, notes and to-dos after.",
    blurb: "calls, transcribed",
    tilt: -1.0,
    mark: "meet",
    dots: ToolIcons.meet,
  },
  {
    tool: "board",
    window: "board.app",
    name: "board",
    desc: "An endless whiteboard: paste screenshots, sketch, think in boxes and arrows.",
    blurb: "an endless whiteboard",
    tilt: -0.7,
    mark: "board",
    dots: ToolIcons.board,
  },
  {
    tool: "disk",
    window: "disk.app",
    name: "disk",
    desc: "See where the space went: a treemap of every file, duplicates, quick wins, snapshots.",
    blurb: "where the space went",
    tilt: -0.8,
    mark: "disk",
    dots: ToolIcons.disk,
  },
  {
    tool: "social",
    window: "social.app",
    name: "social",
    desc: "Schedule posts to 30+ networks from a calendar. Agents can drive it over a local API.",
    blurb: "schedule posts",
    tilt: 0.9,
    mark: "social",
    dots: ToolIcons.social,
  },
];

/**
 * Opening a quick tool is not always "show a modal": the voice note is a page
 * inside focus, not a modal of its own. Both the hub and the rail route through
 * here so that exception lives in one place.
 */
export function openQuickTool(key: QuickToolKey) {
  const shell = useShellStore.getState();
  if (key === "voicenote") {
    shell.setTool("focus");
    shell.setFocusOverview(false);
    useFocusStore.getState().setView("notes");
    return;
  }
  shell.setHubTool(key);
}
