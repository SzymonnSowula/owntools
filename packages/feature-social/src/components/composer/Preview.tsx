import { ArrowUp, Bookmark, Heart, MessageCircle, MessageSquare, Repeat2, Send, Share, ThumbsUp } from "lucide-react";
import type { ReactNode } from "react";
import { findFacets } from "../../facets";
import { networkById } from "../../networks";
import type { Channel, MediaItem, PostContent } from "../../types";
import { Avatar } from "../Avatar";
import { NetworkIcon } from "../NetworkIcon";
import { Thumb } from "./MediaStrip";

/**
 * "How will it look there?" — one card per network, drawn from memory of
 * each network's post layout in our own palette. The text is the final
 * text (signature applied, thread flattened when the network has none).
 */

function RichText({ text, cls = "sc-prev-text" }: { text: string; cls?: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const f of findFacets(text)) {
    nodes.push(text.slice(cursor, f.start));
    nodes.push(
      <span key={f.start} className="f">
        {text.slice(f.start, f.end)}
      </span>,
    );
    cursor = f.end;
  }
  nodes.push(text.slice(cursor));
  return <div className={cls}>{nodes}</div>;
}

function Media({ items, square }: { items: MediaItem[]; square?: boolean }) {
  if (!items.length) return null;
  const n = Math.min(items.length, 4);
  return (
    <div className={`sc-prev-media n${n}${square ? " square" : ""}`}>
      {items.slice(0, 4).map((m) => (
        <Thumb key={m.id} item={m} />
      ))}
    </div>
  );
}

function Actions({ items }: { items: ReactNode[] }) {
  return (
    <div className="sc-prev-actions">
      {items.map((it, i) => (
        <span key={i}>{it}</span>
      ))}
    </div>
  );
}

const Verified = () => (
  <svg viewBox="0 0 22 22" width="15" height="15" aria-hidden>
    <path
      d="M20.4 11c0-1.2-.7-2.2-1.7-2.7.3-1.1 0-2.3-.8-3.1s-2-1.1-3.1-.8C14.2 3.4 13.2 2.7 12 2.7s-2.2.7-2.7 1.7c-1.1-.3-2.3 0-3.1.8s-1.1 2-.8 3.1C4.3 8.8 3.6 9.8 3.6 11s.7 2.2 1.7 2.7c-.3 1.1 0 2.3.8 3.1s2 1.1 3.1.8c.5 1 1.5 1.7 2.7 1.7s2.2-.7 2.7-1.7c1.1.3 2.3 0 3.1-.8s1.1-2 .8-3.1c1.1-.5 1.8-1.5 1.8-2.7zm-9.7 4.2-3.4-3.4 1.4-1.4 2 2 4.5-4.5 1.4 1.4-5.9 5.9z"
      fill="#1d9bf0"
    />
  </svg>
);

export interface PreviewProps {
  channel: Channel;
  content: PostContent;
  mediaById: (id: string) => MediaItem | undefined;
}

