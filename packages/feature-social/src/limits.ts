import { findFacets } from "./facets";
import { networkById, type NetworkDef } from "./networks";
import type { Channel, ChannelOverride, MediaItem, Post, PostContent, ThreadPart } from "./types";

/**
 * Per-network length rules and validation. The counter in the composer and
 * the guard before publishing both come through here so they never disagree.
 */

/** Networks that count every URL as 23 characters (t.co / Mastodon rule). */
const URL_23 = new Set(["x", "mastodon"]);

type SegmenterCtor = new (locale: undefined, opts: { granularity: "grapheme" }) => { segment(s: string): Iterable<unknown> };
const SegmenterImpl = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
const segmenter = SegmenterImpl ? new SegmenterImpl(undefined, { granularity: "grapheme" }) : null;

export function graphemeCount(text: string): number {
  if (!segmenter) return [...text].length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

/** twitter-text v3 weights: most Latin/Cyrillic/… = 1, everything else (emoji, CJK) = 2. */
function xWeight(cp: number): number {
  if (cp <= 4351) return 1;
  if (cp >= 8192 && cp <= 8205) return 1;
  if (cp >= 8208 && cp <= 8223) return 1;
  if (cp >= 8242 && cp <= 8247) return 1;
  return 2;
}

/** How long `text` is in the network's own units. */
export function measure(networkId: string, text: string): number {
  const net = networkById(networkId);
  if (net.id === "bluesky") {
    // Graphemes; links are not shortened.
    return graphemeCount(text);
  }
  let total = 0;
  let cursor = 0;
  const links = URL_23.has(net.id) ? findFacets(text).filter((f) => f.kind === "link") : [];
  const count = (s: string) => {
    if (net.id === "x") {
      let n = 0;
      for (const ch of s) n += xWeight(ch.codePointAt(0) ?? 0);
      return n;
    }
    return [...s].length;
  };
  for (const l of links) {
    total += count(text.slice(cursor, l.start)) + 23;
    cursor = l.end;
  }
  total += count(text.slice(cursor));
  return total;
}

export function charLimit(net: NetworkDef, channel?: Channel | null, hasMedia = false): number {
  if (channel?.preferences.charLimit) return channel.preferences.charLimit;
  if (hasMedia && net.limits.charsWithMedia) return net.limits.charsWithMedia;
  return net.limits.chars;
}

export interface Issue {
  level: "error" | "warning";
  message: string;
}

/** Global content merged with a channel's override. */
export function resolveContent(post: Pick<Post, "content" | "overrides">, channelId: string): PostContent {
  const o: ChannelOverride | undefined = post.overrides[channelId];
  return {
    text: o?.text ?? post.content.text,
    media: o?.media ?? post.content.media,
    thread: o?.thread ?? post.content.thread,
    title: o?.title ?? post.content.title,
  };
}

/** Everything appended for a network without threads: parts separated by a blank line. */
export function flattenThread(content: PostContent): string {
  const extra = content.thread.map((p) => p.text.trim()).filter(Boolean);
  return [content.text.trim(), ...extra].filter(Boolean).join("\n\n");
}

export function applySignature(text: string, channel: Channel | null | undefined): string {
  const sig = channel?.preferences.signature?.trim();
  if (!sig) return text;
  return text.trim() ? `${text.trim()}\n\n${sig}` : sig;
}

function mediaKind(item: MediaItem | undefined): "image" | "video" | "other" {
  if (!item) return "other";
  if (item.mime.startsWith("image/")) return "image";
  if (item.mime.startsWith("video/")) return "video";
  return "other";
}

/**
 * Problems with `content` on `channel`. Errors block scheduling; warnings are
 * shown but let the post through (e.g. Slack dropping an image).
 */
export function validateForChannel(
  content: PostContent,
  channel: Channel,
  mediaById: (id: string) => MediaItem | undefined,
): Issue[] {
  const net = networkById(channel.provider);
  const issues: Issue[] = [];
  const text = applySignature(net.threads ? content.text : flattenThread(content), channel);
  const parts: ThreadPart[] = net.threads ? content.thread : [];
  const hasMedia = content.media.length > 0;
  const limit = charLimit(net, channel, hasMedia);

  if (!text.trim() && content.media.length === 0) {
    issues.push({ level: "error", message: "Nothing to post — add text or media." });
  }
  const len = measure(net.id, text);
  if (len > limit) {
    issues.push({ level: "error", message: `${len - limit} over the ${limit}-character limit for ${net.name}.` });
  }
  parts.forEach((p, i) => {
    const l = measure(net.id, p.text);
    if (l > net.limits.chars) {
      issues.push({ level: "error", message: `Part ${i + 2} is ${l - net.limits.chars} over the limit.` });
    }
    if (!p.text.trim() && p.media.length === 0) {
      issues.push({ level: "warning", message: `Part ${i + 2} is empty and will be skipped.` });
    }
  });
  if (net.titleRequired && !content.title?.trim()) {
    issues.push({ level: "error", message: `${net.name} needs a title.` });
  }
  if (net.limits.title && (content.title?.length ?? 0) > net.limits.title) {
    issues.push({ level: "error", message: `Title is over ${net.limits.title} characters.` });
  }
  const images = content.media.filter((m) => mediaKind(mediaById(m.id)) === "image");
  const videos = content.media.filter((m) => mediaKind(mediaById(m.id)) === "video");
  if (images.length > net.limits.images) {
    issues.push({
      level: net.limits.images === 0 ? "warning" : "error",
      message:
        net.limits.images === 0
          ? `${net.name} takes no images here — they will be left out.`
          : `${net.name} allows ${net.limits.images} image${net.limits.images === 1 ? "" : "s"}; ${images.length} attached.`,
    });
  }
  if (videos.length > net.limits.videos) {
    issues.push({
      level: net.limits.videos === 0 ? "warning" : "error",
      message:
        net.limits.videos === 0
          ? `${net.name} takes no video here — it will be left out.`
          : `${net.name} allows ${net.limits.videos} video${net.limits.videos === 1 ? "" : "s"}.`,
    });
  }
  if (net.limits.imageBytes) {
    for (const m of images) {
      const item = mediaById(m.id);
      if (item && item.bytes > net.limits.imageBytes) {
        issues.push({
          level: "error",
          message: `${item.name} is ${(item.bytes / 1024 / 1024).toFixed(1)} MB; ${net.name} takes up to ${Math.round(net.limits.imageBytes / 1024 / 1024)} MB per image.`,
        });
      }
    }
  }
  if (net.limits.hashtags) {
    const tags = findFacets(text).filter((f) => f.kind === "tag").length;
    if (tags > net.limits.hashtags) {
      issues.push({ level: "error", message: `${tags} hashtags; ${net.name} allows ${net.limits.hashtags}.` });
    }
  }
  if (net.id === "instagram" && images.length === 0 && videos.length === 0) {
    issues.push({ level: "error", message: "Instagram posts need a photo or a video." });
  }
  if (!net.threads && content.thread.some((p) => p.text.trim())) {
    issues.push({ level: "warning", message: `${net.name} has no threads — the parts are joined into one post.` });
  }
  if (channel.stub) {
    issues.push({ level: "error", message: `${net.name} publishing is not wired up yet in this build.` });
  }
  if (channel.disabled) {
    issues.push({ level: "error", message: `${channel.displayName} is disabled.` });
  }
  return issues;
}

export function validatePost(
  post: Post,
  channels: Channel[],
  mediaById: (id: string) => MediaItem | undefined,
): Record<string, Issue[]> {
  const out: Record<string, Issue[]> = {};
  for (const id of post.channelIds) {
    const ch = channels.find((c) => c.id === id);
    if (!ch) {
      out[id] = [{ level: "error", message: "This channel was removed." }];
      continue;
    }
    out[id] = validateForChannel(resolveContent(post, id), ch, mediaById);
  }
  return out;
}

export function hasErrors(issues: Record<string, Issue[]>): boolean {
  return Object.values(issues).some((list) => list.some((i) => i.level === "error"));
}

/** Cut `text` to fit `limit` on a word boundary, ending with an ellipsis. */
export function truncateToLimit(networkId: string, text: string, limit: number): string {
  if (measure(networkId, text) <= limit) return text;
  const words = text.split(/(\s+)/);
  let out = "";
  for (const w of words) {
    const candidate = out + w;
    if (measure(networkId, candidate + "…") > limit) break;
    out = candidate;
  }
  return out.trimEnd() + "…";
}
