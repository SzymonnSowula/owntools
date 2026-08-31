import type { ReactElement } from "react";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { SUITE_NAME } from "@core/branding";
import { openRecorderOverlay } from "@core/recorderWindow";
import { useAppStore as useFocusStore } from "@feature-focus/store/useAppStore";
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
    color: "#0a84ff",
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
    color: "#0a84ff",
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
    color: "#0a84ff",
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
    color: "#0a84ff",
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

/* Tiny 12x12 glyphs for the quick-tool traffic lights, same style as ToolIcons. */
const QUICK_ICONS = {
  /* text lines */
  transcribe: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 3h8M2 6h8M2 9h5" />
    </svg>
  ),
  /* globe */
  translate: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="4.6" />
      <path d="M1.4 6h9.2M6 1.4c-2.6 2.8-2.6 6.4 0 9.2 2.6-2.8 2.6-6.4 0-9.2z" />
    </svg>
  ),
  /* music note */
  extract: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.6 9.4V2.8l5-1v6.6" />
      <circle cx="3.2" cy="9.4" r="1.4" />
      <circle cx="8.2" cy="8.4" r="1.4" />
    </svg>
  ),
} as const;

interface QuickTool {
  key: string;
  window: string;
  name: string;
  desc: string;
  dots: ReactElement;
  icon: ReactElement;
  tilt: number;
}

const QUICK_TOOLS: QuickTool[] = [
  {
    key: "transcribe",
    window: "transcribe.tool",
    name: "Transcribe a file",
    desc: "Audio or video → text & .srt",
    dots: QUICK_ICONS.transcribe,
    tilt: -0.5,
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3.5 5h13M3.5 10h13M3.5 15h8" />
      </svg>
    ),
  },
  {
    key: "translate",
    window: "translate.tool",
    name: "Translate to English",
    desc: "Any speech → English text",
    dots: QUICK_ICONS.translate,
    tilt: 0.5,
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M2.5 10h15M10 2.5c-4.2 4.5-4.2 10.5 0 15 4.2-4.5 4.2-10.5 0-15z" />
      </svg>
    ),
  },
  {
    key: "extract",
    window: "extract.tool",
    name: "Video → audio",
    desc: "Keep the track, leave the video",
    dots: QUICK_ICONS.extract,
    tilt: -0.5,
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M7.5 15.5V4.8l8.5-1.6v10.6" />
        <circle cx="5.3" cy="15.5" r="2.2" />
        <circle cx="13.8" cy="13.8" r="2.2" />
      </svg>
    ),
  },
  {
    key: "voicenote",
    window: "voicenote.tool",
    name: "Voice note",
    desc: "Speak, get a note in Focus",
    dots: ToolIcons.dictate,
    tilt: 0.5,
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="7.2" y="2.8" width="5.6" height="9" rx="2.8" />
        <path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5" />
      </svg>
    ),
  },
];

export function Hub() {
  const setTool = useShellStore((s) => s.setTool);
  const setFocusOverview = useShellStore((s) => s.setFocusOverview);
  const setHubTool = useShellStore((s) => s.setHubTool);

  function runQuickTool(key: string) {
    if (key === "voicenote") {
      setTool("focus");
      setFocusOverview(false);
      useFocusStore.getState().setView("notes");
      return;
    }
    setHubTool(key as "transcribe" | "translate" | "extract");
  }

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

      <div className="hub-tools-label">quick tools</div>
      <div className="hub-tools">
        {QUICK_TOOLS.map((tool) => (
          <button
            key={tool.key}
            className="wincard"
            style={{ transform: `rotate(${tool.tilt}deg)` }}
            onClick={() => runQuickTool(tool.key)}
          >
            <div className="wincard-bar">
              <WinDots icon={tool.dots} />
              <span className="wincard-title">{tool.window}</span>
            </div>
            <div className="wincard-body hub-tool-body">
              <div className="hub-tool-icon">{tool.icon}</div>
              <div>
                <div className="hub-tool-name">{tool.name}</div>
                <div className="hub-tool-desc">{tool.desc}</div>
              </div>
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
