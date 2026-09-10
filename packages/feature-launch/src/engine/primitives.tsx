import React, { useId } from "react";
import { AbsoluteFill } from "remotion";
import { alpha } from "./brand";
import type { Layout } from "./layout";
import { FONT_BODY, FONT_DISPLAY, FONT_MONO, type ChromeKind, type StyleTokens } from "./style";
import type { BrandKit } from "./types";

/**
 * Shared furniture. Everything here is renderer-safe: gradients are inline SVG
 * (CSS `radial-gradient` is not supported by the web renderer), stacking is
 * DOM order rather than `z-index`, and there are no filters or blend modes.
 */

function useUid(): string {
  // useId contains ":" which is illegal in SVG ids.
  return useId().replace(/:/g, "");
}

/* ------------------------------ backgrounds ------------------------------ */

export const DotField: React.FC<{
  color: string;
  gap?: number;
  radius?: number;
  layout: Layout;
}> = ({ color, gap = 26, radius = 1.8, layout }) => {
  const id = useUid();
  const step = layout.px(gap);
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
      <defs>
        <pattern id={`dots-${id}`} width={step} height={step} patternUnits="userSpaceOnUse">
          <circle cx={layout.px(2)} cy={layout.px(2)} r={layout.px(radius)} fill={color} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#dots-${id})`} />
    </svg>
  );
};

export const GridLines: React.FC<{ color: string; cells?: number; layout: Layout }> = ({
  color,
  cells = 6,
  layout,
}) => {
  const cols = Array.from({ length: cells - 1 }, (_, i) => ((i + 1) / cells) * 100);
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
      {cols.map((x) => (
        <line
          key={x}
          x1={`${x}%`}
          y1="0"
          x2={`${x}%`}
          y2="100%"
          stroke={color}
          strokeWidth={Math.max(1, layout.px(1))}
        />
      ))}
    </svg>
  );
};

export interface GlowSpec {
  color: string;
  /** center, in percent of the frame */
  x: number;
  y: number;
  /** radius, in percent of the frame */
  r: number;
  opacity: number;
}

/** Stacked radial washes — the only way to get soft light past the renderer. */
export const Glows: React.FC<{ glows: GlowSpec[] }> = ({ glows }) => {
  const id = useUid();
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
      <defs>
        {glows.map((g, i) => (
          <radialGradient key={i} id={`glow-${id}-${i}`} cx={`${g.x}%`} cy={`${g.y}%`} r={`${g.r}%`}>
            <stop offset="0%" stopColor={g.color} stopOpacity={g.opacity} />
            <stop offset="55%" stopColor={g.color} stopOpacity={g.opacity * 0.34} />
            <stop offset="100%" stopColor={g.color} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      {glows.map((_, i) => (
        <rect key={i} width="100%" height="100%" fill={`url(#glow-${id}-${i})`} />
      ))}
    </svg>
  );
};

/** Horizontal scanlines — cheap CRT texture for the terminal pack. */
export const Scanlines: React.FC<{ color: string; layout: Layout; gap?: number }> = ({
  color,
  layout,
  gap = 5,
}) => {
  const id = useUid();
  const step = layout.px(gap);
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
      <defs>
        <pattern id={`scan-${id}`} width={step} height={step} patternUnits="userSpaceOnUse">
          <rect width={step} height={Math.max(1, layout.px(1.4))} fill={color} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#scan-${id})`} />
    </svg>
  );
};

/* --------------------------------- chrome -------------------------------- */

export const WinBar: React.FC<{
  brand: BrandKit;
  layout: Layout;
  title: string;
}> = ({ brand, layout, title }) => (
  <div
    style={{
      height: layout.px(52),
      display: "flex",
      alignItems: "center",
      gap: layout.px(16),
      padding: `0 ${layout.px(22)}px`,
      borderBottom: `${Math.max(1, layout.px(1.5))}px solid ${brand.line}`,
      background: brand.winBar,
      flexShrink: 0,
    }}
  >
    <div style={{ display: "flex", gap: layout.px(9) }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div
          key={c}
          style={{ width: layout.px(15), height: layout.px(15), borderRadius: layout.px(8), backgroundColor: c }}
        />
      ))}
    </div>
    <div
      style={{
        fontFamily: FONT_BODY,
        fontSize: layout.px(20),
        fontWeight: 500,
        color: brand.muted,
        letterSpacing: "-0.01em",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  </div>
);

export const TerminalBar: React.FC<{
  brand: BrandKit;
  layout: Layout;
  title: string;
}> = ({ brand, layout, title }) => (
  <div
    style={{
      height: layout.px(48),
      display: "flex",
      alignItems: "center",
      gap: layout.px(14),
      padding: `0 ${layout.px(20)}px`,
      borderBottom: `${Math.max(1, layout.px(1))}px solid ${brand.line}`,
      flexShrink: 0,
    }}
  >
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: layout.px(19),
        color: alpha(brand.accent, 0.9),
        letterSpacing: "0.06em",
      }}
    >
      ● ● ●
    </div>
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: layout.px(19),
        color: brand.muted,
        letterSpacing: "0.04em",
      }}
    >
      {title}
    </div>
  </div>
);

