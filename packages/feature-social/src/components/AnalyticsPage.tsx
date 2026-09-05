import { addWeeks, format, startOfWeek } from "date-fns";
import { BarChart3 } from "lucide-react";
import { useMemo } from "react";
import { useSocialStore } from "../store";
import { fromIso } from "../time";
import type { Post } from "../types";
import { Avatar } from "./Avatar";
import { EmptyState } from "./primitives";

/**
 * What the stored results say — nothing more. Posts per week, per channel
 * and per status; no reach or likes, because no network is asked for them.
 */

export function AnalyticsPage() {
  const posts = useSocialStore((s) => s.posts);
  const channels = useSocialStore((s) => s.channels);
  const settings = useSocialStore((s) => s.settings);

  const weeks = useMemo(() => {
    const now = new Date();
    const start = startOfWeek(addWeeks(now, -7), { weekStartsOn: settings.weekStart });
    const buckets = Array.from({ length: 8 }, (_, i) => ({ start: addWeeks(start, i), published: 0, failed: 0, scheduled: 0 }));
    for (const p of posts) {
      const d = fromIso(p.publishedAt ?? p.scheduledAt);
      if (!d) continue;
      const i = buckets.findIndex((b, n) => d >= b.start && (n === buckets.length - 1 || d < buckets[n + 1]!.start));
      if (i < 0) continue;
      if (p.status === "published") buckets[i]!.published += 1;
      else if (p.status === "failed") buckets[i]!.failed += 1;
      else if (p.status === "scheduled") buckets[i]!.scheduled += 1;
    }
    return buckets;
  }, [posts, settings.weekStart]);
  const max = Math.max(1, ...weeks.map((w) => w.published + w.failed + w.scheduled));

  const byStatus = (status: Post["status"]) => posts.filter((p) => p.status === status).length;
  const perChannel = channels.map((c) => ({
    channel: c,
    ok: posts.filter((p) => p.results[c.id]?.status === "ok").length,
    err: posts.filter((p) => p.results[c.id]?.status === "error").length,
    queued: posts.filter((p) => p.status === "scheduled" && p.channelIds.includes(c.id)).length,
  }));

  return (
    <div className="sc-main">
      <div className="sc-toolbar">
        <div className="sc-toolbar-title">analytics</div>
        <span className="text-[12px] text-muted">Counted from your own publish results — the app never reads follower or engagement numbers.</span>
      </div>
      <div className="sc-content sc-desk sc-scroll">
        {posts.length === 0 ? (
          <div className="grid h-full place-items-center p-6">
            <div className="sc-card max-w-[420px]">
              <EmptyState icon={<BarChart3 />} title="nothing to count yet">Once posts go out, this page shows how many, where, and how many failed — per week and per channel.</EmptyState>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[900px] flex-col gap-5 p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ["published", "Published"],
                ["scheduled", "Scheduled"],
                ["draft", "Drafts"],
                ["failed", "Failed"],
              ] as [Post["status"], string][]).map(([st, label]) => (
                <div key={st} className="sc-card p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{label}</div>
                  <div className="sc-display mt-1 text-[28px]">{byStatus(st)}</div>
                </div>
              ))}
            </div>
            <div className="sc-card">
              <div className="sc-card-head">
                <span className="sc-card-title">Posts per week</span>
                <span className="ml-auto flex items-center gap-3 text-[11px] text-muted">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-accent" /> published</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "color-mix(in srgb, var(--color-accent) 35%, transparent)" }} /> scheduled</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#ff453a]" /> failed</span>
                </span>
              </div>
              <div className="sc-card-body">
                <div className="grid h-[160px] grid-cols-8 items-end gap-3">
                  {weeks.map((w) => {
                    const total = w.published + w.failed + w.scheduled;
                    return (
                      <div key={w.start.toISOString()} className="flex h-full flex-col items-center justify-end gap-1">
                        <span className="text-[11px] text-muted">{total || ""}</span>
                        <div className="flex w-full flex-col-reverse overflow-hidden rounded-[6px] bg-line" style={{ height: `${Math.max(4, (total / max) * 100)}%` }}>
                          <div className="bg-accent" style={{ height: `${total ? (w.published / total) * 100 : 0}%` }} />
                          <div style={{ height: `${total ? (w.scheduled / total) * 100 : 0}%`, background: "color-mix(in srgb, var(--color-accent) 35%, transparent)" }} />
                          <div className="bg-[#ff453a]" style={{ height: `${total ? (w.failed / total) * 100 : 0}%` }} />
                        </div>
                        <span className="text-[10.5px] text-muted">{format(w.start, "d MMM")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="sc-card">
              <div className="sc-card-head">
                <span className="sc-card-title">Per channel</span>
              </div>
              <div className="divide-y divide-line">
                {perChannel.map(({ channel, ok, err, queued }) => (
                  <div key={channel.id} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
                    <Avatar channel={channel} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{channel.displayName}</span>
                    <span className="text-muted">{ok} published</span>
                    <span className="text-muted">{queued} queued</span>
                    <span className={err ? "text-[#ff453a]" : "text-muted"}>{err} failed</span>
                  </div>
                ))}
                {perChannel.length === 0 ? <div className="px-4 py-4 text-[12.5px] text-muted">No channels connected.</div> : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
