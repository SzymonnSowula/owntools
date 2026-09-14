import { useId } from "react";

/** The owntools sail + hull on its 12-unit grid, same geometry as the landing page. */
const SAIL = "M6 0.8L10.4 7.6H1.6L6 0.8Z";
const HULL = "M2 9H10L8.6 11.2H3.4L2 9Z";

/**
 * The owntools mark. `filled` paints the app icon itself (hub, onboarding,
 * board welcome); the bare glyph inherits `currentColor` and is what the
 * titlebar / rail use.
 */
export function BrandMark({
  size = 16,
  filled = false,
  className,
}: {
  size?: number;
  filled?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (filled) return <AppIcon size={size} className={className} uid={uid} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className={className}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={`${SAIL}${HULL}`} fill="currentColor" />
    </svg>
  );
}

/**
 * `apps/desktop/src-tauri/app-icon.svg` — the sky with the sail on the horizon —
 * drawn on its 1024 grid and scaled into the 32 × 32 / `rx 7.2` frame the tool
 * marks share. Keep the two in step: this is the icon the taskbar and the Dock
 * show, seen from inside the app. Ids are per instance, so several can coexist.
 */
function AppIcon({ size, className, uid }: { size: number; className?: string; uid: string }) {
  const id = (name: string) => `bm${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const boat = (paint: string) => (
    <>
      <path d={SAIL} fill={paint} stroke={paint} strokeWidth={0.42} strokeLinejoin="round" />
      <path d={HULL} fill={paint} stroke={paint} strokeWidth={0.42} strokeLinejoin="round" />
    </>
  );
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
