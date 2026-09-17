/**
 * `Place` puts a thing at a point of the design canvas (1920 × 1080, or
 * 1080 × 1920 in portrait) and, for app-pixel mocks, blows it up with CSS
 * `zoom` on an inner wrapper — never on the positioned element, because
 * `zoom` scales that element's own `left`/`top` too (the placeholder landed
 * in the corner that way). Optional entrance: a spring from a side, from
 * small, or a fade, starting at `at`.
 */
import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ramp, spr } from "../lib/anim";
import { useLayout } from "./layout";

export type Anchor = "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface PlaceProps {
  x: number;
  y: number;
  anchor?: Anchor;
  /** App-pixel content: apply the UI zoom. Off for things drawn in design px. */
  zoomed?: boolean;
  children: ReactNode;
  /** Frame the item appears (hidden before). */
  at?: number;
  from?: "bottom" | "top" | "left" | "right" | "scale" | "fade" | "none";
  /** Frame the item leaves (fades and shrinks over 8 frames). */
  leaveAt?: number;
  kind?: "pop" | "glide" | "slam" | "soft" | "stiff";
  style?: CSSProperties;
  zIndex?: number;
  /** Extra transform applied after placement, e.g. a tilt. */
  transform?: string;
}

const ANCHORS: Record<Anchor, [x: string, y: string]> = {
  center: ["-50%", "-50%"],
  top: ["-50%", "0%"],
  bottom: ["-50%", "-100%"],
  left: ["0%", "-50%"],
  right: ["-100%", "-50%"],
  "top-left": ["0%", "0%"],
  "top-right": ["-100%", "0%"],
  "bottom-left": ["0%", "-100%"],
  "bottom-right": ["-100%", "-100%"],
};

export function Place({
  x,
  y,
  anchor = "center",
  zoomed = true,
  children,
  at = 0,
  from = "none",
  leaveAt,
  kind = "pop",
  style,
  zIndex,
  transform = "",
}: PlaceProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { s, zoom } = useLayout();
  if (frame < at) return null;
  if (leaveAt !== undefined && frame > leaveAt + 8) return null;

  const p = from === "none" ? 1 : spr({ frame, fps, at, from: 0, to: 1, kind, durationInFrames: 22 });
  const fade = from === "none" ? 1 : ramp(frame, at, at + 6);
  let entrance = "";
  if (from === "bottom") entrance = `translateY(${(1 - p) * 140 * s}px)`;
  else if (from === "top") entrance = `translateY(${-(1 - p) * 140 * s}px)`;
  else if (from === "left") entrance = `translateX(${-(1 - p) * 160 * s}px)`;
  else if (from === "right") entrance = `translateX(${(1 - p) * 160 * s}px)`;
  else if (from === "scale") entrance = `scale(${0.6 + 0.4 * p})`;

  const leave = leaveAt === undefined ? 0 : ramp(frame, leaveAt, leaveAt + 8);
  const [ax, ay] = ANCHORS[anchor];

  return (
    <div
      style={{
        position: "absolute",
        left: x * s,
        top: y * s,
        transform: `translate(${ax}, ${ay}) ${entrance} ${transform} scale(${1 - leave * 0.08})`,
        transformOrigin: "50% 50%",
        opacity: Math.min(fade, 1 - leave),
        zIndex,
        ...style,
      }}
    >
      {/* zoom, not transform: it changes the layout size too, so the anchor
          maths on the outer box stays right */}
      <div style={{ zoom: zoomed ? zoom : s }}>{children}</div>
    </div>
  );
}

/** A full-canvas layer for things drawn in design px, scaled by `s`. */
export function DesignLayer({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { s, portrait } = useLayout();
  const w = portrait ? 1080 : 1920;
  const h = portrait ? 1920 : 1080;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `scale(${s})`, transformOrigin: "0 0", ...style }}>
      {children}
    </div>
  );
}
