/**
 * Excalidraw loads its fonts from `window.EXCALIDRAW_ASSET_PATH` and, when that
 * is unset, from a public CDN — which the app's CSP blocks and an offline
 * desktop should never need. The Vite plugin in apps/desktop/vite.config.ts
 * serves / copies the package's `fonts/` folder under this path.
 *
 * Imported first in BoardView.tsx so it runs before the Excalidraw bundle
 * builds its font registry.
 */
const ASSET_PATH = "/excalidraw/";

const w = typeof window === "undefined" ? null : (window as { EXCALIDRAW_ASSET_PATH?: string | string[] });
if (w && !w.EXCALIDRAW_ASSET_PATH) w.EXCALIDRAW_ASSET_PATH = ASSET_PATH;

export {};
