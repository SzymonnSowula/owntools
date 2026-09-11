/**
 * social — data model. Everything here is what lands on disk under
 * `<AppData>/social/` (see README.md for the file layout). The Rust agent
 * server reads and writes the same JSON, so field names are the contract:
 * camelCase, ISO-8601 strings for every instant, and a `version` counter on
 * each post for read-modify-write.
 */

/** Catalogue id of a network (see networks.ts). */
export type NetworkId =
  | "x"
  | "bluesky"
  | "mastodon"
  | "threads"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "linkedin-page"
  | "tiktok"
  | "youtube"
  | "pinterest"
  | "reddit"
  | "telegram"
  | "discord"
  | "slack"
  | "medium"
  | "devto"
  | "hashnode"
  | "lemmy"
  | "nostr"
  | "farcaster"
  | "vk"
  | "dribbble"
  | "tumblr"
  | "wordpress"
  | "ghost"
  | "substack"
  | "google-business"
  | "snapchat"
  | "whatsapp"
  | "twitch"
  | "kick"
  | "mattermost"
  | "nextdoor"
  | "vimeo"
  | "bilibili"
  | "xiaohongshu"
  | "weibo";

/** What a user can expect from a catalogue entry today. */
export type NetworkAvailability = "live" | "byo" | "soon";

export interface ChannelPreferences {
  /** Appended to every post on this channel (after a blank line). */
  signature?: string;
  /** Mastodon: public / unlisted / private. */
  visibility?: "public" | "unlisted" | "private";
  /** Telegram: parse mode for the message text. */
  parseMode?: "none" | "HTML" | "MarkdownV2";
  /** Dev.to / Medium: publish as draft first. */
  publishAsDraft?: boolean;
  /** Dev.to: default tags (max 4). */
  defaultTags?: string[];
  /** Override of the network's character limit (e.g. a Mastodon instance with 5000). */
  charLimit?: number;
}

/**
 * One recurring posting time of a channel's queue (Buffer-style): the days
 * of the week it applies to (0 = Sunday … 6 = Saturday) and a local
 * wall-clock "HH:MM". A channel without slots uses `DEFAULT_SLOTS`.
 */
export interface QueueSlot {
  days: number[];
  time: string;
}

