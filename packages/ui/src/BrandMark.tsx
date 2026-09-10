import { useId } from "react";

/**
 * The owntools mark — sail + hull, same geometry as the landing page.
 * `filled` paints the rounded-square badge (icons, splash); the bare glyph
 * inherits `currentColor` and is what the titlebar / crumbs use.
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
  const gradientId = useId();
  if (filled) {
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
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0a84ff" />
            <stop offset="1" stopColor="#5e5ce6" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="7.2" fill={`url(#${gradientId})`} />
        <g transform="translate(5.5,5.5) scale(1.75)" fill="#fff">
          <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" />
        </g>
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className={className}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" fill="currentColor" />
    </svg>
  );
}
