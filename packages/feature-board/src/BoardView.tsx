import { confirmDialog } from "@ui/Dialog";
import "./assetPath";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  THEME,
  WelcomeScreen,
  exportToBlob,
  restore,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./board.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { logError } from "@core/errors";
import { registerDictationSink } from "@feature-dictation/insert";
import { BrandMark } from "@ui/BrandMark";
import { THEMES } from "@feature-focus/lib/themes";
import { useAppStore } from "@feature-focus/store/useAppStore";
import {
  boardById,
  createBoard,
  emptyIndex,
  liveElements,
  markOpened,
  pickAppState,
  removeBoard as removeFromIndex,
  renameBoard,
  sceneSignature,
  sortedBoards,
  toStoredScene,
  touchBoard,
  updateBoard,
  type BoardIndex,
} from "./boards";
import { getBoardStorage } from "./storage";
import { BoardSession, type SceneSnapshot } from "./session";
import { pickBoardFile, type ImportedBoard } from "./exporters";
import { BoardsPopover } from "./BoardsPopover";
import { ExportMenu } from "./ExportMenu";
import { insertTextOnBoard } from "./dictation";
import { IconFile, IconFolder, IconGrid, IconImage, IconImport, IconPencil, IconPlus } from "./icons";

/**
 * board — an endless whiteboard on Excalidraw (MIT), kept local: every board is
 * a folder in AppData, images included, and nothing leaves the machine.
 * This file is the glue: which board is open, the session that writes it,
 * the title / boards / export chrome around the editor, and the theme link.
 */

interface OpenBoard {
  id: string;
  initialData: ExcalidrawInitialDataState;
}

const UI_OPTIONS = {
  canvasActions: {
    // Our own open / save live in the menu; Excalidraw's "Save to" and the
    // JSON export dialog assume a browser download, which a webview may not have.
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    saveAsImage: true,
    toggleTheme: false,
    clearCanvas: true,
    changeViewBackgroundColor: true,
  },
  tools: { image: true },
} as const;

async function renderThumbnail(snap: SceneSnapshot): Promise<Blob | null> {
  const elements = liveElements(snap.elements);
  if (elements.length === 0) return null;
  const bg =
    snap.appState.viewBackgroundColor && snap.appState.viewBackgroundColor !== "transparent"
      ? snap.appState.viewBackgroundColor
      : "#ffffff";
  return exportToBlob({
    elements,
    appState: {
      ...snap.appState,
      exportBackground: true,
      exportWithDarkMode: false,
      exportScale: 1,
      viewBackgroundColor: bg,
    },
    files: snap.files,
    maxWidthOrHeight: 480,
    mimeType: "image/jpeg",
    quality: 0.82,
    exportPadding: 16,
  });
}

function confirmDelete(name: string): Promise<boolean> {
  return confirmDialog({
    title: "Delete board",
    message: `Delete "${name}"? The board and its images are removed from this device.`,
    kind: "danger",
    okLabel: "Delete",
    cancelLabel: "Keep",
  });
}

