import { Clock, Copy, Eye, Folder, HardDrive, Home, Loader2, TriangleAlert } from "lucide-react";
import { CATEGORY_LABELS, CATS } from "../api/types";
import { CATEGORY_COLORS } from "../lib/colors";
import { baseName, formatBytes, formatCount, formatPercent } from "../lib/format";
import { useNode } from "../hooks";
import { useDiskStore } from "../store";
import { Section } from "./primitives";

/** Total / used / free ring for one volume. */
export function StorageDonut({ total, free, size = 96 }: { total: number; free: number; size?: number }) {
  const used = Math.max(0, total - free);
  const pct = total > 0 ? used / total : 0;
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const tone = pct > 0.92 ? "#ff453a" : pct > 0.8 ? "#f0a56c" : "var(--color-accent)";
  return (
    <svg className="dk-donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${Math.round(pct * 100)}% used`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="8" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dy="-1" textAnchor="middle" className="dk-donut-pct">
        {Math.round(pct * 100)}%
      </text>
      <text x="50%" y="50%" dy="13" textAnchor="middle" className="dk-donut-sub">
        used
      </text>
    </svg>
  );
}

const QUICK_ICONS: Record<string, string> = {
  downloads: "⬇",
  caches: "♻",
  packages: "📦",
  node_modules: "⬡",
  build: "⚙",
  media: "🎬",
  installers: "⤓",
  vm: "💽",
  leftovers: "🧹",
  emulators: "📱",
};

export function Sidebar() {
  const volumes = useDiskStore((s) => s.volumes);
  const recent = useDiskStore((s) => s.recent);
  const summary = useDiskStore((s) => s.summary);
  const scanning = useDiskStore((s) => s.scanning);
  const currentId = useDiskStore((s) => s.currentId);
  const quickWins = useDiskStore((s) => s.quickWins);
  const breakdown = useDiskStore((s) => s.breakdown);
  const center = useDiskStore((s) => s.center);
  const { scan, scanHome, scanFolder, setCenter, reveal, copyPath } = useDiskStore.getState();
  const current = useNode(summary ? currentId : null);

  const system = volumes.find((v) => v.system) ?? volumes[0] ?? null;
  const shown = summary?.volume ?? system;
  const systemLabel = system ? baseName(system.path) : "disk";
  const totalTypes = breakdown ? breakdown.bytes.reduce((a, b) => a + b, 0) : 0;
  const cats = breakdown
    ? Array.from({ length: CATS }, (_, i) => ({ cat: i, bytes: breakdown.bytes[i] ?? 0, count: breakdown.count[i] ?? 0 })).filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes)
    : [];

  return (
    <aside className="dk-side">
      <div className="dk-scan-buttons">
        <button className="dk-btn primary big" onClick={() => system && scan(system.path)} disabled={!system || scanning}>
          {scanning ? <Loader2 size={15} className="dk-spin" /> : <HardDrive size={15} />}
          {scanning ? "Scanning…" : `Scan ${systemLabel}`}
        </button>
        <div className="dk-scan-row">
          <button className="dk-btn" onClick={() => void scanHome()} disabled={scanning}>
            <Home size={13} /> Home
          </button>
          <button className="dk-btn" onClick={() => void scanFolder()} disabled={scanning}>
            <Folder size={13} /> Folder…
          </button>
        </div>
      </div>

      {recent.length ? (
        <Section title="Recent">
          <ul className="dk-side-list">
            {recent.slice(0, 5).map((r) => (
              <li key={r.path}>
                <button className="dk-side-item" onClick={() => scan(r.path)} title={`Scan ${r.path} again`} disabled={scanning}>
                  <Clock size={12} />
                  <span className="dk-side-item-label">{r.label}</span>
                  <span className="muted">{formatBytes(r.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {shown ? (
        <Section title="Disk storage" aside={shown.label}>
          <div className="dk-storage">
            <StorageDonut total={shown.total} free={shown.free} />
            <dl className="dk-storage-rows">
              <dt>Total</dt>
              <dd>{formatBytes(shown.total)}</dd>
              <dt>Used</dt>
              <dd>{formatBytes(shown.total - shown.free)}</dd>
              <dt>Free</dt>
              <dd>{formatBytes(shown.free)}</dd>
            </dl>
          </div>
        </Section>
      ) : null}

      {summary && current ? (
        <Section title="Current view" aside={summary.elapsedMs ? `${(summary.elapsedMs / 1000).toFixed(1)}s scan` : undefined}>
          <div className="dk-current">
            <div className="dk-current-name">{current.name}</div>
            <div className="dk-current-path" title={current.path}>
              {current.path}
            </div>
            <div className="dk-current-actions">
              <button className="dk-btn" onClick={() => reveal(current.path)}>
                <Eye size={12} /> Reveal
              </button>
              <button className="dk-btn" onClick={() => copyPath(current.path)}>
                <Copy size={12} /> Copy path
              </button>
            </div>
          </div>
        </Section>
      ) : null}

      {summary ? (
        <Section title="Quick wins" aside={quickWins ? formatBytes(quickWins.reduce((a, w) => a + w.bytes, 0)) : "…"}>
          {quickWins && quickWins.length ? (
            <ul className="dk-side-list">
              {quickWins.map((w) => {
                const active = center.kind === "quickwin" && center.id === w.id;
                return (
                  <li key={w.id}>
                    <button className={`dk-win${active ? " active" : ""}`} onClick={() => setCenter(active ? { kind: "tree" } : { kind: "quickwin", id: w.id })} title={w.hint}>
                      <span className="dk-win-icon" aria-hidden>
                        {QUICK_ICONS[w.id] ?? "•"}
                      </span>
                      <span className="dk-win-text">
                        <span className="dk-win-label">
                          {w.label}
                          {w.caution ? <TriangleAlert size={11} className="dk-win-caution" /> : null}
                        </span>
                        <span className="dk-win-count">{formatCount(w.count)} item{w.count === 1 ? "" : "s"}</span>
                      </span>
                      <span className="dk-win-size">{formatBytes(w.bytes)}</span>
                      <span className="dk-win-chevron">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="dk-side-note">{quickWins ? "Nothing obvious to clean." : "Looking for easy wins…"}</div>
          )}
        </Section>
      ) : null}

      {summary && breakdown && totalTypes > 0 ? (
        <Section title="File types">
          <div className="dk-types-bar" aria-hidden>
            {cats.map((c) => (
              <span key={c.cat} style={{ width: `${(c.bytes / totalTypes) * 100}%`, background: CATEGORY_COLORS[c.cat] }} />
            ))}
          </div>
          <ul className="dk-side-list">
            {cats.map((c) => {
              const active = center.kind === "category" && center.cat === c.cat;
              return (
                <li key={c.cat}>
                  <button className={`dk-type-row${active ? " active" : ""}`} onClick={() => setCenter(active ? { kind: "tree" } : { kind: "category", cat: c.cat })}>
                    <i className="dk-dot" style={{ background: CATEGORY_COLORS[c.cat] }} />
                    <span className="dk-side-item-label">{CATEGORY_LABELS[c.cat]}</span>
                    <span className="muted">{formatPercent(c.bytes, totalTypes, 0)}</span>
                    <span className="dk-type-size">{formatBytes(c.bytes)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </aside>
  );
}
