import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Thin wrappers over Radix so every layer carries the `sc-portal` scope (the
 * reset + tokens) and the same surfaces. Nothing clever in here on purpose.
 */

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  size = "default",
  headExtra,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "medium" | "wide";
  headExtra?: ReactNode;
  description?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <div className="sc-portal">
          <DialogPrimitive.Overlay className="sc-overlay" />
          <DialogPrimitive.Content
            className={`sc-dialog ${size === "default" ? "" : size}`}
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="sc-dialog-head">
              <DialogPrimitive.Title className="sc-dialog-title">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description> : null}
              <div className="ml-auto flex items-center gap-1">
                {headExtra}
                <DialogPrimitive.Close className="sc-icon-btn" aria-label="Close">
                  <X />
                </DialogPrimitive.Close>
              </div>
            </div>
            <div className="sc-dialog-body">{children}</div>
            {footer ? <div className="sc-dialog-foot">{footer}</div> : null}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = "start",
  side = "bottom",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <div className="sc-portal">
          <PopoverPrimitive.Content className={`sc-pop ${className ?? ""}`} align={align} side={side} sideOffset={6} collisionPadding={8}>
            {children}
          </PopoverPrimitive.Content>
        </div>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  /** Renders a separator before this item. */
  sepBefore?: boolean;
}

export function Menu({
  trigger,
  items,
  label,
  align = "end",
  side = "bottom",
}: {
  trigger: ReactNode;
  items: MenuItem[];
  label?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <div className="sc-portal">
          <DropdownMenu.Content className="sc-menu" align={align} side={side} sideOffset={6} collisionPadding={8}>
            {label ? <div className="sc-menu-label">{label}</div> : null}
            {items.map((item) => (
              <div key={item.key}>
                {item.sepBefore ? <div className="sc-menu-sep" /> : null}
                <DropdownMenu.Item
                  className={`sc-menu-item${item.danger ? " danger" : ""}`}
                  disabled={item.disabled}
                  onSelect={() => item.onSelect?.()}
                >
                  {item.icon}
                  {item.label}
                  {item.checked ? <Check className="check" /> : null}
                </DropdownMenu.Item>
              </div>
            ))}
          </DropdownMenu.Content>
        </div>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Switch({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: string }) {
  return (
    <SwitchPrimitive.Root className="sc-switch" checked={checked} onCheckedChange={onCheckedChange} aria-label={label}>
      <SwitchPrimitive.Thumb className="sc-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export function Tip({ label, children, side = "right" }: { label: string; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <div className="sc-portal">
          <TooltipPrimitive.Content className="sc-tooltip" side={side} sideOffset={6}>
            {label}
          </TooltipPrimitive.Content>
        </div>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="sc-empty">
      <div className="sc-empty-icon">{icon}</div>
      <div className="sc-empty-title">{title}</div>
      {children ? <p>{children}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={`sc-spinner ${className ?? ""}`} aria-hidden />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="sc-kbd">{children}</kbd>;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="sc-label">{label}</span>
      {children}
      {hint ? <span className="sc-hint block">{hint}</span> : null}
    </label>
  );
}

/** Copies text to the clipboard; resolves false when the platform refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
