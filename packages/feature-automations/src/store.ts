/**
 * The reactive view of the engine's state. The engine (`engine.ts`) is the
 * only writer; the card reads it through the hook. Kept separate so the card
 * never has to know how a rule gets persisted or a run recorded.
 */

import { create } from "zustand";
import { dayKey, type Rule, type RunRecord } from "./rules";

export interface AutomationsState {
  loaded: boolean;
  rules: Rule[];
  runs: RunRecord[];
  /** Rule currently running, if any. */
  running: string | null;
  /** Runs waiting or in progress. */
  queued: number;
}

export const useAutomationsStore = create<AutomationsState>(() => ({
  loaded: false,
  rules: [],
  runs: [],
  running: null,
  queued: 0,
}));

export interface AutomationsSummary {
  enabled: number;
  total: number;
  ranToday: number;
  /** Something is running or waiting right now. */
  busy: boolean;
}

/** For a hub chip or a settings badge: how many rules are on and how many runs happened today. */
export function useAutomationsSummary(): AutomationsSummary {
  const rules = useAutomationsStore((s) => s.rules);
  const runs = useAutomationsStore((s) => s.runs);
  const queued = useAutomationsStore((s) => s.queued);
  const today = dayKey(new Date());
  return {
    enabled: rules.filter((r) => r.enabled).length,
    total: rules.length,
    ranToday: runs.filter((r) => dayKey(new Date(r.startedAt)) === today).length,
    busy: queued > 0,
  };
}
