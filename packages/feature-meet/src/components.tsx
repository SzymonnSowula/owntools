import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ReactNode } from "react";

/** Page header: kicker, lowercase display title, one-line subtitle, actions. */
export function PageHead({
  kicker = "meet",
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
    <header className="mt-head">
      <div>
        <p className="mt-kicker">{kicker}</p>
        <h1 className="mt-title">{title}</h1>
        {sub ? <p className="mt-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="mt-head-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  desc,
  action,
  flush,
  className,
  children,
}: {
  title?: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  /** No body padding — for row lists. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`mt-card${className ? ` ${className}` : ""}`}>
      {title ? (
        <div className="mt-card-head">
          <div>
            <div className="mt-card-title">{title}</div>
            {desc ? <div className="mt-card-desc">{desc}</div> : null}
          </div>
          {action ? <div className="mt-row-ctl">{action}</div> : null}
        </div>
      ) : null}
      <div className={`mt-card-body${flush ? " flush" : ""}`}>{children}</div>
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
  stack?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`mt-row${stack ? " stack" : ""}`}>
      <div>
        <div className="mt-row-label">{label}</div>
        {hint ? <div className="mt-row-hint">{hint}</div> : null}
      </div>
      {children ? <div className={stack ? undefined : "mt-row-ctl"}>{children}</div> : null}
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
      className="mt-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
    >
      <SwitchPrimitive.Thumb className="mt-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "active" : undefined}
          onClick={() => onChange(o.value)}
          disabled={disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mt-kbd">{children}</kbd>;
}

/**
 * A level meter: `level` is RMS 0..1 from the capture. Speech sits around
 * 0.05–0.3, so the bar is drawn on a square-root scale to look alive at
 * normal volumes rather than twitching near zero.
 */
export function Meter({ level, muted, label }: { level: number; muted?: boolean; label: string }) {
  const pct = muted ? 0 : Math.min(100, Math.round(Math.sqrt(Math.max(0, level)) * 100));
  return (
    <div className={`mt-meter${muted ? " muted" : ""}`} role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-empty">
      <div className="mt-empty-icon">{icon}</div>
      <div className="mt-empty-title">{title}</div>
      {text ? <p className="mt-empty-text">{text}</p> : null}
      {children}
    </div>
  );
}
