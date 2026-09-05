import { useMemo, useState } from "react";
import type { NbBlock, NotebookPage } from "../../types";
import { formatLongDate } from "../../lib/dates";
import {
  TEMPLATES,
  blocksForTemplate,
  childPages,
  createPage,
  pagePath,
  type TemplateId,
} from "../../lib/notebook";
import { useAppStore } from "../../store/useAppStore";
import { BlockEditor } from "./BlockEditor";
import { DictationButton } from "./DictationButton";
import type { DictationCommand } from "../../types";

const COVERS = ["", "mist", "sage", "sand", "blush"];
const ICONS = ["📄", "✏️", "🎯", "🧠", "☀️", "📌", "🗂️", "💡", "🗒️", "🔁"];

export function NotebookView() {
  const notebook = useAppStore((s) => s.notebook);
  const speechLang = useAppStore((s) => s.settings.speechLang);
  const createNotebookPage = useAppStore((s) => s.createNotebookPage);
  const updateNotebookPage = useAppStore((s) => s.updateNotebookPage);
  const setActiveNotebookPage = useAppStore((s) => s.setActiveNotebookPage);
  const archiveNotebookPage = useAppStore((s) => s.archiveNotebookPage);
  const restoreNotebookPage = useAppStore((s) => s.restoreNotebookPage);
  const deleteNotebookPage = useAppStore((s) => s.deleteNotebookPage);
  const toggleNotebookFavorite = useAppStore((s) => s.toggleNotebookFavorite);
  const setNotebookBlocks = useAppStore((s) => s.setNotebookBlocks);
  const applyDictation = useAppStore((s) => s.applyNotebookDictation);

  const [query, setQuery] = useState("");
  const [trash, setTrash] = useState(false);
  const [interim, setInterim] = useState("");
  const [focusToken, setFocusToken] = useState(0);

  const pages = notebook.pages;
  const active = pages.find((p) => p.id === notebook.activePageId && !p.archived);
  const favorites = pages.filter((p) => p.favorite && !p.archived);
  const roots = childPages(pages, null).filter((p) =>
    query ? p.title.toLowerCase().includes(query.toLowerCase()) : true,
  );
  const archived = pages.filter((p) => p.archived);

  const crumbs = useMemo(
    () => (active ? pagePath(pages, active.id) : []),
    [pages, active],
  );

  const newPage = (parentId: string | null = null, template?: TemplateId) => {
    const blocks = template ? blocksForTemplate(template) : undefined;
    const title = template ? TEMPLATES.find((t) => t.id === template)?.title : "Untitled";
    createNotebookPage(title, parentId, blocks);
  };

  const onCommand = (text: string, command: DictationCommand | null) => {
    applyDictation(text, command);
    setFocusToken((n) => n + 1);
  };

  return (
    <div className="nb">
      <aside className="nb-side">
        <div className="spread" style={{ marginBottom: 12 }}>
          <span className="kicker" style={{ margin: 0 }}>
            Notebook
          </span>
          <button className="btn small" onClick={() => newPage(null)}>
            New page
          </button>
        </div>
        <input
          className="input"
          placeholder="Search pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {favorites.length > 0 && (
          <div className="nb-group">
            <p className="kicker">Favorites</p>
            {favorites.map((p) => (
              <PageButton
                key={p.id}
                page={p}
                active={p.id === active?.id}
                onOpen={() => setActiveNotebookPage(p.id)}
              />
            ))}
          </div>
        )}
        <div className="nb-group">
          <p className="kicker">Pages</p>
          <Tree
            pages={query ? pages.filter((p) => !p.archived && p.title.toLowerCase().includes(query.toLowerCase())) : roots}
            all={pages}
            activeId={active?.id}
            query={query}
            onOpen={setActiveNotebookPage}
            onNewChild={(id) => newPage(id)}
            onFav={toggleNotebookFavorite}
            onArchive={archiveNotebookPage}
          />
          {roots.length === 0 && !query && <p className="faint">No pages</p>}
        </div>
        <button className={`pill${trash ? " active" : ""}`} onClick={() => setTrash((v) => !v)}>
          Trash ({archived.length})
        </button>
        {trash && (
          <div className="nb-group">
            {archived.length === 0 && <p className="faint">Empty</p>}
            {archived.map((p) => (
              <div key={p.id} className="spread" style={{ gap: 6, marginBottom: 6 }}>
                <span>
                  {p.icon} {p.title || "Untitled"}
                </span>
                <span className="row">
                  <button className="btn small ghost" onClick={() => restoreNotebookPage(p.id)}>
                    Restore
                  </button>
                  <button className="btn small ghost" onClick={() => deleteNotebookPage(p.id)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </aside>

      <div className="nb-main">
        {!active ? (
          <div className="nb-empty">
            <p className="kicker">A clean notebook</p>
            <h1 className="page-title">New page</h1>
            <p className="muted" style={{ maxWidth: "42ch" }}>
              The notebook holds pages and blocks — not sticky notes. Pick a template or start from a blank page.
            </p>
            <div className="nb-templates">
              <button className="card tight nb-tpl" onClick={() => newPage(null)}>
                <strong>Blank page</strong>
                <span className="muted">Title and a first paragraph</span>
              </button>
              {TEMPLATES.map((t) => (
                <button key={t.id} className="card tight nb-tpl" onClick={() => newPage(null, t.id)}>
                  <strong>
                    {t.icon} {t.title}
                  </strong>
                  <span className="muted">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {active.cover && <div className={`nb-cover ${active.cover}`} />}
            <div className="nb-page">
              <div className="nb-toolbar">
                <div className="row">
                  {crumbs.map((c, i) => (
                    <span key={c.id} className="faint">
                      {i > 0 && " / "}
                      <button className="btn small ghost" onClick={() => setActiveNotebookPage(c.id)}>
                        {c.icon} {c.title || "Untitled"}
                      </button>
                    </span>
                  ))}
                </div>
                <div className="row">
                  <DictationButton lang={speechLang} onFinal={onCommand} onInterim={setInterim} />
                  <button className="pill" onClick={() => toggleNotebookFavorite(active.id)}>
                    {active.favorite ? "Favorite" : "Add to favorites"}
                  </button>
                  <button className="pill" onClick={() => archiveNotebookPage(active.id)}>
                    To trash
                  </button>
                </div>
              </div>
              <div className="row" style={{ marginBottom: 8 }}>
                {ICONS.map((icon) => (
                  <button
                    key={icon}
                    className={`nb-icon${active.icon === icon ? " on" : ""}`}
                    onClick={() => updateNotebookPage(active.id, { icon })}
                  >
                    {icon}
                  </button>
                ))}
                {COVERS.map((c) => (
                  <button
                    key={c || "none"}
                    className={`nb-cover-swatch ${c}${active.cover === c ? " on" : ""}`}
                    onClick={() => updateNotebookPage(active.id, { cover: c })}
                    aria-label={c || "no cover"}
                  />
                ))}
              </div>
              <input
                className="nb-title"
                value={active.title}
                placeholder="Untitled"
                onChange={(e) => updateNotebookPage(active.id, { title: e.target.value })}
              />
              <p className="faint" style={{ margin: "0 0 24px", fontSize: 12 }}>
                Last edited {formatLongDate(active.updatedAt.slice(0, 10))}
              </p>
              {interim && <p className="nb-live">{interim}</p>}
              <BlockEditor
                page={active}
                pages={pages.filter((p) => !p.archived)}
                onChange={(blocks: NbBlock[]) => setNotebookBlocks(active.id, blocks)}
                onOpenPage={setActiveNotebookPage}
                onCreateChild={() => {
                  const child = createPage("Subpage", active.id);
                  useAppStore.getState().addNotebookPageObject(child);
                  return child.id;
                }}
                focusToken={focusToken}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PageButton({
  page,
  active,
  onOpen,
}: {
  page: NotebookPage;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button className={`nb-item${active ? " on" : ""}`} onClick={onOpen}>
      {page.icon} {page.title || "Untitled"}
    </button>
  );
}

function Tree({
  pages,
  all,
  activeId,
  query,
  onOpen,
  onNewChild,
  onFav,
  onArchive,
}: {
  pages: NotebookPage[];
  all: NotebookPage[];
  activeId?: string;
  query: string;
  onOpen: (id: string) => void;
  onNewChild: (id: string) => void;
  onFav: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  return (
    <div>
      {pages.map((p) => {
        const kids = query ? [] : childPages(all, p.id);
        return (
          <div key={p.id}>
            <div className={`nb-item-row${p.id === activeId ? " on" : ""}`}>
              <button className="nb-item" onClick={() => onOpen(p.id)}>
                {p.icon} {p.title || "Untitled"}
              </button>
              <button className="nb-mini" title="Favorite" onClick={() => onFav(p.id)}>
                {p.favorite ? "★" : "☆"}
              </button>
              <button className="nb-mini" title="Subpage" onClick={() => onNewChild(p.id)}>
                +
              </button>
              <button className="nb-mini" title="Trash" onClick={() => onArchive(p.id)}>
                ×
              </button>
            </div>
            {kids.length > 0 && (
              <div className="nb-children">
                <Tree
                  pages={kids}
                  all={all}
                  activeId={activeId}
                  query={query}
                  onOpen={onOpen}
                  onNewChild={onNewChild}
                  onFav={onFav}
                  onArchive={onArchive}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
