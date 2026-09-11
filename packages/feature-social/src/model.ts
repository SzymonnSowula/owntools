import { normalizeRepeat } from "./recurrence";
import { localTimezone } from "./time";
import type {
  AgentSettings,
  AiSettings,
  Channel,
  ChannelsFile,
  CredentialsFile,
  MediaFile,
  MediaItem,
  MediaRef,
  Post,
  PostContent,
  PostSource,
  PostStatus,
  PublishResult,
  QueueSlot,
  SocialSettings,
  Tag,
  TagsFile,
  ThreadPart,
} from "./types";

/**
 * Defaults, ids and tolerant parsers for everything on disk. Files written by
 * an older build, by hand or by an agent over the API all come through here,
 * so every parser fills gaps instead of throwing.
 */

export function newId(prefix = ""): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return prefix ? `${prefix}_${hex}` : hex;
}

export const nowIso = () => new Date().toISOString();

export const DEFAULT_COLLECTION = "Personal";
export const DEFAULT_AGENT_PORT = 7474;

/** Tag palette — Apple system hues, the only place the app uses them. */
export const TAG_COLORS = [
  "#0a84ff",
  "#5e5ce6",
  "#32ade6",
  "#30d158",
  "#ff9f0a",
  "#ff375f",
  "#bf5af2",
  "#ac8e68",
  "#6e6e73",
];

export const DEFAULT_TAGS: Tag[] = [
  { id: "tag_news", name: "News", color: "#ff375f" },
  { id: "tag_personal", name: "Personal", color: "#5e5ce6" },
  { id: "tag_product", name: "Product", color: "#0a84ff" },
];

const POST_STATUSES: PostStatus[] = ["draft", "needs_review", "scheduled", "publishing", "published", "failed", "cancelled"];
const POST_SOURCES: PostSource[] = ["app", "agent", "repeat", "automation", "meet", "capture", "screeni"];

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function emptyContent(): PostContent {
  return { text: "", media: [], thread: [] };
}

function parseMediaRefs(v: unknown): MediaRef[] {
  if (!Array.isArray(v)) return [];
  const out: MediaRef[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push({ id: item });
    else if (typeof item === "object" && item !== null && typeof (item as MediaRef).id === "string") {
      const alt = (item as MediaRef).alt;
      out.push(typeof alt === "string" ? { id: (item as MediaRef).id, alt } : { id: (item as MediaRef).id });
    }
  }
  return out;
}

function parseThread(v: unknown): ThreadPart[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((p) => {
      if (typeof p === "string") return { text: p, media: [] };
      const r = record(p);
      return { text: str(r.text), media: parseMediaRefs(r.media) };
    })
    .filter((p) => p.text.trim() || p.media.length);
}

export function parseContent(v: unknown): PostContent {
  if (typeof v === "string") return { text: v, media: [], thread: [] };
  const r = record(v);
  const content: PostContent = { text: str(r.text), media: parseMediaRefs(r.media), thread: parseThread(r.thread) };
  if (typeof r.title === "string" && r.title.trim()) content.title = r.title;
  return content;
}

function parseResult(v: unknown): PublishResult | null {
  const r = record(v);
  const status = r.status;
  if (status !== "pending" && status !== "ok" && status !== "error" && status !== "skipped") return null;
  const out: PublishResult = { status, at: str(r.at, nowIso()) };
  if (typeof r.url === "string") out.url = r.url;
  if (typeof r.remoteId === "string") out.remoteId = r.remoteId;
  if (typeof r.error === "string") out.error = r.error;
  if (r.simulated === true) out.simulated = true;
  return out;
}

export function newPost(patch: Partial<Post> = {}): Post {
  const at = nowIso();
  return {
    id: newId("post"),
    version: 1,
    status: "draft",
    scheduledAt: null,
    timezone: localTimezone(),
    channelIds: [],
    content: emptyContent(),
    overrides: {},
    tags: [],
    repeat: { kind: "none" },
    results: {},
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
    publishedAt: null,
    source: "app",
    repeatOf: null,
    ...patch,
  };
}

