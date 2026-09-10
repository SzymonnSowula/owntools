// First import in every window: the rename left user data under the old
// localStorage keys, and this has to run before anything reads them.
import "@core/storageMigration";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/outfit/latin-400.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-700.css";
import "@fontsource/outfit/latin-800.css";
import "@feature-focus/legacy.css";
import "./suite.css";
import App from "./App";
import { ErrorBoundary } from "@ui/ErrorBoundary";
import { installGlobalErrorHandlers, logError } from "@core/errors";

installGlobalErrorHandlers("main");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary scope="main" onError={(err) => logError("main", "render crash", err)}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
