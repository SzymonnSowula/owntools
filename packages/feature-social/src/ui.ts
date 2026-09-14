import { create } from "zustand";
import { useEffect, useState } from "react";
import { useSocialStore } from "./store";
import type { Post, PostStatus } from "./types";

/** View-only state of the social tool (nothing here is persisted). */

export type Page = "calendar" | "review" | "channels" | "media" | "analytics" | "agents" | "settings";
export type CalendarView = "week" | "month" | "list";

export interface Filters {
  channelIds: string[];
  tagIds: string[];
  statuses: PostStatus[];
}

interface ComposerState {
  open: boolean;
  /** Existing post to edit, or null for a new one. */
  postId: string | null;
  /** Seed for a new post (slot time, preselected channels). */
  seed: Partial<Post> | null;
}

interface UiState {
  page: Page;
  view: CalendarView;
  anchor: Date;
  filters: Filters;
  composer: ComposerState;
  addChannelOpen: boolean;
  /** Set while the add-channel dialog signs an existing channel in again (same id, new credentials). */
  reconnectId: string | null;
  /** Post id whose hover preview is showing. */
  setPage(page: Page): void;
  setView(view: CalendarView): void;
  setAnchor(anchor: Date): void;
  setFilters(patch: Partial<Filters>): void;
  openComposer(postId: string | null, seed?: Partial<Post> | null): void;
  closeComposer(): void;
  setAddChannelOpen(open: boolean): void;
  openReconnect(channelId: string): void;
}

export const useUi = create<UiState>((set) => ({
  page: "calendar",
  view: "week",
  anchor: new Date(),
  filters: { channelIds: [], tagIds: [], statuses: [] },
  composer: { open: false, postId: null, seed: null },
  addChannelOpen: false,
  reconnectId: null,
  setPage: (page) => set({ page }),
  setView: (view) => set({ view }),
  setAnchor: (anchor) => set({ anchor }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  openComposer: (postId, seed = null) => set({ composer: { open: true, postId, seed } }),
  closeComposer: () => set((s) => ({ composer: { ...s.composer, open: false } })),
  setAddChannelOpen: (addChannelOpen) => set({ addChannelOpen, reconnectId: null }),
  openReconnect: (channelId) => set({ addChannelOpen: true, reconnectId: channelId }),
}));

/** Object/asset URL of a media item, or null while loading / when missing. */
export function useMediaUrl(id: string | null | undefined): string | null {
  const mediaUrl = useSocialStore((s) => s.mediaUrl);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    void mediaUrl(id).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [id, mediaUrl]);
  return url;
}

export function postMatchesFilters(post: Post, filters: Filters): boolean {
  if (filters.channelIds.length && !post.channelIds.some((id) => filters.channelIds.includes(id))) return false;
  if (filters.tagIds.length && !post.tags.some((id) => filters.tagIds.includes(id))) return false;
  if (filters.statuses.length && !filters.statuses.includes(post.status)) return false;
  return true;
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  cancelled: "Skipped",
};
