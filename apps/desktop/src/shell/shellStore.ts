import { create } from "zustand";

export type Section = "focus" | "create";

interface ShellState {
  section: Section;
  setSection: (section: Section) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  section: "focus",
  setSection: (section) => set({ section }),
}));
