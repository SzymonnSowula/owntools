import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { addDays, addMonths, isBefore } from "date-fns";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Filter, Plus, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSocialStore } from "../../store";
import { formatMonthTitle, formatWeekTitle, fromIso, monthGrid, moveToDay, nextDefaultSlot, parseHm, relativeTime, slotDate, toIso, weekRange } from "../../time";
import type { Post, PostStatus } from "../../types";
import { STATUS_LABEL, postMatchesFilters, useUi, type CalendarView } from "../../ui";
import { Avatar } from "../Avatar";
import { ChannelAlerts } from "../channels/HealthNote";
import { EmptyState, Menu } from "../primitives";
import { ListView } from "./ListView";
import { MonthView } from "./MonthView";
import { PostCardBody, canMove } from "./PostCard";
import { WeekView } from "./WeekView";

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "list", label: "List" },
];

const FILTER_STATUSES: PostStatus[] = ["draft", "needs_review", "scheduled", "published", "failed"];

function Sidebar() {
  const channels = useSocialStore((s) => s.channels);
  const collections = useSocialStore((s) => s.collections);
  const tags = useSocialStore((s) => s.tags);
  const posts = useSocialStore((s) => s.posts);
  const settings = useSocialStore((s) => s.settings);
  const filters = useUi((s) => s.filters);
  const setFilters = useUi((s) => s.setFilters);
  const openComposer = useUi((s) => s.openComposer);
  const setPage = useUi((s) => s.setPage);
  const setAddChannelOpen = useUi((s) => s.setAddChannelOpen);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const toggle = <T extends string>(list: T[], id: T): T[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const drafts = posts.filter((p) => p.status === "draft").length;
  const failed = posts.filter((p) => p.status === "failed").length;
  const review = posts.filter((p) => p.status === "needs_review").length;

  return (
    <aside className="sc-sidebar">
      <div className="sc-sidebar-head">
        <div className="flex gap-2">
          <button className="sc-btn primary flex-1" onClick={() => openComposer(null, { scheduledAt: toIso(nextDefaultSlot()) })}>
            <Plus /> Create post
          </button>
          <button
            className="sc-btn"
            title={settings.ai.provider === "none" ? "Set up an AI provider in Settings" : "Write with AI"}
            aria-label="Generate with AI"
            onClick={() => openComposer(null, { scheduledAt: toIso(nextDefaultSlot()), content: { text: "", media: [], thread: [] } })}
          >
            <Sparkles />
          </button>
        </div>
        {drafts || failed || review ? (
          <div className="flex flex-wrap gap-1.5">
            {review ? (
              <button className="sc-chip on" onClick={() => setPage("review")} title="Posts from agents waiting for your approval">
                {review} to review
              </button>
            ) : null}
            {drafts ? (
              <button className={`sc-chip${filters.statuses.includes("draft") ? " on" : ""}`} onClick={() => setFilters({ statuses: toggle(filters.statuses, "draft") })}>
                {drafts} draft{drafts === 1 ? "" : "s"}
              </button>
            ) : null}
            {failed ? (
              <button className={`sc-chip${filters.statuses.includes("failed") ? " on" : ""}`} style={{ color: "#ff453a" }} onClick={() => setFilters({ statuses: toggle(filters.statuses, "failed") })}>
                {failed} failed
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="sc-sidebar-body sc-scroll">
        <div className="sc-section-label flex items-center justify-between">
          <span>Channels</span>
          <button className="sc-btn ghost sm !h-6 !px-1.5 normal-case tracking-normal" onClick={() => setAddChannelOpen(true)}>
            <Plus /> add
          </button>
        </div>
        {channels.length === 0 ? (
          <div className="px-2 py-3 text-[12px] leading-5 text-muted">
            No channels yet. Connect Bluesky, Mastodon, Telegram, Discord and more to start scheduling.
            <button className="sc-btn sm mt-2 block" onClick={() => setAddChannelOpen(true)}>
              Add channel
            </button>
          </div>
        ) : (
          collections.map((col) => {
            const own = channels.filter((c) => c.collection === col);
            if (!own.length) return null;
            const isClosed = closed.has(col);
            return (
              <div key={col}>
                <button
                  className={`sc-collection${isClosed ? " closed" : ""}`}
                  onClick={() =>
                    setClosed((s) => {
                      const n = new Set(s);
                      if (n.has(col)) n.delete(col);
                      else n.add(col);
                      return n;
                    })
                  }
                >
                  <ChevronDown />
                  {col}
                </button>
                {!isClosed
                  ? own.map((c) => {
                      const on = filters.channelIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          className={`sc-channel-row${on ? " on" : ""}${c.disabled ? " off" : ""}`}
                          onClick={() => setFilters({ channelIds: toggle(filters.channelIds, c.id) })}
                          title={on ? "Showing only selected channels — click to clear" : "Show only this channel"}
                        >
                          <Avatar channel={c} muted={c.disabled} />
                          <span className="min-w-0 flex-1">
                            <span className="sc-channel-name">{c.displayName}</span>
                            <span className="sc-channel-handle">{c.handle}</span>
                          </span>
                          {c.health ? <span className={`sc-health-dot ${c.health.kind}`} title={c.health.message} aria-label={c.health.kind === "auth" ? "Signed out" : "Out of API credits"} /> : null}
                        </button>
                      );
                    })
                  : null}
              </div>
            );
          })
        )}
        {tags.length ? (
          <>
            <div className="sc-section-label flex items-center justify-between">
              <span>Tags</span>
              <button className="sc-btn ghost sm !h-6 !px-1.5 normal-case tracking-normal" onClick={() => setPage("settings")}>
                edit
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {tags.map((t) => (
                <button
                  key={t.id}
                  className={`sc-chip${filters.tagIds.includes(t.id) ? " on" : ""}`}
                  onClick={() => setFilters({ tagIds: toggle(filters.tagIds, t.id) })}
                >
                  <span className="sc-chip-dot" style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

export function CalendarPage() {
  const posts = useSocialStore((s) => s.posts);
  const channels = useSocialStore((s) => s.channels);
  const tags = useSocialStore((s) => s.tags);
  const settings = useSocialStore((s) => s.settings);
  const updatePost = useSocialStore((s) => s.updatePost);
  const approvePost = useSocialStore((s) => s.approvePost);
  const toast = useSocialStore((s) => s.toast);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const anchor = useUi((s) => s.anchor);
  const setAnchor = useUi((s) => s.setAnchor);
  const filters = useUi((s) => s.filters);
  const setFilters = useUi((s) => s.setFilters);
  const openComposer = useUi((s) => s.openComposer);
  const setAddChannelOpen = useUi((s) => s.setAddChannelOpen);
  const [dragging, setDragging] = useState<Post | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const week = useMemo(() => weekRange(anchor, settings.weekStart), [anchor, settings.weekStart]);
  const rows = useMemo(() => monthGrid(anchor, settings.weekStart), [anchor, settings.weekStart]);
  const visible = useMemo(() => posts.filter((p) => p.status !== "cancelled" && postMatchesFilters(p, filters)), [posts, filters]);
  const filterCount = filters.channelIds.length + filters.tagIds.length + filters.statuses.length;

  const title = view === "week" ? formatWeekTitle(week.start, week.end) : view === "month" ? formatMonthTitle(anchor) : "All posts";
  const step = (dir: -1 | 1) => setAnchor(view === "month" ? addMonths(anchor, dir) : addDays(anchor, dir * 7));

  const onOpen = (post: Post) => openComposer(post.id);
  // The Approve button on a hatched card: onto the calendar at its time, or
  // the next free slot. Anything that stops it opens the composer instead.
  const onApprove = async (post: Post) => {
    const out = await approvePost(post.id);
    if (out.ok) {
      const at = fromIso(out.post.scheduledAt);
      toast({ kind: "success", title: "Approved", body: at ? `Goes out ${relativeTime(at)}${out.movedToSlot ? " — the next free slot" : ""}.` : undefined });
    } else {
      toast({ kind: "error", title: "Cannot approve yet", body: out.message });
      if (out.reason !== "not-waiting") openComposer(post.id);
    }
  };
  const onAdd = (at: Date) => {
    let when = at;
    if (isBefore(at, new Date())) {
      toast({ kind: "info", title: "That slot is in the past", body: "Starting the post at the next free time instead." });
      when = nextDefaultSlot();
    }
    const [h, m] = parseHm(settings.defaultTime) ?? [9, 0];
    if (view === "month") when = slotDate(when, h, m);
    openComposer(null, { scheduledAt: toIso(when), channelIds: filters.channelIds.length ? filters.channelIds : [] });
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as { post: Post } | undefined)?.post ?? null);
  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const post = (e.active.data.current as { post: Post } | undefined)?.post;
    const over = e.over?.data.current as { day: Date; hour?: number } | undefined;
    if (!post || !over || !canMove(post)) return;
    const current = fromIso(post.scheduledAt) ?? nextDefaultSlot();
    const next = over.hour === undefined ? moveToDay(current, over.day) : slotDate(over.day, over.hour, current.getMinutes());
    if (next.getTime() === current.getTime() && post.scheduledAt) return;
    if (post.status !== "draft" && isBefore(next, new Date())) {
      toast({ kind: "info", title: "That slot is in the past", body: "Drop the post on a time that has not happened yet." });
      return;
    }
    await updatePost(post.id, (p) => ({
      ...p,
      scheduledAt: toIso(next),
      status: p.status === "failed" || p.status === "cancelled" ? "scheduled" : p.status,
      attempts: 0,
      nextAttemptAt: null,
    }));
  };

  return (
    <div className="sc-page">
      <Sidebar />
      <div className="sc-main">
        <div className="sc-toolbar">
          <div className="flex items-center gap-1">
            <button className="sc-icon-btn" aria-label="Previous" onClick={() => step(-1)} disabled={view === "list"}>
              <ChevronLeft />
            </button>
            <button className="sc-btn sm" onClick={() => setAnchor(new Date())} title="Jump to today (T)">
              Today
            </button>
            <button className="sc-icon-btn" aria-label="Next" onClick={() => step(1)} disabled={view === "list"}>
              <ChevronRight />
            </button>
          </div>
          <div className="sc-toolbar-title ml-1 truncate">{title}</div>
          <div className="ml-auto flex items-center gap-2">
            {filterCount ? (
              <button className="sc-chip on" onClick={() => setFilters({ channelIds: [], tagIds: [], statuses: [] })} title="Clear filters">
                <Filter /> {filterCount} filter{filterCount === 1 ? "" : "s"} <X />
              </button>
            ) : (
              <Menu
                trigger={
                  <button className="sc-btn ghost sm">
                    <Filter /> Filter
                  </button>
                }
                label="Status"
                items={FILTER_STATUSES.map((st) => ({
                  key: st,
                  label: STATUS_LABEL[st],
                  checked: filters.statuses.includes(st),
                  onSelect: () => setFilters({ statuses: filters.statuses.includes(st) ? filters.statuses.filter((x) => x !== st) : [...filters.statuses, st] }),
                }))}
              />
            )}
            <div className="flex rounded-[9px] border border-line bg-paper p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  className={`h-7 rounded-[7px] px-3 text-[12px] font-semibold transition ${view === v.id ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <ChannelAlerts />
        {channels.length === 0 && posts.length === 0 ? (
          <div className="sc-content sc-desk grid place-items-center">
            <div className="sc-card max-w-[440px]">
              <EmptyState
                icon={<Calendar />}
                title="your week, one glance"
                action={
                  <>
                    <button className="sc-btn primary" onClick={() => setAddChannelOpen(true)}>
                      <Plus /> Add a channel
                    </button>
                    <button className="sc-btn" onClick={() => openComposer(null, { scheduledAt: toIso(nextDefaultSlot()) })}>
                      Write a draft first
                    </button>
                  </>
                }
              >
                Connect a network, write once, schedule everywhere. Everything stays in files on this device; the app publishes from the tray while it runs.
              </EmptyState>
            </div>
          </div>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={() => setDragging(null)}>
            {view === "week" ? (
              <WeekView days={week.days} posts={visible} channels={channels} tags={tags} onOpen={onOpen} onAdd={onAdd} onApprove={(p) => void onApprove(p)} />
            ) : view === "month" ? (
              <MonthView rows={rows} anchor={anchor} posts={visible} channels={channels} tags={tags} weekStart={settings.weekStart} defaultTime={settings.defaultTime} onOpen={onOpen} onAdd={onAdd} onApprove={(p) => void onApprove(p)} />
            ) : (
              <ListView posts={visible} channels={channels} tags={tags} onOpen={onOpen} onNew={() => openComposer(null, { scheduledAt: toIso(nextDefaultSlot()) })} />
            )}
            <DragOverlay dropAnimation={null}>
              {dragging ? (
                <div className="sc-post overlay sc-portal">
                  <PostCardBody post={dragging} channels={channels} tags={tags} showTime />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
