import { HANDOFF_EVENT, takeHandoff } from "@core/handoff";
import { useAppStore } from "./store/useAppStore";

/**
 * focus's side of `@core/handoff`: another tool (meet's action items, an
 * automation) hands over `items` and they become tasks in the inbox; `text`
 * becomes a note. Installed once at start-up (App.tsx), not mounted with a
 * view, because the handoff arrives before focus is shown — the shell
 * switches to it on the same event.
 */
export function startFocusHandoff(): () => void {
  if (typeof window === "undefined") return () => {};

  const apply = () => {
    const item = takeHandoff("focus");
    if (!item) return;
    const run = () => {
      const { addTask, addNote } = useAppStore.getState();
      const items = (item.items ?? []).map((t) => t.trim()).filter(Boolean);
      // The store is newest-first: add in reverse so the list reads in order.
      for (const text of [...items].reverse()) addTask(text, "inbox");
      const text = item.text?.trim();
      if (text) addNote(item.title ? `${item.title}\n\n${text}` : text);
    };
    // A handoff right after a cold start can land before the workspace is
    // hydrated; adding then would be overwritten by the load.
    if (useAppStore.getState().ready) {
      run();
      return;
    }
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.ready) {
        unsubscribe();
        run();
      }
    });
  };

  const handler = (e: Event) => {
    if ((e as CustomEvent<{ tool?: string }>).detail?.tool === "focus") apply();
  };
  window.addEventListener(HANDOFF_EVENT, handler);
  apply();
  return () => window.removeEventListener(HANDOFF_EVENT, handler);
}
