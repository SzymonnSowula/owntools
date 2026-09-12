import { emitSyncApplied, onSyncTouch } from "../events";
import type { CollectionId, ItemsDoc, ScanEntry } from "../types";
import { combine, poll, type AdapterContext, type ItemsAdapter } from "./adapter";

/**
 * A collection whose items are folders under AppData (boards, meetings). The
 * doc carries one small value per folder — enough to notice a change and to
 * show a name — and the bytes travel as a whole-folder copy into this
 * device's subtree (`<syncRoot>/<id>`), from which the other device copies it
 * in. Deletion = the folder is gone. Every value must be derived from the
 * folder's *content*, never its mtimes: a copy has new mtimes and would
 * otherwise read as a fresh edit on the receiving device, forever.
 */

export interface FolderSpec<T, P = void> {
  id: CollectionId;
  label: string;
  detail: string;
  note?: string;
  /** Relative to AppData: where the folders live. */
  appRoot: string;
  /** Relative to this device's subtree in the synced folder. */
  syncRoot: string;
  exclude?: string[];
  maxBytes?: number;
  /** Runs once per read (an index to consult); passed to `describe`. */
  prepare?(ctx: AdapterContext): Promise<P>;
  /** The item value for one folder, or null to leave the folder out. */
  describe(ctx: AdapterContext, entry: ScanEntry, prepared: P): Promise<T | null>;
  nameOf(value: T): string;
  /** After copies landed / folders were removed: update an index, etc. */
  afterApply?(ctx: AdapterContext, merged: ItemsDoc<T>, applied: string[], removed: string[]): Promise<void>;
}

export const FOLDER_CAP = 20 * 1024 * 1024;

export function folderAdapter<T, P = void>(spec: FolderSpec<T, P>): ItemsAdapter<T> {
  const opts = { maxBytes: spec.maxBytes ?? FOLDER_CAP, exclude: spec.exclude ?? [] };
  return {
    kind: "items",
    id: spec.id,
    label: spec.label,
    detail: spec.detail,
    note: spec.note,
    async read(ctx) {
      const entries = (await ctx.backend.appScan(spec.appRoot)).filter((e) => e.isDir);
      const prepared = (await spec.prepare?.(ctx)) as P;
      const items: Array<{ id: string; value: T }> = [];
      let bytes = 0;
      for (const entry of entries) {
        const value = await spec.describe(ctx, entry, prepared);
        if (value === null) continue;
        items.push({ id: entry.name, value });
        bytes += entry.bytes;
      }
      return { items, bytes };
    },
    async push(ctx, doc, shadow) {
      const pushed: Record<string, number> = { ...(shadow.pushed ?? {}) };
      const dropped: string[] = [];
      for (const item of doc.items) {
        if (pushed[item.id] === item.updatedAt) continue;
        try {
          const outcome = await ctx.backend.copyOut(`${spec.appRoot}/${item.id}`, `${spec.syncRoot}/${item.id}`, opts);
          if (outcome.ok) {
            pushed[item.id] = item.updatedAt;
          } else {
            dropped.push(item.id);
            ctx.warn(`${spec.label}: "${spec.nameOf(item.value)}" not synced - ${outcome.reason ?? "copy failed"}`);
          }
        } catch (err) {
          dropped.push(item.id);
          ctx.warn(`${spec.label}: "${spec.nameOf(item.value)}" not synced - ${String(err)}`);
        }
      }
      for (const tomb of doc.tombstones) {
        if (pushed[tomb.id] === undefined) continue;
        try {
          await ctx.backend.removeOut(`${spec.syncRoot}/${tomb.id}`);
        } catch {
          /* already gone */
        }
        delete pushed[tomb.id];
      }
      return { dropped, pushed };
    },
    async apply(ctx, merged, changed, removed, origin) {
      const applied: string[] = [];
      for (const id of changed) {
        const from = origin.get(id);
        if (!from || from === ctx.me) continue;
        const item = merged.items.find((i) => i.id === id);
        try {
          const outcome = await ctx.backend.copyIn(from, `${spec.syncRoot}/${id}`, `${spec.appRoot}/${id}`, opts);
          if (outcome.ok) applied.push(id);
          else ctx.warn(`${spec.label}: "${item ? spec.nameOf(item.value) : id}" not copied in - ${outcome.reason ?? "copy failed"}`);
        } catch (err) {
          ctx.warn(`${spec.label}: "${item ? spec.nameOf(item.value) : id}" not copied in - ${String(err)}`);
        }
      }
      for (const id of removed) {
        try {
          await ctx.backend.appRemove(`${spec.appRoot}/${id}`);
        } catch (err) {
          ctx.warn(`${spec.label}: could not remove ${id} - ${String(err)}`);
        }
      }
      if (spec.afterApply) await spec.afterApply(ctx, merged, applied, removed);
      if (applied.length || removed.length) emitSyncApplied({ collection: spec.id, ids: applied, removed });
    },
    subscribe(cb) {
      const signature = () =>
        import("../api").then(({ getSyncBackend }) =>
          getSyncBackend()
            .appScan(spec.appRoot)
            .then((entries) => entries.map((e) => `${e.name}:${e.bytes}:${e.mtimeMs}`).join("|")),
        );
      return combine(poll(60_000, signature, cb), onSyncTouch(spec.id, cb));
    },
  };
}
