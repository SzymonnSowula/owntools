import { beforeEach, describe, expect, it } from "vitest";
import {
  chunkForModel,
  cloudConfigured,
  DEFAULT_LLM_SETTINGS,
  estimateTokens,
  LLM_EVENT,
  LLM_SETTINGS_KEY,
  llmSettings,
  localModelFor,
  parseLooseJson,
  resolveLlmStatus,
  setLlmSettings,
  stripThink,
  type LlmBackendStatus,
  type LlmSettings,
} from "./llm";

function settings(patch: Partial<LlmSettings> = {}): LlmSettings {
  return {
    ...DEFAULT_LLM_SETTINGS,
    ...patch,
    cloud: { ...DEFAULT_LLM_SETTINGS.cloud, ...(patch.cloud ?? {}) },
    local: { ...DEFAULT_LLM_SETTINGS.local, ...(patch.local ?? {}) },
  };
}

function backend(patch: Partial<LlmBackendStatus> = {}): LlmBackendStatus {
  return { runtime: false, models: [], server: "off", serverModel: null, dir: "", arch: "x86_64", ...patch };
}

const withModel = backend({
  runtime: true,
  models: [
    { id: "qwen3-1.7b-q8_0", installed: true, bytes: 1 },
    { id: "qwen3-4b-q4_k_m", installed: true, bytes: 2 },
  ],
});

beforeEach(() => {
  localStorage.clear();
});

describe("parseLooseJson", () => {
  it("reads plain JSON, fenced JSON and JSON wrapped in prose", () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseJson('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(parseLooseJson('Sure! Here it is: {"title":"x","tags":["a"]} Hope that helps.')).toEqual({
      title: "x",
      tags: ["a"],
    });
    expect(parseLooseJson("The list: [1, 2, 3].")).toEqual([1, 2, 3]);
  });

  it("gives null instead of throwing", () => {
    expect(parseLooseJson("no json here")).toBeNull();
    expect(parseLooseJson("{broken")).toBeNull();
    expect(parseLooseJson("")).toBeNull();
  });
});

