/**
 * dictate — 7 beats. Ctrl+Shift+Space, the pill listens, thirty words land in
 * an e-mail in bursts while you are still talking (the streaming engine's
 * look: settled words in ink, the chunk being decoded greyed), "send it"
 * presses Enter, the message is gone.
 */
import { useCurrentFrame } from "remotion";
import { caretOn, ease, ramp, spr, streamed } from "../lib/anim";
import { useVideoConfig } from "remotion";
import { COLORS, FONT_BODY } from "../theme";
import { MailGlyph, PaperclipIcon, SendIcon, CheckIcon } from "../ui/icons";
import { KeyCombo } from "../ui/Keycap";
import { useLayout } from "../ui/layout";
import { ListeningPill } from "../ui/Pill";
import { DesignLayer, Place } from "../ui/Stage";
import { Stamp } from "../ui/Stamp";
import { Window } from "../ui/Window";
import type { SceneProps } from "./index";

const SEGMENTS = [
  "Hi Michael,",
  "the new build is out.",
  "Screen recordings",
  "now follow the cursor,",
  "meeting notes",
  "write themselves,",
  "and nothing",
  "leaves your machine.",
  "Can you try it",
  "today?",
];

const KEYS_AT = 8;
const PRESS_AT = 26;
const KEYS_LEAVE = 30;
const PILL_AT = 40;
const STREAM_AT = 44;
const EVERY = 9;
const STREAM_DONE = STREAM_AT + SEGMENTS.length * EVERY; // 134
const SEND_AT = 146;
const WHOOSH_AT = 162;
const SENT_AT = 170;

export function Dictate(_: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const { settled, pending, done } = streamed(SEGMENTS, frame, STREAM_AT, EVERY);
  const listening = frame >= PILL_AT && frame < SEND_AT;
  const whoosh = ease.inCubic(ramp(frame, WHOOSH_AT, WHOOSH_AT + 10));
  const sentPop = spr({ frame, fps, at: SENT_AT, from: 0, to: 1, kind: "pop", durationInFrames: 18 });

  const win: [number, number] = portrait ? [540, 760] : [960, 490];
  const keys: [number, number] = portrait ? [540, 1480] : [960, 930];

  return (
    <>
      {/* On screen from frame 0: the first frame is the poster a feed shows. */}
      <Place x={win[0]} y={win[1]} at={0}>
        <Window title="mail — new message" icon={MailGlyph} width={720}>
          <div style={{ padding: "10px 18px 0", overflow: "hidden" }}>
            <div
              style={{
                transform: `translateY(${-whoosh * 120}%) scale(${1 - whoosh * 0.06})`,
                opacity: 1 - whoosh,
              }}
            >
              <Field label="To">
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 10px 3px 4px",
                    borderRadius: 999,
                    background: COLORS.paper,
                    border: `1px solid ${COLORS.line}`,
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  <span style={{ width: 18, height: 18, borderRadius: 999, background: "linear-gradient(135deg, #5e5ce6, #32ade6)" }} />
                  Michael Smith
                </span>
              </Field>
              <Field label="Subject">
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>the new build</span>
              </Field>
              <div style={{ minHeight: 168, padding: "14px 0 12px", fontSize: 16, lineHeight: 1.55, color: COLORS.ink, fontFamily: FONT_BODY }}>
                {settled}
                {pending ? <span style={{ color: "rgba(29,29,31,0.38)" }}> {pending}</span> : null}
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 19,
                    marginLeft: 2,
                    verticalAlign: "-4px",
                    background: COLORS.accent,
                    opacity: listening || caretOn(frame) ? 1 : 0,
                  }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 14px", borderTop: `1px solid ${COLORS.line}` }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    height: 32,
                    padding: "0 14px",
                    borderRadius: 999,
                    background: frame >= SEND_AT + 8 && frame < WHOOSH_AT ? COLORS.accent2 : COLORS.accent,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    transform: frame >= SEND_AT + 8 && frame < WHOOSH_AT ? "scale(0.96)" : undefined,
                  }}
                >
                  <SendIcon />
                  Send
                </span>
                <span style={{ color: COLORS.muted, display: "inline-flex" }}>
                  <PaperclipIcon />
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: COLORS.muted }}>
                  {done ? `${countWords(settled)} words` : listening ? "typing while you speak" : ""}
                </span>
              </div>
            </div>
            {frame >= SENT_AT ? (
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: `translate(-50%, -50%) scale(${0.7 + 0.3 * sentPop})`,
                  opacity: sentPop,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  borderRadius: 999,
                  background: COLORS.ink,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ display: "inline-flex", width: 20, height: 20, borderRadius: 999, background: COLORS.green, color: "#fff", alignItems: "center", justifyContent: "center" }}>
                  <CheckIcon size={13} />
                </span>
                Sent · {countWords(SEGMENTS.join(" "))} words · 0.7 s after you stopped
              </div>
            ) : null}
          </div>
        </Window>
      </Place>

      <DesignLayer>
        <div style={{ position: "absolute", left: keys[0], top: keys[1], transform: "translate(-50%, -50%)" }}>
          <KeyCombo keys={["ctrl", "shift", "space"]} at={KEYS_AT} pressAt={PRESS_AT} leaveAt={KEYS_LEAVE} size={portrait ? 80 : 88} />
        </div>
      </DesignLayer>

      <Place x={keys[0]} y={keys[1]} at={PILL_AT} from="scale" kind="pop" leaveAt={WHOOSH_AT + 8}>
        <ListeningPill state={frame < SEND_AT ? "listening" : frame < WHOOSH_AT ? "sending" : "done"} since={PILL_AT} />
      </Place>

      <Stamp word="dictate" tool="dictate" hold={22} />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: `1px solid ${COLORS.line}` }}>
      <span style={{ width: 58, fontSize: 12, color: COLORS.muted }}>{label}</span>
      {children}
    </div>
  );
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
