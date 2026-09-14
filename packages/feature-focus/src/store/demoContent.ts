import type { AppData } from "../types";

/**
 * The demo content older builds seeded into a first workspace - once in
 * Polish (before 2026-08-31's translation) and then in English - taken back
 * out of existing data. seed.ts no longer creates any of it.
 *
 * Matching is deliberately narrow, so nothing a person wrote is touched: a
 * task, note or plan block goes only when its text is exactly one of the
 * seeded strings (and a plan block only at its seeded times too); habits,
 * whose names are ordinary words, go only when the whole seeded trio is
 * still there in one language. Runs once, for data saved before version 3.
 */

const DEMO_TASKS = new Set([
  "Dokończyć plan tygodnia i wybrać jedno MIT",
  "90 minut głębokiej pracy bez skrzynki",
  "Odpisać na dwa odłożone wątki",
  "Przygotować notatki do przeglądu piątkowego",
  "Finish the weekly plan and pick one MIT",
  "90 minutes of deep work, inbox closed",
  "Reply to two postponed threads",
  "Prepare notes for the Friday review",
]);

const DEMO_NOTES = new Set([
  "Zasada dnia: jedna rzecz, która jeśli zostanie zrobiona, uczyni resztę mniej ważną.",
  "Telefon w drugim pokoju. Szum deszczu. Timer 50/10. Po sesji — krótki spacer.",
  "Rule of the day: one thing that, once done, makes everything else matter less.",
  "Phone in the other room. Rain noise. 50/10 timer. After the session — a short walk.",
]);

const DEMO_HABIT_SETS = [
  ["Ruch", "Czytanie", "Woda"],
  ["Movement", "Reading", "Water"],
];

/** title → "start-end", as seeded. */
const DEMO_PLAN = new Map([
  ["Rozruch i MIT", "08:30-09:00"],
  ["Głęboka praca", "09:00-11:00"],
  ["Skrzynka i administracja", "14:00-14:50"],
  ["Warm-up and MIT", "08:30-09:00"],
  ["Deep work", "09:00-11:00"],
  ["Inbox and admin", "14:00-14:50"],
]);

/** Built-in list names and the session name the Polish seed saved. */
const POLISH_LIST_NAMES: Record<string, string> = { Skrzynka: "Inbox", "Dziś": "Today", "Później": "Later" };
const POLISH_SESSION_NAME = "Głęboka praca";

export function stripDemoContent(data: AppData): AppData {
  const out: AppData = { ...data };

  if (Array.isArray(data.tasks)) {
    const removed = new Set(data.tasks.filter((t) => DEMO_TASKS.has(t.title)).map((t) => t.id));
    out.tasks = data.tasks.filter((t) => !removed.has(t.id));
    // a guard armed on a demo task would otherwise wait forever on a task that is gone
    if (data.settings?.scrollGuardTaskId && removed.has(data.settings.scrollGuardTaskId)) {
      out.settings = { ...data.settings, scrollGuardTaskId: null, scrollGuardEnabled: false };
    }
  }

  if (Array.isArray(data.notes)) {
    out.notes = data.notes.filter((n) => !DEMO_NOTES.has(n.content));
  }

  if (Array.isArray(data.habits)) {
    let habits = data.habits;
    for (const set of DEMO_HABIT_SETS) {
      if (set.every((name) => habits.some((h) => h.name === name))) {
        habits = habits.filter((h) => !set.includes(h.name));
      }
    }
    out.habits = habits;
  }

  if (Array.isArray(data.planner)) {
    out.planner = data.planner.filter((b) => DEMO_PLAN.get(b.title) !== `${b.start}-${b.end}`);
  }

  if (Array.isArray(data.lists)) {
    out.lists = data.lists.map((list) =>
      list.builtin && POLISH_LIST_NAMES[list.name] ? { ...list, name: POLISH_LIST_NAMES[list.name] } : list,
    );
  }

  if (data.timer?.sessionName === POLISH_SESSION_NAME) {
    out.timer = { ...data.timer, sessionName: "Deep work" };
  }

  return out;
}
