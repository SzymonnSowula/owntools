import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LLM_SETTINGS, LLM_SETTINGS_KEY, llmSettings } from "@core/llm";
import { adoptSocialAiSettings, migrateFromSocial } from "./migrate";

const anthropic = { provider: "anthropic" as const, apiKey: " sk-ant-x ", baseUrl: "https://api.openai.com/v1", model: "" };
const ollama = { provider: "openai" as const, apiKey: "", baseUrl: "http://localhost:11434/v1", model: "llama3" };

beforeEach(() => localStorage.clear());

describe("migrateFromSocial", () => {
  it("copies a configured Anthropic key and drops the OpenAI base URL that came with it", () => {
    const next = migrateFromSocial(DEFAULT_LLM_SETTINGS, anthropic);
    expect(next?.cloud).toEqual({ provider: "anthropic", apiKey: "sk-ant-x", baseUrl: "", model: "" });
    expect(next?.prefer).toBe("auto");
  });

  it("copies an OpenAI-compatible endpoint even without a key", () => {
    expect(migrateFromSocial(DEFAULT_LLM_SETTINGS, ollama)?.cloud).toEqual({
      provider: "openai",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3",
    });
  });

  it("has nothing to do when social is off or unconfigured", () => {
    expect(migrateFromSocial(DEFAULT_LLM_SETTINGS, { ...anthropic, provider: "none" })).toBeNull();
    expect(migrateFromSocial(DEFAULT_LLM_SETTINGS, { ...anthropic, apiKey: "  " })).toBeNull();
    expect(migrateFromSocial(DEFAULT_LLM_SETTINGS, { ...ollama, baseUrl: "" })).toBeNull();
    expect(migrateFromSocial(DEFAULT_LLM_SETTINGS, null)).toBeNull();
  });

  it("never overwrites a shared cloud block that already works", () => {
    const shared = { ...DEFAULT_LLM_SETTINGS, cloud: { provider: "anthropic" as const, apiKey: "mine", baseUrl: "", model: "" } };
    expect(migrateFromSocial(shared, ollama)).toBeNull();
  });
});

describe("adoptSocialAiSettings", () => {
  it("writes the shared settings once and then leaves them alone", () => {
    expect(adoptSocialAiSettings(anthropic)).toBe(true);
    expect(llmSettings().cloud.apiKey).toBe("sk-ant-x");
    // The person clears the key afterwards: social's copy must not come back.
    localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(DEFAULT_LLM_SETTINGS));
    expect(adoptSocialAiSettings(anthropic)).toBe(false);
    expect(llmSettings().cloud.apiKey).toBe("");
  });

  it("does not spend the one attempt on settings that have not loaded yet", () => {
    expect(adoptSocialAiSettings({ ...anthropic, provider: "none" })).toBe(false);
    expect(adoptSocialAiSettings(anthropic)).toBe(true);
  });
});
