import type { ReactElement } from "react";

/**
 * Mac-style "traffic lights", but each light is a tiny icon depicting what
 * the card represents, tinted red / yellow / green. Rendered at 11x11 via
 * the `.windots svg` rule in the app stylesheet, 6px apart — same rhythm
 * as the plain dots they replace.
 */

/** Default brand glyph: a little sailboat (sail + hull), single-color. */
const BRAND_GLYPH = (
  <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z"
      fill="currentColor"
    />
  </svg>
);

/**
 * Small icon library for the traffic-light glyphs. Consistent style:
 * viewBox 0 0 12 12, strokeWidth 1.3, fill none, stroke currentColor
 * (tiny filled details excepted).
 */
export const ToolIcons: Record<
  "focus" | "screeni" | "launch" | "dictate" | "video" | "record" | "board" | "social",
  ReactElement
> = {
  /* clock */
  focus: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="4.6" />
      <path d="M6 3.6v2.6l1.8 1.1" />
    </svg>
  ),
  /* play-rectangle */
  screeni: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.2" y="2.4" width="9.6" height="7.2" rx="1.4" />
      <path d="M5 4.6l2.6 1.4L5 7.4V4.6z" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* rocket */
  launch: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 8.7c2.7-1.2 3.6-3.9 3.6-6.3-2.4 0-5.1.9-6.3 3.6L1.8 7.5l2.7 2.7L6 8.7z" />
      <circle cx="7.2" cy="4.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* mic */
  dictate: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="4.4" y="1.2" width="3.2" height="5.4" rx="1.6" />
      <path d="M2.7 5.7a3.3 3.3 0 006.6 0M6 9v1.8" />
    </svg>
  ),
  /* filmstrip with play */
  video: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.3" y="2.3" width="9.4" height="7.4" rx="1.2" />
      <path d="M3.3 2.3v7.4M8.7 2.3v7.4" />
      <path d="M5.3 4.8l1.9 1.2-1.9 1.2V4.8z" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* box, arrow, circle: a sketch */
  board: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.4" y="1.6" width="4.8" height="3.6" rx="0.9" />
      <circle cx="8.6" cy="8.6" r="2" />
      <path d="M3.8 5.2v1.9a1.2 1.2 0 001.2 1.2h1.6" />
    </svg>
  ),
  /* calendar with a scheduled dot */
  social: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.4" y="2.4" width="9.2" height="8.2" rx="1.4" />
      <path d="M1.4 5h9.2M4 1.2v2.2M8 1.2v2.2" />
      <circle cx="7.6" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* record circle */
  record: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="4.6" />
      <circle cx="6" cy="6" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  ),
};

export function WinDots({ icon }: { icon?: ReactElement }) {
  const glyph = icon ?? BRAND_GLYPH;
  return (
    <span className="windots" aria-hidden="true">
      <span style={{ color: "#ff5f57" }}>{glyph}</span>
      <span style={{ color: "#febc2e" }}>{glyph}</span>
      <span style={{ color: "#28c840" }}>{glyph}</span>
    </span>
  );
}
