import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BlockType, NbBlock, NotebookPage } from "../../types";
import {
  BLOCK_CATALOG,
  createBlock,
  markdownShortcut,
  numberedIndex,
  plain,
  sanitizeHtml,
} from "../../lib/notebook";

interface Props {
  page: NotebookPage;
  pages: NotebookPage[];
  onChange: (blocks: NbBlock[]) => void;
  onOpenPage: (id: string) => void;
  onCreateChild: () => string;
  focusToken?: number;
}

export function BlockEditor({
  page,
  pages,
  onChange,
  onOpenPage,
  onCreateChild,
  focusToken = 0,
}: Props) {
  const [slash, setSlash] = useState<{ index: number; q: string } | null>(null);
  const [focus, setFocus] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-block="${focus}"]`);
    el?.focus();
  }, [focus, focusToken, page.id]);

  const setBlocks = (blocks: NbBlock[]) => onChange(blocks);
  const blocks = page.blocks;

  const update = (index: number, patch: Partial<NbBlock>) => {
    setBlocks(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const insertAt = (index: number, type: BlockType = "paragraph", extra?: Partial<NbBlock>) => {
    const next = [...blocks];
    next.splice(index, 0, createBlock(type, extra));
    setBlocks(next);
    setFocus(index);
    setSlash(null);
  };

  const convert = (index: number, type: BlockType) => {
    const current = blocks[index];
    const next = createBlock(type, { text: "", indent: current.indent });
    setBlocks(blocks.map((b, i) => (i === index ? { ...next, id: current.id } : b)));
    setSlash(null);
  };

  const removeAt = (index: number) => {
    if (blocks.length === 1) {
      setBlocks([createBlock("paragraph")]);
      setFocus(0);
      return;
    }
    setBlocks(blocks.filter((_, i) => i !== index));
    setFocus(Math.max(0, index - 1));
  };

  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    setBlocks(next);
    setFocus(to);
  };

  const onEditableInput = (index: number, el: HTMLElement) => {
    const raw = plain(el.innerHTML);
    if (raw.startsWith("/")) setSlash({ index, q: raw.slice(1).toLowerCase() });
    else setSlash(null);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>, index: number, el: HTMLElement) => {
    const raw = plain(el.innerHTML);
    if (e.key === " " || e.key === "Enter") {
      const md = markdownShortcut(`${raw} `);
      if (md && !raw.includes("\n")) {
        e.preventDefault();
        el.innerHTML = "";
        convert(index, md.type);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const t = blocks[index].type;
      const list = t === "bullet" || t === "numbered" || t === "todo";
      if (list && !raw.trim()) {
        convert(index, "paragraph");
        return;
      }
      insertAt(index + 1, list ? t : "paragraph");
    }
    if (e.key === "Backspace" && !raw) {
      e.preventDefault();
      if (blocks[index].type !== "paragraph") convert(index, "paragraph");
      else removeAt(index);
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const indent = Math.min(3, Math.max(0, (blocks[index].indent ?? 0) + (e.shiftKey ? -1 : 1)));
      update(index, { indent });
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      document.execCommand("bold");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      document.execCommand("italic");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      document.execCommand("insertHTML", false, `<code>${document.getSelection()?.toString() || "kod"}</code>`);
    }
    if (e.key === "ArrowUp" && e.altKey) {
      e.preventDefault();
      move(index, -1);
    }
    if (e.key === "ArrowDown" && e.altKey) {
      e.preventDefault();
      move(index, 1);
    }
    if (slash && e.key === "Escape") setSlash(null);
    if (slash && e.key === "Enter") {
      const items = filtered(slash.q);
      if (items[0]) {
        e.preventDefault();
        applySlash(index, items[0].type);
      }
    }
  };

  const applySlash = (index: number, type: BlockType) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-block="${index}"]`);
    if (el) el.innerHTML = "";
    if (type === "pageLink") {
      const id = onCreateChild();
      const current = blocks[index];
      const link = createBlock("pageLink", { pageId: id });
      setBlocks(blocks.map((b, i) => (i === index ? { ...link, id: current.id } : b)));
      setSlash(null);
      onOpenPage(id);
      return;
    }
    convert(index, type);
  };

  const filtered = (q: string) =>
    BLOCK_CATALOG.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        b.slash.includes(q) ||
        b.hint.toLowerCase().includes(q),
    );

  return (
    <div className="nb-blocks" ref={listRef}>
      {blocks.map((block, index) => (
        <div
          key={block.id}
          className={`nb-row indent-${block.indent ?? 0}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const from = Number(e.dataTransfer.getData("text/plain"));
            if (Number.isNaN(from) || from === index) return;
            const next = [...blocks];
            const [item] = next.splice(from, 1);
            next.splice(index, 0, item);
            setBlocks(next);
            setFocus(index);
          }}
        >
          <div className="nb-gutter">
            <button
              className="nb-handle"
              draggable
              title="Przeciągnij albo Alt+↑/↓"
              onDragStart={(e) => e.dataTransfer.setData("text/plain", String(index))}
              onClick={() => move(index, -1)}
              aria-label="W górę"
            >
              ⋮⋮
            </button>
            <button className="nb-mini" onClick={() => move(index, 1)} aria-label="W dół">
              ↓
            </button>
          </div>
          <BlockBody
            block={block}
            index={index}
            number={block.type === "numbered" ? numberedIndex(blocks, index) : 0}
            pages={pages}
            onOpenPage={onOpenPage}
            onFocus={() => setFocus(index)}
            onInput={onEditableInput}
            onKey={onKey}
            onPatch={(patch) => update(index, patch)}
            onChildren={(children) => update(index, { children })}
          />
        </div>
      ))}
      {slash && (
        <div className="slash" style={{ top: Math.min(slash.index, 12) * 36 + 8 }}>
          {filtered(slash.q).map((item) => (
            <button key={item.type} className="slash-item" onMouseDown={() => applySlash(slash.index, item.type)}>
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
          {filtered(slash.q).length === 0 && <p className="faint">Nic nie pasuje</p>}
        </div>
      )}
    </div>
  );
}

function BlockBody({
  block,
  index,
  number,
  pages,
  onOpenPage,
  onFocus,
  onInput,
  onKey,
  onPatch,
  onChildren,
}: {
  block: NbBlock;
  index: number;
  number: number;
  pages: NotebookPage[];
  onOpenPage: (id: string) => void;
  onFocus: () => void;
  onInput: (index: number, el: HTMLElement) => void;
  onKey: (e: KeyboardEvent<HTMLElement>, index: number, el: HTMLElement) => void;
  onPatch: (patch: Partial<NbBlock>) => void;
  onChildren: (children: NbBlock[]) => void;
}) {
  if (block.type === "divider") {
    return <hr className="nb-hr" />;
  }
  if (block.type === "image") {
    return (
      <div className="nb-image">
        <input
          className="input"
          placeholder="https://… adres obrazu"
          value={block.url ?? ""}
          onChange={(e) => onPatch({ url: e.target.value })}
          onFocus={onFocus}
        />
        {block.url && <img src={block.url} alt="" />}
      </div>
    );
  }
  if (block.type === "code") {
    return (
      <div className="nb-code">
        <input
          className="input"
          style={{ width: 120, marginBottom: 8, padding: "4px 8px" }}
          value={block.lang ?? "text"}
          onChange={(e) => onPatch({ lang: e.target.value })}
        />
        <textarea
          className="textarea"
          data-block={index}
          value={block.text}
          onFocus={onFocus}
          onChange={(e) => onPatch({ text: e.target.value })}
        />
      </div>
    );
  }
  if (block.type === "table") {
    const rows = block.rows ?? [["", ""], ["", ""]];
    return (
      <div className="nb-table-wrap">
        <table className="nb-table">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input
                      value={cell}
                      onFocus={onFocus}
                      onChange={(e) => {
                        const next = rows.map((rr) => [...rr]);
                        next[r][c] = e.target.value;
                        onPatch({ rows: next });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="btn small ghost"
          onClick={() => onPatch({ rows: [...rows, Array(rows[0]?.length ?? 2).fill("")] })}
        >
          Dodaj wiersz
        </button>
      </div>
    );
  }
  if (block.type === "pageLink") {
    const target = pages.find((p) => p.id === block.pageId);
    return (
      <button className="nb-pagelink" onClick={() => block.pageId && onOpenPage(block.pageId)}>
        {target ? `${target.icon} ${target.title || "Bez tytułu"}` : "Brak strony"}
      </button>
    );
  }

  return (
    <div className={`nb-block is-${block.type}`}>
      {block.type === "todo" && (
        <button
          className={`check${block.checked ? " on" : ""}`}
          onClick={() => onPatch({ checked: !block.checked })}
          aria-label="Zrobione"
        />
      )}
      {block.type === "bullet" && <span className="nb-bullet">•</span>}
      {block.type === "numbered" && <span className="nb-num">{number}.</span>}
      {block.type === "toggle" && (
        <button className="nb-caret" onClick={() => onPatch({ collapsed: !block.collapsed })}>
          {block.collapsed ? "▸" : "▾"}
        </button>
      )}
      {block.type === "callout" && (
        <input
          className="nb-emoji"
          value={block.callout ?? "💡"}
          onChange={(e) => onPatch({ callout: e.target.value })}
        />
      )}
      <Editable
        html={block.text}
        resetKey={`${block.id}-${block.type}`}
        index={index}
        placeholder={placeholder(block.type)}
        onFocus={onFocus}
        onInput={onInput}
        onKey={onKey}
        onCommit={(html) => onPatch({ text: html })}
      />
      {block.type === "toggle" && !block.collapsed && (
        <div className="nb-toggle-body">
          {(block.children ?? [createBlock()]).map((child, ci) => (
            <div
              key={child.id}
              className="nb-edit"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Pusto. Napisz albo zostaw."
              dangerouslySetInnerHTML={{ __html: child.text || "" }}
              onBlur={(e) => {
                const next = [...(block.children ?? [])];
                next[ci] = { ...child, text: sanitizeHtml(e.currentTarget.innerHTML) };
                onChildren(next);
              }}
            />
          ))}
          <button
            className="btn small ghost"
            onClick={() => onChildren([...(block.children ?? []), createBlock("paragraph")])}
          >
            Dodaj w środku
          </button>
        </div>
      )}
    </div>
  );
}

function Editable({
  html,
  resetKey,
  index,
  placeholder,
  onFocus,
  onInput,
  onKey,
  onCommit,
}: {
  html: string;
  resetKey: string;
  index: number;
  placeholder: string;
  onFocus: () => void;
  onInput: (index: number, el: HTMLElement) => void;
  onKey: (e: KeyboardEvent<HTMLElement>, index: number, el: HTMLElement) => void;
  onCommit: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (document.activeElement === ref.current) return;
    ref.current.innerHTML = html || "";
  }, [resetKey, html]);
  return (
    <div
      ref={ref}
      className="nb-edit"
      data-block={index}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onFocus={onFocus}
      onInput={(e) => onInput(index, e.currentTarget)}
      onKeyDown={(e) => onKey(e, index, e.currentTarget)}
      onBlur={(e) => onCommit(sanitizeHtml(e.currentTarget.innerHTML))}
      role="textbox"
      aria-multiline
    />
  );
}

function placeholder(type: BlockType): string {
  if (type.startsWith("heading")) return "Nagłówek";
  if (type === "quote") return "Cytat";
  if (type === "callout") return "Ważna myśl";
  if (type === "todo") return "Zadanie";
  if (type === "bullet" || type === "numbered") return "Lista";
  if (type === "toggle") return "Rozwijane";
  return "Napisz albo / na bloki";
}
