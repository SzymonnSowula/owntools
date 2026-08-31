import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import { DictationPill } from "@feature-dictation/DictationPill";

document.documentElement.style.background = "transparent";
document.body.style.background = "transparent";
document.body.style.margin = "0";
document.body.style.fontFamily = "Inter, system-ui, sans-serif";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DictationPill />
  </React.StrictMode>,
);
