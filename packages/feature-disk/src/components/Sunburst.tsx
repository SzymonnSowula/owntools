import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../api/types";
import { colorFor, mix, readTheme, type ColorMode, type Theme } from "../lib/colors";
import { formatBytes, formatCount } from "../lib/format";
import { layoutSunburst, type SunburstArc } from "../lib/sunburst";
import { fetchNode, useSize } from "../hooks";
import type { MenuState } from "./ContextMenu";

export interface SunburstProps {
  tree: TreeNode;
  depth: number;
  colorMode: ColorMode;
  selectedId: number | null;
  filter: string;
  onSelect(id: number | null): void;
  onDrill(id: number): void;
  onMenu(menu: MenuState): void;
}

const INNER = 0.22;

/** Rings around the current folder; hover shows the slice, the centre shows the total. */
export function Sunburst({ tree, depth, colorMode, selectedId, filter, onSelect, onDrill, onMenu }: SunburstProps) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<SunburstArc | null>(null);
  const themeRef = useRef<Theme>(readTheme(null));
  const rings = Math.min(depth, 8);
  const arcs = useMemo(() => layoutSunburst(tree, rings), [tree, rings]);
  const branches = useMemo(() => {
    const m = new Map<number, number>();
    (tree.ch ?? []).forEach((c, i) => m.set(c.id, i));
    return m;
  }, [tree]);

  const geometry = useMemo(() => {
    const r = Math.max(10, Math.min(size.w, size.h) / 2 - 12);
    const cx = size.w / 2;
    const cy = size.h / 2;
    const inner = r * INNER;
    const ring = (r - inner) / Math.max(1, rings);
    return { r, cx, cy, inner, ring };
  }, [size.w, size.h, rings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 10 || size.h < 10) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const theme = readTheme(wrapRef.current);
    themeRef.current = theme;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const { cx, cy, inner, ring } = geometry;
    const q = filter.trim().toLowerCase();
    const now = Date.now() / 1000;
    for (const arc of arcs) {
      const r0 = inner + arc.depth * ring + 1;
      const r1 = inner + (arc.depth + 1) * ring - 1;
      const a0 = arc.a0 - Math.PI / 2;
      const a1 = arc.a1 - Math.PI / 2;
      const node = arc.node;
      let fill = colorFor(
        { mode: colorMode, isDir: node?.k === 1, cat: node?.c ?? 0, mtime: node?.m ?? -1e15, depth: arc.depth, branchIndex: branches.get(arc.branch) ?? 0, isRest: !node },
        theme,
        now,
      );
      if (q && !(node && node.n.toLowerCase().includes(q))) fill = mix(fill, theme.paper, 0.72);
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = theme.paper;
      ctx.lineWidth = 1;
      ctx.stroke();
      const isSel = selectedId !== null && arc.id === selectedId;
      const isHover = hover === arc;
      if (isSel || isHover) {
        ctx.strokeStyle = isSel ? theme.accent : theme.ink;
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.stroke();
      }
      // Labels on big arcs.
      const span = arc.a1 - arc.a0;
      const rm = (r0 + r1) / 2;
      if (node && span * rm > 44 && ring > 16) {
        const mid = (a0 + a1) / 2;
        ctx.save();
        ctx.translate(cx + Math.cos(mid) * rm, cy + Math.sin(mid) * rm);
        let rot = mid;
        if (rot > Math.PI / 2 || rot < -Math.PI / 2) rot += Math.PI;
        ctx.rotate(rot);
        ctx.font = "500 10px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = theme.ink;
        const max = span * rm - 8;
        let label = node.n;
        while (label.length > 2 && ctx.measureText(label).width > max) label = `${label.slice(0, -2)}…`;
        if (ctx.measureText(label).width <= max) ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
    // Centre: the current folder.
    ctx.fillStyle = theme.card;
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 2, 0, Math.PI * 2);
    ctx.fill();
    const focus = hover?.node ?? null;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = theme.ink;
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    const title = focus ? focus.n : tree.n;
    let t = title;
    while (t.length > 3 && ctx.measureText(t).width > inner * 1.7) t = `${t.slice(0, -2)}…`;
    ctx.fillText(t, cx, cy - 8);
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = theme.muted;
    ctx.fillText(formatBytes(focus ? focus.s : tree.s), cx, cy + 10);
  }, [arcs, branches, colorMode, filter, geometry, hover, selectedId, size.w, size.h, tree, wrapRef]);

  const locate = useCallback(
    (e: React.MouseEvent): SunburstArc | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left - geometry.cx;
      const y = e.clientY - r.top - geometry.cy;
      const dist = Math.hypot(x, y);
      if (dist < geometry.inner || dist > geometry.r) return null;
      const ring = Math.floor((dist - geometry.inner) / geometry.ring);
      let angle = Math.atan2(y, x) + Math.PI / 2;
      if (angle < 0) angle += Math.PI * 2;
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i];
        if (a.depth === ring && angle >= a.a0 && angle < a.a1) return a;
      }
      return null;
    },
    [arcs, geometry],
  );

  return (
    <div ref={wrapRef} className="dk-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="dk-canvas"
        onMouseMove={(e) => {
          const a = locate(e);
          setHover((h) => (h === a ? h : a));
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const a = locate(e);
          onSelect(a && a.id >= 0 ? a.id : null);
        }}
        onDoubleClick={(e) => {
          const a = locate(e);
          if (a && a.id >= 0 && a.node?.k === 1) onDrill(a.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const a = locate(e);
          if (!a || a.id < 0) return;
          onSelect(a.id);
          void fetchNode(a.id).then((node) => node && onMenu({ node, x: e.clientX, y: e.clientY }));
        }}
      />
      {hover ? (
        <div className="dk-sun-legend">
          {hover.node ? (
            <>
              <b>{hover.node.n}</b> · {formatBytes(hover.node.s)}
              {hover.node.k === 1 ? ` · ${formatCount(hover.node.f)} files` : ""}
            </>
          ) : (
            <>
              <b>{formatCount(hover.rest?.n ?? 0)} smaller items</b> · {formatBytes(hover.bytes)}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
