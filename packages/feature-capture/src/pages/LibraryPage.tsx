import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CAPTURE_HOTKEY_LABEL } from "@core/hotkeys";
import { ToolMark } from "@ui/ToolMark";
import { getCaptureBackend, type CaptureItem } from "../api";
import { Kbd, PageHead } from "../components";
import { Viewer } from "../components/Viewer";
import { excerpt, formatTime, groupByDay, itemLabel, searchItems } from "../lib/library";
import { useLibrary } from "../store";

/** Survives leaving the tool and coming back. */
let lastQuery = "";

export function LibraryPage() {
  const backend = useMemo(() => getCaptureBackend(), []);
  const { items, loaded, error } = useLibrary();
  const [query, setQuery] = useState(lastQuery);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    lastQuery = query;
  }, [query]);

  const filtered = useMemo(() => searchItems(items, query), [items, query]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const open = openId ? items.find((i) => i.id === openId) ?? null : null;

  // The viewer walks the filtered list in the order shown.
  const step = (dir: 1 | -1) => {
    if (!open) return;
    const flat = groups.flatMap((g) => g.items);
    const at = flat.findIndex((i) => i.id === open.id);
    const next = flat[at + dir];
    if (next) setOpenId(next.id);
  };

  return (
    <div className="cp-page cp-page-wide">
      <PageHead
        title="library"
        sub="Every capture you took, on this device. Search finds the text that was on screen."
        actions={
          items.length ? (
            <label className="cp-search">
              <Search aria-hidden />
              <input
                type="search"
                value={query}
                placeholder="Search text in captures"
                aria-label="Search captures"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                  <X />
                </button>
              ) : null}
            </label>
          ) : null
        }
      />

      {error ? <div className="cp-notice danger">{error}</div> : null}

      {!loaded ? (
        <div className="cp-empty-line">Loading captures…</div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : groups.length === 0 ? (
        <div className="cp-empty-line">
          Nothing matches “{query.trim()}”. Search looks at titles and the text recognised in each capture.
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="cp-group">
            <h2 className="cp-group-label">
              {group.label}
              <span>{group.items.length}</span>
            </h2>
            <div className="cp-grid">
              {group.items.map((item) => (
                <Tile key={item.id} item={item} query={query} src={backend.imageUrl(item.path)} onOpen={() => setOpenId(item.id)} />
              ))}
            </div>
          </section>
        ))
      )}

      {open ? <Viewer item={open} onClose={() => setOpenId(null)} onStep={step} /> : null}
    </div>
  );
}

function Tile({ item, query, src, onOpen }: { item: CaptureItem; query: string; src: string; onOpen: () => void }) {
  const snippet = excerpt(item.ocrText, query, 80);
  return (
    <button type="button" className="cp-tile" onClick={onOpen} title={itemLabel(item)}>
      <span className="cp-tile-img">
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      </span>
      <span className="cp-tile-meta">
        <span className="cp-tile-title">{itemLabel(item)}</span>
        <span className="cp-tile-sub">
          {formatTime(item.createdAt)} · {item.width} × {item.height}
          {item.ocrText ? " · text" : ""}
        </span>
        {snippet ? <span className="cp-tile-excerpt">{snippet}</span> : null}
      </span>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="cp-empty">
      <span className="cp-empty-mark" aria-hidden>
        <ToolMark tool="capture" size={56} />
      </span>
      <h2 className="cp-empty-title">
        press <Kbd>{CAPTURE_HOTKEY_LABEL}</Kbd> in any app
      </h2>
      <p className="cp-empty-sub">
        The screen freezes under the pointer. Drag an area, mark it up, and copy it, save it, copy the text out of it, or
        send it to the board or a post. Everything you keep lands here, searchable by the words that were on screen.
      </p>
      <ol className="cp-empty-steps">
        <li>
          <b>1</b> drag an area — or <Kbd>⏎</Kbd> for the whole screen
        </li>
        <li>
          <b>2</b> arrow, box, text, step numbers, highlighter, pixelate
        </li>
        <li>
          <b>3</b> Copy · Copy text · Save · Board · Social
        </li>
      </ol>
    </div>
  );
}
