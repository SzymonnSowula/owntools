import {
  exportToBlob,
  exportToClipboard,
  exportToSvg,
  loadFromBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { isTauri } from "@core/env";
import { safeFileName } from "./boards";

export type ExportKind = "png" | "svg" | "file" | "clipboard";
export type ExportOutcome = "saved" | "copied" | "cancelled" | "empty";

const PADDING = 24;

/**
 * Exports go through the native save dialog in the app (the dialog whitelists
 * the chosen path for the fs plugin) and through a download link in a browser.
 * Excalidraw's own image dialog stays available too; this is the path that is
 * guaranteed to work inside the webview.
 */
export async function exportBoard(
  api: ExcalidrawImperativeAPI,
  kind: ExportKind,
  name: string,
): Promise<ExportOutcome> {
  const elements = api.getSceneElements();
  if (elements.length === 0) return "empty";
  const appState = api.getAppState();
  const files = api.getFiles();
  const base = safeFileName(name);

  switch (kind) {
    case "clipboard": {
      await exportToClipboard({ elements, appState, files, type: "png" });
      return "copied";
    }
    case "png": {
      const blob = await exportToBlob({
        elements,
        appState,
        files,
        mimeType: "image/png",
        exportPadding: PADDING,
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return (await saveBytes(bytes, `${base}.png`, "PNG image", ["png"])) ? "saved" : "cancelled";
    }
    case "svg": {
      const svg = await exportToSvg({ elements, appState, files, exportPadding: PADDING });
      const text = new XMLSerializer().serializeToString(svg);
      const bytes = new TextEncoder().encode(text);
      return (await saveBytes(bytes, `${base}.svg`, "SVG image", ["svg"])) ? "saved" : "cancelled";
    }
    case "file": {
      const json = serializeAsJSON(elements, appState, files, "local");
      const bytes = new TextEncoder().encode(json);
      return (await saveBytes(bytes, `${base}.excalidraw`, "Excalidraw board", ["excalidraw"]))
        ? "saved"
        : "cancelled";
    }
  }
}

async function saveBytes(
  bytes: Uint8Array,
  fileName: string,
  filterName: string,
  extensions: string[],
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: fileName, filters: [{ name: filterName, extensions }] });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export interface ImportedBoard {
  name: string;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

function pickFileInBrowser(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Cancelling the picker fires nothing we can rely on; a dangling resolver is harmless.
    input.click();
  });
}

/** Lets the user pick an .excalidraw file and reads it into a fresh scene. Null when cancelled. */
export async function pickBoardFile(): Promise<ImportedBoard | null> {
  let blob: Blob | null = null;
  let fileName = "";
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Excalidraw board", extensions: ["excalidraw", "json"] }],
    });
    if (!path) return null;
    blob = new Blob([await readFile(path)]);
    fileName = path.split(/[\\/]/).pop() ?? "";
  } else {
    const file = await pickFileInBrowser(".excalidraw,.json,application/json");
    if (!file) return null;
    blob = file;
    fileName = file.name;
  }
  const data = await loadFromBlob(blob, null, null);
  return {
    name: fileName.replace(/\.(excalidraw|json)$/i, ""),
    elements: data.elements,
    appState: data.appState,
    files: data.files,
  };
}
