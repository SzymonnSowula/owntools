import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { MediaUrls, Project, ProjectMeta, RecordedMedia } from "../types";
import { normalizeProject } from "./defaults";
import { isTauri } from "./tauri";

const ROOT = "screeni";
const PROJECTS = `${ROOT}/projects`;
const INDEX = `${ROOT}/index.json`;
/** The browser preview keeps its list in localStorage, where a cap makes sense. On disk there is none. */
const BROWSER_INDEX_LIMIT = 24;

const APP_DATA = { baseDir: BaseDirectory.AppData } as const;

/** AppData-relative folder of a project. */
export function projectDir(id: string): string {
  return `${PROJECTS}/${id}`;
}

/** Absolute path for an AppData-relative one — for convertFileSrc and revealItemInDir. */
export async function appDataPath(rel: string): Promise<string> {
  return join(await appDataDir(), rel);
}

async function ensureDir(rel: string): Promise<void> {
  if (!(await exists(rel, APP_DATA))) {
    await mkdir(rel, { ...APP_DATA, recursive: true });
  }
}

async function ensureRoot(): Promise<void> {
  await ensureDir(ROOT);
}

export async function projectsDir(): Promise<string> {
  return appDataPath(PROJECTS);
}

function isMeta(value: unknown): value is ProjectMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ProjectMeta).id === "string" &&
    typeof (value as ProjectMeta).name === "string"
  );
}

function parseIndex(raw: string): ProjectMeta[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMeta) : [];
  } catch {
    return [];
  }
}

export async function loadIndex(): Promise<ProjectMeta[]> {
  if (!isTauri()) {
    return parseIndex(localStorage.getItem("screeni-recent") || "[]");
  }
  await ensureRoot();
  if (!(await exists(INDEX, APP_DATA))) return [];
  try {
    return parseIndex(await readTextFile(INDEX, APP_DATA));
  } catch {
    return [];
  }
}

async function saveIndex(items: ProjectMeta[]): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem("screeni-recent", JSON.stringify(items.slice(0, BROWSER_INDEX_LIMIT)));
    return;
  }
  await ensureRoot();
  // Uncapped on purpose: every folder under projects/ stays listed, so
  // reconcileIndex never has to read a folder it has already seen.
  await writeTextFile(INDEX, JSON.stringify(items, null, 2), APP_DATA);
}

export async function upsertRecent(meta: ProjectMeta): Promise<ProjectMeta[]> {
  const items = await loadIndex();
  const next = [meta, ...items.filter((i) => i.id !== meta.id)];
  await saveIndex(next);
  return next;
}

/**
 * The recent list is index.json repaired against what is actually on disk.
 * Folders the index does not know — a crash before the index was written, a
 * corrupt index, a project copied in by hand — are read back from their
 * project.json; entries whose folder is gone are dropped. Only folders missing
 * from the index cost a read, so the common case is a single readDir.
 * Folders without a readable project.json are skipped silently.
 */
export async function reconcileIndex(): Promise<ProjectMeta[]> {
  const items = await loadIndex();
  if (!isTauri()) return items;

  let folders: string[];
  try {
    folders = (await listProjectFolders()).filter(Boolean);
  } catch {
    return items;
  }
  const onDisk = new Set(folders);
  const known = new Set(items.map((i) => i.id));
  const kept = items.filter((i) => onDisk.has(i.id));

  const recovered: ProjectMeta[] = [];
  for (const id of folders) {
    if (known.has(id)) continue;
    try {
      const raw = await readTextFile(`${projectDir(id)}/project.json`, APP_DATA);
      const p = JSON.parse(raw) as Partial<Project> | null;
      if (!p || typeof p !== "object") continue;
      recovered.push({
        id,
        name: typeof p.name === "string" && p.name ? p.name : id,
        createdAt: typeof p.createdAt === "number" ? p.createdAt : 0,
        duration: typeof p.duration === "number" ? p.duration : 0,
        dir: projectDir(id),
      });
    } catch {
      /* no or unreadable project.json — nothing we could open */
    }
  }

  if (!recovered.length && kept.length === items.length) return items;
  recovered.sort((a, b) => b.createdAt - a.createdAt);
  const merged = [...recovered, ...kept];
  await saveIndex(merged);
  return merged;
}