export default function BoardView() {
  const themeId = useAppStore((s) => s.settings.theme);
  const dark = THEMES.find((t) => t.id === themeId)?.dark ?? false;
  const storage = useMemo(() => getBoardStorage(), []);

  const [index, setIndex] = useState<BoardIndex>(emptyIndex);
  const indexRef = useRef<BoardIndex>(index);
  const [open, setOpen] = useState<OpenBoard | null>(null);
  const openIdRef = useRef<string | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const sessionRef = useRef<BoardSession | null>(null);
  const libraryRef = useRef<LibraryItems | null>(null);
  const bootRef = useRef(0);

  const commitIndex = useCallback(
    (next: BoardIndex) => {
      indexRef.current = next;
      setIndex(next);
      void storage.saveIndex(next).catch((err) => logError("board", "save index", err));
    },
    [storage],
  );

  const closeSession = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) await session.close();
  }, []);

  const openBoard = useCallback(
    async (id: string) => {
      if (!boardById(indexRef.current, id)) return;
      await closeSession();
      openIdRef.current = id;
      setOpen(null);
      setApi(null);
      try {
        const [stored, keys] = await Promise.all([storage.loadScene(id), storage.listFileKeys(id)]);
        const files = keys.length ? await storage.loadFiles(id, keys) : [];
        const restored = restore(
          {
            elements: stored?.elements ?? [],
            appState: stored?.appState ?? {},
            files: Object.fromEntries(files.map((f) => [f.id, f])) as BinaryFiles,
          },
          null,
          null,
          { repairBindings: true },
        );
        // The user may have picked another board while this one was loading.
        if (openIdRef.current !== id) return;
        sessionRef.current = new BoardSession(
          storage,
          id,
          keys,
          sceneSignature(restored.elements, restored.appState),
          {
            onSaved: (at) => commitIndex(touchBoard(indexRef.current, id, at)),
            thumbnail: renderThumbnail,
            onThumbnail: (at) => commitIndex(updateBoard(indexRef.current, id, { thumbAt: at })),
            onError: () => setNotice("Could not save the board — check the log in Settings → Support."),
          },
        );
        commitIndex(markOpened(indexRef.current, id));
        const hasView = typeof stored?.appState.scrollX === "number";
        setOpen({
          id,
          initialData: {
            elements: restored.elements,
            appState: restored.appState,
            files: restored.files,
            scrollToContent: !hasView,
            libraryItems: libraryRef.current ?? undefined,
          },
        });
      } catch (err) {
        logError("board", `open ${id}`, err);
        setNotice("This board could not be opened. Its files may be damaged.");
      }
    },
    [closeSession, commitIndex, storage],
  );

  // Boot: the index, the library, then the last board (or a first one).
  useEffect(() => {
    const token = ++bootRef.current;
    void (async () => {
      try {
        const [idx, library] = await Promise.all([storage.loadIndex(), storage.loadLibrary()]);
        if (bootRef.current !== token) return; // remounted meanwhile (StrictMode / tool switch)
        libraryRef.current = library;
        const next = idx.boards.length === 0 ? createBoard(idx).index : idx;
        commitIndex(next);
        setBooted(true);
        await openBoard(next.lastOpenedId ?? sortedBoards(next)[0].id);
      } catch (err) {
        logError("board", "boot", err);
        setNotice("The board storage could not be read — check the log in Settings → Support.");
      }
    })();
    return () => {
      bootRef.current++;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.close();
    };
  }, [commitIndex, openBoard, storage]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Ctrl+Shift+Space with the board in front: the words become a text box
  // (or go into the one being edited — that path never reaches the sink).
  useEffect(() => {
    if (!api) return;
    return registerDictationSink({ name: "board", insert: (text) => insertTextOnBoard(api, text) });
  }, [api]);

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      sessionRef.current?.onChange(elements, appState, files);
    },
    [],
  );

  const handleLibrary = useCallback(
    (items: LibraryItems) => {
      libraryRef.current = items;
      void storage.saveLibrary(items).catch((err) => logError("board", "save library", err));
    },
    [storage],
  );

  const newBoard = useCallback(
    async (name?: string, data?: ImportedBoard) => {
      const { index: next, board } = createBoard(indexRef.current, name);
      if (data) {
        try {
          for (const file of Object.values(data.files)) await storage.saveFile(board.id, file);
          await storage.saveScene(board.id, toStoredScene(data.elements, pickAppState(data.appState)));
        } catch (err) {
          logError("board", "import", err);
          setNotice("The import could not be written — check the log in Settings → Support.");
          return;
        }
      }
      commitIndex(next);
      setBoardsOpen(false);
      await openBoard(board.id);
    },
    [commitIndex, openBoard, storage],
  );

  const importBoard = useCallback(async () => {
    try {
      const picked = await pickBoardFile();
      if (!picked) return;
      await newBoard(picked.name, picked);
    } catch (err) {
      logError("board", "import", err);
      setNotice("That file could not be read as a board.");
    }
  }, [newBoard]);

  const rename = useCallback(
    (id: string, name: string) => commitIndex(renameBoard(indexRef.current, id, name)),
    [commitIndex],
  );

  const deleteBoard = useCallback(
    async (id: string) => {
      const meta = boardById(indexRef.current, id);
      if (!meta || !(await confirmDelete(meta.name))) return;
      const wasOpen = openIdRef.current === id;
      if (wasOpen) {
        await closeSession();
        openIdRef.current = null;
        setOpen(null);
        setApi(null);
      }
      await storage.removeBoard(id).catch((err) => logError("board", `remove ${id}`, err));
      let next = removeFromIndex(indexRef.current, id);
      if (next.boards.length === 0) next = createBoard(next).index;
      commitIndex(next);
      if (wasOpen) await openBoard(next.lastOpenedId ?? sortedBoards(next)[0].id);
    },
    [closeSession, commitIndex, openBoard, storage],
  );

  const meta = open ? boardById(index, open.id) : undefined;
  const metaName = meta?.name ?? "";
  const openId = open?.id ?? null;

  const renderTopRight = useCallback(
    () => (openId ? <ExportMenu api={api} name={metaName} onNotice={setNotice} /> : null),
    [api, metaName, openId],
  );

  const addImage = () => api?.setActiveTool({ type: "image" });

  return (
    <div className="board-root">
      {open ? (
        <div className="board-canvas" key={open.id}>
          <div className="board-canvas-inner">
            <Excalidraw
              excalidrawAPI={setApi}
              initialData={open.initialData}
              onChange={handleChange}
              onLibraryChange={handleLibrary}
              theme={dark ? THEME.DARK : THEME.LIGHT}
              name={metaName}
              langCode="en"
              autoFocus
              UIOptions={UI_OPTIONS}
              renderTopRightUI={renderTopRight}
            >
              <MainMenu>
                <MainMenu.Item icon={<IconPlus />} onSelect={() => void newBoard()}>
                  New board
                </MainMenu.Item>
                <MainMenu.Item icon={<IconGrid />} onSelect={() => setBoardsOpen(true)}>
                  Boards…
                </MainMenu.Item>
                <MainMenu.Item icon={<IconImport />} onSelect={() => void importBoard()}>
                  Import board file…
                </MainMenu.Item>
                <MainMenu.Separator />
                <MainMenu.Item icon={<IconImage />} onSelect={addImage}>
                  Add image…
                </MainMenu.Item>
                <MainMenu.DefaultItems.SaveAsImage />
                {storage.kind === "tauri" ? (
                  <MainMenu.Item icon={<IconFolder />} onSelect={() => void storage.reveal(open.id)}>
                    Show board folder
                  </MainMenu.Item>
                ) : null}
                <MainMenu.Separator />
                <MainMenu.DefaultItems.SearchMenu />
                <MainMenu.DefaultItems.CommandPalette />
                <MainMenu.DefaultItems.Help />
                <MainMenu.DefaultItems.ClearCanvas />
                <MainMenu.Separator />
                <MainMenu.DefaultItems.ChangeCanvasBackground />
              </MainMenu>
              <WelcomeScreen>
                <WelcomeScreen.Center>
                  <WelcomeScreen.Center.Logo>
                    <BrandMark size={30} filled />
                    <span className="board-welcome-word">board</span>
                  </WelcomeScreen.Center.Logo>
                  <WelcomeScreen.Center.Heading>
                    paste a screenshot, sketch around it, think in boxes and arrows.
                  </WelcomeScreen.Center.Heading>
                  <WelcomeScreen.Center.Menu>
                    <WelcomeScreen.Center.MenuItem icon={<IconImage />} onSelect={addImage} shortcut="Ctrl+V">
                      Add a screenshot
                    </WelcomeScreen.Center.MenuItem>
                    <WelcomeScreen.Center.MenuItem icon={<IconGrid />} onSelect={() => setBoardsOpen(true)}>
                      Open another board
                    </WelcomeScreen.Center.MenuItem>
                    <WelcomeScreen.Center.MenuItem icon={<IconFile />} onSelect={() => void importBoard()}>
                      Import an .excalidraw file
                    </WelcomeScreen.Center.MenuItem>
                    <WelcomeScreen.Center.MenuItemHelp />
                  </WelcomeScreen.Center.Menu>
                </WelcomeScreen.Center>
                <WelcomeScreen.Hints.MenuHint>boards, export, canvas background</WelcomeScreen.Hints.MenuHint>
                <WelcomeScreen.Hints.ToolbarHint />
                <WelcomeScreen.Hints.HelpHint />
              </WelcomeScreen>
            </Excalidraw>
          </div>
        </div>
      ) : (
        <div className="board-loading">{booted ? "Opening board…" : "Loading boards…"}</div>
      )}

      {meta ? (
        <div className="board-topleft">
          <button
            type="button"
            className="board-chip board-chip-icon"
            title="Boards"
            aria-label="Boards"
            aria-haspopup="dialog"
            aria-expanded={boardsOpen}
            onClick={() => setBoardsOpen((v) => !v)}
          >
            <IconGrid />
          </button>
          <TitleEditor name={meta.name} onRename={(name) => rename(meta.id, name)} />
          {boardsOpen ? (
            <BoardsPopover
              storage={storage}
              boards={sortedBoards(index)}
              currentId={meta.id}
              onOpen={(id) => {
                setBoardsOpen(false);
                if (id !== meta.id) void openBoard(id);
              }}
              onNew={() => void newBoard()}
              onImport={() => void importBoard()}
              onRename={rename}
              onDelete={(id) => void deleteBoard(id)}
              onClose={() => setBoardsOpen(false)}
            />
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div className="board-notice" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

function TitleEditor({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(draft);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="board-chip board-title"
        title="Rename this board"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        <span className="board-title-text">{name}</span>
        <IconPencil className="board-title-pen" />
      </button>
    );
  }
  return (
    <input
      className="board-title-input"
      value={draft}
      maxLength={80}
      autoFocus
      aria-label="Board name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={commit}
    />
  );
}