export interface Channel {
  id: string;
  provider: NetworkId;
  /** "@name" — shown under the display name; also used to build post URLs. */
  handle: string;
  displayName: string;
  /** Relative path under the social folder (`avatars/<id>.jpg`) or null. */
  avatar: string | null;
  /** Grouping in the sidebar ("Personal", "Work"…). */
  collection: string;
  disabled: boolean;
  preferences: ChannelPreferences;
  /** Queue slots "Next free slot" and agents' `add_to_queue` fill first. Absent = defaults. */
  slots?: QueueSlot[];
  /**
   * Provider facts that are not secrets: Bluesky `did` + `pds`, Mastodon
   * `instance`, Telegram `chatId` + `chatUsername`, LinkedIn `authorUrn`,
   * X `userId`, Discord `channelId`/`guildId`…
   */
  meta: Record<string, string>;
  /** True for channels whose provider is only a key form today. */
  stub?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Secrets, one record per channel; stored in credentials.json. */
export type ChannelCredentials = Record<string, string>;

/**
 * `needs_review` is where a post from an agent or an automation waits while
 * "agent posts need my approval" is on: the runner never publishes it, the
 * calendar draws it hatched, and a person approves, edits or rejects it in
 * social → Review.
 */
export type PostStatus = "draft" | "needs_review" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";

/** Who created a post: the composer, an agent over the API, a repeat rule, or another tool. */
export type PostSource = "app" | "agent" | "repeat" | "automation" | "meet" | "capture" | "screeni";

export interface MediaRef {
  /** Media library id (see MediaItem). */
  id: string;
  alt?: string;
}

/** One follow-up in a thread (X, Bluesky, Mastodon, Threads). */
export interface ThreadPart {
  text: string;
  media: MediaRef[];
}

export interface PostContent {
  text: string;
  media: MediaRef[];
  thread: ThreadPart[];
  /** Article networks (Dev.to, Medium, Reddit, Hashnode…) need a title. */
  title?: string;
}

/** Per-channel override; every field is optional and falls back to the global content. */
export interface ChannelOverride {
  text?: string;
  media?: MediaRef[];
  thread?: ThreadPart[];
  title?: string;
}

export type RepeatKind = "none" | "daily" | "weekly" | "monthly" | "every-n-days";

export interface RepeatRule {
  kind: RepeatKind;
  /** For `every-n-days`. */
  every?: number;
  /** ISO date-time after which no occurrence is created. */
  until?: string | null;
}

export type ResultStatus = "pending" | "ok" | "error" | "skipped";

export interface PublishResult {
  status: ResultStatus;
  /** Public URL of the published item, when the network gives us one. */
  url?: string | null;
  /** Remote id (tweet id, status id, message id…). */
  remoteId?: string | null;
  error?: string | null;
  /** ISO time of the attempt. */
  at: string;
  /** True when produced by the browser preview instead of a network. */
  simulated?: boolean;
}

export interface Post {
  id: string;
  /** Bumped on every write; the agent server refuses stale PATCHes. */
  version: number;
  status: PostStatus;
  /** ISO-8601 with offset. Null only for drafts without a date. */
  scheduledAt: string | null;
  /** IANA zone the user picked the time in. */
  timezone: string;
  channelIds: string[];
  content: PostContent;
  overrides: Record<string, ChannelOverride>;
  /** Tag ids (tags.json). */
  tags: string[];
  repeat: RepeatRule;
  results: Record<string, PublishResult>;
  /** Publish attempts made by the runner (max 3). */
  attempts: number;
  /** When the runner may try again after a failure. */
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** Who created it — the composer, an agent over the API, the repeat rule, or another tool. */
  source: PostSource;
  /** Id of the post this occurrence was created from. */
  repeatOf?: string | null;
  /**
   * Caller-chosen idempotency key from an agent (`client_ref`): a second
   * create with the same ref returns this post instead of making another.
   */
  clientRef?: string | null;
}

/* ------------------------------------------------------------------ */
/* Activity log — <AppData>/social/activity.jsonl                       */
/* ------------------------------------------------------------------ */

export type ActivityActor = "agent" | "automation" | "user";
export type ActivityAction = "create" | "update" | "delete" | "publish" | "approve" | "reject";

/**
 * One line of `activity.jsonl`: what an agent or an automation did to a
 * post (and what a person did about it). `before` / `after` carry the whole
 * post, so an update or a delete can be undone by writing `before` back as
 * a new version. Rust appends the same shape for REST / MCP writes.
 */
export interface ActivityEntry {
  ts: string;
  actor: ActivityActor;
  action: ActivityAction;
  postId: string;
  before?: Post | null;
  after?: Post | null;
  note?: string;
}

export interface Tag {
  id: string;
  name: string;
  /** Hex colour. */
  color: string;
}

export interface MediaItem {
  id: string;
  /** Relative path under the social folder: `media/<id>.<ext>`. */
  file: string;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  /** Seconds, for video/audio. */
  duration?: number;
  alt?: string;
  createdAt: string;
}

export type AiProviderKind = "none" | "anthropic" | "openai";

export interface AiSettings {
  provider: AiProviderKind;
  /** OpenAI-compatible base URL (default https://api.openai.com/v1). */
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AgentSettings {
  enabled: boolean;
  port: number;
  /** Bearer token; generated by the desktop app on first start. */
  token: string;
}

export interface SocialSettings {
  version: number;
  /** 0 = Sunday, 1 = Monday. */
  weekStart: 0 | 1;
  /** "HH:MM" used when a post is created from the calendar without a slot. */
  defaultTime: string;
  timezone: string;
  calendarView: "week" | "month" | "list";
  /** Native + in-app notifications for publish results. */
  notifications: boolean;
  /** Posts due more than this many minutes ago wait for the catch-up sheet. */
  lateToleranceMinutes: number;
  /**
   * Posts created by an agent (REST / MCP) or an automation land as
   * `needs_review` and wait for a person in social → Review. Default on;
   * Rust reads the same key from settings.json.
   */
  agentPostsNeedApproval: boolean;
  agent: AgentSettings;
  ai: AiSettings;
  unsplashKey: string;
  /** Browser preview only: simulate networks instead of calling them. */
  simulate: boolean;
}

export interface ChannelsFile {
  version: number;
  channels: Channel[];
  /** Collection names in display order (channels can reference others too). */
  collections: string[];
}

export interface CredentialsFile {
  version: number;
  channels: Record<string, ChannelCredentials>;
}

export interface TagsFile {
  version: number;
  tags: Tag[];
}

export interface MediaFile {
  version: number;
  items: MediaItem[];
}
