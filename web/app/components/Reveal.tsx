import type { CSSProperties, ReactNode } from "react";

/**
 * A block that rises into place as it scrolls into view. Pure CSS (.reveal in
 * globals.css, a scroll-driven animation), so it is visible from the first
 * paint and costs no script: it used to be a client component with its own
 * IntersectionObserver plus scroll and resize listeners, about forty of them,
 * each reading layout on every scroll event.
 *
 * `delay` is kept for the callers' sake: neighbours in a row still stagger,
 * by a few pixels of scroll instead of by time.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`reveal ${className ?? ""}`}
      style={delay ? ({ "--reveal-shift": `${Math.round(delay * 400)}px` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