describe("chunkForModel", () => {
  it("keeps short text whole and splits on paragraphs first", () => {
    expect(chunkForModel("hello world")).toEqual(["hello world"]);
    const paragraph = "Sentence one is here. ".repeat(40).trim(); // ~880 chars ≈ 275 tokens
    const text = [paragraph, paragraph, paragraph, paragraph].join("\n\n");
    const chunks = chunkForModel(text, 600);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c)).toBeLessThanOrEqual(600);
    // Paragraph boundaries survive: no chunk starts mid-sentence.
    for (const c of chunks) expect(c.startsWith("Sentence one")).toBe(true);
    expect(chunks.join("\n\n")).toBe(text);
  });

  it("splits one oversized paragraph on sentence boundaries", () => {
    const text = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i + 1}, long enough to count.`).join(" ");
    const chunks = chunkForModel(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokens(c)).toBeLessThanOrEqual(120 + 20); // one sentence of slack at most
      expect(c.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ")).toBe(text);
  });

  it("estimates tokens pessimistically", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(320))).toBe(100);
  });
});

describe("stripThink", () => {
  it("drops complete and unterminated think blocks", () => {
    expect(stripThink("<think>\n\n</think>\n\nHello.")).toBe("Hello.");
    expect(stripThink("A <think>x</think>B")).toBe("A B");
    expect(stripThink("<think>never closed")).toBe("");
    expect(stripThink("plain")).toBe("plain");
  });
});

describe("settings", () => {
  it("fills in missing parts of an older or partial JSON", () => {
    localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ prefer: "cloud", cloud: { provider: "openai", baseUrl: "http://x/v1" } }));
    const s = llmSettings();
    expect(s.prefer).toBe("cloud");
    expect(s.cloud).toEqual({ provider: "openai", apiKey: "", baseUrl: "http://x/v1", model: "" });
    expect(s.local).toEqual({ model: "" });
  });

  it("falls back to the defaults on garbage", () => {
    localStorage.setItem(LLM_SETTINGS_KEY, "{not json");
    expect(llmSettings()).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it("merges a patch, persists it and fires the change event", () => {
    let fired = 0;
    const listener = () => fired++;
    window.addEventListener(LLM_EVENT, listener);
    setLlmSettings({ cloud: { provider: "anthropic", apiKey: "k", baseUrl: "", model: "" } });
    const next = setLlmSettings({ local: { model: "qwen3-4b-q4_k_m" } });
    window.removeEventListener(LLM_EVENT, listener);
    expect(next.cloud.apiKey).toBe("k");
    expect(next.local.model).toBe("qwen3-4b-q4_k_m");
    expect(JSON.parse(localStorage.getItem(LLM_SETTINGS_KEY)!)).toEqual(next);
    expect(fired).toBe(2);
  });

  it("knows when a cloud block can be called", () => {
    expect(cloudConfigured({ provider: "anthropic", apiKey: "", baseUrl: "", model: "" })).toBe(false);
    expect(cloudConfigured({ provider: "anthropic", apiKey: " k ", baseUrl: "", model: "" })).toBe(true);
    expect(cloudConfigured({ provider: "openai", apiKey: "", baseUrl: "", model: "" })).toBe(false);
    // A local OpenAI-compatible server needs no key.
    expect(cloudConfigured({ provider: "openai", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1", model: "" })).toBe(true);
  });
});

describe("resolveLlmStatus", () => {
  it("is unavailable, with a reason that names Settings, when nothing is set up", () => {
    const s = resolveLlmStatus(settings(), backend(), { inApp: true });
    expect(s.available).toBe(false);
    expect(s.provider).toBeNull();
    expect(s.reason).toContain("Settings → Intelligence");
    expect(s.local).toEqual({ runtime: false, model: false, server: "off", installing: false });
  });

  it("prefers the on-device model in auto and picks the chosen one when installed", () => {
    const s = resolveLlmStatus(settings({ local: { model: "qwen3-4b-q4_k_m" } }), withModel);
    expect(s).toMatchObject({ available: true, provider: "local", model: "qwen3-4b-q4_k_m" });
    // Chosen but not installed → the first installed one.
    const other = resolveLlmStatus(settings({ local: { model: "nope" } }), withModel);
    expect(other.model).toBe("qwen3-1.7b-q8_0");
    expect(localModelFor(settings(), backend({ runtime: true }))).toBeNull();
  });

  it("does not count a model folder without the runtime", () => {
    const noRuntime = backend({ models: [{ id: "qwen3-4b-q4_k_m", installed: true, bytes: 1 }] });
    const s = resolveLlmStatus(settings(), noRuntime);
    expect(s.available).toBe(false);
    expect(s.local.model).toBe(false);
  });

  it("falls back to a configured cloud provider in auto, and uses its default model", () => {
    const s = resolveLlmStatus(settings({ cloud: { provider: "anthropic", apiKey: "k", baseUrl: "", model: "" } }), backend());
    expect(s).toMatchObject({ available: true, provider: "anthropic", model: "claude-opus-5" });
    const named = resolveLlmStatus(
      settings({ cloud: { provider: "openai", apiKey: "", baseUrl: "http://x/v1", model: "llama3" } }),
      null,
    );
    expect(named).toMatchObject({ available: true, provider: "openai", model: "llama3" });
  });

  it("honours a forced provider", () => {
    const both = settings({ cloud: { provider: "anthropic", apiKey: "k", baseUrl: "", model: "" } });
    expect(resolveLlmStatus({ ...both, prefer: "local" }, withModel).provider).toBe("local");
    expect(resolveLlmStatus({ ...both, prefer: "cloud" }, withModel).provider).toBe("anthropic");
    const forcedLocalNoModel = resolveLlmStatus({ ...both, prefer: "local" }, backend());
    expect(forcedLocalNoModel.available).toBe(false);
    expect(forcedLocalNoModel.reason).toContain("install one");
    const forcedCloudNoKey = resolveLlmStatus(settings({ prefer: "cloud" }), withModel);
    expect(forcedCloudNoKey.available).toBe(false);
    expect(forcedCloudNoKey.reason).toContain("API key");
  });

  it("is off when told so, whatever is installed", () => {
    const s = resolveLlmStatus(settings({ prefer: "off" }), withModel);
    expect(s.available).toBe(false);
    expect(s.reason).toContain("switched off");
    expect(s.local.model).toBe(true);
  });

  it("explains the browser preview and a download in progress", () => {
    expect(resolveLlmStatus(settings(), null, { inApp: false }).reason).toContain("desktop app");
    const s = resolveLlmStatus(settings(), backend(), { installing: true });
    expect(s.local.installing).toBe(true);
    expect(s.reason).toContain("downloading");
  });
});
