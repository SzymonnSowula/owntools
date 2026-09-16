import { useId, type ReactElement, type ReactNode } from "react";

/**
 * The drawings the bar is made of, copied for the landing (web/ is a
 * standalone Next app and cannot import @ui):
 *
 *   ToolGlyph   packages/ui/src/ToolMark.tsx     (the line glyphs, 32 grid)
 *   Sail        packages/ui/src/BrandMark.tsx    (the bare mark)
 *   AppIcon     packages/ui/src/BrandMark.tsx    (`filled`: the sky icon)
 *   bar icons   apps/desktop/src/bar/icons.tsx
 *   Rec*Icon    packages/feature-recorder/src/icons.tsx
 *
 * Keep them identical to those files: when a glyph is redrawn there, copy it
 * here in the same commit (the same deal as WinDots.tsx).
 */

export type BarTool = "focus" | "screeni" | "capture" | "dictate" | "meet";

const GLYPHS: Record<BarTool, ReactElement> = {
  focus: (
    <g>
      <circle cx="16" cy="16" r="7.6" />
      <circle cx="16" cy="16" r="2.4" fill="currentColor" stroke="none" />
    </g>
  ),
  screeni: (
    <g>
      <rect x="7" y="8.2" width="18" height="12.2" rx="2.6" />
      <path d="M16 20.4v3.6M11.6 24.6h8.8" />
    </g>
  ),
  capture: (
    <g>
      <path d="M7 12V9.6A2.6 2.6 0 0 1 9.6 7H12M20 7h2.4A2.6 2.6 0 0 1 25 9.6V12M25 20v2.4a2.6 2.6 0 0 1-2.6 2.6H20M12 25H9.6A2.6 2.6 0 0 1 7 22.4V20" />
      <rect x="11.6" y="11.6" width="8.8" height="8.8" rx="1.8" />
    </g>
  ),
  dictate: (
    <g>
      <rect x="13" y="6.4" width="6" height="11.2" rx="3" />
      <path d="M9.8 15a6.2 6.2 0 0 0 12.4 0M16 21.2v3.4M12.4 24.6h7.2" />
    </g>
  ),
  meet: (
    <path
      d="M9.4 7.6h13.2a3 3 0 0 1 3 3v7.6a3 3 0 0 1-3 3h-7.8L9.6 25.2v-4H9.4a3 3 0 0 1-3-3v-7.6a3 3 0 0 1 3-3z"
      strokeLinejoin="round"
    />
  ),
};

export function ToolGlyph({ tool, size = 22 }: { tool: BarTool; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <g fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[tool]}
      </g>
    </svg>
  );
}

const SAIL = "M6 0.8L10.4 7.6H1.6L6 0.8Z";
const HULL = "M2 9H10L8.6 11.2H3.4L2 9Z";

/** The bare mark in `currentColor`. */
export function Sail({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <path d={`${SAIL}${HULL}`} fill="currentColor" />
    </svg>
  );
}

