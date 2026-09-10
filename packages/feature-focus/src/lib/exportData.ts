import type { AppData, NbBlock, NotebookPage, Task } from "../types";
import { isTauri } from "./env";
import { todayIso } from "./dates";

/* Agent-friendly exports: Markdown for humans & LLMs, JSON as a full backup.
 * Everything is generated from the in-memory workspace dataset — no cloud. */

function taskLine(t: Task): string {
  const meta: string[] = [];
  if (t.mit) meta.push("MIT");
  if (t.priority > 0) meta.push(`P${t.priority}`);
  if (t.due) meta.push(`due ${t.due}`);
  const suffix = meta.length ? ` _(${meta.join(", ")})_` : "";
  const lines = [`- [${t.done ? "x" : " "}] ${t.title}${suffix}`];
  for (const s of t.subtasks) lines.push(`  - [${s.done ? "x" : " "}] ${s.title}`);
  return lines.join("\n");
}

function blockLines(block: NbBlock, pages: NotebookPage[], depth = 0): string[] {
  const pad = "  ".repeat((block.indent ?? 0) + depth);
  const text = block.text ?? "";
  let line: string;
  switch (block.type) {
    case "heading1": line = `# ${text}`; break;
    case "heading2": line = `## ${text}`; break;
    case "heading3": line = `### ${text}`; break;
    case "bullet": line = `${pad}- ${text}`; break;
    case "numbered": line = `${pad}1. ${text}`; break;
    case "todo": line = `${pad}- [${block.checked ? "x" : " "}] ${text}`; break;
    case "toggle": line = `${pad}- ${text}`; break;
    case "quote": line = `> ${text}`; break;
    case "divider": line = "---"; break;
    case "callout": line = `> **${block.callout ?? "note"}:** ${text}`; break;
    case "code": line = "```" + (block.lang ?? "") + "\n" + text + "\n```"; break;
    case "table": {
      const rows = block.rows ?? [];
      if (!rows.length) return [];
      const header = `| ${rows[0].join(" | ")} |`;
      const sep = `| ${rows[0].map(() => "---").join(" | ")} |`;
      const rest = rows.slice(1).map((r) => `| ${r.join(" | ")} |`);
      return [header, sep, ...rest];
    }
    case "image": line = block.url ? `![](${block.url})` : ""; break;
    case "pageLink": {
      const target = pages.find((p) => p.id === block.pageId);
      line = `→ ${target?.title ?? "page"}`;
      break;
    }
    default: line = text;
  }
  const out = line ? [line] : [];
  for (const child of block.children ?? []) {
    out.push(...blockLines(child, pages, depth + 1));
  }
  return out;
}

export function workspaceToMarkdown(data: AppData, workspaceName: string): string {
  const out: string[] = [];
  const today = todayIso();
  out.push(`# ${workspaceName} — owntools export`);
  out.push(`_exported ${new Date().toISOString()}_`);

  out.push("\n## Tasks");
  for (const list of data.lists) {
    const tasks = data.tasks.filter((t) => t.listId === list.id);
    if (!tasks.length) continue;
    out.push(`\n### ${list.name}`);
    for (const t of tasks) out.push(taskLine(t));
  }

  const notes = data.notes.filter((n) => !n.archived);
  if (notes.length) {
    out.push("\n## Sticky notes");
    for (const n of notes) out.push(`- ${n.content.replace(/\n/g, " ")}${n.pinned ? " _(pinned)_" : ""}`);
  }

  const pages = data.notebook.pages.filter((p) => !p.archived);
  if (pages.length) {
    out.push("\n## Notebook");
    for (const p of pages) {
      out.push(`\n### ${p.icon ? `${p.icon} ` : ""}${p.title || "Untitled"}`);
      for (const b of p.blocks) out.push(...blockLines(b, pages));
    }
  }

  if (data.habits.length) {
    out.push("\n## Habits");
    for (const h of data.habits) {
      const checks = Object.values(h.checks).filter(Boolean).length;
      out.push(`- ${h.name} — ${checks} check-ins`);
    }
  }

  if (data.journal.length) {
    out.push("\n## Journal");
    for (const j of [...data.journal].sort((a, b) => b.date.localeCompare(a.date))) {
      out.push(`\n### ${j.date} · ${j.rating}/5`);
      if (j.done) out.push(`**Done:** ${j.done}`);
      if (j.tomorrow) out.push(`**Tomorrow:** ${j.tomorrow}`);
    }
  }

  const planToday = data.planner.filter((b) => b.date === today);
  if (planToday.length) {
    out.push("\n## Today's plan");
    for (const b of planToday) out.push(`- ${b.start}–${b.end} ${b.title}${b.done ? " ✓" : ""}`);
  }

  const day = data.heatmap[today];
  out.push("\n## Focus");
  out.push(`- today: ${day?.minutes ?? 0} min across ${day?.sessions ?? 0} sessions`);

  return out.join("\n") + "\n";
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export function exportFileName(workspaceName: string, ext: "md" | "json"): string {
  return `owntools-${slug(workspaceName)}-${todayIso()}.${ext}`;
}

/** Save text: native save dialog in the app, anchor download in the browser. */
export async function saveTextAs(filename: string, content: string, mime: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const ext = filename.split(".").pop() ?? "txt";
      const path = await save({
        defaultPath: filename,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!path) return false;
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, content);
      return true;
    } catch {
      return false;
    }
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
