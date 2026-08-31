import type { ReactElement } from "react";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { SUITE_NAME } from "@core/branding";
import { openRecorderOverlay } from "@core/recorderWindow";
import { useShellStore, type Tool } from "./shellStore";

interface ToolCard {
  tool: Tool;
  window: string;
  name: string;
  desc: string;
  color: string;
  icon: ReactElement;
  dots: ReactElement;
  tilt: number;
}

const CARDS: ToolCard[] = [
  {
    tool: "focus",
    window: "focus.app",
    name: "focus",
    desc: "Deep-work desktop: timer, tasks, notebook, habits and a time heatmap.",
    color: "#111111",
    tilt: -1.1,
    dots: ToolIcons.focus,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v4l2.6 1.6" />
      </svg>
    ),
  },
  {
    tool: "create",
    window: "screeni.app",
    name: "screeni",
    desc: "Screen recordings that follow your cursor. Edit, zoom, export MP4.",
    color: "#0e9a8a",
    tilt: 1.2,
    dots: ToolIcons.video,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="4" width="15" height="10.5" rx="2" />
        <path d="M8 8l4 2.2L8 12.4V8z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    tool: "launch",
    window: "launch.app",
    name: "launch",
    desc: "Paste a URL, get a product launch video. Templates rendered on-device.",
    color: "#6b5bff",
    tilt: -0.9,
    dots: ToolIcons.launch,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M10 14.5c4.5-2 6-6.5 6-10.5-4 0-8.5 1.5-10.5 6L3 12.5l4.5 4.5 2.5-2.5z" />
        <circle cx="12" cy="8" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    tool: "dictate",
    window: "dictate.app",
    name: "dictate",
    desc: "Hold a hotkey, speak, release — on-device Whisper types for you anywhere.",
    color: "#ff715f",
    tilt: 0.8,
    dots: ToolIcons.dictate,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="7.2" y="2.8" width="5.6" height="9" rx="2.8" />
        <path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5" />
      </svg>
    ),
  },
];

export function Hub() {
  const setTool = useShellStore((s) => s.setTool);
  const setFocusOverview = useShellStore((s) => s.setFocusOverview);

  return (
    <div className="hub desktop-bg">
      <div className="hub-word">{SUITE_NAME}</div>
      <div className="hub-tagline">your local-first studio. everything stays on your device.</div>

      <div className="hub-grid">
        {CARDS.map((card) => (
          <button
            key={card.tool}
            className="wincard"
            style={{ transform: `rotate(${card.tilt}deg)` }}
            onClick={() => {
              if (card.tool === "focus") setFocusOverview(true);
              setTool(card.tool);
            }}
          >
            <div className="wincard-bar">
              <WinDots icon={card.dots} />
              <span className="wincard-title">{card.window}</span>
            </div>
            <div className="wincard-body">
              <div className="hub-card-icon" style={{ background: card.color }}>
                {card.icon}
              </div>
              <div className="hub-card-name">{card.name}</div>
              <div className="hub-card-desc">{card.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <button className="btn primary" style={{ marginTop: 34 }} onClick={() => void openRecorderOverlay()}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: "#ff5f57", display: "inline-block", marginRight: 8 }} />
        record screen now
      </button>

      <div className="hub-foot">no accounts · no cloud · your files, your machine</div>
    </div>
  );
}
