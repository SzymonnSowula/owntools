import { isTauri } from "@core/env";
import { memoryEntries, monthOf, type NetEntry } from "@core/net";
import { saveBlob, type SaveOutcome } from "@feature-tools/lib/save";

/**
 * The log as a file the person can keep or hand to someone: the JSONL as it
 * sits on disk, or a CSV for a spreadsheet. Saved through the native dialog
 * in the app, as a download in the browser preview.
 */

export const CSV_COLUMNS = ["time", "host", "purpose", "kind", "method", "status", "ok", "bytesOut", "bytesIn"] as const;

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(entries: readonly NetEntry[]): string {
  const rows = entries.map((e) =>
    [new Date(e.ts).toISOString(), e.host, e.purpose, e.kind, e.method, e.status, e.ok, e.bytesOut, e.bytesIn].map(csvCell).join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

export function toJsonl(entries: readonly NetEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
}

function isEntry(v: unknown): v is NetEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.ts === "number" && typeof e.host === "string" && typeof e.purpose === "string" && (e.kind === "cloud" || e.kind === "local");
}

/** Lines that do not parse are skipped, the way `netlog.rs` reads them. */
export function parseJsonl(text: string): NetEntry[] {
  const out: NetEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (isEntry(v)) out.push(v);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Everything on disk (the rotated generation first), or this window's memory outside Tauri. */
export async function readLogEntries(): Promise<NetEntry[]> {
  if (!isTauri()) return [...memoryEntries()];
  const { BaseDirectory, exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const opts = { baseDir: BaseDirectory.AppData };
  let text = "";
  for (const name of ["privacy/netlog.jsonl.1", "privacy/netlog.jsonl"]) {
    if (await exists(name, opts)) text += (await readTextFile(name, opts)) + "\n";
  }
  return parseJsonl(text);
}

export type ExportFormat = "jsonl" | "csv";

export async function exportLog(format: ExportFormat): Promise<SaveOutcome> {
  const entries = await readLogEntries();
  const text = format === "csv" ? toCsv(entries) : toJsonl(entries);
  const type = format === "csv" ? "text/csv" : "application/x-ndjson";
  return saveBlob(new Blob([text], { type }), `owntools-network-log-${monthOf(Date.now())}.${format}`);
}
