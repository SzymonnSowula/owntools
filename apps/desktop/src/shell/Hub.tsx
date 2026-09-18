import { WinDots } from "@ui/WinDots";
import { ToolMark, TOOL_TINT } from "@ui/ToolMark";
import { BrandMark } from "@ui/BrandMark";
import { SUITE_NAME } from "@core/branding";
import { openRecorderOverlay } from "@core/recorderWindow";
import { formatMs, todayIso } from "@feature-focus/lib/dates";
import { useAppStore as useFocusStore } from "@feature-focus/store/useAppStore";
import { ritualOf } from "@feature-focus/store/persist";
import { useShellStore } from "./shellStore";
import { TOOL_CARDS, openQuickTool } from "./toolCatalogue";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { activeSteps, ritualIsEmpty } from "./ritual";
import { QUICK_TOOLS } from "@feature-tools/catalogue";
import { isProTool } from "@licensing/plan";
import { useIsPro } from "@licensing/useLicense";

function greetingFor(hour: number): string {
  if (hour < 5) return "good night";
  if (hour < 12) return "good morning";
  if (hour < 18) return "good afternoon";
  return "good evening";
}

export function Hub() {
  const pro = useIsPro();
  const setTool = useShellStore((s) => s.setTool);
  const setFocusOverview = useShellStore((s) => s.setFocusOverview);
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
        {TOOL_CARDS.map((card) => (
          <button
            key={card.tool}
            className="hub-card"
            // The tint only colours the hover wash and the arrow; the mark
            // paints its own flat tile (see @ui/ToolMark).
            style={{ ["--tint" as string]: TOOL_TINT[card.mark] }}
            onClick={() => {
              if (card.tool === "focus") setFocusOverview(true);
              setTool(card.tool);
            }}
          >
            <div className="hub-card-top">
              <div className="hub-card-icon">
                <ToolMark tool={card.mark} size={52} />
              </div>
              <span className="hub-card-arrow" aria-hidden>
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8h9M8.5 4l4 4-4 4" />
                </svg>
              </span>
            </div>
            <div className="hub-card-name">
              {card.name}
              {!pro && isProTool(card.tool) ? <span className="hub-pro">pro</span> : null}
            </div>
            <div className="hub-card-desc">{card.desc}</div>
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
            onClick={() => openQuickTool(tool.key)}
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
