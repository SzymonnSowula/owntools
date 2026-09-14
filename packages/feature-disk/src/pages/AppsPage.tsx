import { useEffect, useMemo, useState } from "react";
import { AppWindow, ArrowDown, ArrowUp, Eye, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import { confirmDialog } from "@ui/Dialog";
import { backend } from "../api";
import type { AppInfo } from "../api/types";
import { formatBytes, formatCount } from "../lib/format";
import { useDiskStore } from "../store";
import { Empty, Spinner } from "../components/primitives";

type SortKey = "size" | "name" | "publisher" | "installed";

/** Installed applications with the space they take — measured when their folder is inside the scan. */
export function AppsPage() {
  const dataVersion = useDiskStore((s) => s.dataVersion);
  const summary = useDiskStore((s) => s.summary);
  const appsQuery = useDiskStore((s) => s.appsQuery);
  const { reveal, drill, setTab, notify } = useDiskStore.getState();
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "size", dir: -1 });

  // Sent here from the cleanup (a program it left alone): filter to it, once.
  useEffect(() => {
    if (!appsQuery) return;
    setQuery(appsQuery);
    useDiskStore.setState({ appsQuery: "" });
  }, [appsQuery]);

  const load = (refresh = false) => {
    setApps(null);
    backend()
      .apps(refresh)
      .then(setApps)
      .catch((err) => {
        setApps([]);
        notify(`Could not list apps: ${err instanceof Error ? err.message : String(err)}`, "error");
      });
  };
  useEffect(() => load(false), [dataVersion]);

  const sizeOf = (a: AppInfo) => a.scannedBytes ?? a.estimatedBytes;
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (apps ?? []).filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.publisher.toLowerCase().includes(q) || (a.location ?? "").toLowerCase().includes(q),
    );
    const cmp = (a: AppInfo, b: AppInfo) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name);
        case "publisher":
          return a.publisher.localeCompare(b.publisher);
        case "installed":
          return (a.installed ?? "").localeCompare(b.installed ?? "");
        default:
          return sizeOf(a) - sizeOf(b);
      }
    };
    return filtered.sort((a, b) => cmp(a, b) * sort.dir || a.name.localeCompare(b.name));
  }, [apps, query, sort]);
  const total = (apps ?? []).reduce((a, x) => a + sizeOf(x), 0);
  const measured = (apps ?? []).filter((a) => a.scannedBytes !== null).length;

  const head = (key: SortKey, label: string, className?: string) => (
    <th className={className}>
      <button className={`dk-th${sort.key === key ? " active" : ""}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === "size" ? -1 : 1 }))}>
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
      </button>
    </th>
  );

  const uninstall = async (app: AppInfo) => {
    const ok = await confirmDialog({
      kind: "warning",
      title: `Uninstall ${app.name}?`,
      message: "This starts its own uninstaller, the same one Windows Settings runs. Most uninstallers ask before they remove anything; a few start right away.",
      okLabel: "Start uninstaller",
    });
    if (!ok) return;
    try {
      await backend().appUninstall(app.id);
      notify(`Uninstaller for ${app.name} started`);
    } catch (err) {
      notify(`Could not start the uninstaller: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  return (
    <div className="dk-page">
      <header className="dk-page-head">
        <div>
          <h1>
            <AppWindow size={18} /> Applications
          </h1>
          <p>
            {apps ? `${formatCount(apps.length)} installed · about ${formatBytes(total)}` : "Reading the list…"}
            {apps && summary ? ` · ${measured} measured from the scan, the rest estimated by their installers` : apps ? " · sizes are installer estimates until you scan the drive" : ""}
          </p>
        </div>
        <div className="dk-page-controls">
          <label className="dk-search">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or folder…" />
          </label>
          <button className="dk-btn" onClick={() => load(true)} title="Read the list again">
            <RefreshCw size={13} /> Refresh
          </button>
          <button className="dk-btn" onClick={() => void backend().openAppsSettings()} title="Windows Settings › Apps">
            <Settings2 size={13} /> Apps & features
          </button>
        </div>
      </header>
      {!apps ? (
        <Spinner label="Reading installed apps…" />
      ) : !list.length ? (
        <Empty title={query ? "No app matches" : "No apps found"} hint={query ? "Try another word." : "The registry has no uninstall entries to show."} />
      ) : (
        <div className="dk-table-wrap">
          <table className="dk-table dk-apps">
            <thead>
              <tr>
                {head("name", "Application")}
                {head("publisher", "Publisher")}
                {head("size", "Size", "num")}
                {head("installed", "Installed")}
                <th>Location</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="name">
                    <span className="dk-name">
                      <span className="dk-app-avatar" aria-hidden>
                        {a.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="dk-name-text" title={a.name}>
                        {a.name}
                        {a.version ? <span className="muted"> {a.version}</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="muted">{a.publisher || "—"}</td>
                  <td className="num">
                    <span className="dk-size-text">{sizeOf(a) ? formatBytes(sizeOf(a)) : "—"}</span>
                    <span className={`dk-size-pct${a.scannedBytes !== null ? " measured" : ""}`}>{a.scannedBytes !== null ? "measured" : sizeOf(a) ? "estimate" : ""}</span>
                  </td>
                  <td className="muted">{a.installed ?? "—"}</td>
                  <td className="muted path" title={a.location ?? ""}>
                    {a.location ?? "—"}
                  </td>
                  <td className="actions">
                    {a.nodeId !== null ? (
                      <button className="dk-icon-btn" title="Show in the tree" onClick={() => {
                        drill(a.nodeId!);
                        setTab("explore");
                      }}>
                        <AppWindow size={13} />
                      </button>
                    ) : null}
                    {a.location ? (
                      <button className="dk-icon-btn" title="Reveal folder" onClick={() => reveal(a.location!)}>
                        <Eye size={13} />
                      </button>
                    ) : null}
                    {a.uninstall ? (
                      <button className="dk-icon-btn danger" title="Uninstall…" onClick={() => void uninstall(a)}>
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
