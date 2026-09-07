import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ReactNode } from "react";

/** Page header: kicker, lowercase display title, one-line subtitle, actions. */
export function PageHead({
  kicker = "dictate",
  title,
  sub,
  actions,
}: {
  kicker?: string;
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="dt-head">
      <div>
        <p className="dt-kicker">{kicker}</p>
        <h1 className="dt-title">{title}</h1>
        {sub ? <p className="dt-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="dt-head-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  desc,
  action,
  flush,
  children,
}: {
  title?: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  /** No body padding — for row lists. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="dt-card">
      {title ? (
        <div className="dt-card-head">
          <div>
            <div className="dt-card-title">{title}</div>
            {desc ? <div className="dt-card-desc">{desc}</div> : null}
          </div>
          {action ? <div className="dt-row-ctl">{action}</div> : null}
        </div>
      ) : null}
      <div className={`dt-card-body${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}

/** A settings row: label + hint on the left, the control on the right. */
export function Row({
  label,
  hint,
  stack,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Control goes under the label, full width (textareas). */
  stack?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`dt-row${stack ? " stack" : ""}`}>
      <div>
        <div className="dt-row-label">{label}</div>
        {hint ? <div className="dt-row-hint">{hint}</div> : null}
      </div>
      {children ? <div className={stack ? undefined : "dt-row-ctl"}>{children}</div> : null}
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      className="dt-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
    >
      <SwitchPrimitive.Thumb className="dt-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="dt-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "active" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="dt-kbd">{children}</kbd>;
}

export function Progress({ percent }: { percent: number | null }) {
  return (
    <div className={`dt-progress${percent === null ? " indeterminate" : ""}`} aria-hidden>
      <span style={{ width: percent === null ? undefined : `${percent}%` }} />
    </div>
  );
}

export function Alert({
  kind,
  icon,
  children,
}: {
  kind: "warn" | "error" | "info";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`dt-alert ${kind}`} role={kind === "error" ? "alert" : undefined}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

/** Copies text; resolves false when the clipboard is unavailable. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
