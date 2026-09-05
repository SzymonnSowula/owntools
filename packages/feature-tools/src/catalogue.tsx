import type { ReactElement, ReactNode } from "react";
import { ToolIcons } from "@ui/WinDots";
import type { QuickToolKey } from "./keys";

/** Cards are listed speech → documents → media, so the grid clusters by kind without headers. */
export type QuickToolGroup = "speech" | "documents" | "media";

export interface QuickTool {
  key: QuickToolKey;
  /** The mac-window title on the card, e.g. "youtube.tool". */
  window: string;
  name: string;
  desc: string;
  group: QuickToolGroup;
  /** 12×12 glyph for the tri-colour window dots. */
  dots: ReactElement;
  /** 16×16 icon in the card body. */
  icon: ReactElement;
  tilt: number;
}

/* Tiny 12×12 glyphs in the WinDots style. */
const glyph = (children: ReactNode): ReactElement => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    {children}
  </svg>
);

/* 16 px card icons drawn on a 20-unit grid. */
const icon = (children: ReactNode): ReactElement => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const QUICK_TOOLS: QuickTool[] = [
  // ---- speech & text ------------------------------------------------------
  {
    key: "transcribe",
    window: "transcribe.tool",
    name: "Transcribe a file",
    desc: "Audio or video → text & .srt",
    group: "speech",
    tilt: -0.5,
    dots: glyph(<path d="M2 3h8M2 6h8M2 9h5" />),
    icon: icon(<path d="M3.5 5h13M3.5 10h13M3.5 15h8" />),
  },
  {
    key: "translate",
    window: "translate.tool",
    name: "Translate to English",
    desc: "Any speech → English text",
    group: "speech",
    tilt: 0.5,
    dots: glyph(
      <>
        <circle cx="6" cy="6" r="4.6" />
        <path d="M1.4 6h9.2M6 1.4c-2.6 2.8-2.6 6.4 0 9.2 2.6-2.8 2.6-6.4 0-9.2z" />
      </>,
    ),
    icon: icon(
      <>
        <circle cx="10" cy="10" r="7.5" />
        <path d="M2.5 10h15M10 2.5c-4.2 4.5-4.2 10.5 0 15 4.2-4.5 4.2-10.5 0-15z" />
      </>,
    ),
  },
  {
    key: "youtube",
    window: "youtube.tool",
    name: "YouTube → transcript",
    desc: "Paste a link, get the captions as text & .srt",
    group: "speech",
    tilt: -0.4,
    dots: glyph(
      <>
        <rect x="1.2" y="2.6" width="9.6" height="6.8" rx="2" />
        <path d="M5 4.6v2.8L7.6 6z" fill="currentColor" stroke="none" />
      </>,
    ),
    icon: icon(
      <>
        <rect x="2" y="4.5" width="16" height="11" rx="3" />
        <path d="M8.5 7.8v4.4L12.5 10z" fill="currentColor" stroke="none" />
      </>,
    ),
  },
  {
    key: "subtitles",
    window: "subtitles.tool",
    name: "Convert subtitles",
    desc: ".srt ↔ .vtt ↔ text, shift the timing",
    group: "speech",
    tilt: 0.6,
    dots: glyph(
      <>
        <rect x="1.2" y="2.2" width="9.6" height="7.6" rx="1.6" />
        <path d="M3.2 7.4h3.2M7.6 7.4h1.2M3.2 5.2h5.6" />
      </>,
    ),
    icon: icon(
      <>
        <rect x="2" y="4" width="16" height="12" rx="2.5" />
        <path d="M5.5 12.5h5M12.5 12.5h2M5.5 9h9" />
      </>,
    ),
  },
  {
    key: "voicenote",
    window: "voicenote.tool",
    name: "Voice note",
    desc: "Speak, get a note in Focus",
    group: "speech",
    tilt: -0.6,
    dots: ToolIcons.dictate,
    icon: icon(
      <>
        <rect x="7.2" y="2.8" width="5.6" height="9" rx="2.8" />
        <path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5" />
      </>,
    ),
  },

  // ---- documents ----------------------------------------------------------
  {
    key: "pdf",
    window: "pdf.tool",
    name: "PDF → text / Word / images",
    desc: "Pages out as .txt, .md, .docx, PNG or JPG",
    group: "documents",
    tilt: 0.5,
    dots: glyph(
      <>
        <path d="M3 1.4h4l2.4 2.4v6.8H3z" />
        <path d="M7 1.4v2.4h2.4M4.6 6.4h2.8M4.6 8.2h2.8" />
      </>,
    ),
    icon: icon(
      <>
        <path d="M5 2.5h7l4 4v11H5z" />
        <path d="M12 2.5v4h4M7.5 10.5h5M7.5 13.5h5" />
      </>,
    ),
  },
  {
    key: "makepdf",
    window: "makepdf.tool",
    name: "Images → PDF",
    desc: "Photos, scans and PDFs into one file",
    group: "documents",
    tilt: -0.5,
    dots: glyph(
      <>
        <path d="M1.8 3.4h6v7h-6z" />
        <path d="M4.2 1.6h6v7" />
      </>,
    ),
    icon: icon(
      <>
        <path d="M3 6h9.5v11.5H3z" />
        <path d="M6.5 2.5h9.5v11.5" />
      </>,
    ),
  },
  {
    key: "images",
    window: "images.tool",
    name: "Convert images",
    desc: "PNG / JPG / WebP, resize & shrink",
    group: "documents",
    tilt: 0.4,
    dots: glyph(
      <>
        <rect x="1.2" y="2" width="9.6" height="8" rx="1.6" />
        <circle cx="4.2" cy="4.8" r="1" />
        <path d="M1.6 9l2.8-2.6 1.8 1.6 1.7-1.5 2.8 2.5" />
      </>,
    ),
    icon: icon(
      <>
        <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
        <circle cx="7" cy="8" r="1.6" />
        <path d="M3 15l4.5-4.2 2.8 2.6 2.7-2.4 4.5 4" />
      </>,
    ),
  },

  // ---- media --------------------------------------------------------------
  {
    key: "extract",
    window: "extract.tool",
    name: "Video → audio",
    desc: "Keep the track, leave the video",
    group: "media",
    tilt: -0.5,
    dots: glyph(
      <>
        <path d="M4.6 9.4V2.8l5-1v6.6" />
        <circle cx="3.2" cy="9.4" r="1.4" />
        <circle cx="8.2" cy="8.4" r="1.4" />
      </>,
    ),
    icon: icon(
      <>
        <path d="M7.5 15.5V4.8l8.5-1.6v10.6" />
        <circle cx="5.3" cy="15.5" r="2.2" />
        <circle cx="13.8" cy="13.8" r="2.2" />
      </>,
    ),
  },
  {
    key: "audio",
    window: "audio.tool",
    name: "Convert audio",
    desc: "MP3, M4A, WAV, OGG or FLAC",
    group: "media",
    tilt: 0.5,
    dots: glyph(<path d="M1.8 5v2M4 3.4v5.2M6.2 1.8v8.4M8.4 3.4v5.2M10.6 5v2" />),
    icon: icon(<path d="M3 8.5v3M6.5 6v8M10 3.5v13M13.5 6v8M17 8.5v3" />),
  },
  {
    key: "video",
    window: "video.tool",
    name: "Convert video",
    desc: "MP4 / WebM / MOV, resize, trim",
    group: "media",
    tilt: -0.4,
    dots: glyph(
      <>
        <rect x="1.2" y="3.4" width="9.6" height="6.6" rx="1.2" />
        <path d="M1.2 5.6h9.6M3.6 3.4l1.6 2.2M6.6 3.4l1.6 2.2" />
      </>,
    ),
    icon: icon(
      <>
        <rect x="2.5" y="5.5" width="15" height="11" rx="2.2" />
        <path d="M2.5 9h15M6.5 5.5l2.5 3.5M11 5.5l2.5 3.5" />
      </>,
    ),
  },
  {
    key: "gif",
    window: "gif.tool",
    name: "Video → GIF",
    desc: "A looping clip for a README or a post",
    group: "media",
    tilt: 0.6,
    dots: glyph(
      <>
        <path d="M2.2 6.6a3.8 3.8 0 016.4-2.8M8.8 1.8v2.2H6.6" />
        <path d="M9.8 5.4a3.8 3.8 0 01-6.4 2.8M3.2 10.2V8h2.2" />
      </>,
    ),
    icon: icon(
      <>
        <path d="M4 11a6 6 0 0110.2-4.4M14.5 3.5v3.3h-3.3" />
        <path d="M16 9a6 6 0 01-10.2 4.4M5.5 16.5v-3.3h3.3" />
      </>,
    ),
  },
];
