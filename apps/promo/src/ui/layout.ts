import { useVideoConfig } from "remotion";

/**
 * The scenes are drawn for 1920 × 1080; `s` scales that design to the
 * composition, and `portrait` tells a scene to stack instead of sit side by
 * side. `zoom` is the factor the app-pixel mocks are blown up by: the app's
 * UI is 12–14 px text, a video wants ~22 px.
 */
export interface Layout {
  w: number;
  h: number;
  portrait: boolean;
  /** Design scale: 1 at 1920 × 1080. */
  s: number;
  /** CSS `zoom` for app-pixel mocks. */
  zoom: number;
}

export const UI_ZOOM = 1.72;

export function useLayout(): Layout {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const s = portrait ? width / 1080 : Math.min(width / 1920, height / 1080);
  // Portrait: the widest mock is 940 app px and has to fit 1080 with a margin.
  const zoom = portrait ? 1.12 * s : UI_ZOOM * s;
  return { w: width, h: height, portrait, s, zoom };
}
