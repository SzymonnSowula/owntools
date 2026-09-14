import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ReactNode } from "react";

/*
 * The building blocks of every Settings page, drawn like dictate's own
 * settings (a card per topic, one row per setting: what it is on the left,
 * the control on the right) so the app-wide screen and a tool's screen read
 * as the same app. Classes are st-*, in settings.css.
 */

export function PageHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="st-head">
      <p className="st-kicker">settings</p>
      <h1 className="st-title">{title}</h1>
      {sub ? <p className="st-sub">{sub}</p> : null}
    </header>
  );
}

export function Card({
  id,
  title,
  desc,
  action,
  flush = true,
  children,
}: {
  /** `data-settings-section` - what links and search results scroll to. */
  id?: string;
  title?: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  /** Rows sit edge to edge (the default); false pads the body. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="st-card" data-settings-section={id}>
      {title ? (
        <div className="st-card-head">
          <div>
            <div className="st-card-title">{title}</div>
            {desc ? <div className="st-card-desc">{desc}</div> : null}
          </div>
          {action ? <div className="st-row-ctl">{action}</div> : null}
        </div>
      ) : null}
      <div className={`st-card-body${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}

/** One setting: label and hint on the left, the control on the right. */
export function Row({
  id,
  label,
  hint,
  stack,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  /** The control goes under the label at full width (search boxes, lists). */
  stack?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`st-row${stack ? " stack" : ""}`} data-settings-section={id}>
      <div className="st-row-text">
        <div className="st-row-label">{label}</div>
        {hint ? <div className="st-row-hint">{hint}</div> : null}
      </div>
      {children ? <div className={stack ? "st-row-under" : "st-row-ctl"}>{children}</div> : null}
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
  onCheckedChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      className="st-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
    >
      <SwitchPrimitive.Thumb className="st-switch-thumb" />
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
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="st-seg" role="radiogroup" aria-label={label}>
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

/** A number the store keeps, clamped on the way in so a stray keystroke cannot save 0. */
export function NumberInput({
  value,
  min,
  max,
  unit,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <span className="st-number">
      <input
        className="st-input"
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && e.target.value !== "") onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
      />
      <span className="st-number-unit">{unit}</span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="st-kbd">{children}</kbd>;
}

export function Button({
  children,
  onClick,
  kind = "default",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`st-btn ${kind}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** A short line that says what just happened (saved, copied, cancelled). */
export function Note({ children }: { children: ReactNode }) {
  return (
    <span className="st-note" role="status">
      {children}
    </span>
  );
}
