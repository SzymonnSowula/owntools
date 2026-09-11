import type { ReactNode } from "react";

/** Small pieces the Script lists share, so the four of them read as one panel. */

export function ScriptEmpty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-6">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{body}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function ScriptNote({ children }: { children: ReactNode }) {
  return <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-muted">{children}</p>;
}

export function ReviewRow({
  checked,
  onToggle,
  time,
  reason,
  onHear,
  onGo,
  children,
}: {
  checked: boolean;
  onToggle: (on: boolean) => void;
  time: string;
  reason: string;
  onHear: () => void;
  onGo: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`mx-2 my-0.5 flex gap-2 rounded-[10px] px-2 py-1.5 ${checked ? "bg-paper" : "opacity-80 hover:opacity-100"}`}>
      <input type="checkbox" className="mt-1 shrink-0" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-[1.5]">{children}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          <button type="button" className="tabular-nums hover:text-ink hover:underline" title="Put the playhead here" onClick={onGo}>
            {time}
          </button>
          <span>{reason}</span>
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost !h-7 shrink-0 !px-2 !py-0 text-[11px] text-muted"
        title="Hear it, then decide"
        onClick={onHear}
      >
        ▶ hear
      </button>
    </div>
  );
}

export function ReviewFooter({
  summary,
  action,
  disabled,
  onAction,
}: {
  summary: string;
  action: string;
  disabled?: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
      <span className="min-w-0 truncate text-[11px] text-muted">{summary}</span>
      <button className="btn btn-primary !h-8 shrink-0 !px-3 !py-0 text-xs" disabled={disabled} onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

/** A tiny pill with a count, for the panel's tabs. */
export function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="ml-1 rounded-full bg-teal/12 px-1.5 text-[9px] font-semibold tabular-nums text-teal-2">{n}</span>;
}
