import "./social.css";
import { BarChart3, Bot, Calendar, Image as ImageIcon, Plug, Settings, ShieldCheck } from "lucide-react";
import { useEffect, type ReactElement } from "react";
import { isTauri } from "@core/env";
import { onHandoff, takeHandoff } from "@core/handoff";
import { AgentsPage } from "./components/AgentsPage";
import { AnalyticsPage } from "./components/AnalyticsPage";
import { CatchUpSheet } from "./components/CatchUpSheet";
import { MediaPage } from "./components/MediaPage";
import { ReviewPage } from "./components/ReviewPage";
import { SettingsPage } from "./components/SettingsPage";
import { Toasts } from "./components/Toasts";
import { CalendarPage } from "./components/calendar/CalendarPage";
import { AddChannelDialog } from "./components/channels/AddChannelDialog";
import { ChannelsPage } from "./components/channels/ChannelsPage";
import { PostModal } from "./components/composer/PostModal";
import { Tip, TooltipProvider } from "./components/primitives";
import { startSocialRuntime } from "./runtime";
import { loadSampleData } from "./sample";
import { useSocialStore } from "./store";
import { nextDefaultSlot, toIso } from "./time";
import { useUi, type Page } from "./ui";
import { addDays, addMonths } from "date-fns";

/**
 * social — a local-first scheduler: channels, a calendar, a composer with
 * per-network previews, a runner that publishes from the tray, and a local
 * API so agents can drive it. This file is the shell: the rail, the pages,
 * the layers (composer, add-channel, catch-up, toasts) and the shortcuts.
 */

const RAIL: { id: Page; label: string; icon: ReactElement }[] = [
  { id: "calendar", label: "Calendar", icon: <Calendar /> },
  { id: "review", label: "Review", icon: <ShieldCheck /> },
  { id: "channels", label: "Channels", icon: <Plug /> },
  { id: "media", label: "Media", icon: <ImageIcon /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 /> },
  { id: "agents", label: "Agents", icon: <Bot /> },
  { id: "settings", label: "Settings", icon: <Settings /> },
];

function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable));
}

export default function SocialView() {
  const ready = useSocialStore((s) => s.ready);
  const loadError = useSocialStore((s) => s.loadError);
  const channels = useSocialStore((s) => s.channels);
  const posts = useSocialStore((s) => s.posts);
  const failed = useSocialStore((s) => s.posts.filter((p) => p.status === "failed").length);
  const review = useSocialStore((s) => s.posts.filter((p) => p.status === "needs_review").length);
  const catchUp = useSocialStore((s) => s.catchUp.length);
  const page = useUi((s) => s.page);
  const setPage = useUi((s) => s.setPage);
  const view = useUi((s) => s.view);
  const anchor = useUi((s) => s.anchor);
  const setAnchor = useUi((s) => s.setAnchor);
  const openComposer = useUi((s) => s.openComposer);
  const composerOpen = useUi((s) => s.composer.open);

  useEffect(() => {
    void startSocialRuntime();
  }, []);

  // Something handed over from another tool — today that is a finished
  // recording from screeni. It lands in the media library and opens the
  // composer with the clip already attached.
  useEffect(() => {
    const take = () => {
      const item = takeHandoff("social");
      if (!item?.file) return;
      void (async () => {
        try {
          // The store may still be loading when a handoff lands right after a
          // cold start; the runtime promise is already deduplicated.
          await startSocialRuntime();
          const added = await useSocialStore.getState().addMedia(item.file!);
          openComposer(null, {
            content: { text: item.text ?? "", media: [{ id: added.id }], thread: [] },
            scheduledAt: toIso(nextDefaultSlot()),
          });
          useSocialStore.getState().toast({
            kind: "success",
            title: `${item.file!.name} is ready to post`,
            body: item.from ? `Handed over from ${item.from}.` : undefined,
          });
        } catch (err) {
          useSocialStore.getState().toast({ kind: "error", title: "Could not take that file", body: err instanceof Error ? err.message : String(err) });
        }
      })();
    };
    take();
    return onHandoff("social", take);
  }, [openComposer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (composerOpen || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        openComposer(null, { scheduledAt: toIso(nextDefaultSlot()) });
      } else if (key === "t" && page === "calendar") {
        setAnchor(new Date());
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && page === "calendar" && view !== "list") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        setAnchor(view === "month" ? addMonths(anchor, dir) : addDays(anchor, dir * 7));
      } else if (key === "c") {
        setPage("calendar");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor, composerOpen, openComposer, page, setAnchor, setPage, view]);

  if (!ready) {
    return <div className="mod-social grid place-items-center text-muted">Loading social…</div>;
  }

  return (
    <TooltipProvider>
      <div className="mod-social">
        <nav className="sc-rail" aria-label="Social">
          {RAIL.map((item) => {
            const badge = item.id === "calendar" ? failed + catchUp : item.id === "review" ? review : 0;
            return (
              <Tip key={item.id} label={`${item.label}${item.id === "calendar" ? " (C)" : item.id === "review" && review ? ` — ${review} waiting for approval` : ""}`}>
                <button className={`sc-rail-btn${page === item.id ? " active" : ""}`} aria-label={item.label} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}>
                  {item.icon}
                  {badge ? <span className={`sc-rail-badge${item.id === "review" ? " review" : ""}`}>{badge}</span> : null}
                </button>
              </Tip>
            );
          })}
          {!isTauri() && channels.length === 0 && posts.length === 0 ? (
            <Tip label="Browser preview: load sample data">
              <button className="sc-rail-btn mt-auto text-[10px] font-bold" onClick={() => void loadSampleData()} aria-label="Load sample data">
                demo
              </button>
            </Tip>
          ) : null}
        </nav>
        {loadError ? (
          <div className="sc-main">
            <div className="m-6 sc-issue error">
              <span>Could not read the social folder: {loadError}</span>
            </div>
          </div>
        ) : page === "calendar" ? (
          <CalendarPage />
        ) : page === "review" ? (
          <ReviewPage />
        ) : page === "channels" ? (
          <ChannelsPage />
        ) : page === "media" ? (
          <MediaPage />
        ) : page === "analytics" ? (
          <AnalyticsPage />
        ) : page === "agents" ? (
          <AgentsPage />
        ) : (
          <SettingsPage />
        )}
        <PostModal />
        <AddChannelDialog />
        <CatchUpSheet />
        <Toasts />
      </div>
    </TooltipProvider>
  );
}
