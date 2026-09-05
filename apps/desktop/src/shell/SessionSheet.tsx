import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@feature-focus/store/useAppStore";
import { ritualOf } from "@feature-focus/store/persist";
import { useShellStore } from "./shellStore";
import {
  activeSteps,
  applyRitualInApp,
  launchSteps,
  ritualIsEmpty,
  STEP_LABEL,
  type StepOutcome,
} from "./ritual";

const TOOL_LABEL: Record<string, string> = {
  hub: "the hub",
  focus: "focus",
  create: "screeni",
  launch: "launch",
  dictate: "dictate",
};

type Phase = "idle" | "running" | "done";

/**
 * The sheet you get when a workspace with a ritual is activated: what is about
 * to open, and one button to make it happen.
 */
export function SessionSheet() {
  const sessionFor = useShellStore((s) => s.sessionFor);
  const sessionAuto = useShellStore((s) => s.sessionAuto);
  const close = useShellStore((s) => s.closeSession);
  const openSetup = useShellStore((s) => s.openSetup);
  const workspaces = useAppStore((s) => s.workspaces);

  const ws = workspaces.find((w) => w.id === sessionFor);
  const ritual = ritualOf(ws);
  const steps = activeSteps(ritual);

  const [phase, setPhase] = useState<Phase>("idle");
  const [outcomes, setOutcomes] = useState<Record<string, StepOutcome>>({});
  const startedRef = useRef(false);

  // Reads the workspace fresh, so editing the ritual and starting it in the
  // same breath launches what you just saved.
  const start = useCallback(async () => {
    const id = useShellStore.getState().sessionFor;
    if (!id || startedRef.current) return;
    const current = useAppStore.getState().workspaces.find((w) => w.id === id);
    if (!current) return;
    const plan = ritualOf(current);
    startedRef.current = true;
    setPhase("running");
    // Previewing another workspace's session: load its data first, otherwise
    // the timer and the guard would land on the workspace you're sitting in.
    if (useAppStore.getState().workspaceId !== id) {
      await useAppStore.getState().switchWorkspace(id);
    }
    applyRitualInApp(plan, current.name);
    const results = await launchSteps(activeSteps(plan));
    const byId: Record<string, StepOutcome> = {};
    for (const r of results) byId[r.id] = r;
    setOutcomes(byId);
    setPhase("done");
    if (results.every((r) => r.ok)) {
      window.setTimeout(() => useShellStore.getState().closeSession(), 900);
    }
  }, []);

  useEffect(() => {
    startedRef.current = false;
    setPhase("idle");
    setOutcomes({});
  }, [sessionFor]);

  useEffect(() => {
    if (!sessionFor || !sessionAuto) return;
    const current = useAppStore.getState().workspaces.find((w) => w.id === sessionFor);
    if (current && !ritualIsEmpty(ritualOf(current))) void start();
  }, [sessionFor, sessionAuto, start]);

  useEffect(() => {
    if (!sessionFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Enter" && phase === "idle") void start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionFor, phase, close, start]);

  if (!sessionFor || !ws) return null;

  const empty = ritualIsEmpty(ritual);

  return (
    <div className="ses" role="dialog" aria-label={`${ws.name} session`}>
      <div className="ses-card wincard">
        <div className="wincard-bar">
          <span className="wincard-dot r" />
          <span className="wincard-dot y" />
          <span className="wincard-dot g" />
          <span className="wincard-title">
            {ws.name.toLowerCase().replace(/\s+/g, "-")}.session
          </span>
        </div>

        <div className="ses-body">
          <div className="ses-head">
            <span className="ses-emoji" aria-hidden>
              {ws.emoji}
            </span>
            <div>
              <div className="ses-name">{ws.name}</div>
              <div className="ses-sub">
                {empty
                  ? "nothing set up yet — this workspace only swaps your data"
                  : `${steps.length} thing${steps.length === 1 ? "" : "s"} to open`}
              </div>
            </div>
          </div>

          {steps.length ? (
            <ul className="ses-steps">
              {steps.map((step) => {
                const outcome = outcomes[step.id];
                const status = outcome ? (outcome.ok ? "ok" : "fail") : phase;
                return (
                  <li key={step.id} className={`ses-step ${status}`}>
                    <span className="ses-dot" aria-hidden />
                    <span className="ses-step-label">{step.label || step.target}</span>
                    <span className="ses-kind">{STEP_LABEL[step.kind]}</span>
                    {outcome && !outcome.ok ? (
                      <span className="ses-error" title={outcome.error ?? ""}>
                        {outcome.error}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {ritual.timerMinutes || ritual.openTool || ritual.scrollGuard !== null ? (
            <div className="ses-extras">
              {ritual.timerMinutes ? (
                <span className="ses-extra">⏱ {ritual.timerMinutes} min focus timer</span>
              ) : null}
              {ritual.openTool ? (
                <span className="ses-extra">→ opens {TOOL_LABEL[ritual.openTool]}</span>
              ) : null}
              {ritual.scrollGuard !== null ? (
                <span className="ses-extra">
                  🛡 scroll guard {ritual.scrollGuard ? "on" : "off"}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="ses-actions">
            <button
              className="btn primary"
              disabled={empty || phase === "running"}
              onClick={() => void start()}
            >
              {phase === "running"
                ? "starting…"
                : phase === "done"
                  ? "started"
                  : "start session"}
            </button>
            <button className="btn" onClick={close}>
              {phase === "done" ? "close" : "just switch"}
            </button>
            <button
              className="ses-link"
              onClick={() => {
                close();
                openSetup(ws.id);
              }}
            >
              set up…
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
