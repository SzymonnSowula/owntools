import { useEffect, type ReactNode } from "react";
import { revealPath, type SaveOutcome } from "../lib/save";

export interface ToolModalProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  /** While true, Escape does nothing — a job is running. */
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
  footer: ReactNode;
  /** Always-visible strip above the buttons — where a file went, outside the scrolling body. */
  status?: ReactNode;
}

/**
 * The shell every quick tool shares: a card over the hub with a title, a
 * scrolling body and a button row. Escape closes it unless something is
 * running. Styled with the same tokens as the older transcribe / extract
 * modals so the family reads as one.
 */
export function ToolModal({ title, subtitle, onClose, busy, wide, children, footer, status }: ToolModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#17151f]/35 p-6">
      <div
        className={`flex max-h-[calc(100vh-48px)] w-full flex-col rounded-[18px] border border-line bg-card shadow-[0_30px_80px_rgba(23,21,31,0.18)] ${
          wide ? "max-w-xl" : "max-w-md"
        }`}
        role="dialog"
        aria-label={title}
      >
        <div className="px-6 pt-6">
          <h2 className="text-lg font-semibold tracking-[-0.03em]">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-4">
          <div className="flex flex-col gap-3">{children}</div>
        </div>
        <div className="px-6 pt-3 empty:hidden">{status}</div>
        <div className="flex flex-wrap gap-2 px-6 pb-6 pt-4">{footer}</div>
      </div>
    </div>
  );
}

/** A slim bar; `value` 0..1, or null for "busy, no idea how long". */
export function ToolProgress({ value, label }: { value: number | null; label?: string }) {
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
        {value === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
          />
        )}
      </div>
      {label ? <p className="mt-1.5 text-xs text-muted">{label}</p> : null}
    </div>
  );
}

export function ToolError({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-coral">{children}</p>;
}

export function ToolNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}

/** A labelled row: label on the left, control on the right. */
export function ToolRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2">{children}</span>
    </label>
  );
}

/** Where the file went, with a way to get there. */
export function SavedLine({ outcome }: { outcome: SaveOutcome | null }) {
  if (!outcome || outcome.kind === "cancelled") return null;
  if (outcome.kind === "downloaded") {
    return <p className="text-xs text-muted">Downloaded {outcome.name}.</p>;
  }
  return (
    <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span className="truncate" title={outcome.path}>
        Saved to {outcome.path}
      </span>
      <button type="button" className="btn btn-ghost shrink-0 px-2 py-0.5 text-xs" onClick={() => void revealPath(outcome.path)}>
        Show in folder
      </button>
    </p>
  );
}

/** Scrolling preview of generated text. */
export function TextPreview({ text }: { text: string }) {
  return (
    <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-line bg-paper px-3 py-2 text-sm leading-relaxed">
      {text}
    </div>
  );
}
