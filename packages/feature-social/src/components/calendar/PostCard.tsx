import { useDraggable } from "@dnd-kit/core";
import { AlertCircle, Check, Loader2, Repeat, ShieldAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { postSummary } from "../../model";
import { describeSource } from "../../review";
import { formatTime, fromIso } from "../../time";
import type { Channel, Post, Tag } from "../../types";
import { Avatar } from "../Avatar";

/**
 * A post on the calendar: tag-coloured header, channel avatars with their
 * provider badges, two lines of text, and a status glyph. Draggable while it
 * can still be moved (drafts, scheduled, failed, waiting for review). A post
 * waiting for review is drawn hatched and carries its own Approve button.
 */

export function canMove(post: Post): boolean {
  return post.status === "draft" || post.status === "needs_review" || post.status === "scheduled" || post.status === "failed" || post.status === "cancelled";
}

export function PostCardBody({
  post,
  channels,
  tags,
  showTime = false,
  onApprove,
}: {
  post: Post;
  channels: Channel[];
  tags: Tag[];
  showTime?: boolean;
  /** Present on the calendar (not in the drag overlay): the Approve button on a post waiting for review. */
  onApprove?: (post: Post) => void;
}) {
  const tag = post.tags.map((id) => tags.find((t) => t.id === id)).find(Boolean);
  const own = post.channelIds.map((id) => channels.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c));
  const when = fromIso(post.scheduledAt);
  const failedCount = Object.values(post.results).filter((r) => r.status === "error").length;
  const source = describeSource(post.source);
  return (
    <>
      {tag ? (
        <div className="sc-post-tag" style={{ ["--tag" as string]: tag.color }}>
          {tag.name}
        </div>
      ) : (
        <div className="sc-post-tag none" />
      )}
      <div className="sc-post-body">
        <div className="sc-avatars">
          {own.slice(0, 3).map((c) => (
            <Avatar key={c.id} channel={c} size="sm" />
          ))}
          {own.length > 3 ? <span className="sc-avatar sm" title={`${own.length - 3} more`}>+{own.length - 3}</span> : null}
        </div>
        <div className="sc-post-text">
          {post.status === "draft" ? <span className="draft">Draft: </span> : post.status === "needs_review" ? <span className="draft">Review: </span> : null}
          {postSummary(post, 120)}
        </div>
      </div>
      <div className="sc-post-meta">
        {post.status === "published" ? (
          <span className="sc-post-glyph ok" title="Published">
            <Check />
          </span>
        ) : post.status === "needs_review" ? (
          <span className="sc-post-glyph review" title="Waiting for your approval">
            <ShieldAlert />
          </span>
        ) : post.status === "failed" ? (
          <span className="sc-post-glyph err" title={post.lastError ?? "Failed"}>
            <AlertCircle />
          </span>
        ) : post.status === "publishing" ? (
          <span className="sc-post-glyph busy" title="Publishing…">
            <Loader2 className="animate-spin" />
          </span>
        ) : null}
        {showTime && when ? <span>{formatTime(when)}</span> : null}
        {post.attempts > 0 && post.status === "scheduled" ? <span title={post.lastError ?? ""}>retrying</span> : null}
        {failedCount > 0 && post.status !== "failed" ? <span>{failedCount} failed</span> : null}
        {post.repeat.kind !== "none" ? <Repeat className="h-3 w-3" aria-label="Repeats" /> : null}
        {source ? <span title={`Created by ${source}`}>{source}</span> : null}
        {post.status === "needs_review" && onApprove ? (
          <button
            className="sc-post-approve"
            title="Approve — onto the calendar at its time, or the next free slot"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onApprove(post);
            }}
          >
            Approve
          </button>
        ) : null}
      </div>
    </>
  );
}

export function PostCard({
  post,
  channels,
  tags,
  onOpen,
  onApprove,
  showTime,
}: {
  post: Post;
  channels: Channel[];
  tags: Tag[];
  onOpen: (post: Post) => void;
  onApprove?: (post: Post) => void;
  showTime?: boolean;
}) {
  const movable = canMove(post);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: post.id, data: { post }, disabled: !movable });
  const style: CSSProperties | undefined = movable ? undefined : { cursor: "default" };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={`sc-post${isDragging ? " dragging" : ""}${post.status === "published" ? " done" : ""}${post.status === "needs_review" ? " review" : ""}`}
      style={style}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(post)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(post);
        }
      }}
      {...listeners}
      aria-roledescription={movable ? "draggable post" : undefined}
    >
      <PostCardBody post={post} channels={channels} tags={tags} showTime={showTime} onApprove={onApprove} />
    </div>
  );
}
