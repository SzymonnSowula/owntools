/**
 * Outfit (display, lowercase headings) and Inter (body) — the app's two
 * faces, served from `public/fonts` (copied from @fontsource, latin subset).
 * `loadFont` holds the render until each face is in `document.fonts`.
 */
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

const faces: Array<{ family: string; file: string; weight: string }> = [
  { family: "Outfit", file: "outfit-latin-500-normal.woff2", weight: "500" },
  { family: "Outfit", file: "outfit-latin-600-normal.woff2", weight: "600" },
  { family: "Outfit", file: "outfit-latin-700-normal.woff2", weight: "700" },
  { family: "Outfit", file: "outfit-latin-800-normal.woff2", weight: "800" },
  { family: "Inter", file: "inter-latin-400-normal.woff2", weight: "400" },
  { family: "Inter", file: "inter-latin-500-normal.woff2", weight: "500" },
  { family: "Inter", file: "inter-latin-600-normal.woff2", weight: "600" },
  { family: "Inter", file: "inter-latin-700-normal.woff2", weight: "700" },
];

let started: Promise<void[]> | null = null;

export function loadFonts(): Promise<void[]> {
  if (!started) {
    started = Promise.all(
      faces.map((f) =>
        loadFont({
          family: f.family,
          url: staticFile(`fonts/${f.file}`),
          weight: f.weight,
          format: "woff2",
        }),
      ),
    );
  }
  return started;
}
