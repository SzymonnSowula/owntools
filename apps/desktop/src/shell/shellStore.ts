import { create } from "zustand";

export type Tool = "hub" | "focus" | "create" | "launch" | "dictate";

export type HubTool = "transcribe" | "translate" | "extract" | null;

interface ShellState {
  tool: Tool;
  /** Focus module: show the feature-tile overview instead of a single view. */
  focusOverview: boolean;
  /** Quick tool modal opened straight from the hub (no tool switch). */
  hubTool: HubTool;
  setTool: (tool: Tool) => void;
  setFocusOverview: (v: boolean) => void;
  setHubTool: (hubTool: HubTool) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  tool: "hub",
  focusOverview: true,
  hubTool: null,
  setTool: (tool) => set({ tool }),
  setFocusOverview: (focusOverview) => set({ focusOverview }),
  setHubTool: (hubTool) => set({ hubTool }),
}));
