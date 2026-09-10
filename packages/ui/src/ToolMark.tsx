import { useId, type ReactElement } from "react";

/**
 * App marks for the seven tools — the little rounded tiles that stand next to
 * a tool's name on the hub and in its own sidebar.
 *
 * ## Why these are drawn here and not imported
 *
 * The tiles used to be a stock outline icon dropped into a flat `#0a84ff`
 * square: the same square, the same blue, for every tool. That reads as a
 * placeholder — a Material glyph in a coloured box — and it threw away the
 * one job an app mark has, which is to be recognisable at a glance without
 * its label.
 *
 * Every glyph below is drawn for this grid, and each says what the tool
 * actually does rather than naming its category:
 *
 *   focus    an aperture closing on a point, not a wall clock
 *   screeni  a lit display with the pointer as its subject, because the take
 *            follows the cursor
 *   launch   a sail leaning into the wind over its own wake — the brand
 *            mark's geometry set in motion
 *   dictate  a mic resting on a line of text, because it types what you say
 *   board    one stroke across a dotted canvas — the endless whiteboard
 *   disk     an actual treemap, the analyzer's own picture of a volume
 *   social   a calendar where one post is scheduled and the rest are not
 *
 * ## The frame
 *
 * `viewBox 0 0 32 32` with `rx 7.2` is exactly `BrandMark`'s filled badge, so
 * a tool tile and the app icon are visibly the same object. Each tool gets its
 * own gradient along the blue→indigo→cyan arc of the palette, ordered so the
 * hub reads as one spectrum instead of seven identical squares.
 *
 * Those gradients are **hard-coded on purpose**, which is the one place the
 * "recolor via tokens" rule does not apply: an app mark is the same object in
 * Day and in Night, the way a real app icon does not repaint itself when the
 * system theme flips. `BrandMark` hard-codes its own gradient for the same
 * reason.
 */

export type ToolMarkName =
  | "focus"
  | "screeni"
  | "launch"
  | "dictate"
  | "board"
  | "social"
  | "disk";

interface Mark {
  /** Gradient stops, top-left → bottom-right. */
  from: string;
  to: string;
  glyph: ReactElement;
}

/** White at a given opacity — the only ink these glyphs use. */
const ink = (opacity: number) => ({ stroke: "#fff", strokeOpacity: opacity });

