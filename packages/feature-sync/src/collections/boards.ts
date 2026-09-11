import { parseIndex, type BoardIndex, type BoardMeta } from "@feature-board/boards";
import { hashOf } from "../merge";
import { isRecord, type AdapterContext } from "./adapter";
import { folderAdapter } from "./folderCollection";

/**
 * Boards: `<AppData>/board/boards/<id>/` copied whole (scene, images,
 * thumbnail; 20 MB cap, larger boards are skipped and named in the card).
 * The value is the board's row from `index.json` plus a content fingerprint
 * of `scene.json`, so an edit anywhere shows up as a changed value.
 *
 * Deletion is "the folder is gone", not "the row is gone": the board view
 * keeps the index in memory and writes it back whole, so a row it never
 * loaded can drop out of `index.json` while the folder is still there. That
 * is drift, not a deletion, and `afterApply` puts the row back.
 */

export const BOARD_INDEX = "board/index.json";
export const BOARDS_ROOT = "board/boards";

export interface BoardItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbAt: number;
  /** Fingerprint of scene.json (content, not mtime). */
  scene: string;
  bytes: number;
}

function isBoardItem(v: unknown): v is BoardItem {
  return isRecord(v) && typeof v.id === "string" && typeof v.name === "string" && typeof v.updatedAt === "number";
}

async function readIndex(ctx: AdapterContext): Promise<BoardIndex> {
  return parseIndex(await ctx.backend.appReadText(BOARD_INDEX));
}

export const boardsAdapter = folderAdapter<BoardItem, BoardIndex>({
  id: "boards",
  label: "Boards",
  detail: "every board with its images and preview (up to 20 MB each)",
  appRoot: BOARDS_ROOT,
  syncRoot: "boards",
  prepare: readIndex,
  async describe(ctx, entry, index) {
    const scene = await ctx.backend.appReadText(`${BOARDS_ROOT}/${entry.name}/scene.json`);
    if (scene === null) return null; // a folder without a scene is not a board yet
    const meta = index.boards.find((b) => b.id === entry.name);
    return {
      id: entry.name,
      name: meta?.name ?? "Untitled board",
      createdAt: meta?.createdAt ?? 0,
      updatedAt: meta?.updatedAt ?? 0,
      thumbAt: meta?.thumbAt ?? 0,
      scene: hashOf(scene),
      bytes: entry.bytes,
    };
  },
  nameOf: (v) => v.name,
  async afterApply(ctx, merged, applied, removed) {
    const index = await readIndex(ctx);
    const gone = new Set(removed);
    let boards: BoardMeta[] = index.boards.filter((b) => !gone.has(b.id));
    let changed = boards.length !== index.boards.length;
    for (const id of applied) {
      const item = merged.items.find((i) => i.id === id);
      if (!item || !isBoardItem(item.value)) continue;
      const v = item.value;
      const row: BoardMeta = { id, name: v.name, createdAt: v.createdAt, updatedAt: v.updatedAt, thumbAt: v.thumbAt };
      const i = boards.findIndex((b) => b.id === id);
      if (i >= 0) boards = boards.map((b, j) => (j === i ? { ...b, ...row } : b));
      else boards = [row, ...boards];
      changed = true;
    }
    // Drift repair: a folder that is on disk and in the merged list but missing from the index.
    for (const item of merged.items) {
      if (!boards.some((b) => b.id === item.id) && isBoardItem(item.value) && !gone.has(item.id)) {
        const v = item.value;
        boards = [...boards, { id: item.id, name: v.name, createdAt: v.createdAt, updatedAt: v.updatedAt, thumbAt: v.thumbAt }];
        changed = true;
      }
    }
    if (!changed) return;
    const lastOpenedId = index.lastOpenedId && boards.some((b) => b.id === index.lastOpenedId) ? index.lastOpenedId : boards[0]?.id ?? null;
    const next: BoardIndex = { version: 1, boards, lastOpenedId };
    await ctx.backend.appWriteText(BOARD_INDEX, JSON.stringify(next, null, 2));
  },
});
