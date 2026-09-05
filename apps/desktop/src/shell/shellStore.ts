import { create } from "zustand";
import type { QuickToolKey } from "@feature-tools/keys";

export type Tool = "hub" | "focus" | "create" | "launch" | "dictate" | "board" | "social";

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
  setTool: (tool: Tool) => void;
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
  setTool: (tool) => set({ tool }),
  setFocusOverview: (focusOverview) => set({ focusOverview }),
  setHubTool: (hubTool) => set({ hubTool }),
  openSession: (workspaceId, auto = false) =>
    set({ sessionFor: workspaceId, sessionAuto: auto }),
  closeSession: () => set({ sessionFor: null, sessionAuto: false }),
  openSetup: (workspaceId) => set({ setupFor: workspaceId }),
  closeSetup: () => set({ setupFor: null }),
}));
