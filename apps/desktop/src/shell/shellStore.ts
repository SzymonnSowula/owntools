import { create } from "zustand";
import type { QuickToolKey } from "@feature-tools/keys";
import type { SettingsTarget } from "@feature-focus/features/settings/SettingsView";

export type Tool =
  | "hub"
  | "focus"
  | "create"
  | "capture"
  | "launch"
  | "dictate"
  | "meet"
  | "board"
  | "social"
  | "disk"
  /** Not a tool on the rail: the app-wide Settings screen (the gear under it). */
  | "settings";

/** A quick tool opened over the hub (`@feature-tools/catalogue`), or null. */
export type HubTool = QuickToolKey | null;

interface ShellState {
  tool: Tool;
  /** Focus module: show the feature-tile overview instead of a single view. */
  focusOverview: boolean;
  /** Quick tool modal opened straight from the hub (no tool switch). */
  hubTool: HubTool;
  /** Workspace whose session sheet is open (id), or null. */
  sessionFor: string | null;
  /** Whether that sheet should launch as soon as it opens. */
  sessionAuto: boolean;
  /** Workspace whose ritual editor is open (id), or null. */
  setupFor: string | null;
  /** Where Settings should open (a category or one setting); null = where it was left. */
  settingsTarget: SettingsTarget | null;
  setTool: (tool: Tool) => void;
  /** Opens Settings, optionally at one setting (`"scroll-guard"`, `"privacy"`). */
  openSettings: (section?: string | null) => void;
  setFocusOverview: (v: boolean) => void;
  setHubTool: (hubTool: HubTool) => void;
  openSession: (workspaceId: string, auto?: boolean) => void;
  closeSession: () => void;
  openSetup: (workspaceId: string) => void;
  closeSetup: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  tool: "hub",
  focusOverview: true,
  hubTool: null,
  sessionFor: null,
  sessionAuto: false,
  setupFor: null,
  settingsTarget: null,
  setTool: (tool) => set({ tool }),
  openSettings: (section = null) =>
    set({ tool: "settings", settingsTarget: section ? { section, at: Date.now() } : null }),
  setFocusOverview: (focusOverview) => set({ focusOverview }),
  setHubTool: (hubTool) => set({ hubTool }),
  openSession: (workspaceId, auto = false) =>
    set({ sessionFor: workspaceId, sessionAuto: auto }),
  closeSession: () => set({ sessionFor: null, sessionAuto: false }),
  openSetup: (workspaceId) => set({ setupFor: workspaceId }),
  closeSetup: () => set({ setupFor: null }),
}));
