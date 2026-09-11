import { cloudConfigured, llmSettings, setLlmSettings, type LlmSettings } from "@core/llm";

/**
 * social used to keep its own AI provider (`settings.ai` in
 * `<AppData>/social/settings.json`): provider, key, base URL, model. That
 * form is gone — there is one model for every tool now — so the first time
 * the shared settings are empty and social's are configured, social's move
 * over. Once: a person who later clears the shared key has cleared it.
 */

export interface SocialAiLike {
  provider: "none" | "anthropic" | "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Pure: the shared settings with social's cloud block copied in, or `null`
 * when there is nothing to copy (social off / unconfigured) or nothing to
 * copy into (the shared cloud block is already usable).
 */
export function migrateFromSocial(shared: LlmSettings, social: SocialAiLike | null | undefined): LlmSettings | null {
  if (!social || social.provider === "none") return null;
  if (cloudConfigured(shared.cloud)) return null;
  const configured = social.provider === "anthropic" ? Boolean(social.apiKey.trim()) : Boolean(social.baseUrl.trim());
  if (!configured) return null;
  return {
    ...shared,
    cloud: {
      provider: social.provider,
      apiKey: social.apiKey.trim(),
      baseUrl: social.provider === "openai" ? social.baseUrl.trim() : "",
      model: social.model.trim(),
    },
  };
}

const MIGRATED_KEY = "owntools-llm-migrated-social";

/**
 * Applies `migrateFromSocial` to the live settings, once. Called by social's
 * AI adapter with whatever its settings file holds; a call made before the
 * file has loaded (provider "none") changes nothing and does not count as
 * the one attempt. Returns true when something was copied.
 */
export function adoptSocialAiSettings(social: SocialAiLike | null | undefined): boolean {
  if (!social || social.provider === "none") return false;
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return false;
  } catch {
    return false;
  }
  const next = migrateFromSocial(llmSettings(), social);
  if (next) setLlmSettings({ cloud: next.cloud });
  try {
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
  } catch {
    /* private mode */
  }
  return next !== null;
}
