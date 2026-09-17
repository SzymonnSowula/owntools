/**
 * A window in the app's own chrome: the `.wincard` from suite.css — white,
 * 14 px radius, a hairline, a soft drop shadow, the three tinted glyphs of
 * `WinDots` and a title. Drawn in app pixels; the scene's `zoom` blows it up.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { WinDots } from "@ui/WinDots";
import { COLORS, FONT_BODY } from "../theme";

export function Window({
  title,
  icon,
  width,
  children,
  style,
  dark = false,
  right,
  bodyStyle,
}: {
  title: string;
  icon?: ReactElement;
  width: number;
  children: ReactNode;
  style?: CSSProperties;
  dark?: boolean;
  right?: ReactNode;
  bodyStyle?: CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        background: dark ? "#141416" : COLORS.card,
        color: dark ? COLORS.paper : COLORS.ink,
        border: `1px solid ${dark ? "rgba(255,255,255,0.12)" : "#e5e5e5"}`,
        borderRadius: 14,
        boxShadow: "0 24px 60px rgba(4,10,24,0.45), 0 2px 6px rgba(4,10,24,0.25)",
        overflow: "hidden",
        fontFamily: FONT_BODY,
        fontSize: 13,
        lineHeight: 1.35,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "9px 12px",
          borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.1)" : "#e5e5e5"}`,
          background: dark ? "#1b1b1e" : "#fbfbfc",
        }}
      >
        <WinDots icon={icon} />
        <span
          style={{
            marginLeft: 8,
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: dark ? "rgba(245,245,247,0.8)" : COLORS.muted,
          }}
        >
          {title}
        </span>
        {right ? <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center" }}>{right}</span> : null}
      </div>
      <div style={{ position: "relative", ...bodyStyle }}>{children}</div>
    </div>
  );
}

/** A dark pill with a red dot: the pill, the recorder bar, the meet take. */
export function DarkPill({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 18px",
        borderRadius: 999,
        background: "rgba(17,17,17,0.94)",
        color: "#fffdfb",
        fontFamily: FONT_BODY,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function RecDot({ size = 9, on = true, pulse = 1 }: { size?: number; on?: boolean; pulse?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 999,
        background: on ? COLORS.red : "#666",
        opacity: on ? 0.55 + 0.45 * pulse : 1,
        boxShadow: on ? `0 0 ${size}px rgba(255,69,58,${0.5 * pulse})` : undefined,
      }}
    />
  );
}
