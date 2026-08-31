import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./suite.css";
import { RecorderOverlay } from "@feature-recorder/RecorderOverlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div className="mod-create h-full">
      <RecorderOverlay />
    </div>
  </React.StrictMode>,
);
