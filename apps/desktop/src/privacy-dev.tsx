// Dev-only harness for Settings → Privacy: `pnpm dev` then /privacy-dev.html.
// The card is not mounted in SettingsView.tsx yet (integrator's file), and
// the browser has no network to bsky.social anyway, so two hosts are served
// by a fake transport here and every request still goes through
// `trackedFetch` — which is the thing under test.
import "@core/storageMigration";
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/outfit/latin-400.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-700.css";
import "@feature-focus/legacy.css";
import "./suite.css";
import { DialogHost } from "@ui/Dialog";
import { isOfflineMode, trackedFetch } from "@core/net";
import PrivacyCard, { PrivacyBadge } from "@feature-privacy/PrivacyCard";

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.example.com/")) {
    await new Promise((r) => setTimeout(r, 120));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-length": "1536", "content-type": "application/json" } });
  }
  if (url.startsWith("https://down.example.com/")) {
    throw new TypeError("Failed to fetch");
  }
  if (url.startsWith("http://127.0.0.1:7474/")) {
    return new Response("ok", { status: 200, headers: { "content-length": "2" } });
  }
  return realFetch(input, init);
};

function Harness() {
  const [log, setLog] = useState<string[]>([]);
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 8));
  const run = async (label: string, fn: () => Promise<Response>) => {
    try {
      const res = await fn();
      say(`${label}: ${res.status}`);
    } catch (err) {
      say(`${label}: ${isOfflineMode(err) ? "OfflineMode" : "error"} — ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const toggleTheme = () => {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
  };
  return (
    <div className="mod-focus" style={{ minHeight: "100vh" }}>
      <main className="main" style={{ minHeight: "100vh", padding: "28px 0" }}>
        <div className="page" style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px" }}>
          <div className="stack">
            <section className="card stack" data-testid="harness">
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn small" data-testid="cloud" onClick={() => void run("cloud", () => trackedFetch("https://api.example.com/v1/post", { method: "POST", body: JSON.stringify({ text: "hello from the harness" }), purpose: "post to Bluesky" }))}>
                  Cloud request
                </button>
                <button className="btn small" data-testid="local" onClick={() => void run("local", () => trackedFetch("http://127.0.0.1:7474/health", { purpose: "local agent server" }))}>
                  Loopback request
                </button>
                <button className="btn small" data-testid="failing" onClick={() => void run("failing", () => trackedFetch("https://down.example.com/x", { purpose: "share link upload" }))}>
                  Failing request
                </button>
                <button className="btn small ghost" data-testid="theme" onClick={toggleTheme}>
                  Toggle Night
                </button>
                <PrivacyBadge onClick={() => say("badge clicked")} />
              </div>
              <ul className="faint" style={{ fontSize: 12, margin: 0, paddingLeft: 18 }} data-testid="harness-log">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </section>
            <PrivacyCard />
          </div>
        </div>
      </main>
      <DialogHost />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
