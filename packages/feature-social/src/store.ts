import { create } from "zustand";
import { isTauri } from "@core/env";
import { logError } from "@core/errors";
import {
  DEFAULT_COLLECTION,
  defaultSettings,
  extensionFor,
  newId,
  newPost,
  nowIso,
  parseChannelsFile,
  parseCredentialsFile,
  parseMediaFile,
  parsePost,
  parseSettings,
  parseTagsFile,
  TAG_COLORS,
} from "./model";
import { getSocialStorage, PATHS, postPath, safeId, type SocialStorage } from "./storage";
import type {
  Channel,
  ChannelCredentials,
  ChannelsFile,
  CredentialsFile,
  MediaFile,
  MediaItem,
  Post,
  SocialSettings,
  Tag,
  TagsFile,
} from "./types";

/**
 * The one store for social. Files are the truth: every mutation reads the
 * file fresh, applies the change and writes it back (the Rust agent server
 * edits the same files), then the in-memory copy is refreshed. `reload()`
 * re-reads everything and is what the `social-changed` event triggers.
 */

export const SOCIAL_CHANGED_EVENT = "social-changed";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  title: string;
  body?: string;
  /** Optional link (a published post). */
  url?: string | null;
}

export interface SocialState {
  ready: boolean;
  loadError: string | null;
  storage: SocialStorage;
  channels: Channel[];
  collections: string[];
  credentials: Record<string, ChannelCredentials>;
  posts: Post[];
  tags: Tag[];
  media: MediaItem[];
  settings: SocialSettings;
  /** Posts that were due while the app was closed and wait for a decision. */
  catchUp: Post[];
  toasts: Toast[];
  /** In-flight publishes (post ids), so two ticks never publish the same post. */
  publishing: Set<string>;

  load(): Promise<void>;
  reload(): Promise<void>;

  createPost(post: Post): Promise<Post>;
  updatePost(id: string, change: (post: Post) => Post): Promise<Post | null>;
  deletePost(id: string): Promise<void>;
  getPost(id: string): Post | undefined;

  addChannel(channel: Omit<Channel, "id" | "createdAt" | "updatedAt">, creds: ChannelCredentials, avatar?: { bytes: Uint8Array; mime: string } | null): Promise<Channel>;
  updateChannel(id: string, patch: Partial<Channel>): Promise<void>;
  saveCredentials(id: string, creds: ChannelCredentials): Promise<void>;
  removeChannel(id: string): Promise<void>;
  renameCollection(from: string, to: string): Promise<void>;

  addTag(name: string, color?: string): Promise<Tag>;
  updateTag(id: string, patch: Partial<Tag>): Promise<void>;
  removeTag(id: string): Promise<void>;

  addMedia(input: { bytes: Uint8Array; name: string; mime: string; alt?: string }): Promise<MediaItem>;
  removeMedia(id: string): Promise<void>;
  mediaUrl(id: string): Promise<string | null>;
  avatarUrl(channel: Channel): Promise<string | null>;

  saveSettings(patch: Partial<SocialSettings>): Promise<void>;

  setCatchUp(posts: Post[]): void;
  toast(t: Omit<Toast, "id">): void;
  dismissToast(id: string): void;
  markPublishing(id: string, on: boolean): void;
}

async function readJson<T>(storage: SocialStorage, rel: string, parse: (raw: unknown) => T): Promise<T> {
  const text = await storage.readText(rel);
  if (text === null) return parse(null);
  try {
    return parse(JSON.parse(text));
  } catch (err) {
    logError("social", `parse ${rel}`, err);
    return parse(null);
  }
}

async function writeJson(storage: SocialStorage, rel: string, value: unknown): Promise<void> {
  await storage.writeText(rel, JSON.stringify(value, null, 2));
}

async function readAllPosts(storage: SocialStorage): Promise<Post[]> {
  const names = await storage.list(PATHS.posts);
  const posts: Post[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const text = await storage.readText(`${PATHS.posts}/${name}`);
    if (!text) continue;
    try {
      const post = parsePost(JSON.parse(text));
      if (post) posts.push(post);
    } catch (err) {
      logError("social", `parse post ${name}`, err);
    }
  }
  return posts;
}