const MARKS: Record<ToolMarkName, Mark> = {
  // An aperture: a dim ring, the bright arc of a session running, and the
  // point of attention in the middle.
  focus: {
    from: "#7b78ff",
    to: "#4f4ad6",
    glyph: (
      <g fill="none" strokeLinecap="round">
        <circle cx="16" cy="16" r="8.4" strokeWidth="2.1" {...ink(0.45)} />
        <path d="M16 7.6A8.4 8.4 0 0 1 23.3 20.2" strokeWidth="2.4" stroke="#fff" />
        <circle cx="16" cy="16" r="2" fill="#fff" stroke="none" />
      </g>
    ),
  },

  // The display sits back with its status light on; the pointer is the
  // brightest thing in the frame, because the take is built around it.
  screeni: {
    from: "#5a86ff",
    to: "#2f56dc",
    glyph: (
      <g fill="none">
        <rect x="4.2" y="7.6" width="23.6" height="15.2" rx="3" strokeWidth="2" {...ink(0.45)} />
        <circle cx="8.9" cy="12.4" r="1.5" fill="#fff" fillOpacity="0.9" stroke="none" />
        <path d="M13.8 12.2l8.4 5-3.5.9-1.7 3.7z" fill="#fff" />
      </g>
    ),
  },

  // The brand's sail, leaning into the wind, with its wake under it. The app
  // icon is sail + hull; this is sail + speed.
  launch: {
    from: "#2f96ff",
    to: "#1263e8",
    glyph: (
      <g fill="none" strokeLinecap="round">
        <path d="M22.4 4.8L26.4 19.8L9.2 16.6z" fill="#fff" />
        <path d="M6.6 21.4q6 1.8 12.4 2.6" strokeWidth="2.1" {...ink(0.75)} />
        <path d="M10.4 25.8q5.6 1.6 11.2 2.2" strokeWidth="2.1" {...ink(0.4)} />
      </g>
    ),
  },

  // A mic hovering over a line of text: it does not record you, it writes for
  // you. The capsule is filled so it holds its weight at 16 px.
  dictate: {
    from: "#35a8ff",
    to: "#0a72e6",
    glyph: (
      <g fill="none" strokeLinecap="round">
        <rect x="12.4" y="5.6" width="7.2" height="12" rx="3.6" fill="#fff" stroke="none" />
        <path d="M9.2 15.2A6.8 6.8 0 0 0 22.8 15.2" strokeWidth="2.2" {...ink(0.9)} />
        <path d="M9.6 25.4h12.8" strokeWidth="2.1" {...ink(0.5)} />
      </g>
    ),
  },

  // A dotted canvas with one confident stroke across it.
  //
  // Two earlier attempts failed the only test that matters, which is what a
  // stranger sees at 32 px: a box with an elbow connector read as a speech
  // bubble, and a box wired to a circle read as a key. Both were trying to
  // draw a diagram, and a diagram needs more room than this. The dots are
  // the app's own endless canvas (the same motif as `.desktop-bg`) and the
  // stroke is the one thing no other mark here has: a freehand line.
  board: {
    from: "#22b3ee",
    to: "#0b86d6",
    glyph: (
      <g fill="none" strokeLinecap="round">
        <g fill="#fff" fillOpacity="0.34" stroke="none">
          <circle cx="8" cy="8" r="1.1" />
          <circle cx="16" cy="8" r="1.1" />
          <circle cx="24" cy="8" r="1.1" />
          <circle cx="8" cy="16" r="1.1" />
          <circle cx="24" cy="16" r="1.1" />
          <circle cx="8" cy="24" r="1.1" />
          <circle cx="16" cy="24" r="1.1" />
          <circle cx="24" cy="24" r="1.1" />
        </g>
        <path
          d="M7 23.4c1.8-4.6 5.4-3.2 7.6-6.4 2.2-3.2 4.6-1.6 9.4-6.4"
          strokeWidth="2.6"
          stroke="#fff"
        />
      </g>
    ),
  },

  // A squarified treemap, the same picture the tool paints of a volume: one
  // folder eating half of it and the rest fading away.
  disk: {
    from: "#35c6e6",
    to: "#0f96bf",
    glyph: (
      <g fill="#fff" stroke="none">
        <rect x="6" y="6" width="11.4" height="11.4" rx="1.6" />
        <rect x="18.8" y="6" width="7.2" height="6.6" rx="1.5" fillOpacity="0.62" />
        <rect x="18.8" y="14" width="7.2" height="3.4" rx="1.4" fillOpacity="0.4" />
        <rect x="6" y="18.8" width="6.6" height="7.2" rx="1.5" fillOpacity="0.78" />
        <rect x="14" y="18.8" width="3.4" height="7.2" rx="1.4" fillOpacity="0.5" />
        <rect x="18.8" y="18.8" width="7.2" height="7.2" rx="1.5" fillOpacity="0.3" />
      </g>
    ),
  },

  // A month with one post standing out of it: scheduling, not a calendar.
  social: {
    from: "#4ccae8",
    to: "#1090c6",
    glyph: (
      <g fill="none" strokeLinecap="round">
        <rect x="5.6" y="8" width="20.8" height="18" rx="3.2" strokeWidth="2.1" {...ink(0.9)} />
        <path d="M5.6 13.8h20.8" strokeWidth="2.1" {...ink(0.9)} />
        <path d="M11.6 5.2v3.4M20.4 5.2v3.4" strokeWidth="2.1" stroke="#fff" />
        <g fill="#fff" stroke="none">
          <circle cx="11.4" cy="18.9" r="1.3" fillOpacity="0.5" />
          <circle cx="16" cy="18.9" r="1.3" fillOpacity="0.5" />
          <circle cx="20.6" cy="18.9" r="2.1" />
          <circle cx="11.4" cy="22.8" r="1.3" fillOpacity="0.35" />
          <circle cx="16" cy="22.8" r="1.3" fillOpacity="0.35" />
        </g>
      </g>
    ),
  },
};

/**
 * The darker gradient stop, for the tinted shadow a tile casts. Exported so a
 * caller can set it as a CSS variable rather than repeating the hex.
 */
export const TOOL_TINT: Record<ToolMarkName, string> = Object.fromEntries(
  (Object.keys(MARKS) as ToolMarkName[]).map((name) => [name, MARKS[name].to]),
) as Record<ToolMarkName, string>;

export function ToolMark({
  tool,
  size = 32,
  className,
}: {
  tool: ToolMarkName;
  size?: number;
  className?: string;
}) {
  const mark = MARKS[tool];
  // One id per instance: several tiles share a page and duplicate gradient
  // ids would leave all but the first unpainted.
  const base = useId();
  const fillId = `${base}-fill`;
  const sheenId = `${base}-sheen`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={mark.from} />
          <stop offset="1" stopColor={mark.to} />
        </linearGradient>
        {/* The sheen a physical tile has: light from above, gone by the middle. */}
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.2" fill={`url(#${fillId})`} />
      <rect width="32" height="32" rx="7.2" fill={`url(#${sheenId})`} />
      {mark.glyph}
      {/* A hairline lip on the edge, so the tile has a top rather than being flat. */}
      <rect
        x="0.6"
        y="0.6"
        width="30.8"
        height="30.8"
        rx="6.7"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.2"
        strokeWidth="1.2"
      />
    </svg>
  );
}
