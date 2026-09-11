import { isTauri } from "@core/env";
import { clearMemoryLog, memoryEntries, summarize, type NetEntry, type NetSummary } from "@core/net";

/**
 * The card's data layer. In the app the log lives in Rust
 * (`<AppData>/privacy/netlog.jsonl`, `netlog.rs`); outside Tauri the
 * in-memory list `@core/net` keeps for this window stands in, so `pnpm dev`
 * shows real entries from the YouTube tool or a launch page read.
 */

export async function fetchSummary(month: string): Promise<NetSummary> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<NetSummary>("net_log_summary", { month });
  }
  return summarize(memoryEntries(), month);
}

/** Newest first. */
export async function fetchRecent(limit = 100): Promise<NetEntry[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<NetEntry[]>("net_log_recent", { limit });
  }
  return [...memoryEntries()].reverse().slice(0, limit);
}

export async function clearLog(): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("net_log_clear");
  }
  clearMemoryLog();
}
