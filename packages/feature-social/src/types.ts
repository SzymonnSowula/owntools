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

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";

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
  /** Who created it — the composer, an agent over the API, or the repeat rule. */
  source: "app" | "agent" | "repeat";
  /** Id of the post this occurrence was created from. */
  repeatOf?: string | null;
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
