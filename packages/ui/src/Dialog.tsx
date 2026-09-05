import { useEffect, useRef, useState } from "react";

/**
 * The suite's stand-in for `window.confirm` / `window.alert`. Those render as
 * the browser's own "tauri.localhost says…" boxes, which is not the app's
 * face. `confirmDialog` resolves true on the primary button; with no host
 * mounted (a window without one, a test) it falls back to the browser's box
 * so nothing ever silently answers itself.
 */
export interface DialogOptions {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "info" | "warning" | "danger";
}

interface Pending extends DialogOptions {
  alert: boolean;
  resolve: (ok: boolean) => void;
}

let host: ((pending: Pending) => void) | null = null;

function ask(options: DialogOptions | string, alert: boolean): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  if (!host) {
    if (typeof window === "undefined") return Promise.resolve(true);
    return Promise.resolve(alert ? (window.alert(opts.message), true) : window.confirm(opts.message));
  }
  return new Promise((resolve) => host!({ ...opts, alert, resolve }));
}

export function confirmDialog(options: DialogOptions | string): Promise<boolean> {
  return ask(options, false);
}

export async function alertDialog(options: DialogOptions | string): Promise<void> {
  await ask(options, true);
}

const KIND_TITLE: Record<NonNullable<DialogOptions["kind"]>, string> = {
  info: "Just checking",
  warning: "Are you sure?",
  danger: "Are you sure?",
};

/** Mount once per window, near the root. Queues dialogs so two askers never overlap. */
export function DialogHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const queue = useRef<Pending[]>([]);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    host = (pending) => {
      queue.current.push(pending);
      setCurrent((open) => open ?? queue.current.shift() ?? null);
    };
    return () => {
      host = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        settle(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function settle(ok: boolean) {
    const open = current;
    if (!open) return;
    open.resolve(ok);
    setCurrent(queue.current.shift() ?? null);
  }

  if (!current) return null;
  const kind = current.kind ?? "info";
  const title = current.title ?? KIND_TITLE[kind];
  const primary =
    kind === "danger"
      ? "bg-[#ff453a] text-white hover:bg-[#e63b31]"
      : "bg-accent text-white hover:bg-[#0071e3]";
  const button =
    "cursor-pointer appearance-none rounded-[12px] px-4 py-2 text-sm font-semibold [font-family:inherit] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

  return (
    <div
      className="fixed inset-0 z-[300] grid place-items-center bg-[#17151f]/35 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div
        role={current.alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="suite-dialog-title"
        className="w-full max-w-sm rounded-[18px] border border-line bg-card p-6 text-ink shadow-[0_30px_80px_rgba(23,21,31,0.22)]"
      >
        <h2 id="suite-dialog-title" className="text-base font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{current.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          {current.alert ? null : (
            <button
              type="button"
              className={`${button} border border-line bg-transparent text-ink hover:bg-paper`}
              onClick={() => settle(false)}
            >
              {current.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button ref={okRef} type="button" className={`${button} border-0 ${primary}`} onClick={() => settle(true)}>
            {current.okLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
