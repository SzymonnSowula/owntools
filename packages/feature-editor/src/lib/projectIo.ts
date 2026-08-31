import { BaseDirectory, exists, mkdir, readDir, readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { MediaUrls, Project, ProjectMeta } from "../types";
import { isTauri } from "./tauri";

const ROOT = "screeni";
const INDEX = "screeni/index.json";

async function ensureRoot(): Promise<void> {
  if (!(await exists(ROOT, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(ROOT, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

export async function projectsDir(): Promise<string> {
  const root = await appDataDir();
  return join(root, ROOT, "projects");
}

export async function loadIndex(): Promise<ProjectMeta[]> {
  if (!isTauri()) {
    try {
      return JSON.parse(localStorage.getItem("screeni-recent") || "[]") as ProjectMeta[];
    } catch {
      return [];
    }
  }
  await ensureRoot();
  if (!(await exists(INDEX, { baseDir: BaseDirectory.AppData }))) return [];
  try {
    const raw = await readTextFile(INDEX, { baseDir: BaseDirectory.AppData });
    return JSON.parse(raw) as ProjectMeta[];
  } catch {
    return [];
  }
}

async function saveIndex(items: ProjectMeta[]): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem("screeni-recent", JSON.stringify(items.slice(0, 24)));
    return;
  }
  await ensureRoot();
  await writeTextFile(INDEX, JSON.stringify(items.slice(0, 24), null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function upsertRecent(meta: ProjectMeta): Promise<ProjectMeta[]> {
  const items = await loadIndex();
  const next = [meta, ...items.filter((i) => i.id !== meta.id)].slice(0, 24);
  await saveIndex(next);
  return next;
}

async function writeBlob(path: string, blob: Blob): Promise<void> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  await writeFile(path, buffer, { baseDir: BaseDirectory.AppData });
}

export async function saveProjectToDisk(
  project: Project,
  screenBlob?: Blob,
  webcamBlob?: Blob,
  backgroundBlob?: Blob,
): Promise<Project> {
  if (!isTauri()) return project;

  await ensureRoot();
  const rel = `${ROOT}/projects/${project.id}`;
  if (!(await exists(rel, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(rel, { baseDir: BaseDirectory.AppData, recursive: true });
  }

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

  await writeTextFile(`${rel}/project.json`, JSON.stringify(next, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
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
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".mp4")) return "video/mp4";
  return "video/webm";
}

async function appDataToObjectUrl(rel: string): Promise<string> {
  const bytes = await readFile(rel, { baseDir: BaseDirectory.AppData });
  const copy = new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([copy], { type: mimeFor(rel) }));
}

export async function loadProjectFromDisk(id: string): Promise<{ project: Project; media: MediaUrls } | null> {
  if (!isTauri()) return null;
  const rel = `${ROOT}/projects/${id}/project.json`;
  if (!(await exists(rel, { baseDir: BaseDirectory.AppData }))) return null;
  const raw = await readTextFile(rel, { baseDir: BaseDirectory.AppData });
  const project = JSON.parse(raw) as Project;
  const media: MediaUrls = { screenUrl: "" };
  try {
    if (project.screenPath) media.screenUrl = await appDataToObjectUrl(project.screenPath);
    if (project.webcamPath) media.webcamUrl = await appDataToObjectUrl(project.webcamPath);
    if (project.backgroundPath) media.backgroundUrl = await appDataToObjectUrl(project.backgroundPath);
  } catch {
    const root = await appDataDir();
    if (project.screenPath) media.screenUrl = convertFileSrc(await join(root, project.screenPath));
    if (project.webcamPath) media.webcamUrl = convertFileSrc(await join(root, project.webcamPath));
    if (project.backgroundPath) {
      media.backgroundUrl = convertFileSrc(await join(root, project.backgroundPath));
    }
  }
  return { project, media };
}

export async function listProjectFolders(): Promise<string[]> {
  if (!isTauri()) return [];
  const rel = `${ROOT}/projects`;
  if (!(await exists(rel, { baseDir: BaseDirectory.AppData }))) return [];
  const entries = await readDir(rel, { baseDir: BaseDirectory.AppData });
  return entries.filter((e) => e.isDirectory).map((e) => e.name ?? "");
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
