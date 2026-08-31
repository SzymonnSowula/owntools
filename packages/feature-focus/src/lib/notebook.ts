import { uid } from "./ids";
import type { BlockType, NbBlock, NotebookPage, NotebookState } from "../types";

export const BLOCK_CATALOG: { type: BlockType; label: string; hint: string; slash: string }[] = [
  { type: "paragraph", label: "Tekst", hint: "Zwykły akapit", slash: "tekst" },
  { type: "heading1", label: "Nagłówek 1", hint: "Duży tytuł", slash: "h1" },
  { type: "heading2", label: "Nagłówek 2", hint: "Średni tytuł", slash: "h2" },
  { type: "heading3", label: "Nagłówek 3", hint: "Mały tytuł", slash: "h3" },
  { type: "bullet", label: "Lista", hint: "Wypunktowanie", slash: "lista" },
  { type: "numbered", label: "Lista numerowana", hint: "1, 2, 3", slash: "numer" },
  { type: "todo", label: "Do zrobienia", hint: "Checkbox", slash: "zadanie" },
  { type: "toggle", label: "Rozwijane", hint: "Ukryj szczegóły", slash: "toggle" },
  { type: "quote", label: "Cytat", hint: "Wyróżniony fragment", slash: "cytat" },
  { type: "callout", label: "Callout", hint: "Ramka z ikoną", slash: "callout" },
  { type: "code", label: "Kod", hint: "Blok kodu", slash: "kod" },
  { type: "divider", label: "Linia", hint: "Rozdzielacz", slash: "linia" },
  { type: "table", label: "Tabela", hint: "Dwie kolumny", slash: "tabela" },
  { type: "image", label: "Obraz (URL)", hint: "Osadź po adresie", slash: "obraz" },
  { type: "pageLink", label: "Link do strony", hint: "Podstrona notatnika", slash: "strona" },
];

export function createBlock(type: BlockType = "paragraph", extra: Partial<NbBlock> = {}): NbBlock {
  const block: NbBlock = { id: uid(), type, text: extra.text ?? "" };
  if (type === "todo") block.checked = extra.checked ?? false;
  if (type === "toggle") {
    block.collapsed = extra.collapsed ?? false;
    block.children = extra.children ?? [createBlock("paragraph")];
  }
  if (type === "code") block.lang = extra.lang ?? "text";
  if (type === "table") block.rows = extra.rows ?? [["", ""], ["", ""]];
  if (type === "callout") block.callout = extra.callout ?? "💡";
  if (type === "image") block.url = extra.url ?? "";
  if (type === "pageLink") block.pageId = extra.pageId;
  if (extra.indent) block.indent = extra.indent;
  return { ...block, ...extra, type, id: block.id };
}

export function emptyNotebook(): NotebookState {
  return { pages: [], activePageId: null };
}

export function createPage(
  title = "Bez tytułu",
  parentId: string | null = null,
  blocks?: NbBlock[],
): NotebookPage {
  const now = new Date().toISOString();
  return {
    id: uid(),
    parentId,
    title,
    icon: "📄",
    cover: "",
    favorite: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    blocks: blocks ?? [createBlock("paragraph")],
  };
}

export type TemplateId = "meeting" | "brain" | "day" | "retro";

export const TEMPLATES: { id: TemplateId; title: string; desc: string; icon: string }[] = [
  { id: "meeting", title: "Notatka ze spotkania", desc: "Cel, ustalenia, następne kroki", icon: "🗓️" },
  { id: "brain", title: "Brain dump", desc: "Wszystko z głowy, bez porządku", icon: "🧠" },
  { id: "day", title: "Plan dnia", desc: "MIT, bloki, zamknięcie", icon: "☀️" },
  { id: "retro", title: "Retrospektywa", desc: "Co działa, co zmienić", icon: "🔁" },
];

export function blocksForTemplate(id: TemplateId): NbBlock[] {
  if (id === "meeting") {
    return [
      createBlock("heading2", { text: "Cel" }),
      createBlock("paragraph"),
      createBlock("heading2", { text: "Ustalenia" }),
      createBlock("bullet"),
      createBlock("heading2", { text: "Następne kroki" }),
      createBlock("todo"),
    ];
  }
  if (id === "brain") {
    return [
      createBlock("paragraph", { text: "Pisz bez cenzury. Porządek przyjdzie później." }),
      createBlock("paragraph"),
      createBlock("paragraph"),
    ];
  }
  if (id === "day") {
    return [
      createBlock("heading2", { text: "Najważniejsze" }),
      createBlock("todo"),
      createBlock("heading2", { text: "Reszta" }),
      createBlock("bullet"),
      createBlock("heading2", { text: "Nie dzisiaj" }),
      createBlock("paragraph"),
    ];
  }
  return [
    createBlock("heading2", { text: "Co poszło dobrze" }),
    createBlock("bullet"),
    createBlock("heading2", { text: "Co tarło" }),
    createBlock("bullet"),
    createBlock("heading2", { text: "Co zmieniam" }),
    createBlock("todo"),
  ];
}

export function markdownShortcut(raw: string): { type: BlockType; text: string } | null {
  const t = raw.replace(/\u00a0/g, " ");
  if (t === "# " || t === "#") return { type: "heading1", text: "" };
  if (t === "## " || t === "##") return { type: "heading2", text: "" };
  if (t === "### " || t === "###") return { type: "heading3", text: "" };
  if (t === "- " || t === "* ") return { type: "bullet", text: "" };
  if (t === "1. ") return { type: "numbered", text: "" };
  if (t === "[] " || t === "[ ] " || t === "- [ ] ") return { type: "todo", text: "" };
  if (t === "> ") return { type: "quote", text: "" };
  if (t === "``` " || t === "```") return { type: "code", text: "" };
  if (t === "--- " || t === "---") return { type: "divider", text: "" };
  return null;
}

export function numberedIndex(blocks: NbBlock[], index: number): number {
  const indent = blocks[index].indent ?? 0;
  let n = 1;
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i].type !== "numbered") break;
    if ((blocks[i].indent ?? 0) !== indent) break;
    n += 1;
  }
  return n;
}

export function pagePath(pages: NotebookPage[], id: string): NotebookPage[] {
  const map = new Map(pages.map((p) => [p.id, p]));
  const out: NotebookPage[] = [];
  let cur = map.get(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
  }
  return out;
}

export function childPages(pages: NotebookPage[], parentId: string | null): NotebookPage[] {
  return pages
    .filter((p) => p.parentId === parentId && !p.archived)
    .sort((a, b) => a.title.localeCompare(b.title, "pl"));
}

export function sanitizeHtml(html: string): string {
  const allowed = new Set(["B", "STRONG", "I", "EM", "CODE", "A", "BR", "SPAN"]);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const walk = (node: Node) => {
    const kids = [...node.childNodes];
    for (const child of kids) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!allowed.has(el.tagName)) {
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
        } else {
          [...el.attributes].forEach((attr) => {
            if (el.tagName === "A" && attr.name === "href") {
              const href = el.getAttribute("href") ?? "";
              if (!/^https?:|^mailto:/i.test(href)) el.removeAttribute("href");
            } else {
              el.removeAttribute(attr.name);
            }
          });
          walk(el);
        }
      }
    }
  };
  walk(wrap);
  return wrap.innerHTML;
}

export function plain(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent ?? "").replace(/\u00a0/g, " ");
}
