import {
  getDictationSettings,
  saveDictationSettings,
  SETTINGS_EVENT,
  SETTINGS_KEY,
  type DictationSettings,
} from "@feature-dictation/engine";
import { bytesOf, combine, isRecord, onStorageKey, type ValueAdapter } from "./adapter";

/**
 * The dictation preferences as one value: language, quality preset, standing
 * context and the cleanup switches. Left out on purpose: `entries` (the
 * vocabulary syncs per entry, see `dictationVocabulary.ts`) and `model` — the
 * engines installed differ per machine (a Mac has Parakeet only), so a model
 * choice is a fact about the device, not the person.
 */

export type SyncedDictationSettings = Pick<
  DictationSettings,
  "lang" | "quality" | "context" | "useSessionContext" | "cleanup" | "removeFillers" | "keepHistory"
>;

const LANGS = new Set(["auto", "en", "pl"]);
const QUALITIES = new Set(["fast", "balanced", "accurate"]);

export function pickSynced(settings: DictationSettings): SyncedDictationSettings {
  return {
    lang: settings.lang,
    quality: settings.quality,
    context: settings.context,
    useSessionContext: settings.useSessionContext,
    cleanup: settings.cleanup,
    removeFillers: settings.removeFillers,
    keepHistory: settings.keepHistory,
  };
}

/** Only known keys with the right types make it into the tool's settings. */
export function sanitizeSynced(raw: unknown): Partial<SyncedDictationSettings> {
  if (!isRecord(raw)) return {};
  const out: Partial<SyncedDictationSettings> = {};
  if (typeof raw.lang === "string" && LANGS.has(raw.lang)) out.lang = raw.lang as SyncedDictationSettings["lang"];
  if (typeof raw.quality === "string" && QUALITIES.has(raw.quality)) out.quality = raw.quality as SyncedDictationSettings["quality"];
  if (typeof raw.context === "string") out.context = raw.context.slice(0, 4000);
  for (const key of ["useSessionContext", "cleanup", "removeFillers", "keepHistory"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

export const dictationSettingsAdapter: ValueAdapter<SyncedDictationSettings> = {
  kind: "value",
  id: "dictation-settings",
  label: "Dictation settings",
  detail: "language, quality, context, cleanup switches - the model choice stays per device",
  async read() {
    const value = pickSynced(getDictationSettings());
    return { value, bytes: bytesOf(value) };
  },
  async apply(_ctx, value) {
    // Through the tool's own save so SETTINGS_EVENT fires and every page updates.
    saveDictationSettings(sanitizeSynced(value));
  },
  subscribe(cb) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(SETTINGS_EVENT, cb);
    return combine(() => window.removeEventListener(SETTINGS_EVENT, cb), onStorageKey(SETTINGS_KEY, cb));
  },
};