async function writeBlob(path: string, blob: Blob): Promise<void> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  await writeFile(path, buffer, APP_DATA);
}

/**
 * Creates the folder a recording streams into and returns the paths the
 * recorder should write. In the browser preview nothing is created; the paths
 * are still handed back so callers have one shape to work with.
 */
export async function createProjectDir(
  id: string,
): Promise<{ dir: string; screenPath: string; webcamPath: string }> {
  const dir = projectDir(id);
  if (isTauri()) await ensureDir(dir);
  return { dir, screenPath: `${dir}/screen.webm`, webcamPath: `${dir}/webcam.webm` };
}

/**
 * Registers a recording whose media is already on disk: writes project.json
 * and the index entry. The media is never read back — for a long take that
 * would mean pulling hundreds of megabytes through the webview for nothing.
 */
export async function finalizeRecordedProject(project: Project, media: RecordedMedia): Promise<Project> {
  const next: Project = { ...project, screenPath: media.screenPath, webcamPath: media.webcamPath };
  if (!isTauri()) return next;

  const dir = projectDir(project.id);
  await ensureDir(dir);
  await writeTextFile(`${dir}/project.json`, JSON.stringify(next, null, 2), APP_DATA);
  await upsertRecent({
    id: next.id,
    name: next.name,
    createdAt: next.createdAt,
    duration: next.duration,
    dir,
  });
  return next;
}

/** Removes a project folder — used when a live recording is cancelled, never on a finished take. */
export async function discardProjectDir(id: string): Promise<void> {
  if (!isTauri()) return;
  const dir = projectDir(id);
  if (await exists(dir, APP_DATA)) {
    await remove(dir, { ...APP_DATA, recursive: true });
  }
}

export async function saveProjectToDisk(
  project: Project,
  screenBlob?: Blob,
  webcamBlob?: Blob,
  backgroundBlob?: Blob,
): Promise<Project> {
  if (!isTauri()) return project;

  const rel = projectDir(project.id);
  await ensureDir(rel);

  const next = { ...project };
  if (screenBlob) {
    next.screenPath = `${rel}/screen.webm`;
    await writeBlob(next.screenPath, screenBlob);
  }
  if (webcamBlob) {
    next.webcamPath = `${rel}/webcam.webm`;
    await writeBlob(next.webcamPath, webcamBlob);
  }
  if (backgroundBlob) {
    next.backgroundPath = `${rel}/background.jpg`;
    await writeBlob(next.backgroundPath, backgroundBlob);
  }

  await writeTextFile(`${rel}/project.json`, JSON.stringify(next, null, 2), APP_DATA);
  await upsertRecent({
    id: next.id,
    name: next.name,
    createdAt: next.createdAt,
    duration: next.duration,
    dir: rel,
  });
  return next;
}

function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "video/webm";
}

function safeExt(name: string, fallback: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return (m ? m[1] : fallback).toLowerCase();
}

/**
 * Copies a picked file (logo, sticker, background) into the project folder so
 * it survives a restart. Returns the file name inside the folder, or null in
 * the browser preview where nothing is persisted.
 */
export async function saveProjectAsset(
  projectId: string,
  file: Blob,
  originalName: string,
  prefix = "asset",
): Promise<{ name: string; rel: string } | null> {
  if (!isTauri()) return null;
  const dir = projectDir(projectId);
  await ensureDir(dir);
  const base = originalName.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w\-]+/g, "_").slice(0, 40) || prefix;
  const name = `${prefix}_${Math.random().toString(36).slice(2, 8)}_${base}.${safeExt(originalName, "png")}`;
  const rel = `${dir}/${name}`;
  await writeBlob(rel, file);
  return { name, rel };
}

async function appDataToObjectUrl(rel: string): Promise<string> {
  const bytes = await readFile(rel, APP_DATA);
  const copy = new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([copy], { type: mimeFor(rel) }));
}

