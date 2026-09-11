import type { Adapter } from "./adapter";
import { automationsAdapter } from "./automations";
import { boardsAdapter } from "./boards";
import { dictationHistoryAdapter } from "./dictationHistory";
import { dictationSettingsAdapter } from "./dictationSettings";
import { dictationVocabularyAdapter } from "./dictationVocabulary";
import { focusAdapter } from "./focus";
import { lookPresetsAdapter } from "./lookPresets";
import { meetAdapter } from "./meet";

export type { Adapter, AdapterContext, ItemsAdapter, ValueAdapter } from "./adapter";

/** Every collection v1 syncs, in the order the card lists them. */
export const ADAPTERS: Adapter[] = [
  dictationSettingsAdapter,
  dictationVocabularyAdapter,
  dictationHistoryAdapter,
  lookPresetsAdapter,
  focusAdapter,
  automationsAdapter,
  boardsAdapter,
  meetAdapter,
];

/** What is deliberately never written to the folder — shown in the card. */
export const NEVER_SYNCED = "meeting audio, screen recordings, social credentials, the licence key, the cloud model key";
