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
import type { DictationCommand } from "../../lib/speech";

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
    const title = template ? TEMPLATES.find((t) => t.id === template)?.title : "Bez tytułu";
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
            Notatnik
          </span>
          <button className="btn small" onClick={() => newPage(null)}>
            Nowa strona
          </button>
        </div>
        <input
          className="input"
          placeholder="Szukaj stron…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {favorites.length > 0 && (
          <div className="nb-group">
            <p className="kicker">Ulubione</p>
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
          <p className="kicker">Strony</p>
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
          {roots.length === 0 && !query && <p className="faint">Brak stron</p>}
        </div>
        <button className={`pill${trash ? " active" : ""}`} onClick={() => setTrash((v) => !v)}>
          Kosz ({archived.length})
        </button>
        {trash && (
          <div className="nb-group">
            {archived.length === 0 && <p className="faint">Pusto</p>}
            {archived.map((p) => (
              <div key={p.id} className="spread" style={{ gap: 6, marginBottom: 6 }}>
                <span>
                  {p.icon} {p.title || "Bez tytułu"}
                </span>
                <span className="row">
                  <button className="btn small ghost" onClick={() => restoreNotebookPage(p.id)}>
                    Przywróć
                  </button>
                  <button className="btn small ghost" onClick={() => deleteNotebookPage(p.id)}>
                    Usuń
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
            <p className="kicker">Czysty notes</p>
            <h1 className="page-title">Nowa strona</h1>
            <p className="muted" style={{ maxWidth: "42ch" }}>
              Notatnik trzyma strony i bloki — nie karteczki. Wybierz szablon albo zacznij od pustej kartki.
            </p>
            <div className="nb-templates">
              <button className="card tight nb-tpl" onClick={() => newPage(null)}>
                <strong>Pusta strona</strong>
                <span className="muted">Tytuł i pierwszy akapit</span>
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
                        {c.icon} {c.title || "Bez tytułu"}
                      </button>
                    </span>
                  ))}
                </div>
                <div className="row">
                  <DictationButton lang={speechLang} onFinal={onCommand} onInterim={setInterim} />
                  <button className="pill" onClick={() => toggleNotebookFavorite(active.id)}>
                    {active.favorite ? "Ulubione" : "Do ulubionych"}
                  </button>
                  <button className="pill" onClick={() => archiveNotebookPage(active.id)}>
                    Do kosza
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
                    aria-label={c || "bez okładki"}
                  />
                ))}
              </div>
              <input
                className="nb-title"
                value={active.title}
                placeholder="Bez tytułu"
                onChange={(e) => updateNotebookPage(active.id, { title: e.target.value })}
              />
              <p className="faint" style={{ margin: "0 0 24px", fontSize: 12 }}>
                Ostatnia zmiana {formatLongDate(active.updatedAt.slice(0, 10))}
              </p>
              {interim && <p className="nb-live">{interim}</p>}
              <BlockEditor
                page={active}
                pages={pages.filter((p) => !p.archived)}
                onChange={(blocks: NbBlock[]) => setNotebookBlocks(active.id, blocks)}
                onOpenPage={setActiveNotebookPage}
                onCreateChild={() => {
                  const child = createPage("Podstrona", active.id);
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
      {page.icon} {page.title || "Bez tytułu"}
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
                {p.icon} {p.title || "Bez tytułu"}
              </button>
              <button className="nb-mini" title="Ulubione" onClick={() => onFav(p.id)}>
                {p.favorite ? "★" : "☆"}
              </button>
              <button className="nb-mini" title="Podstrona" onClick={() => onNewChild(p.id)}>
                +
              </button>
              <button className="nb-mini" title="Kosz" onClick={() => onArchive(p.id)}>
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
