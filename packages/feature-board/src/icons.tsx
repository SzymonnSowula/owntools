import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const IconGrid = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1.2" />
    <rect x="9" y="2" width="5" height="5" rx="1.2" />
    <rect x="2" y="9" width="5" height="5" rx="1.2" />
    <rect x="9" y="9" width="5" height="5" rx="1.2" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const IconPencil = (p: P) => (
  <svg {...base} {...p}>
    <path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </svg>
);

export const IconFolder = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12V4.5z" />
  </svg>
);

export const IconCopy = (p: P) => (
  <svg {...base} {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4A1.5 1.5 0 009 2.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
  </svg>
);

export const IconFile = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 2.5h5l3 3v8H4v-11z" />
    <path d="M9 2.5v3h3" />
  </svg>
);

export const IconShare = (p: P) => (
  <svg {...base} {...p}>
    <path d="M13 9v3.5a1 1 0 01-1 1H4a1 1 0 01-1-1V9M8 10.5v-8M5 5.5L8 2.5l3 3" />
  </svg>
);

export const IconImport = (p: P) => (
  <svg {...base} {...p}>
    <path d="M13 9v3.5a1 1 0 01-1 1H4a1 1 0 01-1-1V9M8 2.5v8M5 7.5l3 3 3-3" />
  </svg>
);

export const IconImage = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1.2" />
    <path d="M13.5 10.5L10 7.5l-4.5 4.5" />
  </svg>
);

export const IconSketch = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="2.5" width="6" height="4.5" rx="1" />
    <circle cx="11.5" cy="11" r="2.5" />
    <path d="M5 7v3a1.5 1.5 0 001.5 1.5H9" />
  </svg>
);