/**
 * Wraps a scene's content in the pack's chrome. Scenes never care which one
 * they got — that is exactly what makes one scene layer serve six looks.
 */
export const Chrome: React.FC<{
  brand: BrandKit;
  tokens: StyleTokens;
  layout: Layout;
  title?: string;
  kind?: ChromeKind;
  tint?: string;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ brand, tokens, layout, title = "", kind, tint, style, bodyStyle, children }) => {
  const chrome = kind ?? tokens.chrome;
  const accent = tint ?? brand.accent;
  const radius = layout.px(tokens.radius);

  if (chrome === "none") {
    return <div style={{ display: "flex", flexDirection: "column", ...style, ...bodyStyle }}>{children}</div>;
  }

  if (chrome === "rule") {
    return (
      <div
        style={{
          borderTop: `${Math.max(1, layout.px(2))}px solid ${brand.ink}`,
          borderBottom: `${Math.max(1, layout.px(1))}px solid ${brand.line}`,
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
      >
        {title ? (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: layout.px(19),
              letterSpacing: tokens.kickerTracking,
              textTransform: "uppercase",
              color: brand.muted,
              padding: `${layout.px(14)}px 0`,
              borderBottom: `${Math.max(1, layout.px(1))}px solid ${brand.line}`,
            }}
          >
            {title}
          </div>
        ) : null}
        <div style={{ flex: 1, minHeight: 0, ...bodyStyle }}>{children}</div>
      </div>
    );
  }

  if (chrome === "block") {
    return (
      <div
        style={{
          backgroundColor: accent,
          borderRadius: radius,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
      >
        <div style={{ flex: 1, minHeight: 0, ...bodyStyle }}>{children}</div>
      </div>
    );
  }

  if (chrome === "glass") {
    return (
      <div
        style={{
          backgroundColor: brand.theme === "night" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.62)",
          border: `${Math.max(1, layout.px(1.5))}px solid ${
            brand.theme === "night" ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.9)"
          }`,
          borderRadius: radius,
          boxShadow: tokens.shadow,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
      >
        <div style={{ flex: 1, minHeight: 0, position: "relative", ...bodyStyle }}>{children}</div>
      </div>
    );
  }

  if (chrome === "terminal") {
    return (
      <div
        style={{
          backgroundColor: brand.card,
          border: `${Math.max(1, layout.px(1))}px solid ${alpha(accent, 0.35)}`,
          borderRadius: radius,
          boxShadow: tokens.shadow,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
      >
        <TerminalBar brand={brand} layout={layout} title={title || "~/launch"} />
        <div style={{ flex: 1, minHeight: 0, position: "relative", ...bodyStyle }}>{children}</div>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: brand.card,
        border: `${Math.max(1, layout.px(1.5))}px solid ${brand.line}`,
        borderRadius: radius,
        boxShadow: tokens.shadow,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <WinBar brand={brand} layout={layout} title={title} />
      <div style={{ flex: 1, minHeight: 0, position: "relative", ...bodyStyle }}>{children}</div>
    </div>
  );
};

/* ------------------------------ device frames ----------------------------- */

export type DeviceKind = "browser" | "laptop" | "phone";

/**
 * A screenshot sitting in a real device reads as a product; the same
 * screenshot in a plain box reads as an attachment. The frames are drawn with
 * borders and linear gradients only — no clip-path, no filters — so they
 * survive the offline renderer.
 */
export const DeviceFrame: React.FC<{
  brand: BrandKit;
  tokens: StyleTokens;
  layout: Layout;
  kind: DeviceKind;
  /** shown in the browser frame's address pill */
  title?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ brand, tokens, layout, kind, title = "", style, children }) => {
  const line = `${Math.max(1, layout.px(1.5))}px solid ${brand.line}`;

  if (kind === "phone") {
    const radius = layout.px(54);
    return (
      <div
        style={{
          backgroundColor: brand.theme === "night" ? "#1c1c20" : "#e9e9ee",
          border: line,
          borderRadius: radius,
          padding: layout.px(12),
          boxShadow: tokens.shadow,
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            borderRadius: radius - layout.px(12),
            overflow: "hidden",
            backgroundColor: brand.card,
          }}
        >
          {children}
          {/* notch — drawn after the screen so DOM order puts it on top */}
          <div
            style={{
              position: "absolute",
              top: layout.px(14),
              left: "50%",
              width: layout.px(120),
              height: layout.px(26),
              marginLeft: -layout.px(60),
              borderRadius: layout.px(13),
              backgroundColor: "#141418",
            }}
          />
        </div>
      </div>
    );
  }

  if (kind === "laptop") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", ...style }}>
        <div
          style={{
            width: "100%",
            flex: 1,
            minHeight: 0,
            backgroundColor: brand.theme === "night" ? "#1c1c20" : "#dedee4",
            border: line,
            borderRadius: layout.px(18),
            padding: layout.px(12),
            boxShadow: tokens.shadow,
            display: "flex",
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              position: "relative",
              overflow: "hidden",
              borderRadius: layout.px(8),
              backgroundColor: brand.card,
            }}
          >
            {children}
          </div>
        </div>
        {/* the lip of the base, wider than the lid */}
        <div
          style={{
            width: "112%",
            height: layout.px(16),
            borderBottomLeftRadius: layout.px(10),
            borderBottomRightRadius: layout.px(10),
            background: `linear-gradient(to bottom, ${
              brand.theme === "night" ? "#26262c" : "#d2d2da"
            }, ${brand.theme === "night" ? "#151519" : "#b9b9c3"})`,
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: brand.card,
        border: line,
        borderRadius: layout.px(tokens.radius),
        boxShadow: tokens.shadow,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div
        style={{
          height: layout.px(62),
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: layout.px(18),
          padding: `0 ${layout.px(22)}px`,
          borderBottom: line,
          background: brand.winBar,
        }}
      >
        <div style={{ display: "flex", gap: layout.px(9) }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div
              key={c}
              style={{ width: layout.px(15), height: layout.px(15), borderRadius: layout.px(8), backgroundColor: c }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: layout.px(34),
            borderRadius: layout.px(17),
            border: `${Math.max(1, layout.px(1))}px solid ${brand.line}`,
            backgroundColor: alpha(brand.ink, 0.04),
            display: "flex",
            alignItems: "center",
            padding: `0 ${layout.px(18)}px`,
            fontFamily: FONT_BODY,
            fontSize: layout.px(19),
            color: brand.muted,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</div>
    </div>
  );
};

/* -------------------------------- details -------------------------------- */

export const Kicker: React.FC<{
  brand: BrandKit;
  tokens: StyleTokens;
  layout: Layout;
  color?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ brand, tokens, layout, color, children, style }) => (
  <div
    style={{
      fontFamily:
        tokens.kickerFont === "mono" ? FONT_MONO : tokens.kickerFont === "display" ? FONT_DISPLAY : FONT_BODY,
      fontSize: layout.kicker,
      fontWeight: 600,
      letterSpacing: tokens.kickerTracking,
      textTransform: "uppercase",
      color: color ?? brand.muted,
      ...style,
    }}
  >
    {children}
  </div>
);

/** The pack's accent gesture: a bar, a dot, a block, an underline, a caret. */
export const AccentMark: React.FC<{
  brand: BrandKit;
  tokens: StyleTokens;
  layout: Layout;
  progress?: number;
  color?: string;
  width?: number;
}> = ({ brand, tokens, layout, progress = 1, color, width = 210 }) => {
  const c = color ?? brand.accent;
  const w = layout.px(width);
  switch (tokens.accentShape) {
    case "dot":
      return (
        <div
          style={{
            width: layout.px(26) * progress,
            height: layout.px(26) * progress,
            borderRadius: "50%",
            backgroundColor: c,
          }}
        />
      );
    case "block":
      return (
        <div style={{ width: w * progress, height: layout.px(28), backgroundColor: c }} />
      );
    case "underline":
      return (
        <div style={{ width: w * progress, height: layout.px(4), backgroundColor: c }} />
      );
    case "caret":
      return (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: layout.px(46),
            color: c,
            opacity: progress,
            lineHeight: 1,
          }}
        >
          ▍
        </div>
      );
    default:
      return (
        <div
          style={{
            width: w * progress,
            height: layout.px(10),
            borderRadius: layout.px(5),
            backgroundColor: c,
          }}
        />
      );
  }
};

export const Sticker: React.FC<{
  layout: Layout;
  rotate?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ layout, rotate = -5, children, style }) => (
  <div
    style={{
      backgroundColor: "#fff8c4",
      color: "#4a4425",
      padding: `${layout.px(18)}px ${layout.px(26)}px`,
      fontFamily: FONT_BODY,
      fontWeight: 600,
      fontSize: layout.px(26),
      letterSpacing: "-0.01em",
      transform: `rotate(${rotate}deg)`,
      boxShadow: `0 ${layout.px(14)}px ${layout.px(30)}px rgba(10,10,14,0.16)`,
      borderRadius: layout.px(4),
      ...style,
    }}
  >
    {children}
  </div>
);

/* ------------------------------- watermark ------------------------------- */

export const Watermark: React.FC<{ brand: BrandKit; layout: Layout }> = ({ brand, layout }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        right: layout.px(34),
        bottom: layout.px(30),
        display: "flex",
        alignItems: "center",
        gap: layout.px(12),
        backgroundColor: "rgba(16,16,20,0.72)",
        border: `${Math.max(1, layout.px(1))}px solid rgba(255,255,255,0.16)`,
        borderRadius: layout.px(999),
        padding: `${layout.px(12)}px ${layout.px(22)}px`,
      }}
    >
      <svg width={layout.px(18)} height={layout.px(18)} viewBox="0 0 12 12">
        <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" fill={brand.accent} />
      </svg>
      <span
        style={{
          fontFamily: FONT_BODY,
          fontWeight: 600,
          fontSize: layout.px(21),
          color: "#f5f5f7",
          letterSpacing: "-0.01em",
        }}
      >
        made with owntools
      </span>
    </div>
  </AbsoluteFill>
);
