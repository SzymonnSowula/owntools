import { isTauri } from "@core/env";
import { logError, logInfo } from "@core/errors";
import { notify } from "@feature-focus/lib/notify";
import { adaptPost } from "./adapt";
import { networksMirror } from "./networks";
import { missedPosts, startScheduler, tick } from "./scheduler";
import { PATHS } from "./storage";
import { SOCIAL_CHANGED_EVENT, useSocialStore } from "./store";

/** Rust asks the window (the one with the language model) for per-network variants; the window answers. */
export const ADAPT_REQUEST_EVENT = "social-adapt-request";
export const ADAPT_RESPONSE_EVENT = "social-adapt-response";

interface ChangedPayload {
  source?: string;
  kind?: string;
  id?: string;
  action?: string;
  /** Set by Rust when the write left a post waiting for review. */
  needsReview?: boolean;
}

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
    void mirrorCatalogue();
    if (isTauri()) {
      try {
        const { listen, emit } = await import("@tauri-apps/api/event");
        let pending: ReturnType<typeof setTimeout> | null = null;
        let reviewPending = false;
        await listen<ChangedPayload>(SOCIAL_CHANGED_EVENT, (event) => {
          if (pending) clearTimeout(pending);
          if (event.payload?.needsReview && event.payload.action === "create") reviewPending = true;
          pending = setTimeout(() => {
            pending = null;
            const announceReview = reviewPending;
            reviewPending = false;
            void useSocialStore
              .getState()
              .reload()
              .then(() => {
                if (announceReview) announceReviewQueue();
                return tick();
              });
          }, 150);
        });
        // The MCP server runs inside this app but the language model is only
        // reachable from the window: `adapt_post` asks here and waits.
        await listen<{ id: string; text?: string; channelIds?: string[] }>(ADAPT_REQUEST_EVENT, (event) => {
          const { id, text = "", channelIds = [] } = event.payload ?? { id: "" };
          if (!id) return;
          const { channels, voice } = useSocialStore.getState();
          void adaptPost(text, channelIds, channels, voice)
            .then((out) => emit(ADAPT_RESPONSE_EVENT, { id, variants: out.variants, model: out.model }))
            .catch((err) => {
              logError("social", "adapt relay", err);
              return emit(ADAPT_RESPONSE_EVENT, { id, unavailable: true });
            });
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

/** An agent queued something: say so, in the app and on the desktop. */
function announceReviewQueue(): void {
  const state = useSocialStore.getState();
  const waiting = state.posts.filter((p) => p.status === "needs_review").length;
  if (!waiting) return;
  const title = waiting === 1 ? "An agent queued a post" : `${waiting} posts wait for your approval`;
  state.toast({ kind: "info", title, body: "Nothing publishes until you approve it in social → Review." });
  if (state.settings.notifications) void notify(title, "Approve, edit or reject it in owntools → social → Review.");
}

/**
 * Keeps `networks.json` next to the other social files in step with
 * `networks.ts`, so the agent server can answer questions about limits
 * without a second copy of the catalogue in Rust. Rewritten only when it
 * actually differs — this runs on every app start.
 */
async function mirrorCatalogue(): Promise<void> {
  try {
    const { storage } = useSocialStore.getState();
    const next = JSON.stringify(networksMirror(), null, 2);
    if ((await storage.readText(PATHS.networks)) === next) return;
    await storage.writeText(PATHS.networks, next);
  } catch (err) {
    logError("social", "mirror networks.json", err);
  }
}
