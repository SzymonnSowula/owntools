/**
 * The bar's small control icons, drawn in the tool marks' line style (round
 * caps, one weight). The tools themselves use `ToolGlyph`, never these.
 */
import type { ReactNode } from "react";

function Line({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const MoreIcon = () => (
  <Line>
    <circle cx="4.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
  </Line>
);

export const PauseIcon = () => (
  <Line size={15}>
    <path d="M7 4.5v11M13 4.5v11" />
  </Line>
);

export const PlayIcon = () => (
  <Line size={15}>
    <path d="M6.5 4.6v10.8L15.4 10z" fill="currentColor" />
  </Line>
);

export const StopIcon = () => (
  <Line size={15}>
    <rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor" />
  </Line>
);

export const OpenIcon = () => (
  <Line size={15}>
    <path d="M8 4.5H5.5a1.5 1.5 0 0 0-1.5 1.5v8.5A1.5 1.5 0 0 0 5.5 16H14a1.5 1.5 0 0 0 1.5-1.5V12M11 4h5v5M16 4l-7 7" />
  </Line>
);

export const SettingsIcon = () => (
  <Line size={17}>
    <path d="M4 6h8M15.5 6H16M4 14h1M8.5 14H16" />
    <circle cx="13.5" cy="6" r="1.9" />
    <circle cx="6.5" cy="14" r="1.9" />
  </Line>
);

export const HideIcon = () => (
  <Line size={17}>
    <path d="M3.5 10s2.4-4.5 6.5-4.5c1.3 0 2.4.4 3.4 1M16.5 10s-2.4 4.5-6.5 4.5c-1.3 0-2.4-.4-3.4-1M4 16 16 4" />
  </Line>
);
