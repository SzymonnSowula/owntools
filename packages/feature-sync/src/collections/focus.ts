import { emptyNotebook } from "@feature-focus/lib/notebook";
import {
  deletePersisted,
  loadPersisted,
  savePersisted,
  saveWorkspacesMeta,
  type WorkspaceMeta,
  type WorkspaceRitual,
} from "@feature-focus/store/persist";
import { blankState } from "@feature-focus/store/seed";
import { useAppStore } from "@feature-focus/store/useAppStore";
import type { AppData } from "@feature-focus/types";
import { bytesOf, isRecord, type ItemsAdapter } from "./adapter";

/**
 * focus, one item per **workspace**, each a whole value.
 *
 * Why not per task: tasks and habits carry `createdAt` only (a toggle, a
 * rename or a check stamps nothing), lists and planner blocks are ordered by
 * their place in the array, and only notes and notebook pages have an
 * `updatedAt`. Per-item merging would need every mutation in the store to
 * stamp, which is not this package's file to change. So a workspace is the
 * unit: the device that saved it last wins it whole — said plainly in the card.
 *
 * What travels: lists, tasks, notes, habits, journal, planner, notebook, and
 * the workspace's name, emoji and ritual. What stays on the device: the
 * heatmap and usage stats (one machine's hours are not the other's), the
 * running timer, view state, sounds, records, piano and the settings
 * (theme, tray, scroll guard — machine preferences).
 */

export const FOCUS_SECTIONS = ["lists", "tasks", "notes", "habits", "journal", "planner", "notebook"] as const;
export type FocusSection = (typeof FOCUS_SECTIONS)[number];
export type FocusSections = Pick<AppData, FocusSection>;

export interface WorkspaceBundle {
  meta: { name: string; emoji: string; createdAt: string; ritual?: WorkspaceRitual };
  data: FocusSections;
}

export function pickSections(data: Partial<AppData> | null | undefined): FocusSections {
  return {
    lists: Array.isArray(data?.lists) ? data.lists : [],
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    notes: Array.isArray(data?.notes) ? data.notes : [],
    habits: Array.isArray(data?.habits) ? data.habits : [],
    journal: Array.isArray(data?.journal) ? data.journal : [],
    planner: Array.isArray(data?.planner) ? data.planner : [],
    notebook: isRecord(data?.notebook) ? (data.notebook as AppData["notebook"]) : emptyNotebook(),
  };
}

function isBundle(v: unknown): v is WorkspaceBundle {
  return isRecord(v) && isRecord(v.meta) && typeof v.meta.name === "string" && isRecord(v.data);
}

export const focusAdapter: ItemsAdapter<WorkspaceBundle> = {
  kind: "items",
  id: "focus",
  label: "focus workspaces",
  detail: "tasks, notes, habits, journal, planner and notebook, per workspace",
  note: "Last writer wins for focus data: the device that saved a workspace last replaces the other's copy of it. Stats, the timer, sounds and preferences stay on each device.",
  async read() {
    const s = useAppStore.getState();
    if (!s.ready) return null;
    const items: Array<{ id: string; value: WorkspaceBundle }> = [];
    for (const ws of s.workspaces) {
      const data = ws.id === s.workspaceId ? s.exportWorkspaceData() : await loadPersisted(ws.id);
      const sections = pickSections(data ?? blankState(s.settings));
      const meta: WorkspaceBundle["meta"] = { name: ws.name, emoji: ws.emoji, createdAt: ws.createdAt };
      if (ws.ritual) meta.ritual = ws.ritual;
      items.push({ id: ws.id, value: { meta, data: sections } });
    }
    return { items, bytes: bytesOf(items.map((i) => i.value.data)) };
  },
  async apply(ctx, merged, changed, removed) {
    const s = useAppStore.getState();
    if (!s.ready) return;
    let workspaces = s.workspaces;
    for (const id of changed) {
      const item = merged.items.find((i) => i.id === id);
      if (!item || !isBundle(item.value)) continue;
      const { meta, data } = item.value;
      const sections = pickSections(data);
      const existing = workspaces.find((w) => w.id === id);
      const next: WorkspaceMeta = {
        id,
        name: meta.name || existing?.name || "Workspace",
        emoji: typeof meta.emoji === "string" && meta.emoji ? meta.emoji : existing?.emoji ?? "📁",
        createdAt: existing?.createdAt ?? (typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString()),
      };
      if (meta.ritual) next.ritual = meta.ritual;
      workspaces = existing ? workspaces.map((w) => (w.id === id ? { ...w, ...next } : w)) : [...workspaces, next];
      if (id === useAppStore.getState().workspaceId) {
        // The live store: swap the content sections in place and persist the
        // way the store does, so the views update and nothing else is touched.
        useAppStore.setState(sections);
        await savePersisted(useAppStore.getState().exportWorkspaceData(), id);
      } else {
        const current = (await loadPersisted(id)) ?? blankState(s.settings);
        await savePersisted({ ...current, ...sections }, id);
      }
    }
    for (const id of removed) {
      const ws = workspaces.find((w) => w.id === id);
      if (id === useAppStore.getState().workspaceId || workspaces.length <= 1) {
        ctx.warn(`Workspace "${ws?.name ?? id}" was deleted on another device; it stays here because it is open.`);
        continue;
      }
      workspaces = workspaces.filter((w) => w.id !== id);
      await deletePersisted(id);
    }
    if (workspaces !== s.workspaces) {
      useAppStore.setState({ workspaces });
      await saveWorkspacesMeta({ version: 1, active: useAppStore.getState().workspaceId, list: workspaces });
    }
  },
  subscribe(cb) {
    let prev = useAppStore.getState();
    return useAppStore.subscribe((s) => {
      const was = prev;
      prev = s;
      if (!s.ready) return;
      // References are stable for untouched slices, so this is O(1) per tick —
      // the timer ticks four times a second and must not count as an edit.
      const moved =
        s.workspaces !== was.workspaces ||
        s.workspaceId !== was.workspaceId ||
        s.ready !== was.ready ||
        FOCUS_SECTIONS.some((k) => s[k] !== was[k]);
      if (moved) cb();
    });
  },
};