/** Newest scheduled time first is what most views want; stable by id. */
export function sortPosts(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const ta = a.scheduledAt ?? a.createdAt;
    const tb = b.scheduledAt ?? b.createdAt;
    return ta < tb ? -1 : ta > tb ? 1 : a.id.localeCompare(b.id);
  });
}

/**
 * Settings on the frontend side never touch the `agent` block — Rust owns it
 * (token generation, port, enabled) — so a save re-reads the file and keeps
 * whatever the agent block on disk says.
 */
async function writeSettingsPreservingAgent(storage: SocialStorage, next: SocialSettings): Promise<SocialSettings> {
  const onDisk = await readJson(storage, PATHS.settings, parseSettings);
  const merged: SocialSettings = { ...next, agent: onDisk.agent };
  await writeJson(storage, PATHS.settings, merged);
  return merged;
}

/** Serialise mutations per file so two quick edits never interleave. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
}

const urlCache = new Map<string, string>();

export const useSocialStore = create<SocialState>((set, get) => ({
  ready: false,
  loadError: null,
  storage: getSocialStorage(),
  channels: [],
  collections: [DEFAULT_COLLECTION],
  credentials: {},
  posts: [],
  tags: [],
  media: [],
  settings: defaultSettings(),
  catchUp: [],
  toasts: [],
  publishing: new Set(),

  async load() {
    if (get().ready) return;
    await get().reload();
  },

  async reload() {
    const { storage } = get();
    try {
      const [channelsFile, credsFile, tagsFile, mediaFile, settingsRaw, posts] = await Promise.all([
        readJson(storage, PATHS.channels, parseChannelsFile),
        readJson(storage, PATHS.credentials, parseCredentialsFile),
        readJson(storage, PATHS.tags, parseTagsFile),
        readJson(storage, PATHS.media, parseMediaFile),
        readJson(storage, PATHS.settings, parseSettings),
        readAllPosts(storage),
      ]);
      let settings = settingsRaw;
      if (!isTauri() && !settings.simulate) settings = { ...settings, simulate: true };
      set({
        ready: true,
        loadError: null,
        channels: channelsFile.channels,
        collections: channelsFile.collections,
        credentials: credsFile.channels,
        tags: tagsFile.tags,
        media: mediaFile.items,
        settings,
        posts: sortPosts(posts),
      });
    } catch (err) {
      logError("social", "load", err);
      set({ ready: true, loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  getPost(id) {
    return get().posts.find((p) => p.id === id);
  },

  async createPost(post) {
    const { storage } = get();
    const fresh: Post = { ...post, id: post.id || newId("post"), version: 1, createdAt: post.createdAt || nowIso(), updatedAt: nowIso() };
    await writeJson(storage, postPath(safeId(fresh.id)), fresh);
    set((s) => ({ posts: sortPosts([...s.posts.filter((p) => p.id !== fresh.id), fresh]) }));
    return fresh;
  },

  async updatePost(id, change) {
    const { storage } = get();
    return withLock(`post:${id}`, async () => {
      const rel = postPath(safeId(id));
      const text = await storage.readText(rel);
      let current: Post | null = null;
      if (text) {
        try {
          current = parsePost(JSON.parse(text));
        } catch (err) {
          logError("social", `re-read ${id}`, err);
        }
      }
      if (!current) current = get().posts.find((p) => p.id === id) ?? null;
      if (!current) return null;
      const next: Post = { ...change(current), id, version: current.version + 1, updatedAt: nowIso() };
      await writeJson(storage, rel, next);
      set((s) => ({ posts: sortPosts([...s.posts.filter((p) => p.id !== id), next]) }));
      return next;
    });
  },

  async deletePost(id) {
    const { storage } = get();
    await storage.remove(postPath(safeId(id)));
    set((s) => ({ posts: s.posts.filter((p) => p.id !== id), catchUp: s.catchUp.filter((p) => p.id !== id) }));
  },

  async addChannel(channel, creds, avatar) {
    const { storage } = get();
    const id = newId("ch");
    const at = nowIso();
    let avatarRel: string | null = null;
    if (avatar) {
      avatarRel = `${PATHS.avatars}/${id}.${extensionFor(avatar.mime)}`;
      try {
        await storage.writeBinary(avatarRel, avatar.bytes);
      } catch (err) {
        logError("social", "avatar write", err);
        avatarRel = null;
      }
    }
    const full: Channel = { ...channel, id, avatar: avatarRel, createdAt: at, updatedAt: at };
    await withLock("channels", async () => {
      const file = await readJson(storage, PATHS.channels, parseChannelsFile);
      file.channels.push(full);
      if (!file.collections.includes(full.collection)) file.collections.push(full.collection);
      await writeJson(storage, PATHS.channels, file satisfies ChannelsFile);
      const cf = await readJson(storage, PATHS.credentials, parseCredentialsFile);
      cf.channels[id] = creds;
      await writeJson(storage, PATHS.credentials, cf satisfies CredentialsFile);
      set({ channels: file.channels, collections: file.collections, credentials: cf.channels });
    });
    return full;
  },

  async updateChannel(id, patch) {
    const { storage } = get();
    await withLock("channels", async () => {
      const file = await readJson(storage, PATHS.channels, parseChannelsFile);
      const i = file.channels.findIndex((c) => c.id === id);
      if (i < 0) return;
      file.channels[i] = { ...file.channels[i]!, ...patch, id, updatedAt: nowIso() };
      const col = file.channels[i]!.collection;
      if (!file.collections.includes(col)) file.collections.push(col);
      await writeJson(storage, PATHS.channels, file);
      set({ channels: file.channels, collections: file.collections });
    });
  },

  async saveCredentials(id, creds) {
    const { storage } = get();
    await withLock("credentials", async () => {
      const cf = await readJson(storage, PATHS.credentials, parseCredentialsFile);
      cf.channels[id] = creds;
      await writeJson(storage, PATHS.credentials, cf);
      set({ credentials: cf.channels });
    });
  },

  async removeChannel(id) {
    const { storage } = get();
    await withLock("channels", async () => {
      const file = await readJson(storage, PATHS.channels, parseChannelsFile);
      const gone = file.channels.find((c) => c.id === id);
      file.channels = file.channels.filter((c) => c.id !== id);
      await writeJson(storage, PATHS.channels, file);
      const cf = await readJson(storage, PATHS.credentials, parseCredentialsFile);
      delete cf.channels[id];
      await writeJson(storage, PATHS.credentials, cf);
      if (gone?.avatar) await storage.remove(gone.avatar).catch(() => undefined);
      set({ channels: file.channels, collections: file.collections, credentials: cf.channels });
    });
  },

  async renameCollection(from, to) {
    const { storage } = get();
    const name = to.trim() || DEFAULT_COLLECTION;
    await withLock("channels", async () => {
      const file = await readJson(storage, PATHS.channels, parseChannelsFile);
      file.channels = file.channels.map((c) => (c.collection === from ? { ...c, collection: name } : c));
      file.collections = Array.from(new Set(file.collections.map((c) => (c === from ? name : c))));
      await writeJson(storage, PATHS.channels, file);
      set({ channels: file.channels, collections: file.collections });
    });
  },

  async addTag(name, color) {
    const { storage } = get();
    const tag: Tag = { id: newId("tag"), name: name.trim(), color: color ?? TAG_COLORS[get().tags.length % TAG_COLORS.length]! };
    await withLock("tags", async () => {
      const file = await readJson(storage, PATHS.tags, parseTagsFile);
      file.tags.push(tag);
      await writeJson(storage, PATHS.tags, file satisfies TagsFile);
      set({ tags: file.tags });
    });
    return tag;
  },

  async updateTag(id, patch) {
    const { storage } = get();
    await withLock("tags", async () => {
      const file = await readJson(storage, PATHS.tags, parseTagsFile);
      file.tags = file.tags.map((t) => (t.id === id ? { ...t, ...patch, id } : t));
      await writeJson(storage, PATHS.tags, file);
      set({ tags: file.tags });
    });
  },

  async removeTag(id) {
    const { storage } = get();
    await withLock("tags", async () => {
      const file = await readJson(storage, PATHS.tags, parseTagsFile);
      file.tags = file.tags.filter((t) => t.id !== id);
      await writeJson(storage, PATHS.tags, file);
      set({ tags: file.tags });
    });
  },

  async addMedia(input) {
    const { storage } = get();
    const id = newId("m");
    const ext = extensionFor(input.mime, input.name);
    const rel = `${PATHS.mediaDir}/${id}.${ext}`;
    await storage.writeBinary(rel, input.bytes);
    const item: MediaItem = { id, file: rel, name: input.name || `${id}.${ext}`, mime: input.mime, bytes: input.bytes.length, createdAt: nowIso() };
    if (input.alt) item.alt = input.alt;
    const dims = await probeMedia(input.bytes, input.mime).catch(() => null);
    if (dims) Object.assign(item, dims);
    await withLock("media", async () => {
      const file = await readJson(storage, PATHS.media, parseMediaFile);
      file.items.push(item);
      await writeJson(storage, PATHS.media, file satisfies MediaFile);
      set({ media: file.items });
    });
    return item;
  },

  async removeMedia(id) {
    const { storage } = get();
    await withLock("media", async () => {
      const file = await readJson(storage, PATHS.media, parseMediaFile);
      const gone = file.items.find((m) => m.id === id);
      file.items = file.items.filter((m) => m.id !== id);
      await writeJson(storage, PATHS.media, file);
      if (gone) await storage.remove(gone.file).catch(() => undefined);
      urlCache.delete(id);
      set({ media: file.items });
    });
  },

  async mediaUrl(id) {
    const hit = urlCache.get(id);
    if (hit) return hit;
    const item = get().media.find((m) => m.id === id);
    if (!item) return null;
    const url = await get().storage.fileUrl(item.file);
    if (url) urlCache.set(id, url);
    return url;
  },

  async avatarUrl(channel) {
    if (!channel.avatar) return null;
    const key = `avatar:${channel.id}:${channel.updatedAt}`;
    const hit = urlCache.get(key);
    if (hit) return hit;
    const url = await get().storage.fileUrl(channel.avatar, Date.parse(channel.updatedAt) || 0);
    if (url) urlCache.set(key, url);
    return url;
  },

  async saveSettings(patch) {
    const { storage } = get();
    await withLock("settings", async () => {
      const next = { ...get().settings, ...patch };
      const merged = await writeSettingsPreservingAgent(storage, next);
      set({ settings: { ...merged, simulate: next.simulate } });
    });
  },

  setCatchUp(posts) {
    set({ catchUp: posts });
  },

  toast(t) {
    const id = newId("toast");
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.kind === "error" ? 9000 : 5000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  markPublishing(id, on) {
    set((s) => {
      const next = new Set(s.publishing);
      if (on) next.add(id);
      else next.delete(id);
      return { publishing: next };
    });
  },
}));

/** Width/height for images, duration + dims for video — for previews and per-network checks. */
async function probeMedia(bytes: Uint8Array, mime: string): Promise<Partial<MediaItem> | null> {
  if (typeof document === "undefined") return null;
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    if (mime.startsWith("image/")) {
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }
    if (mime.startsWith("video/")) {
      return await new Promise((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: Math.round(v.duration * 10) / 10 });
        v.onerror = () => resolve(null);
        v.src = url;
      });
    }
    return null;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Helpers used by several views. */
export function channelById(channels: Channel[], id: string): Channel | undefined {
  return channels.find((c) => c.id === id);
}

export function tagById(tags: Tag[], id: string): Tag | undefined {
  return tags.find((t) => t.id === id);
}

export function mediaById(media: MediaItem[]): (id: string) => MediaItem | undefined {
  const map = new Map(media.map((m) => [m.id, m]));
  return (id) => map.get(id);
}

export function newDraft(channelIds: string[], scheduledAt: string | null): Post {
  return newPost({ channelIds, scheduledAt, status: "draft" });
}
