import type { SleeveArt } from "../../lib/audio/engine";

/**
 * Record artwork, drawn rather than shipped. Each record names a pattern and
 * three colours; the same primitive serves the sleeve in the crate and the
 * label in the middle of the spinning disc.
 */

/** Fixed scatter — a random one would re-roll on every render and shimmer. */
const DUST: [number, number, number][] = [
  [14, 22, 2.4], [31, 12, 1.4], [48, 27, 3.1], [66, 16, 1.8], [82, 31, 2.2],
  [21, 44, 1.6], [39, 55, 2.8], [58, 47, 1.5], [74, 60, 2.6], [88, 52, 1.3],
  [11, 68, 2.1], [29, 79, 1.7], [45, 71, 2.5], [62, 86, 1.9], [79, 76, 3.0],
  [93, 88, 1.5], [8, 91, 1.8], [52, 94, 2.2], [36, 33, 1.2], [70, 38, 1.6],
];

function Pattern({ art }: { art: SleeveArt }) {
  switch (art.pattern) {
    case "waves":
      return (
        <g fill="none" strokeLinecap="round">
          {[30, 44, 58, 72].map((y, i) => (
            <path
              key={y}
              d={`M-5 ${y} q 17 -${10 + i * 2} 34 0 t 34 0 t 34 0 t 34 0`}
              stroke={i === 1 ? art.accent : art.ink}
              strokeOpacity={i === 1 ? 0.95 : 0.28}
              strokeWidth={i === 1 ? 3 : 1.6}
            />
          ))}
        </g>
      );
    case "sun":
      return (
        <g>
          {Array.from({ length: 18 }, (_, i) => {
            const angle = (i / 18) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={50 + Math.cos(angle) * 24}
                y1={44 + Math.sin(angle) * 24}
                x2={50 + Math.cos(angle) * 46}
                y2={44 + Math.sin(angle) * 46}
                stroke={art.ink}
                strokeOpacity={0.22}
                strokeWidth={1.4}
              />
            );
          })}
          <circle cx="50" cy="44" r="19" fill={art.accent} />
        </g>
      );
    case "grid":
      return (
        <g stroke={art.ink} strokeOpacity={0.24} strokeWidth={1.2}>
          {[20, 35, 50, 65, 80].map((v) => (
            <line key={`v${v}`} x1={v} y1="8" x2={v} y2="92" />
          ))}
          {[20, 35, 50, 65, 80].map((h) => (
            <line key={`h${h}`} x1="8" y1={h} x2="92" y2={h} />
          ))}
          <rect x="35" y="35" width="30" height="30" fill={art.accent} />
        </g>
      );
    case "bars":
      return (
        <g>
          {[
            [16, 68], [26, 44], [36, 78], [46, 30], [56, 60],
          ].map(([y, w], i) => (
            <rect
              key={y}
              x="12"
              y={y}
              width={w}
              height="5"
              fill={i === 3 ? art.accent : art.ink}
              fillOpacity={i === 3 ? 1 : 0.7}
            />
          ))}
        </g>
      );
    case "dust":
      return (
        <g>
          {DUST.map(([x, y, r], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={r}
              fill={i % 5 === 0 ? art.accent : art.ink}
              fillOpacity={i % 5 === 0 ? 0.95 : 0.34}
            />
          ))}
        </g>
      );
    default:
      return (
        <g fill="none">
          {[10, 18, 26, 34, 42].map((r, i) => (
            <circle
              key={r}
              cx="50"
              cy="46"
              r={r}
              stroke={i === 1 ? art.accent : art.ink}
              strokeOpacity={i === 1 ? 1 : 0.26}
              strokeWidth={i === 1 ? 3 : 1.4}
            />
          ))}
        </g>
      );
  }
}

export function SleeveArtwork({
  art,
  title,
  side,
  label = false,
}: {
  art: SleeveArt;
  title: string;
  side: string;
  /** label mode drops the type — it would be unreadable spinning at 33⅓ */
  label?: boolean;
}) {
  return (
    <svg viewBox="0 0 100 100" className="sleeve-svg" role="img" aria-label={title}>
      <rect width="100" height="100" fill={art.base} />
      <Pattern art={art} />
      {label ? (
        <circle cx="50" cy="50" r="7" fill={art.base} stroke={art.ink} strokeOpacity={0.4} strokeWidth="0.8" />
      ) : (
        <>
          <text x="8" y="88" fill={art.ink} fontSize="7.4" fontWeight="700" letterSpacing="-0.4">
            {title.toLowerCase()}
          </text>
          <text x="8" y="95.5" fill={art.ink} fillOpacity="0.55" fontSize="4.4" letterSpacing="1.4">
            {side.toUpperCase()} · SHIPSHAPE
          </text>
        </>
      )}
    </svg>
  );
}
