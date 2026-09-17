/**
 * focus — 6 beats. The bar opens, the focus widget: 25 min on "write the
 * launch post", Start. The timer owns the screen (a fast-forward through
 * the session), then the day's three tasks get ticked.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ToolIcons } from "@ui/WinDots";
import { clock, ease, ramp, spr } from "../lib/anim";
import { COLORS, FONT_BODY, FONT_DISPLAY } from "../theme";
import { BarCapsule, BarRow, FocusPanel } from "../ui/Bar";
import { Cursor } from "../ui/Cursor";
import { CheckIcon } from "../ui/icons";
import { useLayout } from "../ui/layout";
import { DesignLayer, Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { Window } from "../ui/Window";
import type { SceneProps } from "./index";

const ROW_AT = 6;
const FOCUS_CLICK = 22;
const PANEL_AT = 30;
const START_CLICK = 48;
const START_AT = 58;
const TIMER_AT = 68;
const TASKS_AT = 116;
const TICKS = [126, 138, 150];
const TASKS = ["write the launch post", "reply to Michael", "book the dentist"];

export function Focus(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const W = portrait ? 1080 : 1920;

  // The row grows out of the capsule and folds back into it on Start.
  const open = spr({ frame, fps, at: ROW_AT, from: 0, to: 1, kind: "glide", durationInFrames: 18 }) * (1 - ease.inCubic(ramp(frame, START_AT, START_AT + 8)));
  const rowW = 60 + open * 400;

  // The session, fast-forwarded: 25:00 → 21:47 over 54 frames.
  const runP = ramp(frame, TIMER_AT + 4, TIMER_AT + 58);
  const remaining = 25 * 60 - Math.round(ease.inOutCubic(runP) * 193);
  const timerIn = spr({ frame, fps, at: TIMER_AT, from: 0, to: 1, kind: "glide", durationInFrames: 20 });
  const shift = ease.inOutQuint(ramp(frame, TASKS_AT, TASKS_AT + 14));

  const barY = portrait ? 240 : 96;
  // The tasks window takes the right third; the clock moves left and shrinks to make room.
  const clockX = portrait ? W / 2 : W / 2 - shift * 360;
  const clockY = portrait ? 780 - shift * 200 : 470;
  const clockScale = 1 - shift * 0.24;

  return (
    <>
      {/* the bar: capsule → row → capsule with the clock */}
      <Place x={W / 2} y={barY} at={2} from="top" kind="glide" zIndex={5}>
        {open < 0.02 ? (
          <BarCapsule clock={frame >= START_AT ? clock(remaining) : undefined} task={frame >= START_AT ? TASKS[0] : undefined} />
        ) : (
          <div style={{ width: rowW, overflow: "hidden", borderRadius: 999 }}>
            <BarRow focusPressed={frame >= FOCUS_CLICK + 10 && frame < FOCUS_CLICK + 16 ? 1 : 0} active={frame >= FOCUS_CLICK + 10 ? "focus" : undefined} />
          </div>
        )}
      </Place>

      <Place x={W / 2} y={barY + 34} anchor="top" at={PANEL_AT} from="top" kind="pop" leaveAt={START_AT - 2} zIndex={6}>
        <FocusPanel minutes={25} task={TASKS[0]} tasks={[TASKS[0], TASKS[1], "nothing in particular"]} startPressed={frame >= START_CLICK + 10 && frame < START_CLICK + 16 ? 1 : 0} />
      </Place>

      {/* the timer that owns the screen */}
      {frame >= TIMER_AT ? (
        <DesignLayer>
          <div
            style={{
              position: "absolute",
              left: clockX,
              top: clockY,
              transform: `translate(-50%, -50%) scale(${(0.8 + 0.2 * timerIn) * clockScale})`,
              opacity: timerIn,
              textAlign: "center",
              color: "#fff",
              fontFamily: FONT_DISPLAY,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.65)", fontFamily: FONT_BODY }}>deep focus</div>
            <div className="tnum" style={{ fontSize: portrait ? 240 : 300, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.04em", textShadow: "0 12px 60px rgba(4,10,24,0.5)" }}>
              {clock(remaining)}
            </div>
            <div style={{ margin: "18px auto 0", width: 520, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.18)" }}>
              <div style={{ width: `${((25 * 60 - remaining) / (25 * 60)) * 100}%`, height: "100%", borderRadius: 999, background: "#fff" }} />
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                marginTop: 22,
                padding: "10px 18px",
                borderRadius: 999,
                background: COLORS.surface,
                border: `1px solid ${COLORS.surfaceLine}`,
                fontFamily: FONT_BODY,
                fontSize: 20,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 999, background: COLORS.accent }} />
              {TASKS[0]}
            </div>
          </div>
        </DesignLayer>
      ) : null}

      {/* today's tasks, ticked */}
      <Place x={portrait ? W / 2 : 1800} y={portrait ? 1330 : 480} anchor={portrait ? "center" : "right"} at={TASKS_AT} from={portrait ? "bottom" : "right"} kind="glide">
        <Window title="focus — today" icon={ToolIcons.focus} width={400}>
          <div style={{ padding: "8px 12px 10px" }}>
            {TASKS.map((t, i) => {
              const at = TICKS[i];
              const done = frame >= at;
              const pop = spr({ frame, fps, at, from: 0, to: 1, kind: "slam", durationInFrames: 16 });
              const strike = ease.outCubic(ramp(frame, at + 2, at + 10));
              return (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 6px", borderBottom: i < TASKS.length - 1 ? `1px solid ${COLORS.line}` : undefined }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      border: `2px solid ${done ? COLORS.accent : "rgba(29,29,31,0.25)"}`,
                      background: done ? COLORS.accent : "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      transform: `scale(${done ? 0.85 + 0.15 * pop : 1})`,
                      flex: "none",
                    }}
                  >
                    {done ? <CheckIcon size={15} stroke={2.6} /> : null}
                  </span>
                  <span style={{ position: "relative", fontSize: 15.5, fontWeight: 500, color: done ? COLORS.muted : COLORS.ink }}>
                    {t}
                    <span style={{ position: "absolute", left: 0, top: "52%", height: 2, width: `${strike * 100}%`, background: COLORS.muted, borderRadius: 1 }} />
                  </span>
                  {i === 0 ? (
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: COLORS.accent, background: "rgba(10,132,255,0.1)", padding: "2px 8px", borderRadius: 999 }}>
                      25 min
                    </span>
                  ) : null}
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 6px 2px", fontSize: 12, color: COLORS.muted }}>
              <span>{frame >= TICKS[2] ? "3 of 3 done" : frame >= TICKS[1] ? "2 of 3 done" : frame >= TICKS[0] ? "1 of 3 done" : "3 for today"}</span>
              <span style={{ color: COLORS.ink, fontWeight: 600 }}>{Math.round(47 * ramp(frame, TASKS_AT, TICKS[2] + 8))} min focused</span>
            </div>
          </div>
        </Window>
      </Place>

      <DesignLayer>
        <Cursor
          size={26}
          stops={
            portrait
              ? [
                  { at: 8, x: 760, y: 520 },
                  { at: FOCUS_CLICK - 10, x: 606, y: 242, click: true },
                  { at: START_CLICK - 12, x: 540, y: 620, click: true },
                ]
              : [
                  { at: 8, x: 1180, y: 330 },
                  { at: FOCUS_CLICK - 10, x: 1034, y: 98, click: true },
                  { at: START_CLICK - 12, x: 960, y: 452, click: true },
                ]
          }
          hideAfter={START_AT + 6}
        />
      </DesignLayer>

      <Stamp word="focus" tool="focus" hold={22} center={portrait ? undefined : [960, 640]} />
    </>
  );
}
