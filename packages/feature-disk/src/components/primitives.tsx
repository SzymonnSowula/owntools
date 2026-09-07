import { Folder, FileText, Link2, type LucideIcon } from "lucide-react";
import { CATEGORY_LABELS, type NodeInfo } from "../api/types";
import { CATEGORY_COLORS } from "../lib/colors";
import { formatBytes } from "../lib/format";
import type { ReactNode } from "react";

/** Small shared pieces: kind icon, category dot, size bar, section header. */

export function KindIcon({ node, size = 14 }: { node: Pick<NodeInfo, "kind" | "cat">; size?: number }) {
  const Icon: LucideIcon = node.kind === "dir" ? Folder : node.kind === "link" ? Link2 : FileText;
  const color = node.kind === "dir" ? "var(--color-accent)" : CATEGORY_COLORS[node.cat] ?? CATEGORY_COLORS[0];
  return <Icon size={size} style={{ color }} aria-hidden />;
}

export function CategoryDot({ cat }: { cat: number }) {
  return <i className="dk-dot" style={{ background: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS[0] }} aria-hidden />;
}

export function categoryLabel(cat: number): string {
  return CATEGORY_LABELS[cat] ?? CATEGORY_LABELS[0];
}

export function SizeBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="dk-bar" aria-hidden>
      <span className="dk-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`dk-section${className ? ` ${className}` : ""}`}>
      <header className="dk-section-head">
        <span className="dk-section-title">{title}</span>
        {aside ? <span className="dk-section-aside">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function Bytes({ value, muted }: { value: number; muted?: boolean }) {
  return <span className={`dk-bytes${muted ? " muted" : ""}`}>{formatBytes(value)}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="dk-empty">
      <div className="dk-empty-title">{title}</div>
      {hint ? <div className="dk-empty-hint">{hint}</div> : null}
      {action ? <div className="dk-empty-action">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="dk-spinner-wrap">
      <span className="dk-spinner" aria-hidden />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
