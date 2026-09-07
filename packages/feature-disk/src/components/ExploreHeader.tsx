import { BarChart3, ChevronRight, Files, LayoutGrid, List, PieChart } from "lucide-react";
import type { NodeInfo } from "../api/types";
import { AGE_STOPS, CATEGORY_COLORS } from "../lib/colors";
import { CATEGORY_LABELS } from "../api/types";
import { formatBytes, formatCount, pathSegments } from "../lib/format";
import { useDiskStore, type ViewKind } from "../store";
import { useAncestors } from "../hooks";

const VIEWS: { id: ViewKind; label: string; icon: React.ReactElement; hint: string }[] = [
  { id: "treemap", label: "Treemap", icon: <LayoutGrid size={14} />, hint: "Every file as a rectangle, sized by bytes" },
  { id: "sunburst", label: "Sunburst", icon: <PieChart size={14} />, hint: "Rings around this folder, one per level" },
  { id: "bars", label: "Bars", icon: <BarChart3 size={14} />, hint: "What is big in this folder, side by side" },
  { id: "list", label: "List", icon: <List size={14} />, hint: "Sortable table of this folder" },
  { id: "files", label: "Files", icon: <Files size={14} />, hint: "The largest files anywhere under this folder" },
];

/** Breadcrumb + numbers + view / colour / depth controls above the centre view. */
export function ExploreHeader({ node }: { node: NodeInfo }) {
  const view = useDiskStore((s) => s.view);
  const colorMode = useDiskStore((s) => s.colorMode);
  const depth = useDiskStore((s) => s.depth);
  const summary = useDiskStore((s) => s.summary);
  const { setView, setColorMode, setDepth, drill } = useDiskStore.getState();
  const chain = useAncestors(node.id);
  const rootSegments = summary ? pathSegments(summary.root) : [];
  const visual = view === "treemap" || view === "sunburst";

  return (
    <header className="dk-explore-head">
      <div className="dk-crumbs" aria-label="Path">
        {chain.map((n, i) => {
          const last = i === chain.length - 1;
          const label = i === 0 ? rootSegments[rootSegments.length - 1] ?? n.name : n.name;
          return (
            <span key={n.id} className="dk-crumb-wrap">
              {i > 0 ? <ChevronRight size={12} className="dk-crumb-sep" /> : null}
              <button className={`dk-crumb${last ? " current" : ""}`} onClick={() => !last && drill(n.id)} disabled={last} title={n.path}>
                {label}
              </button>
            </span>
          );
        })}
      </div>
      <div className="dk-explore-title">
        <h1>{node.name}</h1>
        <span className="dk-explore-size">{formatBytes(node.size)}</span>
        <span className="dk-explore-meta">
          {formatCount(node.files)} files · {formatCount(node.dirs)} folders
          {summary?.errors ? <span title="Some folders could not be read"> · {formatCount(summary.errors)} unreadable</span> : null}
          {summary?.source === "snapshot" ? <span className="dk-chip"> snapshot</span> : null}
        </span>
      </div>
      <div className="dk-explore-tools">
        <div className="dk-seg" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)} title={v.hint}>
              {v.icon}
              <span>{v.label}</span>
            </button>
          ))}
        </div>
        <span className="dk-explore-hint">{VIEWS.find((v) => v.id === view)?.hint}</span>
        {visual || view === "bars" ? (
          <div className="dk-seg small" role="tablist" aria-label="Colour by">
            {(["type", "folder", "age"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={colorMode === m} className={colorMode === m ? "on" : ""} onClick={() => setColorMode(m)} disabled={view === "bars" && m === "age"}>
                By {m}
              </button>
            ))}
          </div>
        ) : null}
        {visual ? (
          <label className="dk-depth" title="How many levels deep to draw">
            <span>Depth</span>
            <input type="range" min={1} max={view === "sunburst" ? 8 : 12} value={Math.min(depth, view === "sunburst" ? 8 : 12)} onChange={(e) => setDepth(Number(e.target.value))} />
            <b>{Math.min(depth, view === "sunburst" ? 8 : 12)}</b>
          </label>
        ) : null}
      </div>
      {visual && colorMode !== "folder" ? (
        <div className="dk-legend" aria-label="Legend">
          {colorMode === "type"
            ? CATEGORY_LABELS.map((label, i) => (
                <span key={label}>
                  <i style={{ background: CATEGORY_COLORS[i] }} />
                  {label}
                </span>
              ))
            : AGE_STOPS.map((s) => (
                <span key={s.label}>
                  <i style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
        </div>
      ) : null}
    </header>
  );
}