/** The app icon: the sky with the sail on the horizon, in the 32 / `rx 7.2` frame. */
export function AppIcon({ size = 24 }: { size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `bm${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const boat = (paint: string) => (
    <>
      <path d={SAIL} fill={paint} stroke={paint} strokeWidth={0.42} strokeLinejoin="round" />
      <path d={HULL} fill={paint} stroke={paint} strokeWidth={0.42} strokeLinejoin="round" />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={id("tile")}>
          <rect width="1024" height="1024" rx="230" />
        </clipPath>
        <filter id={id("ring")} x="-300" y="-300" width="1624" height="1624" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation={40} />
        </filter>
        <filter id={id("rim")} x="-300" y="-300" width="1624" height="1624" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation={3} />
        </filter>
        <filter id={id("soft")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={0.55} />
        </filter>
        <filter id={id("haze")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={30} />
        </filter>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="724" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2f7fce" />
          <stop offset=".62" stopColor="#62aae7" />
          <stop offset="1" stopColor="#d6ebf3" />
        </linearGradient>
        <linearGradient id={id("sea")} x1="0" y1="724" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5aa7e6" />
          <stop offset=".35" stopColor="#3a86d4" />
          <stop offset="1" stopColor="#1c5aa3" />
        </linearGradient>
        <radialGradient id={id("sun")} cx="790" cy="190" r="340" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".22" stopColor="#fff" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("sail")} x1="3" y1="0.8" x2="9" y2="11.2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e3ebff" />
        </linearGradient>
        <pattern id={id("dots")} width="64" height="64" patternUnits="userSpaceOnUse">
          <circle cx="32" cy="32" r="4.2" fill="#fff" fillOpacity=".16" />
        </pattern>
        <linearGradient id={id("dotsFade")} x1="0" y1="0" x2="0" y2="700" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={id("dotsMask")}>
          <rect width="1024" height="724" fill={url("dotsFade")} />
        </mask>
        <linearGradient id={id("reflFade")} x1="0" y1="728" x2="0" y2="960" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={id("reflMask")}>
          <rect y="724" width="1024" height="300" fill={url("reflFade")} />
        </mask>
      </defs>
      <g transform="scale(0.03125)">
        <g clipPath={url("tile")}>
          <rect width="1024" height="1024" fill={url("sky")} />
          <g mask={url("dotsMask")}>
            <rect width="1024" height="724" fill={url("dots")} />
          </g>
          <rect width="1024" height="1024" fill={url("sun")} />
          <rect y="724" width="1024" height="300" fill={url("sea")} />
          <rect y="706" width="1024" height="40" fill="#fff" opacity=".5" filter={url("haze")} />

          <g mask={url("reflMask")}>
            <g transform="translate(0 1464) scale(1 -1)">
              <g transform="translate(272 280) scale(40)">{boat("#fff")}</g>
            </g>
          </g>
          <rect x="200" y="800" width="624" height="5" rx="2.5" fill="#fff" opacity=".12" />
          <rect x="290" y="846" width="444" height="5" rx="2.5" fill="#fff" opacity=".07" />

          <g transform="translate(272 280) scale(40)">
            <g opacity=".22" filter={url("soft")} transform="translate(0 .3)">
              {boat("#123a78")}
            </g>
            {boat(url("sail"))}
            <path
              d="M6 0.8L1.6 7.6"
              stroke="#fff"
              strokeOpacity=".55"
              strokeWidth={0.16}
              strokeLinecap="round"
              transform="translate(.12 .1)"
            />
          </g>

          <rect x="0" y="-22" width="1024" height="1024" rx="230" fill="none" stroke="#0b2a55" strokeWidth={110} opacity=".18" filter={url("ring")} />
          <rect x="0" y="7" width="1024" height="1024" rx="230" fill="none" stroke="#fff" strokeWidth={10} opacity=".4" filter={url("rim")} />
        </g>
      </g>
    </svg>
  );
}

/* ---- the bar's control icons (apps/desktop/src/bar/icons.tsx) ---- */

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

/* ---- the recorder's live bar (packages/feature-recorder/src/icons.tsx) ---- */

function Rec({ children, filled = false }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const RecPauseIcon = () => (
  <Rec>
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </Rec>
);

export const RecPlayIcon = () => (
  <Rec filled>
    <path d="M5 3.2v9.6L12.5 8z" />
  </Rec>
);

export const RecRestartIcon = () => (
  <Rec>
    <path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4" />
    <path d="M3 2.6v2.6h2.6" />
  </Rec>
);

export const RecTrashIcon = () => (
  <Rec>
    <path d="M3 4.5h10M6.5 2.5h3M4.5 4.5l.6 8h5.8l.6-8M6.8 7v3.5M9.2 7v3.5" />
  </Rec>
);

export const RecDotsIcon = () => (
  <Rec filled>
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="12.5" cy="8" r="1.3" />
  </Rec>
);

export const RecStopIcon = () => (
  <Rec filled>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </Rec>
);

export const RecMicIcon = ({ muted }: { muted?: boolean }) => (
  <Rec>
    <rect x="5.75" y="2" width="4.5" height="7.5" rx="2.25" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2M6 14h4" />
    {muted ? <path d="M3 3l10 10" /> : null}
  </Rec>
);

export const RecFolderIcon = () => (
  <Rec>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Rec>
);

export const RecCloseIcon = () => (
  <Rec>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Rec>
);

export const RecBackIcon = () => (
  <Rec>
    <path d="M10 3.5 5.5 8 10 12.5" />
  </Rec>
);