/** Post from JSON; null when there is no usable id. */
export function parsePost(raw: unknown): Post | null {
  const r = record(raw);
  const id = str(r.id);
  if (!id) return null;
  const overridesRaw = record(r.overrides);
  const overrides: Post["overrides"] = {};
  for (const [cid, o] of Object.entries(overridesRaw)) {
    const rec = record(o);
    const out: Post["overrides"][string] = {};
    if (typeof rec.text === "string") out.text = rec.text;
    if (Array.isArray(rec.media)) out.media = parseMediaRefs(rec.media);
    if (Array.isArray(rec.thread)) out.thread = parseThread(rec.thread);
    if (typeof rec.title === "string") out.title = rec.title;
    overrides[cid] = out;
  }
  const results: Post["results"] = {};
  for (const [cid, res] of Object.entries(record(r.results))) {
    const parsed = parseResult(res);
    if (parsed) results[cid] = parsed;
  }
  const status = POST_STATUSES.includes(r.status as PostStatus) ? (r.status as PostStatus) : "draft";
  const source = POST_SOURCES.includes(r.source as PostSource) ? (r.source as PostSource) : "app";
  const clientRef = typeof r.clientRef === "string" && r.clientRef ? r.clientRef : typeof r.client_ref === "string" && r.client_ref ? r.client_ref : null;
  return {
    id,
    version: Math.max(1, Math.round(num(r.version, 1))),
    status,
    scheduledAt: typeof r.scheduledAt === "string" && r.scheduledAt ? r.scheduledAt : null,
    timezone: str(r.timezone, localTimezone()),
    channelIds: strList(r.channelIds),
    content: parseContent(r.content),
    overrides,
    tags: strList(r.tags),
    repeat: normalizeRepeat(r.repeat),
    results,
    attempts: Math.max(0, Math.round(num(r.attempts))),
    nextAttemptAt: typeof r.nextAttemptAt === "string" ? r.nextAttemptAt : null,
    lastError: typeof r.lastError === "string" ? r.lastError : null,
    createdAt: str(r.createdAt, nowIso()),
    updatedAt: str(r.updatedAt, nowIso()),
    publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : null,
    source,
    repeatOf: typeof r.repeatOf === "string" ? r.repeatOf : null,
    clientRef,
  };
}

/** Queue slots from JSON: days 0–6 (unique, sorted), a valid "HH:MM"; anything else is dropped. */
export function parseSlots(raw: unknown): QueueSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: QueueSlot[] = [];
  for (const item of raw) {
    const r = record(item);
    const days = Array.from(
      new Set((Array.isArray(r.days) ? r.days : []).filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)),
    ).sort((a, b) => a - b);
    const time = str(r.time).trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!days.length || !m || Number(m[1]) > 23 || Number(m[2]) > 59) continue;
    out.push({ days, time: `${m[1]!.padStart(2, "0")}:${m[2]}` });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export function parseChannel(raw: unknown): Channel | null {
  const r = record(raw);
  const id = str(r.id);
  const provider = str(r.provider);
  if (!id || !provider) return null;
  const prefs = record(r.preferences);
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(r.meta))) if (typeof v === "string") meta[k] = v;
  const channel: Channel = {
    id,
    provider: provider as Channel["provider"],
    handle: str(r.handle),
    displayName: str(r.displayName, str(r.handle, provider)),
    avatar: typeof r.avatar === "string" && r.avatar ? r.avatar : null,
    collection: str(r.collection, DEFAULT_COLLECTION) || DEFAULT_COLLECTION,
    disabled: bool(r.disabled),
    preferences: {},
    meta,
    createdAt: str(r.createdAt, nowIso()),
    updatedAt: str(r.updatedAt, nowIso()),
  };
  if (typeof prefs.signature === "string") channel.preferences.signature = prefs.signature;
  if (prefs.visibility === "public" || prefs.visibility === "unlisted" || prefs.visibility === "private") {
    channel.preferences.visibility = prefs.visibility;
  }
  if (prefs.parseMode === "none" || prefs.parseMode === "HTML" || prefs.parseMode === "MarkdownV2") {
    channel.preferences.parseMode = prefs.parseMode;
  }
  if (typeof prefs.publishAsDraft === "boolean") channel.preferences.publishAsDraft = prefs.publishAsDraft;
  if (Array.isArray(prefs.defaultTags)) channel.preferences.defaultTags = strList(prefs.defaultTags);
  if (typeof prefs.charLimit === "number" && prefs.charLimit > 0) channel.preferences.charLimit = prefs.charLimit;
  if (r.stub === true) channel.stub = true;
  const slots = parseSlots(r.slots);
  if (slots.length) channel.slots = slots;
  return channel;
}

export function parseChannelsFile(raw: unknown): ChannelsFile {
  const r = record(raw);
  const channels: Channel[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r.channels) ? r.channels : []) {
    const ch = parseChannel(item);
    if (ch && !seen.has(ch.id)) {
      seen.add(ch.id);
      channels.push(ch);
    }
  }
  const collections = strList(r.collections);
  for (const ch of channels) if (!collections.includes(ch.collection)) collections.push(ch.collection);
  if (collections.length === 0) collections.push(DEFAULT_COLLECTION);
  return { version: 1, channels, collections };
}

