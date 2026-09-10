import type { ReactElement } from "react";
import { DICTATION_HOTKEY_LABEL } from "@core/hotkeys";
import { WinDots, ToolIcons } from "@ui/WinDots";
import { ToolMark, TOOL_TINT, type ToolMarkName } from "@ui/ToolMark";
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
  /** Which app mark the tile paints (`@ui/ToolMark`). */
  mark: ToolMarkName;
  dots: ReactElement;
  tilt: number;
}

const CARDS: ToolCard[] = [
  {
    tool: "focus",
    window: "focus.app",
    name: "focus",
    desc: "A quiet desk: timer, tasks, notebook, habits and a time heatmap.",
    tilt: -1.1,
    mark: "focus",
    dots: ToolIcons.focus,
  },
  {
    tool: "create",
    window: "screeni.app",
    name: "screeni",
    desc: "Screen recordings that follow your cursor. Edit, zoom, export MP4.",
    tilt: 1.2,
    mark: "screeni",
    dots: ToolIcons.video,
  },
  {
    tool: "launch",
    window: "launch.app",
    name: "launch",
    desc: "Paste a URL, get a short video out of it. Rendered on-device.",
    tilt: -0.9,
    mark: "launch",
    dots: ToolIcons.launch,
  },
  {
    tool: "dictate",
    window: "dictate.app",
    name: "dictate",
    desc: `Press ${DICTATION_HOTKEY_LABEL}, speak, press again — an on-device model types for you anywhere.`,
    tilt: 0.8,
    mark: "dictate",
    dots: ToolIcons.dictate,
  },
  {
    tool: "board",
    window: "board.app",
    name: "board",
    desc: "An endless whiteboard: paste screenshots, sketch, think in boxes and arrows.",
    tilt: -0.7,
    mark: "board",
    dots: ToolIcons.board,
  },
  {
    tool: "disk",
    window: "disk.app",
    name: "disk",
    desc: "See where the space went: a treemap of every file, duplicates, quick wins, snapshots.",
    tilt: -0.8,
    mark: "disk",
    dots: ToolIcons.disk,
  },
  {
    tool: "social",
    window: "social.app",
    name: "social",
    desc: "Schedule posts to 30+ networks from a calendar. Agents can drive it over a local API.",
    tilt: 0.9,
    mark: "social",
    dots: ToolIcons.social,
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
              <div
                className="hub-card-icon"
                // The tile paints itself; the wrapper only casts its shadow, in the
                // tool's own colour rather than one blue for all seven.
                style={{ boxShadow: `0 7px 18px -4px ${TOOL_TINT[card.mark]}66` }}
              >
                <ToolMark tool={card.mark} size={38} />
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
