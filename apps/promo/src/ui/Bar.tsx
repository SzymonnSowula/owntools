/**
 * The bar, as `apps/desktop/src/bar/bar.css` draws it: the capsule at rest,
 * the row (mark · Dictate · Record · Focus · Meeting · ⋯) and the focus
 * widget. App pixels, the same numbers as the stylesheet.
 */
import type { CSSProperties, ReactNode } from "react";
import { BrandMark } from "@ui/BrandMark";
import { ToolGlyph } from "@ui/ToolMark";
import { COLORS, FONT_BODY } from "../theme";
import { DotsIcon } from "./icons";

const surface: CSSProperties = {
  background: COLORS.surface,
  color: COLORS.paper,
  border: `1px solid ${COLORS.surfaceLine}`,
  fontFamily: FONT_BODY,
  boxShadow: "0 16px 40px rgba(4,10,24,0.45)",
};

export function BarCapsule({ clock, task }: { clock?: string; task?: string }) {
  return (
    <div
      style={{
        ...surface,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 26,
        padding: "0 11px 0 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {clock ? (
        <>
          <ToolGlyph tool="focus" size={14} />
          <span className="tnum">{clock}</span>
          {task ? <span style={{ color: "rgba(245,245,247,0.55)", fontWeight: 500 }}>· {task}</span> : null}
        </>
      ) : (
        <>
          <BrandMark size={11} />
          <span style={{ display: "inline-flex", gap: 4 }} aria-hidden>
            <i style={{ width: 4, height: 4, borderRadius: 999, background: "rgba(245,245,247,0.5)" }} />
            <i style={{ width: 4, height: 4, borderRadius: 999, background: "rgba(245,245,247,0.5)" }} />
            <i style={{ width: 4, height: 4, borderRadius: 999, background: "rgba(245,245,247,0.5)" }} />
          </span>
        </>
      )}
    </div>
  );
}

function BarBtn({ children, on = false, pressed = 0, style }: { children: ReactNode; on?: boolean; pressed?: number; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 32,
        padding: "0 11px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "-0.005em",
        background: on ? "rgba(255,255,255,0.16)" : pressed > 0 ? `rgba(255,255,255,${0.09 * pressed})` : "transparent",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

const Sep = () => <span style={{ width: 1, height: 20, margin: "0 3px", background: "rgba(255,255,255,0.14)", flex: "none" }} />;

export function BarRow({ active, focusPressed = 0, width }: { active?: "dictate" | "record" | "focus" | "meet"; focusPressed?: number; width?: number }) {
  return (
    <div
      style={{
        ...surface,
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: 42,
        padding: 4,
        borderRadius: 999,
        whiteSpace: "nowrap",
        width,
        overflow: "hidden",
      }}
    >
      <BarBtn style={{ padding: "0 4px" }}>
        <BrandMark size={24} filled />
      </BarBtn>
      <Sep />
      <BarBtn on={active === "dictate"}>
        <ToolGlyph tool="dictate" size={18} />
        Dictate
      </BarBtn>
      <BarBtn on={active === "record"}>
        <ToolGlyph tool="screeni" size={18} />
        Record
      </BarBtn>
      <BarBtn on={active === "focus"} pressed={focusPressed}>
        <ToolGlyph tool="focus" size={18} />
        Focus
      </BarBtn>
      <BarBtn on={active === "meet"}>
        <ToolGlyph tool="meet" size={18} />
        Meeting
      </BarBtn>
      <Sep />
      <BarBtn style={{ padding: "0 8px" }}>
        <DotsIcon size={18} />
      </BarBtn>
    </div>
  );
}

export function Chip({ children, on = false, style }: { children: ReactNode; on?: boolean; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 28,
        padding: "0 11px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: on ? "#fff" : COLORS.paper,
        background: on ? COLORS.accent : "rgba(255,255,255,0.07)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function FocusPanel({ minutes, task, tasks, startPressed = 0 }: { minutes: number; task: string; tasks: string[]; startPressed?: number }) {
  return (
    <div style={{ ...surface, width: 300, padding: 14, borderRadius: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
        <ToolGlyph tool="focus" size={18} />
        Focus
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {[15, 25, 50, 90].map((m) => (
          <Chip key={m} on={m === minutes} style={{ padding: 0 }}>
            {m}
          </Chip>
        ))}
      </div>
      <div style={{ marginBottom: -4, fontSize: 11, fontWeight: 600, color: "rgba(245,245,247,0.5)" }}>Working on</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tasks.map((t) => (
          <Chip key={t} on={t === task} style={{ maxWidth: "100%" }}>
            {t}
          </Chip>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 34,
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: startPressed > 0 ? COLORS.accent2 : COLORS.accent,
          transform: `scale(${1 - startPressed * 0.03})`,
        }}
      >
        Start {minutes} min
      </div>
    </div>
  );
}