export async function loadProjectFromDisk(id: string): Promise<{ project: Project; media: MediaUrls } | null> {
  if (!isTauri()) return null;
  const rel = `${projectDir(id)}/project.json`;
  if (!(await exists(rel, APP_DATA))) return null;
  const raw = await readTextFile(rel, APP_DATA);
  const project = normalizeProject(JSON.parse(raw) as Project);
  const media: MediaUrls = { screenUrl: "" };
  try {
    if (project.screenPath) media.screenUrl = await appDataToObjectUrl(project.screenPath);
    if (project.webcamPath) media.webcamUrl = await appDataToObjectUrl(project.webcamPath);
    if (project.backgroundPath) media.backgroundUrl = await appDataToObjectUrl(project.backgroundPath);
  } catch {
    if (project.screenPath) media.screenUrl = convertFileSrc(await appDataPath(project.screenPath));
    if (project.webcamPath) media.webcamUrl = convertFileSrc(await appDataPath(project.webcamPath));
    if (project.backgroundPath) {
      media.backgroundUrl = convertFileSrc(await appDataPath(project.backgroundPath));
    }
  }
  // Image overlays: one file each inside the project folder; a missing one just doesn't draw.
  const dir = projectDir(id);
  for (const overlay of project.overlays) {
    if (media.overlayUrls?.[overlay.src]) continue;
    try {
      const url = await appDataToObjectUrl(`${dir}/${overlay.src}`);
      media.overlayUrls = { ...(media.overlayUrls ?? {}), [overlay.src]: url };
    } catch {
      /* the file is gone; the overlay stays in the list so it can be removed */
    }
  }
  return { project, media };
}

export async function listProjectFolders(): Promise<string[]> {
  if (!isTauri()) return [];
  if (!(await exists(PROJECTS, APP_DATA))) return [];
  const entries = await readDir(PROJECTS, APP_DATA);
  return entries.filter((e) => e.isDirectory).map((e) => e.name ?? "");
}

/**
 * Opens the file explorer on an AppData path. When the file itself is missing
 * (a take whose first chunk never got written) its folder is revealed instead.
 */
export async function revealInAppData(rel: string): Promise<void> {
  if (!isTauri()) return;
  const target = (await exists(rel, APP_DATA)) ? rel : rel.slice(0, rel.lastIndexOf("/"));
  await revealItemInDir(await appDataPath(target));
}

/** Reveals a project's folder with its project.json selected. */
export async function revealProjectInFolder(meta: Pick<ProjectMeta, "id" | "dir">): Promise<void> {
  if (!isTauri()) return;
  const dir = meta.dir ?? projectDir(meta.id);
  await revealInAppData(`${dir}/project.json`);
}

/**
 * Reveals the recordings folder. revealItemInDir selects an item inside its
 * parent, so we point it at a project folder (the preferred one when it
 * exists) and the explorer opens on projects/ itself. With no projects yet,
 * projects/ is selected inside screeni/.
 */
export async function revealProjectsFolder(preferId?: string): Promise<void> {
  if (!isTauri()) return;
  await ensureDir(PROJECTS);
  const folders = (await listProjectFolders()).filter(Boolean);
  const pick = preferId && folders.includes(preferId) ? preferId : folders[0];
  await revealItemInDir(await appDataPath(pick ? projectDir(pick) : PROJECTS));
}

function filterFor(ext: string): { name: string; extensions: string[] } {
  switch (ext) {
    case "mp4":
      return { name: "MP4", extensions: ["mp4"] };
    case "webm":
      return { name: "WebM", extensions: ["webm"] };
    case "srt":
      return { name: "Subtitles", extensions: ["srt"] };
    case "txt":
      return { name: "Text", extensions: ["txt"] };
    case "m4a":
      return { name: "Audio", extensions: ["m4a"] };
    case "wav":
      return { name: "Audio", extensions: ["wav"] };
    default:
      return { name: ext.toUpperCase(), extensions: [ext] };
  }
}

export async function exportBlobToPath(
  blob: Blob,
  defaultName: string,
  ext: string = "webm",
): Promise<string | null> {
  if (!isTauri()) return null;
  const path = await save({
    defaultPath: defaultName,
    filters: [filterFor(ext)],
  });
  if (!path) return null;
  const buffer = new Uint8Array(await blob.arrayBuffer());
  await writeFile(path, buffer);
  return path;
}

export async function readDiskFile(path: string): Promise<Uint8Array> {
  return readFile(path);
}

export async function fileToBlob(file: File): Promise<Blob> {
  return file;
}
