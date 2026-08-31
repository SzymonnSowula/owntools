import { uid } from "./ids";
import type { BlockType, NbBlock, NotebookPage, NotebookState } from "../types";

export const BLOCK_CATALOG: { type: BlockType; label: string; hint: string; slash: string }[] = [
  { type: "paragraph", label: "Text", hint: "Plain paragraph", slash: "text" },
  { type: "heading1", label: "Heading 1", hint: "Large title", slash: "h1" },
  { type: "heading2", label: "Heading 2", hint: "Medium title", slash: "h2" },
  { type: "heading3", label: "Heading 3", hint: "Small title", slash: "h3" },
  { type: "bullet", label: "List", hint: "Bulleted list", slash: "list" },
  { type: "numbered", label: "Numbered list", hint: "1, 2, 3", slash: "numbered" },
  { type: "todo", label: "To-do", hint: "Checkbox", slash: "todo" },
  { type: "toggle", label: "Toggle", hint: "Hide details", slash: "toggle" },
  { type: "quote", label: "Quote", hint: "Highlighted passage", slash: "quote" },
  { type: "callout", label: "Callout", hint: "Box with an icon", slash: "callout" },
  { type: "code", label: "Code", hint: "Code block", slash: "code" },
  { type: "divider", label: "Divider", hint: "Separator line", slash: "divider" },
  { type: "table", label: "Table", hint: "Two columns", slash: "table" },
  { type: "image", label: "Image (URL)", hint: "Embed from a link", slash: "image" },
  { type: "pageLink", label: "Page link", hint: "Notebook subpage", slash: "page" },
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
  title = "Untitled",
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
  { id: "meeting", title: "Meeting notes", desc: "Goal, decisions, next steps", icon: "🗓️" },
  { id: "brain", title: "Brain dump", desc: "Everything out of your head, no order", icon: "🧠" },
  { id: "day", title: "Day plan", desc: "MIT, blocks, shutdown", icon: "☀️" },
  { id: "retro", title: "Retrospective", desc: "What works, what to change", icon: "🔁" },
];

export function blocksForTemplate(id: TemplateId): NbBlock[] {
  if (id === "meeting") {
    return [
      createBlock("heading2", { text: "Goal" }),
      createBlock("paragraph"),
      createBlock("heading2", { text: "Decisions" }),
      createBlock("bullet"),
      createBlock("heading2", { text: "Next steps" }),
      createBlock("todo"),
    ];
  }
  if (id === "brain") {
    return [
      createBlock("paragraph", { text: "Write without censoring. Order comes later." }),
      createBlock("paragraph"),
      createBlock("paragraph"),
    ];
  }
  if (id === "day") {
    return [
      createBlock("heading2", { text: "Most important" }),
      createBlock("todo"),
      createBlock("heading2", { text: "The rest" }),
      createBlock("bullet"),
      createBlock("heading2", { text: "Not today" }),
      createBlock("paragraph"),
    ];
  }
  return [
    createBlock("heading2", { text: "What went well" }),
    createBlock("bullet"),
    createBlock("heading2", { text: "What dragged" }),
    createBlock("bullet"),
    createBlock("heading2", { text: "What I'm changing" }),
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
    .sort((a, b) => a.title.localeCompare(b.title));
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
