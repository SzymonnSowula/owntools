// First import in every window: the rename left user data under the old
// localStorage keys, and this has to run before anything reads them.
import "@core/storageMigration";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./suite.css";
import { RecorderOverlay } from "@feature-recorder/RecorderOverlay";
import { ErrorBoundary } from "@ui/ErrorBoundary";
import { installGlobalErrorHandlers, logError } from "@core/errors";
import { hideRecorderOverlay, showMainWindow } from "@core/recorderWindow";

installGlobalErrorHandlers("recorder");

/* The overlay hides the main window while it is up, so a crash here must
 * always offer a way back; otherwise the user is left with no window at all. */
function BackToApp() {
  return (
    <button
      type="button"
      onClick={() => void showMainWindow().then(() => hideRecorderOverlay())}
      style={{
        height: 34,
        padding: "0 14px",
        borderRadius: 999,
        border: "1px solid #e3e3e6",
        background: "#fff",
        color: "#1d1d1f",
        fontWeight: 600,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      Back to owntools
    </button>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      scope="recorder"
      actions={<BackToApp />}
      onError={(err) => logError("recorder", "render crash", err)}
    >
      <div className="mod-create h-full">
        <RecorderOverlay />
      </div>
    </ErrorBoundary>
  </React.StrictMode>,
);
