import "./meet.css";
import { ToolMark } from "@ui/ToolMark";
import { Radio, SlidersHorizontal, Users, X } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { isTauri } from "@core/env";
import { LivePage } from "./pages/LivePage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useMeetStore } from "./store";

export type Page = "live" | "meetings" | "settings";

const NAV: { id: Page; label: string; icon: ReactElement }[] = [
  { id: "live", label: "Live", icon: <Radio /> },
  { id: "meetings", label: "Meetings", icon: <Users /> },
  { id: "settings", label: "Settings", icon: <SlidersHorizontal /> },
];

/** Survives leaving the tool and coming back within a session. */
let lastPage: Page = "live";

/**
 * meet — the eighth tool: record any call on this machine (mic + system
 * audio) with a live transcript that says who spoke, notes beside it, and a
 * summary with decisions and to-dos afterwards. A sidebar of three pages
 * over one store; the capture runs in Rust and keeps going while you look
 * at another page (or another tool).
 */
export default function MeetView() {
  const [page, setPage] = useState<Page>(lastPage);
  const phase = useMeetStore((s) => s.phase);
  const unavailable = useMeetStore((s) => s.unavailable);
  const meetings = useMeetStore((s) => s.meetings);
  const notice = useMeetStore((s) => s.notice);
  const init = useMeetStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  function go(next: Page) {
    lastPage = next;
    setPage(next);
  }

  const recording = phase === "recording" || phase === "paused" || phase === "stopping" || phase === "starting";
  const statusClass = phase === "recording" ? "live" : recording ? "busy" : unavailable ? "" : "ok";
  const statusText = phase === "recording"
    ? "recording"
    : phase === "paused"
      ? "paused"
      : recording
        ? "working…"
        : !isTauri()
          ? "browser preview"
          : unavailable
            ? "not available here"
            : "ready";

  return (
    <div className="mt">
      <aside className="mt-side">
        <div className="mt-side-brand">
          <span className="mt-side-icon" aria-hidden>
            <ToolMark tool="meet" size={32} />
          </span>
          <div>
            <div className="mt-side-name">meet</div>
            <div className={`mt-side-status ${statusClass}`}>
              <i aria-hidden />
              {statusText}
            </div>
          </div>
        </div>
        <nav className="mt-nav" aria-label="Meet">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`mt-nav-item${page === item.id ? " active" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => go(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "meetings" && meetings.length ? <span className="mt-nav-count">{meetings.length}</span> : null}
              {item.id === "live" && phase === "recording" ? <span className="mt-nav-rec" aria-label="recording" /> : null}
            </button>
          ))}
        </nav>
        <div className="mt-side-foot">
          <div>Mic and system audio, transcribed and summarised on this device. Nothing is uploaded.</div>
        </div>
      </aside>
      <main className="mt-main">
        {page === "live" ? <LivePage /> : page === "meetings" ? <MeetingsPage onLive={() => go("live")} /> : <SettingsPage />}
        {notice ? (
          <div className={`mt-notice ${notice.kind}`} role="status">
            <span>{notice.text}</span>
            <button type="button" className="mt-icon-btn" onClick={() => useMeetStore.setState({ notice: null })} aria-label="Dismiss">
              <X />
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
