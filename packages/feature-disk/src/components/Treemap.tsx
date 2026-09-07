import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../api/types";
import { colorFor, inkOn, mix, readTheme, type ColorMode, type Theme } from "../lib/colors";
import { formatBytes, formatCount, formatRelative } from "../lib/format";
import { hitTest, layoutTreemap, type TreemapItem } from "../lib/treemap";
import { useSize } from "../hooks";
import type { MenuState } from "./ContextMenu";
import { fetchNode } from "../hooks";

/**
 * The treemap: one canvas, the layout from `lib/treemap.ts`, a base render
 * cached in an offscreen canvas and a thin overlay for hover/selection so
 * mouse movement never re-paints thousands of rectangles.
 */
export interface TreemapProps {
  tree: TreeNode;
  depth: number;
  colorMode: ColorMode;
  selectedId: number | null;
  filter: string;
  onSelect(id: number | null): void;
  onDrill(id: number): void;
  onMenu(menu: MenuState): void;
}

const FONT = "500 11px Inter, system-ui, sans-serif";
const FONT_SMALL = "500 10px Inter, system-ui, sans-serif";

function branchIndices(tree: TreeNode): Map<number, number> {
  const m = new Map<number, number>();
  (tree.ch ?? []).forEach((c, i) => m.set(c.id, i));
  return m;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  if (max < 14) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 1 ? "" : `${text.slice(0, lo)}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function paintBase(
  ctx: CanvasRenderingContext2D,
  items: TreemapItem[],
  branches: Map<number, number>,
  theme: Theme,
  mode: ColorMode,
  now: number,
  filter: string,
) {
  const q = filter.trim().toLowerCase();
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  for (const item of items) {
    const { x, y, w, h } = item.rect;
    if (w < 0.6 || h < 0.6) continue;
    const node = item.node;
    const fill = colorFor(
      {
        mode,
        isDir: node?.k === 1,
        cat: node?.c ?? 0,
        mtime: node?.m ?? -1e15,
        depth: item.depth,
        branchIndex: branches.get(item.branch) ?? 0,
        isRest: !node,
      },
      theme,
      now,
    );
    const matches = q ? Boolean(node && node.n.toLowerCase().includes(q)) : true;
    const dim = q && !matches && !item.nested;
    ctx.fillStyle = dim ? mix(fill, theme.paper, 0.72) : fill;
    const radius = w > 6 && h > 6 ? 3 : 1;
    roundRect(ctx, x + 0.5, y + 0.5, Math.max(0.5, w - 1), Math.max(0.5, h - 1), radius);
    ctx.fill();
    if (w > 4 && h > 4) {
      ctx.strokeStyle = theme.dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (item.nested && item.header) {
      // Title strip.
      ctx.fillStyle = theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
      ctx.fillRect(x + 1, y + 1, w - 2, item.header);
      if (w >= 34) {
        ctx.font = FONT;
        ctx.fillStyle = dim ? mix(inkOn(fill), fill, 0.5) : inkOn(fill);
        const label = ellipsize(ctx, node?.n ?? "", w - 10);
        if (label) ctx.fillText(label, x + 6, y + 1 + item.header / 2);
      }
      continue;
    }
    // Leaf label (files, folders without room for nesting, the rest block).
    if (w >= 30 && h >= 14) {
      const ink = dim ? mix(inkOn(fill), fill, 0.5) : inkOn(fill);
      ctx.fillStyle = ink;
      ctx.font = h >= 24 ? FONT : FONT_SMALL;
      const name = node ? node.n : `${formatCount(item.rest?.n ?? 0)} more`;
      const label = ellipsize(ctx, name, w - 8);
      if (label) {
        if (h >= 30 && w >= 44) {
          ctx.fillText(label, x + 4, y + 10);
          ctx.font = FONT_SMALL;
          ctx.fillStyle = mix(ink, fill, 0.35);
          const size = ellipsize(ctx, formatBytes(item.bytes), w - 8);
          if (size) ctx.fillText(size, x + 4, y + 22);
        } else {
          ctx.fillText(label, x + 4, y + h / 2);
        }
      }
    }
  }
}

export function Treemap({ tree, depth, colorMode, selectedId, filter, onSelect, onDrill, onMenu }: TreemapProps) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<TreemapItem | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const themeRef = useRef<Theme>(readTheme(null));

  const items = useMemo(() => {
    if (size.w < 4 || size.h < 4) return [] as TreemapItem[];
    return layoutTreemap(tree, { x: 0, y: 0, w: size.w, h: size.h }, { maxDepth: depth });
  }, [tree, size.w, size.h, depth]);
  const branches = useMemo(() => branchIndices(tree), [tree]);

  // Overlay: base + hover + selection. Kept in a ref so the base paint can
  // call the latest version without re-running on every hover.
  const paintOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = themeRef.current;
    const outline = (item: TreemapItem, color: string, width: number) => {
      const { x, y, w, h } = item.rect;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      roundRect(ctx, x + width / 2, y + width / 2, Math.max(1, w - width), Math.max(1, h - width), 3);
      ctx.stroke();
    };
    if (selectedId !== null) {
      const sel = items.find((i) => i.id === selectedId);
      if (sel) outline(sel, theme.accent, 2);
    }
    if (hover && hover.id !== selectedId) outline(hover, theme.dark ? "rgba(255,255,255,0.85)" : "rgba(29,29,31,0.75)", 1.5);
  }, [items, hover, selectedId]);
  const overlayRef = useRef(paintOverlay);
  overlayRef.current = paintOverlay;

  // Base layer: only when data, size, colours or the filter change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 4 || size.h < 4) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const theme = readTheme(wrapRef.current);
    themeRef.current = theme;
    const base = baseRef.current ?? document.createElement("canvas");
    baseRef.current = base;
    base.width = Math.round(size.w * dpr);
    base.height = Math.round(size.h * dpr);
    const ctx = base.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    paintBase(ctx, items, branches, theme, colorMode, Date.now() / 1000, filter);
    canvas.width = base.width;
    canvas.height = base.height;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    setHover(null);
    // Resetting the canvas size wiped it: put the picture back right away.
    overlayRef.current();
  }, [items, branches, colorMode, size.w, size.h, filter, wrapRef]);

  useEffect(() => {
    paintOverlay();
  }, [paintOverlay]);

  const locate = useCallback(
    (e: React.MouseEvent): TreemapItem | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      return hitTest(items, e.clientX - r.left, e.clientY - r.top);
    },
    [items],
  );

  const onMove = (e: React.MouseEvent) => {
    const item = locate(e);
    setHover((h) => (h === item ? h : item));
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (wrap) setPointer({ x: e.clientX - wrap.left, y: e.clientY - wrap.top });
  };

  const onClick = (e: React.MouseEvent) => {
    const item = locate(e);
    if (!item || item.id < 0) {
      onSelect(null);
      return;
    }
    onSelect(item.id);
  };

  const onDouble = (e: React.MouseEvent) => {
    const item = locate(e);
    if (item && item.id >= 0 && item.node?.k === 1) onDrill(item.id);
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const item = locate(e);
    if (!item || item.id < 0) return;
    onSelect(item.id);
    void fetchNode(item.id).then((node) => {
      if (node) onMenu({ node, x: e.clientX, y: e.clientY });
    });
  };

  const tip = hover && pointer ? { item: hover, x: pointer.x, y: pointer.y } : null;
  const flipX = tip && size.w - tip.x < 240;
  const flipY = tip && size.h - tip.y < 96;

  return (
    <div ref={wrapRef} className="dk-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="dk-canvas"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
        onDoubleClick={onDouble}
        onContextMenu={onContext}
      />
      {tip ? (
        <div
          className="dk-tip"
          style={{
            left: flipX ? undefined : tip.x + 14,
            right: flipX ? size.w - tip.x + 14 : undefined,
            top: flipY ? undefined : tip.y + 14,
            bottom: flipY ? size.h - tip.y + 14 : undefined,
          }}
        >
          {tip.item.node ? (
            <>
              <div className="dk-tip-name">{tip.item.node.n}</div>
              <div className="dk-tip-row">
                <b>{formatBytes(tip.item.node.s)}</b>
                <span>{((tip.item.node.s / Math.max(1, tree.s)) * 100).toFixed(1)}% of {tree.n}</span>
              </div>
              {tip.item.node.k === 1 ? (
                <div className="dk-tip-row muted">
                  {formatCount(tip.item.node.f)} files · {formatCount(tip.item.node.d)} folders
                </div>
              ) : (
                <div className="dk-tip-row muted">modified {formatRelative(tip.item.node.m)}</div>
              )}
              {tip.item.node.e ? <div className="dk-tip-row warn">some of it could not be read</div> : null}
            </>
          ) : (
            <>
              <div className="dk-tip-name">{formatCount(tip.item.rest?.n ?? 0)} smaller items</div>
              <div className="dk-tip-row">
                <b>{formatBytes(tip.item.bytes)}</b>
                <span>too small to draw here</span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