export function parseCredentialsFile(raw: unknown): CredentialsFile {
  const r = record(raw);
  const channels: CredentialsFile["channels"] = {};
  for (const [id, creds] of Object.entries(record(r.channels))) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(record(creds))) if (typeof v === "string") out[k] = v;
    channels[id] = out;
  }
  return { version: 1, channels };
}

export function parseTagsFile(raw: unknown): TagsFile {
  const r = record(raw);
  if (!Array.isArray(r.tags)) return { version: 1, tags: DEFAULT_TAGS.map((t) => ({ ...t })) };
  const tags: Tag[] = [];
  for (const item of r.tags) {
    const t = record(item);
    const id = str(t.id);
    const name = str(t.name).trim();
    if (!id || !name) continue;
    tags.push({ id, name, color: /^#[0-9a-f]{6}$/i.test(str(t.color)) ? str(t.color) : TAG_COLORS[0]! });
  }
  return { version: 1, tags };
}

export function parseMediaItem(raw: unknown): MediaItem | null {
  const r = record(raw);
  const id = str(r.id);
  const file = str(r.file);
  if (!id || !file) return null;
  const item: MediaItem = {
    id,
    file,
    name: str(r.name, file.split("/").pop() ?? id),
    mime: str(r.mime, "application/octet-stream"),
    bytes: Math.max(0, Math.round(num(r.bytes))),
    createdAt: str(r.createdAt, nowIso()),
  };
  if (typeof r.width === "number") item.width = r.width;
  if (typeof r.height === "number") item.height = r.height;
  if (typeof r.duration === "number") item.duration = r.duration;
  if (typeof r.alt === "string") item.alt = r.alt;
  return item;
}

export function parseMediaFile(raw: unknown): MediaFile {
  const r = record(raw);
  const items: MediaItem[] = [];
  for (const item of Array.isArray(r.items) ? r.items : []) {
    const m = parseMediaItem(item);
    if (m) items.push(m);
  }
  return { version: 1, items };
}

export function defaultAgentSettings(): AgentSettings {
  return { enabled: true, port: DEFAULT_AGENT_PORT, token: "" };
}

export function defaultAiSettings(): AiSettings {
  return { provider: "none", baseUrl: "https://api.openai.com/v1", model: "", apiKey: "" };
}

export function defaultSettings(): SocialSettings {
  return {
    version: 1,
    weekStart: 1,
    defaultTime: "09:00",
    timezone: localTimezone(),
    calendarView: "week",
    notifications: true,
    lateToleranceMinutes: 10,
    agentPostsNeedApproval: true,
    agent: defaultAgentSettings(),
    ai: defaultAiSettings(),
    unsplashKey: "",
    simulate: false,
  };
}

export function parseSettings(raw: unknown): SocialSettings {
  const d = defaultSettings();
  const r = record(raw);
  const agent = record(r.agent);
  const ai = record(r.ai);
  const provider = ai.provider === "anthropic" || ai.provider === "openai" ? ai.provider : "none";
  return {
    version: 1,
    weekStart: r.weekStart === 0 ? 0 : 1,
    defaultTime: /^\d{1,2}:\d{2}$/.test(str(r.defaultTime)) ? str(r.defaultTime) : d.defaultTime,
    timezone: str(r.timezone, d.timezone) || d.timezone,
    calendarView: r.calendarView === "month" || r.calendarView === "list" ? r.calendarView : "week",
    notifications: bool(r.notifications, true),
    lateToleranceMinutes: Math.min(720, Math.max(1, Math.round(num(r.lateToleranceMinutes, d.lateToleranceMinutes)))),
    agentPostsNeedApproval: bool(r.agentPostsNeedApproval, true),
    agent: {
      enabled: bool(agent.enabled, true),
      port: Math.min(65535, Math.max(1024, Math.round(num(agent.port, DEFAULT_AGENT_PORT)))),
      token: str(agent.token),
    },
    ai: { provider, baseUrl: str(ai.baseUrl, d.ai.baseUrl) || d.ai.baseUrl, model: str(ai.model), apiKey: str(ai.apiKey) },
    unsplashKey: str(r.unsplashKey),
    simulate: bool(r.simulate),
  };
}

/** Extension for a media file from its MIME type. */
export function extensionFor(mime: string, name = ""): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "application/pdf": "pdf",
  };
  return map[mime] ?? fromName ?? "bin";
}

/** Short, human summary of a post for cards and notifications. */
export function postSummary(post: Post, max = 80): string {
  const text = post.content.text.replace(/\s+/g, " ").trim();
  if (text) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  if (post.content.media.length) return `${post.content.media.length} media item${post.content.media.length === 1 ? "" : "s"}`;
  return "Empty post";
}

export function postIsEmpty(post: Post): boolean {
  return !post.content.text.trim() && post.content.media.length === 0 && post.content.thread.length === 0;
}
