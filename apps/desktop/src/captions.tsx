// First import in every window: the rename left user data under the old
// localStorage keys, and this has to run before anything reads them.
import "@core/storageMigration";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import { CaptionsOverlay } from "@feature-dictation/captions/CaptionsOverlay";
import { ErrorBoundary } from "@ui/ErrorBoundary";
import { OverlayReady } from "@ui/OverlayReady";
import { installGlobalErrorHandlers, logError } from "@core/errors";

installGlobalErrorHandlers("captions");

document.documentElement.style.background = "transparent";
document.body.style.background = "transparent";
document.body.style.margin = "0";
document.body.style.fontFamily = "Inter, system-ui, sans-serif";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary scope="captions" onError={(err) => logError("captions", "render crash", err)}>
      <CaptionsOverlay />
    </ErrorBoundary>
    <OverlayReady />
  </React.StrictMode>,
);
