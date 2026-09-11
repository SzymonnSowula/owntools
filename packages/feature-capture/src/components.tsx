import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Page header: kicker, lowercase display title, one-line subtitle, actions. */
export function PageHead({
  kicker = "capture",
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
    <header className="cp-head">
      <div>
        <p className="cp-kicker">{kicker}</p>
        <h1 className="cp-title">{title}</h1>
        {sub ? <p className="cp-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="cp-head-actions">{actions}</div> : null}
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
    <section className="cp-card">
      {title ? (
        <div className="cp-card-head">
          <div>
            <div className="cp-card-title">{title}</div>
            {desc ? <div className="cp-card-desc">{desc}</div> : null}
          </div>
          {action ? <div className="cp-row-ctl">{action}</div> : null}
        </div>
      ) : null}
      <div className={`cp-card-body${flush ? " flush" : ""}`}>{children}</div>
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
    <div className={`cp-row${stack ? " stack" : ""}`}>
      <div>
        <div className="cp-row-label">{label}</div>
        {hint ? <div className="cp-row-hint">{hint}</div> : null}
      </div>
      {children ? <div className={stack ? undefined : "cp-row-ctl"}>{children}</div> : null}
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
      className="cp-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
    >
      <SwitchPrimitive.Thumb className="cp-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="cp-kbd">{children}</kbd>;
}

export function Button({
  primary,
  danger,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  const cls = ["cp-btn", primary ? "primary" : "", danger ? "danger" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
