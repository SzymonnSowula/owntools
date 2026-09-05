import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  createBoard,
  emptyIndex,
  markOpened,
  nextBoardName,
  parseIndex,
  parseStoredScene,
  pickAppState,
  referencedFileIds,
  removeBoard,
  renameBoard,
  safeFileName,
  sceneSignature,
  sortedBoards,
  timeAgo,
  toStoredScene,
} from "./boards";

const el = (patch: Partial<ExcalidrawElement> & { type: string }): ExcalidrawElement =>
  ({ id: Math.random().toString(36).slice(2), version: 1, isDeleted: false, ...patch }) as unknown as ExcalidrawElement;

describe("parseIndex", () => {
  it("survives garbage and missing fields", () => {
    expect(parseIndex(null)).toEqual(emptyIndex());
    expect(parseIndex("not json")).toEqual(emptyIndex());
    expect(parseIndex("42")).toEqual(emptyIndex());
    const idx = parseIndex(JSON.stringify({ boards: [{ id: "a", name: "  A  board " }, { id: "", name: "x" }, "junk"], lastOpenedId: "a" }));
    expect(idx.boards).toEqual([{ id: "a", name: "A board", createdAt: 0, updatedAt: 0, thumbAt: 0 }]);
    expect(idx.lastOpenedId).toBe("a");
  });

  it("drops duplicate ids and a lastOpenedId that points nowhere", () => {
    const idx = parseIndex(JSON.stringify({ boards: [{ id: "a", name: "1" }, { id: "a", name: "2" }], lastOpenedId: "zzz" }));
    expect(idx.boards.map((b) => b.name)).toEqual(["1"]);
    expect(idx.lastOpenedId).toBeNull();
  });
});

describe("board index operations", () => {
  it("numbers untitled boards and ignores case", () => {
    const { index: one } = createBoard(emptyIndex(), undefined, 1);
    expect(one.boards[0].name).toBe("Untitled board");
    expect(nextBoardName(one.boards)).toBe("Untitled board 2");
    expect(nextBoardName([...one.boards, { ...one.boards[0], id: "b", name: "untitled BOARD 2" }])).toBe("Untitled board 3");
  });

  it("opens a new board and falls back to the most recent one on delete", () => {
    const { index: a, board: first } = createBoard(emptyIndex(), "alpha", 1000);
    const { index: b, board: second } = createBoard(a, "beta", 2000);
    expect(b.lastOpenedId).toBe(second.id);
    const touched = renameBoard(b, first.id, "alpha two", 3000);
    expect(sortedBoards(touched).map((x) => x.name)).toEqual(["alpha two", "beta"]);
    const after = removeBoard(touched, second.id);
    expect(after.boards).toHaveLength(1);
    expect(after.lastOpenedId).toBe(first.id);
    expect(removeBoard(after, first.id).lastOpenedId).toBeNull();
  });

  it("keeps the old name on an empty rename and caps long ones", () => {
    const { index, board } = createBoard(emptyIndex(), "keep me");
    expect(renameBoard(index, board.id, "   ").boards[0].name).toBe("keep me");
    expect(renameBoard(index, board.id, "x".repeat(200)).boards[0].name).toHaveLength(80);
    expect(markOpened(index, "nope").lastOpenedId).toBe(board.id);
  });
});

describe("scene persistence", () => {
  it("keeps only the view, canvas look and toolbar defaults of appState", () => {
    const picked = pickAppState({
      viewBackgroundColor: "#fff",
      zoom: { value: 1.5 },
      scrollX: 10,
      currentItemStrokeColor: "#f00",
      selectedElementIds: { a: true },
      collaborators: new Map(),
      openDialog: null,
      theme: "dark",
    } as never);
    expect(Object.keys(picked).sort()).toEqual(["currentItemStrokeColor", "scrollX", "viewBackgroundColor", "zoom"]);
  });

  it("stores only live elements and reads its own format back", () => {
    const live = el({ type: "rectangle" });
    const gone = el({ type: "ellipse", isDeleted: true });
    const scene = toStoredScene([live, gone], { scrollX: 5, selectedElementIds: {} } as never, 123);
    expect(scene.elements).toEqual([live]);
    expect(scene.appState).toEqual({ scrollX: 5 });
    const back = parseStoredScene(JSON.stringify(scene));
    expect(back?.elements).toHaveLength(1);
    expect(back?.savedAt).toBe(123);
    expect(parseStoredScene("{}")).toBeNull();
    expect(parseStoredScene("nope")).toBeNull();
  });

  it("lists the files that live image elements reference", () => {
    const a = el({ type: "image", fileId: "f1" } as never);
    const b = el({ type: "image", fileId: "f2", isDeleted: true } as never);
    const c = el({ type: "image", fileId: null } as never);
    expect([...referencedFileIds([a, b, c])]).toEqual(["f1"]);
  });

  it("changes its signature on element versions and on persisted state only", () => {
    const a = el({ type: "rectangle", version: 1 });
    const base = sceneSignature([a], { scrollX: 0 } as never);
    expect(sceneSignature([a], { scrollX: 0, selectedElementIds: { x: true } } as never)).toBe(base);
    expect(sceneSignature([{ ...a, version: 2 }], { scrollX: 0 } as never)).not.toBe(base);
    expect(sceneSignature([a], { scrollX: 1 } as never)).not.toBe(base);
  });
});

describe("names & time", () => {
  it("makes a board name safe for a file", () => {
    expect(safeFileName('Q3: plan / "v2" <draft>...')).toBe("Q3 plan v2 draft");
    expect(safeFileName("   ")).toBe("board");
    expect(safeFileName("x".repeat(100))).toHaveLength(60);
  });

  it("phrases elapsed time", () => {
    const now = 1_000_000_000;
    expect(timeAgo(0, now)).toBe("never");
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(timeAgo(now - 4 * 86_400_000, now)).toBe("4 days ago");
  });
});
