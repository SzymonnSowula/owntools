/**
 * Small line icons in the app's style (round caps, one weight) for the
 * recorder bar, the bar's menu and the mocks. Not the tool marks — those
 * come from @ui/ToolMark.
 */
import type { ReactNode } from "react";

function Line({ children, size = 16, stroke = 1.7, viewBox = "0 0 20 20" }: { children: ReactNode; size?: number; stroke?: number; viewBox?: string }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const PauseIcon = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <path d="M7 4.5v11M13 4.5v11" />
  </Line>
);

export const RestartIcon = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M4.2 3.6v3.2h3.2" />
  </Line>
);

export const TrashIcon = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.5 9v4M11.5 9v4" />
  </Line>
);

export const DotsIcon = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <circle cx="4.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
  </Line>
);

export const StopIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
    <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="currentColor" />
  </svg>
);

export const CheckIcon = ({ size = 16, stroke = 2.2 }: { size?: number; stroke?: number }) => (
  <Line size={size} stroke={stroke}>
    <path d="M4.5 10.5l3.6 3.5L15.5 6" />
  </Line>
);

export const SendIcon = ({ size = 14 }: { size?: number }) => (
  <Line size={size}>
    <path d="M17 3 9.5 10.5M17 3l-5 14-2.5-6.5L3 8z" />
  </Line>
);

export const PaperclipIcon = ({ size = 14 }: { size?: number }) => (
  <Line size={size}>
    <path d="M14.5 8.5 9 14a3 3 0 0 1-4.2-4.2l6.4-6.4a2 2 0 0 1 2.8 2.8L7.6 12.6a1 1 0 0 1-1.4-1.4L11.4 6" />
  </Line>
);

export const MailGlyph = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.3" y="2.6" width="9.4" height="6.8" rx="1.3" />
    <path d="M1.8 3.4 6 6.6l4.2-3.2" />
  </svg>
);

export const DocGlyph = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 1.6h4l2.4 2.4v6.4H3z" />
    <path d="M4.4 6h3.2M4.4 8h3.2" />
  </svg>
);

export const ExportIcon = ({ size = 14 }: { size?: number }) => (
  <Line size={size}>
    <path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 15.5h12" />
  </Line>
);

export const PlayIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
    <path d="M3.4 2.2v7.6L9.6 6z" fill="currentColor" />
  </svg>
);

export const ClipboardIcon = ({ size = 14 }: { size?: number }) => (
  <Line size={size}>
    <path d="M7 4.5H5.5A1.5 1.5 0 0 0 4 6v9.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H13" />
    <rect x="7" y="3" width="6" height="3" rx="1" />
  </Line>
);

export const ChevronIcon = ({ size = 12 }: { size?: number }) => (
  <Line size={size}>
    <path d="M7 4.5 12.5 10 7 15.5" />
  </Line>
);
