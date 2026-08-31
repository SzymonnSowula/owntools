import { create } from "zustand";

export type Tool = "hub" | "focus" | "create" | "launch" | "dictate";

interface ShellState {
  tool: Tool;
  /** Focus module: show the feature-tile overview instead of a single view. */
  focusOverview: boolean;
  setTool: (tool: Tool) => void;
  setFocusOverview: (v: boolean) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  tool: "hub",
  focusOverview: true,
  setTool: (tool) => set({ tool }),
  setFocusOverview: (focusOverview) => set({ focusOverview }),
}));
