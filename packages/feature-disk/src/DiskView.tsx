import "./disk.css";
import { Activity, AppWindow, Camera, Compass, Layers, PanelRight, Search, X } from "lucide-react";
import { useEffect, type ReactElement } from "react";
import { isTauri } from "@core/env";
import { AppsPage } from "./pages/AppsPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { ExplorePage } from "./pages/ExplorePage";
import { MonitorPage } from "./pages/MonitorPage";
import { SnapshotsPage } from "./pages/SnapshotsPage";
import { useDiskStore, type Tab } from "./store";
import { formatBytes } from "./lib/format";

const TABS: { id: Tab; label: string; icon: ReactElement }[] = [
  { id: "explore", label: "Explore", icon: <Compass size={14} /> },
  { id: "dupes", label: "Duplicates", icon: <Layers size={14} /> },
  { id: "apps", label: "Applications", icon: <AppWindow size={14} /> },
  { id: "monitor", label: "Monitor", icon: <Activity size={14} /> },
  { id: "snapshots", label: "Snapshots", icon: <Camera size={14} /> },
];

/**
 * disk — the seventh tool: a disk-space analyzer. Top bar with the five
 * pages, the current scan as a crumb, a name filter and the inspector
 * toggle. The tree lives in Rust (or the demo backend in a browser); the
 * store below only knows what the user is looking at.
 */
export default function DiskView() {
  const tab = useDiskStore((s) => s.tab);
  const summary = useDiskStore((s) => s.summary);
  const filter = useDiskStore((s) => s.filter);
  const inspectorOpen = useDiskStore((s) => s.inspectorOpen);
  const { init, setTab, setFilter, toggleInspector } = useDiskStore.getState();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".dk-filter input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="dk">
      <header className="dk-top">
        <nav className="dk-tabs" aria-label="Disk pages">
          {TABS.map((t) => (
            <button key={t.id} className={`dk-tab${tab === t.id ? " active" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="dk-top-crumb">
          {summary ? (
            <>
              <span className="dk-top-root" title={summary.root}>
                {summary.name}
              </span>
              <span className="muted">{formatBytes(summary.size)}</span>
              {summary.source === "snapshot" ? <span className="dk-chip">snapshot</span> : null}
            </>
          ) : (
            <span className="muted">{isTauri() ? "no scan yet" : "browser preview · generated disk"}</span>
          )}
        </div>
        <label className={`dk-filter${filter ? " on" : ""}`}>
          <Search size={13} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name…" disabled={!summary} onKeyDown={(e) => e.key === "Escape" && setFilter("")} />
          {filter ? (
            <button className="dk-icon-btn" aria-label="Clear" onClick={() => setFilter("")}>
              <X size={12} />
            </button>
          ) : null}
        </label>
        <button className={`dk-icon-btn dk-top-toggle${inspectorOpen ? " on" : ""}`} title={inspectorOpen ? "Hide details" : "Show details"} aria-pressed={inspectorOpen} onClick={toggleInspector}>
          <PanelRight size={15} />
        </button>
      </header>
      <div className="dk-body">
        {tab === "explore" ? <ExplorePage /> : tab === "dupes" ? <DuplicatesPage /> : tab === "apps" ? <AppsPage /> : tab === "monitor" ? <MonitorPage /> : <SnapshotsPage />}
      </div>
    </div>
  );
}
