/**
 * A workspace is a *session*: switching to it can open the apps, links,
 * folders and terminals you work in, land you on a module and start a timer.
 * This module is the runner — the Rust side does the actual spawning.
 */
import { isTauri } from "@core/env";
import { useAppStore } from "@feature-focus/store/useAppStore";
import type { RitualStep, WorkspaceRitual } from "@feature-focus/store/persist";
import { useShellStore } from "./shellStore";

export interface StepOutcome {
  id: string;
  ok: boolean;
  error?: string | null;
}

/** Steps that are switched on and actually point somewhere. */
export function activeSteps(ritual: WorkspaceRitual): RitualStep[] {
  return ritual.steps.filter((s) => s.enabled && s.target.trim().length > 0);
}

/** True when starting this workspace does anything at all. */
export function ritualIsEmpty(ritual: WorkspaceRitual): boolean {
  return (
    activeSteps(ritual).length === 0 &&
    ritual.timerMinutes == null &&
    ritual.openTool == null &&
    ritual.scrollGuard == null
  );
}

export const STEP_LABEL: Record<RitualStep["kind"], string> = {
  app: "app",
  url: "link",
  folder: "folder",
  terminal: "terminal",
};

/** Hand the steps to the backend; never throws, failures come back per step. */
export async function launchSteps(steps: RitualStep[]): Promise<StepOutcome[]> {
  if (steps.length === 0) return [];
  if (!isTauri()) {
    return steps.map((s) => ({ id: s.id, ok: false, error: "desktop app only" }));
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<StepOutcome[]>("launch_session", {
      steps: steps.map((s) => ({
        id: s.id,
        kind: s.kind,
        target: s.target.trim(),
        args: s.args?.trim() || null,
        cwd: s.cwd?.trim() || null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return steps.map((s) => ({ id: s.id, ok: false, error: message }));
  }
}

/** The in-app half of a session: guard, timer, module. */
export function applyRitualInApp(ritual: WorkspaceRitual, sessionName: string) {
  const store = useAppStore.getState();

  if (ritual.scrollGuard !== null) {
    store.setScrollGuard({ enabled: ritual.scrollGuard });
  }

  if (ritual.timerMinutes != null && ritual.timerMinutes > 0) {
    store.setCustomMinutes(ritual.timerMinutes);
    store.setSessionName(sessionName);
    useAppStore.getState().startTimer();
  }

  if (ritual.openTool) {
    const shell = useShellStore.getState();
    shell.setTool(ritual.openTool);
    if (ritual.openTool === "focus") shell.setFocusOverview(false);
  }
}

/** Does this path still exist? Used by the editor to flag broken steps. */
export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri() || !path.trim()) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("path_exists", { path });
  } catch {
    return true;
  }
}
