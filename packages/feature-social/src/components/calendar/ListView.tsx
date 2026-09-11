import { format, isSameDay } from "date-fns";
import { AlertCircle, CalendarPlus, Check, FileText, Loader2, ShieldAlert } from "lucide-react";
import { postSummary } from "../../model";
import { formatTime, fromIso, relativeTime } from "../../time";
import type { Channel, Post, Tag } from "../../types";
import { STATUS_LABEL } from "../../ui";
import { Avatar } from "../Avatar";
import { EmptyState } from "../primitives";

function Row({ post, channels, tags, onOpen }: { post: Post; channels: Channel[]; tags: Tag[]; onOpen: (p: Post) => void }) {
  const when = fromIso(post.scheduledAt);
  const own = post.channelIds.map((id) => channels.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c));
  const tag = post.tags.map((id) => tags.find((t) => t.id === id)).find(Boolean);
  return (
    <button className="sc-row" onClick={() => onOpen(post)}>
      <span className="sc-row-time">{when ? formatTime(when) : "—"}</span>
      <span className="flex min-w-0 items-center gap-3">
        <span className="sc-avatars">
          {own.slice(0, 4).map((c) => (
            <Avatar key={c.id} channel={c} size="sm" />
          ))}
        </span>
        <span className="min-w-0">
          <span className="sc-row-text block">
            {post.status === "draft" ? <span className="text-muted font-semibold">Draft: </span> : post.status === "needs_review" ? <span className="text-muted font-semibold">Review: </span> : null}
            {postSummary(post, 140)}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
            {tag ? (
              <span className="sc-chip !h-[18px] !px-2 !text-[10px]" style={{ borderColor: tag.color, color: tag.color }}>
                {tag.name}
              </span>
            ) : null}
            {when ? <span>{relativeTime(when)}</span> : <span>no date yet</span>}
            {post.lastError ? <span className="text-[#ff453a]">{post.lastError}</span> : null}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2 text-muted">
        {post.status === "published" ? (
          <span className="sc-post-glyph ok">
            <Check />
          </span>
        ) : post.status === "failed" ? (
          <span className="sc-post-glyph err">
            <AlertCircle />
          </span>
        ) : post.status === "publishing" ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        ) : post.status === "needs_review" ? (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
            <span className="sc-post-glyph review">
              <ShieldAlert />
            </span>
            review
          </span>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wide">{STATUS_LABEL[post.status]}</span>
        )}
      </span>
    </button>
  );
}

export function ListView({
  posts,
  channels,
  tags,
  onOpen,
  onNew,
}: {
  posts: Post[];
  channels: Channel[];
  tags: Tag[];
  onOpen: (post: Post) => void;
  onNew: () => void;
}) {
  const now = new Date();
  const dated = posts.filter((p) => fromIso(p.scheduledAt)).sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const undated = posts.filter((p) => !fromIso(p.scheduledAt));
  const groups: { day: Date; posts: Post[] }[] = [];
  for (const p of dated) {
    const d = fromIso(p.scheduledAt)!;
    const g = groups.find((x) => isSameDay(x.day, d));
    if (g) g.posts.push(p);
    else groups.push({ day: d, posts: [p] });
  }
  if (posts.length === 0) {
    return (
      <div className="sc-content sc-scroll">
        <EmptyState icon={<CalendarPlus />} title="nothing here yet" action={<button className="sc-btn primary" onClick={onNew}>New post</button>}>
          Posts you schedule or draft show up here as a plain list — handy for a quick review of the week.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="sc-content sc-scroll">
      <div className="sc-list">
        {undated.length ? (
          <>
            <div className="sc-list-day">
              <b>drafts</b>
              <span>without a date</span>
              <FileText className="h-3.5 w-3.5" />
            </div>
            {undated.map((p) => (
              <Row key={p.id} post={p} channels={channels} tags={tags} onOpen={onOpen} />
            ))}
          </>
        ) : null}
        {groups.map((g) => (
          <div key={g.day.toISOString()}>
            <div className={`sc-list-day${isSameDay(g.day, now) ? " today" : ""}`}>
              <b>{isSameDay(g.day, now) ? "today" : format(g.day, "EEEE")}</b>
              <span>{format(g.day, "MMMM d, yyyy")}</span>
            </div>
            {g.posts.map((p) => (
              <Row key={p.id} post={p} channels={channels} tags={tags} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
