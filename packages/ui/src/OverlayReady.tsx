import { useEffect } from "react";
import { isTauri } from "@core/env";

/**
 * Rendered last in an on-demand window's root (recorder, captions, capture):
 * tells Rust the page is mounted and listening, which is what `overlay_ensure`
 * waits for before the window is shown or sent anything — an event sent to a
 * page that is still loading is simply lost (`src-tauri/src/overlays.rs`).
 * Kept outside the ErrorBoundary so a page that fails to render still says so,
 * and shows its fallback instead of keeping the caller waiting.
 */
export function OverlayReady() {
  useEffect(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("overlay_ready"))
      .catch(() => undefined);
  }, []);
  return null;
}
