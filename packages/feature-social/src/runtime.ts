import { isTauri } from "@core/env";
import { logError, logInfo } from "@core/errors";
import { notify } from "@feature-focus/lib/notify";
import { missedPosts, startScheduler, tick } from "./scheduler";
import { SOCIAL_CHANGED_EVENT, useSocialStore } from "./store";

/**
 * Boots the social runtime once per app session: loads the store, starts the
 * 30-second runner, follows the Rust server's `social-changed` events (an
 * agent created or edited a post) and announces posts missed while the app
 * was closed. App.tsx calls this on start so scheduling works from the tray,
 * whether or not the social tool is open.
 */

let started: Promise<void> | null = null;

export function startSocialRuntime(): Promise<void> {
  if (started) return started;
  started = (async () => {
    const store = useSocialStore.getState();
    await store.load();
    const missed = missedPosts(useSocialStore.getState().posts, new Date(), useSocialStore.getState().settings.lateToleranceMinutes);
    if (missed.length) {
      useSocialStore.getState().setCatchUp(missed);
      logInfo("social", `${missed.length} post(s) missed while closed`);
      if (useSocialStore.getState().settings.notifications) {
        void notify(
          `${missed.length} post${missed.length === 1 ? "" : "s"} missed`,
          "Open social to publish, move or skip them.",
        );
      }
    }
    startScheduler();
    if (isTauri()) {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        let pending: ReturnType<typeof setTimeout> | null = null;
        await listen<{ source?: string; kind?: string; id?: string; action?: string }>(SOCIAL_CHANGED_EVENT, (event) => {
          if (pending) clearTimeout(pending);
          pending = setTimeout(() => {
            pending = null;
            void useSocialStore
              .getState()
              .reload()
              .then(() => {
                if (event.payload?.action === "publish") return tick();
                return tick();
              });
          }, 150);
        });
      } catch (err) {
        logError("social", "listen social-changed", err);
      }
    }
  })().catch((err) => {
    logError("social", "runtime start", err);
    started = null;
  });
  return started;
}
