// First import in every window: the rename left user data under the old
// localStorage keys, and this has to run before anything reads them.
import "@core/storageMigration";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./bar/bar.css";
import { BarWindow } from "./bar/BarWindow";
import { ErrorBoundary } from "@ui/ErrorBoundary";
import { installGlobalErrorHandlers, logError } from "@core/errors";

installGlobalErrorHandlers("dictation");

// The bar and the dictation pill share this window: the bar when it is on,
// the pill on its own when the bar is switched off (apps/desktop/src/bar).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary scope="dictation" onError={(err) => logError("dictation", "render crash", err)}>
      <BarWindow />
    </ErrorBoundary>
  </React.StrictMode>,
);
