import type { ReactNode } from "react";

/** 16px line icons for the editor toolbar. One weight, one grid, no library. */
function Glyph({ children, filled }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const PlayGlyph = () => (
  <Glyph filled>
    <path d="M5 3.3v9.4L12.6 8z" />
  </Glyph>
);

export const PauseGlyph = () => (
  <Glyph>
    <path d="M5.6 3.4v9.2M10.4 3.4v9.2" />
  </Glyph>
);

/** Razor: the split tool. */
export const SplitGlyph = () => (
  <Glyph>
    <path d="M8 1.8v8.4" />
    <circle cx="4.7" cy="12" r="2" />
    <circle cx="11.3" cy="12" r="2" />
    <path d="M8 10.2 6.2 12M8 10.2 9.8 12" />
  </Glyph>
);

/** Auto-cut: a waveform with a gap taken out. */
export const AutoCutGlyph = () => (
  <Glyph>
    <path d="M2 6.4v3.2M4.3 4.2v7.6M6.6 6.8v2.4" />
    <path d="M9.4 6.8v2.4M11.7 4.2v7.6M14 6.4v3.2" />
    <path d="M8 2.6v10.8" strokeDasharray="1.6 1.6" />
  </Glyph>
);

/** Sound effects: a speaker with two waves coming off it. */
export const SoundGlyph = () => (
  <Glyph>
    <path d="M3.4 6.2h1.9L8 3.8v8.4L5.3 9.8H3.4z" />
    <path d="M10.6 6.1a2.7 2.7 0 0 1 0 3.8" />
    <path d="M12.5 4.2a5.4 5.4 0 0 1 0 7.6" />
  </Glyph>
);

/** The same speaker with the waves struck through: effects are off. */
export const SoundOffGlyph = () => (
  <Glyph>
    <path d="M3.4 6.2h1.9L8 3.8v8.4L5.3 9.8H3.4z" />
    <path d="m10.6 6.4 3.4 3.2M14 6.4l-3.4 3.2" />
  </Glyph>
);

export const ZoomInGlyph = () => (
  <Glyph>
    <circle cx="7" cy="7" r="4.4" />
    <path d="m10.4 10.4 3.2 3.2M7 5.1v3.8M5.1 7h3.8" />
  </Glyph>
);

export const ZoomOutGlyph = () => (
  <Glyph>
    <circle cx="7" cy="7" r="4.4" />
    <path d="m10.4 10.4 3.2 3.2M5.1 7h3.8" />
  </Glyph>
);

export const CaptionGlyph = () => (
  <Glyph>
    <rect x="1.8" y="3.4" width="12.4" height="9.2" rx="2" />
    <path d="M4.6 8.2h2.6M4.6 10.4h4.6M9.6 8.2h1.8M11.4 10.4h0" />
  </Glyph>
);

export const TextGlyph = () => (
  <Glyph>
    <path d="M3 4.2h10M8 4.2v8.2M5.9 12.4h4.2" />
  </Glyph>
);

export const ImageGlyph = () => (
  <Glyph>
    <rect x="1.8" y="3" width="12.4" height="10" rx="2" />
    <circle cx="5.7" cy="6.6" r="1.1" />
    <path d="m2.4 11.4 3.4-3 2.7 2.6 2.3-2.2 3.2 3" />
  </Glyph>
);

export const TrashGlyph = () => (
  <Glyph>
    <path d="M2.8 4.4h10.4M6.4 2.6h3.2M4.4 4.4l.6 8h6l.6-8M6.7 6.8v3.6M9.3 6.8v3.6" />
  </Glyph>
);

export const UndoGlyph = () => (
  <Glyph>
    <path d="M3 5.6h6.2a3.6 3.6 0 0 1 0 7.2H5.4" />
    <path d="M5.4 3.2 3 5.6l2.4 2.4" />
  </Glyph>
);

export const RedoGlyph = () => (
  <Glyph>
    <path d="M13 5.6H6.8a3.6 3.6 0 0 0 0 7.2h3.8" />
    <path d="M10.6 3.2 13 5.6l-2.4 2.4" />
  </Glyph>
);

export const ImportGlyph = () => (
  <Glyph>
    <path d="M8 2.4v7.2M5.4 7l2.6 2.6L10.6 7" />
    <path d="M2.8 11.2v1.2a1.2 1.2 0 0 0 1.2 1.2h8a1.2 1.2 0 0 0 1.2-1.2v-1.2" />
  </Glyph>
);

export const SparkleGlyph = () => (
  <Glyph>
    <path d="M6 2.2 7 5l2.8 1-2.8 1-1 2.8-1-2.8L2.2 6 5 5z" />
    <path d="M11.6 8.4l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
  </Glyph>
);

export const CommandGlyph = () => (
  <Glyph>
    <path d="M6 6h4v4H6z" />
    <path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6zM10 6h1.5A1.5 1.5 0 1 0 10 4.5V6zM10 10v1.5a1.5 1.5 0 1 0 1.5-1.5H10zM6 10H4.5A1.5 1.5 0 1 0 6 11.5V10z" />
  </Glyph>
);

export const ExportGlyph = () => (
  <Glyph>
    <path d="M8 10.4V2.8M5.4 5.4 8 2.8l2.6 2.6" />
    <path d="M2.8 10.4v2a1.2 1.2 0 0 0 1.2 1.2h8a1.2 1.2 0 0 0 1.2-1.2v-2" />
  </Glyph>
);

export const HomeGlyph = () => (
  <Glyph>
    <path d="M2.6 7.2 8 2.6l5.4 4.6" />
    <path d="M4 8.4v4.2a.8.8 0 0 0 .8.8h6.4a.8.8 0 0 0 .8-.8V8.4" />
  </Glyph>
);

/** Lines of text with one struck through: the Script panel. */
export const ScriptGlyph = () => (
  <Glyph>
    <path d="M3 4h10M3 8h10M3 12h6" />
    <path d="M9.5 7.2 6.5 8.8" />
  </Glyph>
);
