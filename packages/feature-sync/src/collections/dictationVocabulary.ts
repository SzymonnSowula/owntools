import { getDictationSettings, saveDictationSettings, SETTINGS_EVENT, SETTINGS_KEY } from "@feature-dictation/engine";
import { sanitizeEntries, type VocabularyEntry } from "@feature-dictation/vocabulary";
import { bytesOf, combine, onStorageKey, type ItemsAdapter } from "./adapter";

/**
 * The vocabulary, one item per entry keyed by its spoken form (lower-cased),
 * which is also how the tool itself de-duplicates (`upsertEntry`). Two devices
 * adding different words both keep them; the same word edited on both takes
 * the later edit; a removal travels as a tombstone. Entries carry no
 * `updatedAt` of their own, so edits are found by the engine's shadow.
 */

export type VocabularyItem = VocabularyEntry;

export function vocabularyKey(spoken: string): string {
  return spoken.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export const dictationVocabularyAdapter: ItemsAdapter<VocabularyItem> = {
  kind: "items",
  id: "dictation-vocabulary",
  label: "Vocabulary",
  detail: "spellings and spoken-phrase replacements, merged word by word",
  async read() {
    const entries = getDictationSettings().entries;
    const items = entries.map((e) => ({ id: vocabularyKey(e.spoken), value: e }));
    return { items, bytes: bytesOf(entries) };
  },
  async apply(_ctx, merged) {
    // The tool's sanitizer decides what an entry is; order by creation so the
    // list reads the same on every device.
    const entries = sanitizeEntries(merged.items.map((i) => i.value)).sort((a, b) => a.createdAt - b.createdAt);
    saveDictationSettings({ entries });
  },
  subscribe(cb) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(SETTINGS_EVENT, cb);
    return combine(() => window.removeEventListener(SETTINGS_EVENT, cb), onStorageKey(SETTINGS_KEY, cb));
  },
};
