import { isTauri } from "@core/env";

export type SaveOutcome = { kind: "saved"; path: string } | { kind: "downloaded"; name: string } | { kind: "cancelled" };

/**
 * Saves text where the person points the native dialog (the dialog plugin
 * whitelists the picked path for `fs`), or as a browser download under
 * `pnpm dev`. Same shape as the quick tools' `saveBlob`.
 */
export async function saveText(text: string, filename: string): Promise<SaveOutcome> {
  const bytes = new TextEncoder().encode(text);
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return { kind: "cancelled" };
    await writeFile(path, bytes);
    return { kind: "saved", path };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { kind: "downloaded", name: filename };
}

/** "Roadmap sync" → "Roadmap sync.md"; anything a file system dislikes becomes "_". */
export function markdownFilename(title: string): string {
  const stem = title.replace(/[<>:"/\\|?*]+/g, "_").replace(/\p{Cc}+/gu, "_").trim() || "meeting";
  return `${stem}.md`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
