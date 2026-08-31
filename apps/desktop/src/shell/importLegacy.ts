import { isTauri } from "@core/env";

const FLAG = "suite-legacy-import-done";

/**
 * One-time copy of data from the standalone focus/screeni apps into this
 * app's AppData. Runs before the focus store hydrates so imported data is
 * picked up on the very first launch. Never deletes the legacy directories.
 */
export async function runLegacyImport(): Promise<void> {
  if (!isTauri()) return;
  try {
    if (localStorage.getItem(FLAG)) return;
  } catch {
    /* continue */
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("import_legacy_data");
    localStorage.setItem(FLAG, "1");
  } catch (err) {
    console.warn("Legacy data import failed:", err);
  }
}
