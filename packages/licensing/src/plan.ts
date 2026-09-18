import { isPro } from "./license";

/**
 * What a key unlocks (2026-09-18).
 *
 * Free is the everyday desk - dictate, screeni (with the badge on exports),
 * focus, board, capture and the quick file tools. Pro adds the four tools
 * below and takes the badge off exports. This list is the one source: the hub
 * tags the cards, the tool mounts show the lock screen (`@ui/ProGate`), the
 * bar's meeting widget says so, social's runner stays quiet, and Rust hears
 * about the key through `license_set_pro` so the agent server refuses writes.
 * A tool moves between free and Pro here and nowhere else.
 */
export const PRO_TOOLS = ["meet", "social", "disk", "launch"] as const;
export type ProTool = (typeof PRO_TOOLS)[number];

export function isProTool(tool: string): tool is ProTool {
  return (PRO_TOOLS as readonly string[]).includes(tool);
}

/** True when `tool` needs a key this install does not have. */
export function toolLocked(tool: string): boolean {
  return isProTool(tool) && !isPro();
}

/** One sentence per Pro tool, for the lock screen. */
export const PRO_PITCH: Record<ProTool, string> = {
  meet: "Records both sides of a call, writes the transcript as it happens and the notes after - all on this machine.",
  social: "Schedules posts to 30+ networks from one calendar, and lets your agents queue them for review.",
  disk: "Shows where the space went, finds duplicates and cleans up - into the Recycle Bin, never further.",
  launch: "Turns a URL into a launch video in six styles, rendered on this machine.",
};

/** What the key buys, in the order the lock screen lists it. */
export const PRO_INCLUDES: readonly string[] = [
  "meet, social, disk and launch",
  "no badge on exported videos",
  "one payment, an offline key, every update",
];
