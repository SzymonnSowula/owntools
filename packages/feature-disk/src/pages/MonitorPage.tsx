import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, HardDrive, Usb } from "lucide-react";
import { backend } from "../api";
import type { MonitorData, NodeInfo } from "../api/types";
import { readTheme } from "../lib/colors";
import { baseName, formatBytes, formatCount } from "../lib/format";
import { useSize, useTopFiles } from "../hooks";
import { useDiskStore } from "../store";
import { ContextMenu, type MenuState } from "../components/ContextMenu";
import { NodeTable } from "../components/NodeTable";
import { Section, Spinner } from "../components/primitives";

/**
 * Monitor: free space over time (sampled every 20 s by the backend for as
 * long as the app runs), what changed lately and the biggest files.
 */
export function MonitorPage() {
  const summary = useDiskStore((s) => s.summary);
  const currentId = useDiskStore((s) => s.currentId);
  const selectedId = useDiskStore((s) => s.selectedId);
  const { select, drill } = useDiskStore.getState();
  const [data, setData] = useState<MonitorData | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [range, setRange] = useState<"1h" | "6h" | "24h">("6h");
  const [pickedVol, setPickedVol] = useState<number>(0);
  // Fixed at mount: a per-render clock would change the query key every second.
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const recent = useTopFiles(summary ? 0 : null, { modifiedAfter: now - 7 * 86400, limit: 60 });
  const largest = useTopFiles(summary ? 0 : null, { limit: 60 });

  useEffect(() => {
    const api = backend();
    let alive = true;
    const read = () => api.monitorRead().then((d) => alive && setData(d)).catch(() => undefined);
    void api.monitorStart().then(read);
    const t = setInterval(read, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const volumes = data?.volumes ?? [];
  const vol = volumes[Math.min(pickedVol, Math.max(0, volumes.length - 1))] ?? null;
  const span = range === "1h" ? 3600 : range === "6h" ? 6 * 3600 : 24 * 3600;
  const series = useMemo(() => {
    if (!data || !vol) return [] as { t: number; free: number }[];
    const idx = volumes.indexOf(vol);
    const cutoff = now - span;
    return data.samples.filter((s) => s.t >= cutoff).map((s) => ({ t: s.t, free: s.free[idx] ?? 0 }));
  }, [data, vol, volumes, span, now]);
  const first = series[0]?.free ?? 0;
  const last = series[series.length - 1]?.free ?? 0;
  const delta = last - first;

  return (
    <div className="dk-page">
      <header className="dk-page-head">
        <div>
          <h1>
            <Activity size={18} /> Monitor
          </h1>
          <p>Free space, sampled every {data?.intervalS ?? 20} seconds while shipshape runs.</p>
        </div>
        <div className="dk-page-controls">
          <div className="dk-seg small" role="tablist">
            {(["1h", "6h", "24h"] as const).map((r) => (
              <button key={r} role="tab" aria-selected={range === r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </header>
      {!data ? (
        <Spinner label="Reading volumes…" />
      ) : (
        <>
          <div className="dk-volumes compact">
            {volumes.map((v, i) => {
              const used = v.total - v.free;
              const pct = v.total ? used / v.total : 0;
              return (
                <button key={v.path} className={`dk-volume${i === pickedVol ? " active" : ""}`} onClick={() => setPickedVol(i)}>
                  <span className="dk-volume-icon">{v.kind === "removable" ? <Usb size={16} /> : <HardDrive size={16} />}</span>
                  <span className="dk-volume-text">
                    <span className="dk-volume-name">
                      {v.label} <span className="muted">({baseName(v.path)})</span>
                    </span>
                    <span className="dk-volume-meta">
                      {formatBytes(v.free)} free of {formatBytes(v.total)}
                    </span>
                    <span className="dk-volume-track">
                      <span className="dk-volume-fill" style={{ width: `${pct * 100}%`, background: pct > 0.92 ? "#ff453a" : pct > 0.8 ? "#f0a56c" : "var(--color-accent)" }} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {vol ? (
            <Section
              title={`Free space on ${vol.label} (${baseName(vol.path)})`}
              aside={
                series.length > 1 ? (
                  <span className={delta < 0 ? "dk-neg" : "dk-pos"}>
                    {delta >= 0 ? "+" : "−"}
                    {formatBytes(Math.abs(delta))} in the last {range}
                  </span>
                ) : (
                  "collecting…"
                )
              }
            >
              <FreeChart series={series} total={vol.total} span={span} now={now} />
            </Section>
          ) : null}
        </>
      )}
      {summary ? (
        <div className="dk-two-col">
          <Section title="Changed in the last 7 days" aside={`${formatCount(recent.items.length)} largest`}>
            <NodeTable items={recent.items} selectedId={selectedId} onSelect={select} onDrill={(id) => {
              drill(id);
              useDiskStore.getState().setTab("explore");
            }} onMenu={setMenu} showPath showType={false} defaultSort="mtime" emptyText={recent.loading ? "Looking…" : "Nothing changed lately"} pageSize={30} />
          </Section>
          <Section title="Largest files" aside={summary.name}>
            <NodeTable items={largest.items} selectedId={selectedId} onSelect={select} onDrill={(id) => {
              drill(id);
              useDiskStore.getState().setTab("explore");
            }} onMenu={setMenu} showPath showType={false} emptyText={largest.loading ? "Looking…" : "No files"} pageSize={30} />
          </Section>
        </div>
      ) : (
        <div className="dk-side-note">Scan a drive to see what changed recently and the largest files.</div>
      )}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      <span hidden>{currentId}</span>
    </div>
  );
}

function FreeChart({ series, total, span, now }: { series: { t: number; free: number }[]; total: number; span: number; now: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || size.w < 10) return;
    const dpr = window.devicePixelRatio || 1;
    const h = 160;
    c.width = size.w * dpr;
    c.height = h * dpr;
    c.style.width = `${size.w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const theme = readTheme(ref.current);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, h);
    const pad = { l: 56, r: 12, t: 12, b: 22 };
    const w = size.w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const values = series.map((s) => s.free);
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : total;
    const room = Math.max(hi - lo, total * 0.01, 1);
    const y0 = Math.max(0, lo - room * 0.25);
    const y1 = hi + room * 0.25;
    const x = (t: number) => pad.l + ((t - (now - span)) / span) * w;
    const y = (v: number) => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;
    ctx.strokeStyle = theme.line;
    ctx.fillStyle = theme.muted;
    ctx.font = "500 10px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 3; i++) {
      const v = y0 + ((y1 - y0) * i) / 3;
      const yy = y(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(pad.l + w, yy);
      ctx.stroke();
      ctx.fillText(formatBytes(v), pad.l - 6, yy + 3);
    }
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const t = now - span + (span * i) / 4;
      ctx.fillText(new Date(t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), x(t), h - 6);
    }
    if (series.length < 2) {
      ctx.fillText("waiting for samples…", pad.l + w / 2, pad.t + ih / 2);
      return;
    }
    ctx.beginPath();
    series.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s.free)) : ctx.moveTo(x(s.t), y(s.free))));
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(x(series[series.length - 1].t), pad.t + ih);
    ctx.lineTo(x(series[0].t), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = `${theme.accent}22`;
    ctx.fill();
  }, [series, total, span, now, size.w, ref]);
  return (
    <div ref={ref} className="dk-chart">
      <canvas ref={canvas} />
    </div>
  );
}

export type { NodeInfo };
