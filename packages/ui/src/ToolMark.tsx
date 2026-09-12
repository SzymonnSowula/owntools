import type { ReactElement } from "react";

/**
 * App marks for the nine tools — the rounded tiles next to a tool's name on
 * the hub and in its own sidebar, and (through `ToolGlyph`) the same drawings
 * as plain line icons in the rail.
 *
 * ## The look (2026-09-11)
 * A flat, solid tile in the tool's own colour with a white line glyph on it —
 * the language of a modern launcher: one weight of stroke (2.1 on a 32 grid,
 * round caps and joins), one idea per glyph, nothing behind or on top of the
 * tile. The earlier gradient + sheen + lip + tinted shadow tiles read as
 * stickers next to the rest of the UI; the user asked for them to go.
 *
 * ## The frame
 * `viewBox 0 0 32 32` with `rx 7.2` is `BrandMark`'s filled badge, so a tool
 * tile and the app icon stay one object. Colours are **hard-coded on
 * purpose** (the one exception to "recolor via tokens"): an app mark is the
 * same object in Day and Night, like a real app icon.
 *
 * ## The glyphs
 *   focus    a ring closing on a point
 *   screeni  a display on its stand
 *   capture  a scan frame — four corners around what you are about to grab
 *   launch   a paper plane: send it out
 *   dictate  a microphone
 *   meet     one speech bubble
 *   board    the dotted canvas with one freehand stroke, pared down
 *   disk     a drive with its activity light
 *   social   a calendar with the one post that is scheduled
 *
 * Verify a new glyph on a blown-up contact sheet of the live tiles, never by
 * eye in the source (see the "Tool marks" ground rule in CLAUDE.md).
 */

export type ToolMarkName =
  | "focus"
  | "screeni"
  | "capture"
  | "launch"
  | "dictate"
  | "meet"
  | "board"
  | "social"
  | "disk";

interface Mark {
  /** The tile's solid colour. */
  fill: string;
  /** The glyph, drawn for `stroke="currentColor"` on a 32 × 32 grid. */
  glyph: ReactElement;
}

const STROKE = 2.1;

const MARKS: Record<ToolMarkName, Mark> = {
  focus: {
    fill: "#5b5fe0",
    glyph: (
      <g>
        <circle cx="16" cy="16" r="7.6" />
        <circle cx="16" cy="16" r="2.4" fill="currentColor" stroke="none" />
      </g>
    ),
  },
  screeni: {
    fill: "#2d323b",
    glyph: (
      <g>
        <rect x="7" y="8.2" width="18" height="12.2" rx="2.6" />
        <path d="M16 20.4v3.6M11.6 24.6h8.8" />
      </g>
    ),
  },
  capture: {
    fill: "#7d58f2",
    glyph: (
      <g>
        <path d="M7 12V9.6A2.6 2.6 0 0 1 9.6 7H12M20 7h2.4A2.6 2.6 0 0 1 25 9.6V12M25 20v2.4a2.6 2.6 0 0 1-2.6 2.6H20M12 25H9.6A2.6 2.6 0 0 1 7 22.4V20" />
        <rect x="11.6" y="11.6" width="8.8" height="8.8" rx="1.8" />
      </g>
    ),
  },
  launch: {
    fill: "#2fa47c",
    glyph: (
      <g>
        <path d="M25.4 6.6L15.2 16.8" />
        <path d="M25.4 6.6l-6.6 18.8-3.6-8.6-8.6-3.6z" strokeLinejoin="round" />
      </g>
    ),
  },
  dictate: {
    fill: "#6659f0",
    glyph: (
      <g>
        <rect x="13" y="6.4" width="6" height="11.2" rx="3" />
        <path d="M9.8 15a6.2 6.2 0 0 0 12.4 0M16 21.2v3.4M12.4 24.6h7.2" />
      </g>
    ),
  },
  meet: {
    fill: "#2f8bff",
    glyph: (
      <path d="M9.4 7.6h13.2a3 3 0 0 1 3 3v7.6a3 3 0 0 1-3 3h-7.8L9.6 25.2v-4H9.4a3 3 0 0 1-3-3v-7.6a3 3 0 0 1 3-3z" strokeLinejoin="round" />
    ),
  },
  board: {
    fill: "#ef7470",
    glyph: (
      <g>
        {/* The canvas: a quiet dot grid. The stroke is the only thing at full ink. */}
        <g fill="currentColor" fillOpacity="0.55" stroke="none">
          <circle cx="8.5" cy="8.5" r="1.15" />
          <circle cx="16" cy="8.5" r="1.15" />
          <circle cx="23.5" cy="8.5" r="1.15" />
          <circle cx="8.5" cy="16" r="1.15" />
          <circle cx="23.5" cy="16" r="1.15" />
          <circle cx="8.5" cy="23.5" r="1.15" />
          <circle cx="16" cy="23.5" r="1.15" />
          <circle cx="23.5" cy="23.5" r="1.15" />
        </g>
        <path d="M8.8 21.6c2.4-5.6 6.2-3.2 9-6.2s3.4-5.4 5.6-7.6" strokeWidth="2.5" />
      </g>
    ),
  },
  disk: {
    fill: "#20b3a0",
    glyph: (
      <g>
        <rect x="7" y="8.6" width="18" height="14.8" rx="3" />
        <path d="M7 18.2h18" />
        <circle cx="21" cy="20.9" r="1.25" fill="currentColor" stroke="none" />
        <path d="M11 20.9h4" />
      </g>
    ),
  },
  social: {
    fill: "#a58cf2",
    glyph: (
      <g>
        <rect x="7" y="9" width="18" height="16" rx="3" />
        <path d="M7 14.6h18M12 6.6v4.6M20 6.6v4.6" />
        <circle cx="12.6" cy="19.8" r="1.7" fill="currentColor" stroke="none" />
      </g>
    ),
  },
};

/**
 * The tile colour per tool — for callers that tint something next to the
 * mark (a hover wash, the rail's active pill). No shadows: the mark is flat.
 */
export const TOOL_TINT: Record<ToolMarkName, string> = Object.fromEntries(
  (Object.keys(MARKS) as ToolMarkName[]).map((name) => [name, MARKS[name].fill]),
) as Record<ToolMarkName, string>;

function Glyph({ tool }: { tool: ToolMarkName }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      {MARKS[tool].glyph}
    </g>
  );
}

/** The tile: solid colour, white glyph. */
export function ToolMark({
  tool,
  size = 32,
  className,
}: {
  tool: ToolMarkName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: "#fff" }}
    >
      <rect width="32" height="32" rx="7.2" fill={MARKS[tool].fill} />
      <Glyph tool={tool} />
    </svg>
  );
}

/**
 * The same drawing as a bare line icon in `currentColor` — the rail, menus,
 * anywhere the tile would be too loud.
 */
export function ToolGlyph({
  tool,
  size = 22,
  className,
}: {
  tool: ToolMarkName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <Glyph tool={tool} />
    </svg>
  );
}
