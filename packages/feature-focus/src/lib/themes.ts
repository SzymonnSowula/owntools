import type { Theme } from "../types";

export interface ThemeMeta {
  id: Theme;
  label: string;
  hint: string;
  /** [background, surface, accent] — used to draw swatch previews. */
  swatch: [string, string, string];
  dark: boolean;
}

export const THEMES: ThemeMeta[] = [
  { id: "light", label: "Day", hint: "Clean paper white", swatch: ["#fafafa", "#ffffff", "#0a84ff"], dark: false },
  { id: "dark", label: "Night", hint: "Deep charcoal", swatch: ["#111113", "#18181b", "#0a84ff"], dark: true },
  { id: "nature", label: "Nature", hint: "Sage paper, forest green", swatch: ["#f2f5ee", "#fbfcf8", "#3a7d44"], dark: false },
  { id: "ocean", label: "Ocean", hint: "Deep sea, cyan glow", swatch: ["#0a141d", "#101d29", "#32ade6"], dark: true },
  { id: "sunset", label: "Sunset", hint: "Warm dusk amber", swatch: ["#faf3ec", "#fffcf8", "#e8590c"], dark: false },
];

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((t) => t.id === value);
}

/** Sets data-theme on <html>; unknown persisted values fall back to light. */
export function applyTheme(theme: unknown) {
  document.documentElement.dataset.theme = isTheme(theme) ? theme : "light";
}
