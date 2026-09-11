import { loadCustomPresets, type LookPreset } from "@feature-editor/lib/presets";
import { bytesOf, combine, isRecord, onStorageKey, poll, type ItemsAdapter } from "./adapter";

/**
 * screeni's custom looks, one item per preset by id. The editor keeps them in
 * localStorage under a private key and reads the list every time its menu
 * opens, so writing the same key is enough — there is no event to fire.
 */

/** `STORAGE_KEY` in `feature-editor/lib/presets.ts` is not exported; the value is a contract. */
export const LOOK_PRESETS_KEY = "screeni-look-presets";

export type LookItem = Pick<LookPreset, "id" | "name" | "look">;

function isLook(v: unknown): v is LookItem {
  return isRecord(v) && typeof v.id === "string" && typeof v.name === "string" && isRecord(v.look);
}

const raw = () => {
  try {
    return localStorage.getItem(LOOK_PRESETS_KEY) ?? "";
  } catch {
    return "";
  }
};

export const lookPresetsAdapter: ItemsAdapter<LookItem> = {
  kind: "items",
  id: "look-presets",
  label: "screeni looks",
  detail: "your saved look presets (background, camera, cursor, progress bar, fades)",
  async read() {
    const presets = loadCustomPresets();
    const items = presets.map((p) => ({ id: p.id, value: { id: p.id, name: p.name, look: p.look } }));
    return { items, bytes: bytesOf(items.map((i) => i.value)) };
  },
  async apply(_ctx, merged) {
    const presets = merged.items.map((i) => i.value).filter(isLook);
    try {
      localStorage.setItem(LOOK_PRESETS_KEY, JSON.stringify(presets));
    } catch {
      /* quota */
    }
  },
  subscribe(cb) {
    return combine(onStorageKey(LOOK_PRESETS_KEY, cb), poll(15_000, raw, cb));
  },
};
