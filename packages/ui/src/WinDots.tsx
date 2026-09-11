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
  "focus" | "screeni" | "capture" | "launch" | "dictate" | "meet" | "video" | "record" | "board" | "social" | "disk",
  ReactElement
> = {
  /* aperture: ring closing on a point — the app mark at 11 px */
  focus: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="4.4" />
      <circle cx="6" cy="6" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* play-rectangle */
  screeni: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.2" y="2.4" width="9.6" height="7.2" rx="1.4" />
      <path d="M5 4.6l2.6 1.4L5 7.4V4.6z" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* viewfinder corners + shutter point (PROVISIONAL, see ToolMark) */
  capture: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.6 3.8V2.6a1 1 0 0 1 1-1h1.2M8.2 1.6h1.2a1 1 0 0 1 1 1v1.2M10.4 8.2v1.2a1 1 0 0 1-1 1H8.2M3.8 10.4H2.6a1 1 0 0 1-1-1V8.2" />
      <circle cx="6" cy="6" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* sail over its wake — not a rocket; the brand sails */
  launch: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.4 1.4l1.5 5.7-6.5-1.2z" fill="currentColor" stroke="none" />
      <path d="M2.2 8.2q2.3.7 4.7 1M3.7 10.4q2.1.6 4.2.8" />
    </svg>
  ),
  /* mic */
  dictate: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="4.4" y="1.2" width="3.2" height="5.4" rx="1.6" />
      <path d="M2.7 5.7a3.3 3.3 0 006.6 0M6 9v1.8" />
    </svg>
  ),
  /* two speech bubbles: theirs behind and dim, yours in front — the app mark at 11 px */
  meet: (
    <svg viewBox="0 0 12 12" fill="currentColor" stroke="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.6 1.6h4.2a1.4 1.4 0 0 1 1.4 1.4v1.6a1.4 1.4 0 0 1-1.4 1.4H8.4l1.4 1.6-2.6-1.6H5.6a1.4 1.4 0 0 1-1.4-1.4V3a1.4 1.4 0 0 1 1.4-1.4z" opacity="0.5" />
      <path d="M2.4 5.2h4.4a1.5 1.5 0 0 1 1.5 1.5v1.8a1.5 1.5 0 0 1-1.5 1.5H4.2L2.6 11.6V10A1.5 1.5 0 0 1 .9 8.5V6.7a1.5 1.5 0 0 1 1.5-1.5z" />
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
  /* one stroke across a dotted canvas */
  board: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" xmlns="http://www.w3.org/2000/svg">
      <g fill="currentColor" stroke="none" opacity="0.6">
        <circle cx="2.4" cy="2.4" r="0.8" />
        <circle cx="9.6" cy="2.4" r="0.8" />
        <circle cx="2.4" cy="9.6" r="0.8" />
        <circle cx="9.6" cy="9.6" r="0.8" />
      </g>
      <path d="M2.2 9.2q1.4-2.2 3.4-3 2-.8 4.2-3" />
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
  /* treemap: a box split into blocks */
  disk: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.4" y="1.4" width="9.2" height="9.2" rx="1.4" />
      <path d="M6.2 1.4v9.2M6.2 6.4h4.4M1.4 7.4h4.8" />
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