export function NetworkPreview({ channel, content, mediaById }: PreviewProps) {
  const net = networkById(channel.provider);
  const media = content.media.map((m) => mediaById(m.id)).filter((m): m is MediaItem => Boolean(m));
  const text = content.text || "Your post text will appear here.";
  const handle = channel.handle;
  const name = channel.displayName;
  const thread = content.thread.filter((p) => p.text.trim());

  const threadBlock =
    thread.length && net.threads ? (
      <div className="sc-prev-thread">
        {thread.map((p, i) => (
          <div key={i} className={i ? "mt-3" : ""}>
            <div className="sc-prev-head !mb-1">
              <Avatar channel={channel} size="sm" />
              <span className="sc-prev-name !text-[12.5px]">{name}</span>
            </div>
            <RichText text={p.text} />
          </div>
        ))}
      </div>
    ) : null;

  switch (net.id) {
    case "x":
      return (
        <div className="sc-prev sc-prev-dark">
          <div className="sc-prev-head">
            <Avatar channel={channel} />
            <div>
              <div className="sc-prev-name">
                {name} <Verified />
              </div>
              <div className="sc-prev-handle">{handle} · now</div>
            </div>
          </div>
          <RichText text={text} />
          <Media items={media} />
          <Actions items={[<><MessageCircle /> 12</>, <><Repeat2 /> 4</>, <><Heart /> 38</>, <><Bookmark /></>, <><Share /></>]} />
          {threadBlock}
        </div>
      );
    case "bluesky":
      return (
        <div className="sc-prev">
          <div className="sc-prev-head">
            <Avatar channel={channel} />
            <div>
              <div className="sc-prev-name">{name}</div>
              <div className="sc-prev-handle">{handle} · now</div>
            </div>
          </div>
          <RichText text={text} />
          <Media items={media} />
          <Actions items={[<><MessageCircle /> 3</>, <><Repeat2 /> 5</>, <><Heart /> 21</>, <><Share /></>]} />
          {threadBlock}
        </div>
      );
    case "mastodon":
      return (
        <div className="sc-prev">
          <div className="sc-prev-head">
            <Avatar channel={channel} />
            <div>
              <div className="sc-prev-name">{name}</div>
              <div className="sc-prev-handle">{handle}</div>
            </div>
            <span className="ml-auto text-[11px] text-muted">now</span>
          </div>
          <RichText text={text} />
          <Media items={media} />
          <Actions items={[<><MessageCircle /> 2</>, <><Repeat2 /> 7</>, <><Heart /> 19</>, <><Bookmark /></>]} />
          {threadBlock}
        </div>
      );
    case "threads":
      return (
        <div className="sc-prev">
          <div className="sc-prev-head">
            <Avatar channel={channel} />
            <div className="sc-prev-name">{handle.replace(/^@/, "")}</div>
            <span className="ml-auto text-[11px] text-muted">now</span>
          </div>
          <RichText text={text} />
          <Media items={media} />
          <Actions items={[<><Heart /> 40</>, <><MessageCircle /> 6</>, <><Repeat2 /> 2</>, <><Send /></>]} />
          {threadBlock}
        </div>
      );
    case "linkedin":
    case "linkedin-page":
      return (
        <div className="sc-prev">
          <div className="sc-prev-head">
            <Avatar channel={channel} />
            <div>
              <div className="sc-prev-name">
                {name} <span className="text-[11px] font-normal text-muted">· 1st</span>
              </div>
              <div className="sc-prev-handle">now · 🌐</div>
            </div>
          </div>
          <RichText text={text} />
          <Media items={media} />
          <Actions items={[<><ThumbsUp /> Like</>, <><MessageSquare /> Comment</>, <><Repeat2 /> Repost</>, <><Send /> Send</>]} />
        </div>
      );
    case "instagram":
      return (
        <div className="sc-prev !p-0">
          <div className="sc-prev-head !mb-0 p-3">
            <Avatar channel={channel} size="sm" />
            <div className="sc-prev-name !text-[12.5px]">{handle.replace(/^@/, "")}</div>
          </div>
          {media.length ? (
            <Media items={media.slice(0, 1)} square />
          ) : (
            <div className="grid aspect-square place-items-center bg-paper text-[12px] text-muted">Add a photo — Instagram needs one.</div>
          )}
          <div className="p-3">
            <Actions items={[<><Heart /></>, <><MessageCircle /></>, <><Send /></>, <><Bookmark /></>]} />
            <div className="mt-2 text-[13px]">
              <b>{handle.replace(/^@/, "")}</b> <RichText text={text} cls="inline" />
            </div>
          </div>
        </div>
      );
    case "facebook":
      return (
        <div className="sc-prev">
          <div className="sc-prev-head">
            <Avatar channel={channel} />
            <div>
              <div className="sc-prev-name">{name}</div>
              <div className="sc-prev-handle">Just now · 🌐</div>
            </div>
          </div>
          <RichText text={text} />
          <Media items={media} />
          <Actions items={[<><ThumbsUp /> Like</>, <><MessageSquare /> Comment</>, <><Share /> Share</>]} />
        </div>
      );
    case "pinterest":
      return (
        <div className="sc-prev !p-0">
          {media.length ? <Media items={media.slice(0, 1)} /> : <div className="grid h-40 place-items-center bg-paper text-[12px] text-muted">Pin image</div>}
          <div className="p-3">
            <div className="sc-prev-name">{content.title || "Pin title"}</div>
            <RichText text={text} cls="sc-prev-text mt-1 text-[12.5px] text-muted" />
            <div className="sc-prev-head !mb-0 mt-3">
              <Avatar channel={channel} size="sm" />
              <span className="text-[12px]">{name}</span>
            </div>
          </div>
        </div>
      );
    case "reddit":
      return (
        <div className="sc-prev">
          <div className="sc-prev-head">
            <Avatar channel={channel} size="sm" />
            <div className="text-[12px]">
              <b>r/{channel.meta.subreddit || "subreddit"}</b> <span className="text-muted">· Posted by u/{handle.replace(/^@/, "")} · now</span>
            </div>
          </div>
          <div className="text-[15px] font-bold leading-tight">{content.title || "Post title"}</div>
          <RichText text={text} cls="sc-prev-text mt-2" />
          <Media items={media} />
          <Actions items={[<><ArrowUp /> 1</>, <><MessageSquare /> 0 comments</>, <><Share /> Share</>]} />
        </div>
      );
    case "telegram":
      return (
        <div className="sc-prev !bg-[#e6f0fa] !p-3 dark:!bg-[#1f2c3a]" style={{ background: "color-mix(in srgb, #26a5e4 12%, var(--color-card))" }}>
          <div className="inline-block max-w-full rounded-[12px] rounded-tl-[4px] bg-card px-3 py-2 shadow-sm">
            <div className="text-[12px] font-bold" style={{ color: "#26a5e4" }}>
              {name}
            </div>
            <Media items={media} />
            <RichText text={text} cls="sc-prev-text mt-1" />
            <div className="mt-1 text-right text-[10.5px] text-muted">12:00</div>
          </div>
        </div>
      );
    case "discord":
      return (
        <div className="sc-prev" style={{ background: "#313338", color: "#dbdee1", borderColor: "#1e1f22" }}>
          <div className="flex gap-3">
            <Avatar channel={channel} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-white">
                {name} <span className="ml-1 rounded bg-[#5865f2] px-1 text-[9px] font-bold uppercase text-white">bot</span>{" "}
                <span className="ml-1 text-[11px] font-normal text-[#949ba4]">Today at 12:00</span>
              </div>
              <RichText text={text} cls="sc-prev-text mt-0.5" />
              <Media items={media} />
            </div>
          </div>
        </div>
      );
    case "slack":
    case "mattermost":
      return (
        <div className="sc-prev">
          <div className="flex gap-3">
            <Avatar channel={channel} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold">
                {name} <span className="ml-1 rounded bg-line px-1 text-[9px] font-bold uppercase text-muted">app</span>{" "}
                <span className="ml-1 text-[11px] font-normal text-muted">12:00</span>
              </div>
              <RichText text={text} cls="sc-prev-text mt-0.5" />
              {media.length ? <div className="mt-2 text-[11px] text-muted">Images are not sent through webhooks.</div> : null}
            </div>
          </div>
        </div>
      );
    case "devto":
    case "medium":
    case "hashnode":
    case "wordpress":
    case "ghost":
      return (
        <div className="sc-prev">
          <div className="sc-prev-label">
            <NetworkIcon id={net.id} /> {net.name} article
          </div>
          <div className="text-[18px] font-bold leading-tight">{content.title || "Article title"}</div>
          <div className="sc-prev-head mt-2">
            <Avatar channel={channel} size="sm" />
            <span className="text-[12px] text-muted">
              {name} · {Math.max(1, Math.round(text.split(/\s+/).length / 200))} min read
            </span>
          </div>
          {media.length ? <Media items={media.slice(0, 1)} /> : null}
          <RichText text={text} cls="sc-prev-text mt-2 text-[13px]" />
        </div>
      );
    default:
      return (
        <div className="sc-prev">
          <div className="sc-prev-head">
            <Avatar channel={channel} />
            <div>
              <div className="sc-prev-name">{name}</div>
              <div className="sc-prev-handle">
                {handle} · {net.name}
              </div>
            </div>
          </div>
          {content.title ? <div className="mb-1 font-bold">{content.title}</div> : null}
          <RichText text={text} />
          <Media items={media} />
        </div>
      );
  }
}
