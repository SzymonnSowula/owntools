import type { ReactElement } from "react";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { BrandMark } from "@ui/BrandMark";
import { SUITE_NAME } from "@core/branding";
import { openRecorderOverlay } from "@core/recorderWindow";
import { formatMs, todayIso } from "@feature-focus/lib/dates";
import { useAppStore as useFocusStore } from "@feature-focus/store/useAppStore";
import { ritualOf } from "@feature-focus/store/persist";
import { useShellStore, type Tool } from "./shellStore";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { activeSteps, ritualIsEmpty } from "./ritual";
import { QUICK_TOOLS } from "@feature-tools/catalogue";
import type { QuickToolKey } from "@feature-tools/keys";

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
    desc: "A quiet desk: timer, tasks, notebook, habits and a time heatmap.",
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
    desc: "Paste a URL, get a short video out of it. Rendered on-device.",
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
    desc: "Press Ctrl+Shift+Space, speak, press again — on-device Whisper types for you anywhere.",
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
  {
    tool: "board",
    window: "board.app",
    name: "board",
    desc: "An endless whiteboard: paste screenshots, sketch, think in boxes and arrows.",
    color: "#0a84ff",
    tilt: -0.7,
    dots: ToolIcons.board,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="3" width="8" height="6" rx="1.5" />
        <circle cx="14.5" cy="14" r="3" />
        <path d="M6.5 9v3a2 2 0 002 2h3" />
      </svg>
    ),
  },
  {
    tool: "disk",
    window: "disk.app",
    name: "disk",
    desc: "See where the space went: a treemap of every file, duplicates, quick wins, snapshots.",
    color: "#0a84ff",
    tilt: -0.8,
    dots: ToolIcons.disk,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" />
        <path d="M10.5 2.5v15M10.5 10.5h7M2.5 12.5h8" />
      </svg>
    ),
  },
  {
    tool: "social",
    window: "social.app",
    name: "social",
    desc: "Schedule posts to 30+ networks from a calendar. Agents can drive it over a local API.",
    color: "#0a84ff",
    tilt: 0.9,
    dots: ToolIcons.social,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="4" width="15" height="13" rx="2.5" />
        <path d="M2.5 8.5h15M6.5 2.5v3M13.5 2.5v3" />
        <circle cx="12.5" cy="13" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

function greetingFor(hour: number): string {
  if (hour < 5) return "good night";
  if (hour < 12) return "good morning";
  if (hour < 18) return "good afternoon";
  return "good evening";
}

export function Hub() {
  const setTool = useShellStore((s) => s.setTool);
  const setFocusOverview = useShellStore((s) => s.setFocusOverview);
  const setHubTool = useShellStore((s) => s.setHubTool);
  const tasks = useFocusStore((s) => s.tasks);
  const heatmap = useFocusStore((s) => s.heatmap);
  const timer = useFocusStore((s) => s.timer);
  const workspaces = useFocusStore((s) => s.workspaces);
  const workspaceId = useFocusStore((s) => s.workspaceId);
  const openSession = useShellStore((s) => s.openSession);
  const openSetup = useShellStore((s) => s.openSetup);

  const today = todayIso();
  const openToday = tasks.filter((t) => !t.done && (t.due === today || t.listId === "today")).length;
  const focusedMin = heatmap[today]?.minutes ?? 0;
  const midSession =
    timer.preset !== "stopwatch" && timer.remainingMs > 0 && timer.remainingMs < timer.durationMs;

  const activeWs = workspaces.find((w) => w.id === workspaceId);
  const ritual = ritualOf(activeWs);
  const stepCount = activeSteps(ritual).length;
  const hasRitual = !ritualIsEmpty(ritual);

  const now = new Date();
  const greeting = greetingFor(now.getHours());
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  function goFocus(view: "today" | "tasks" | "stats") {
    setTool("focus");
    setFocusOverview(false);
    useFocusStore.getState().setView(view);
  }

  function runQuickTool(key: QuickToolKey) {
    if (key === "voicenote") {
      setTool("focus");
      setFocusOverview(false);
      useFocusStore.getState().setView("notes");
      return;
    }
    setHubTool(key);
  }

  return (
    <div className="hub-wrap">
      <div className="hub-scenery" aria-hidden>
        <span className="scene-sky-a" />
        <span className="scene-sky-b" />
        <span className="scene-hill-a" />
        <span className="scene-hill-b" />
      </div>

      <div className="hub">
        <div className="hub-top">
          <WorkspaceSwitcher />
        </div>

        <div className="hub-brand">
          <BrandMark size={34} filled />
          <div className="hub-word">{SUITE_NAME}</div>
        </div>
        <div className="hub-greeting">
          {greeting} · {dateLabel}
        </div>

        <div className="hub-today">
          {hasRitual ? (
            <button
              className={`hub-chip${midSession ? "" : " primary"}`}
              onClick={() => openSession(workspaceId)}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                <path d="M3 2l7 4-7 4V2z" fill="currentColor" />
              </svg>
              start {(activeWs?.name ?? "this").toLowerCase()} session
              {stepCount ? ` · ${stepCount} app${stepCount === 1 ? "" : "s"}` : ""}
            </button>
          ) : (
            <button className="hub-chip" onClick={() => openSetup(workspaceId)}>
              set up this workspace
            </button>
          )}
          {midSession ? (
            <button
              className="hub-chip primary"
              onClick={() => {
                if (!timer.running) useFocusStore.getState().toggleTimer();
                goFocus("today");
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                <path d="M3 2l7 4-7 4V2z" fill="currentColor" />
              </svg>
              {timer.running ? "session running" : "resume session"} · {formatMs(timer.remainingMs)}
            </button>
          ) : null}
          <button className="hub-chip" onClick={() => goFocus("tasks")}>
            {openToday === 0 ? "nothing due today" : `${openToday} task${openToday === 1 ? "" : "s"} for today`}
          </button>
          <button className="hub-chip" onClick={() => goFocus("stats")}>
            {focusedMin} min focused today
          </button>
        </div>

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
    </div>
  );
}
