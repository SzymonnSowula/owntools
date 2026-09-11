import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_MODEL_ID,
  formatBytes,
  LLM_MODELS,
  LLM_RUNTIMES,
  LLAMA_CPP_TAG,
  modelById,
  modelInstalled,
  modelReady,
  type LlmBackendStatus,
} from "./models";

const HEX64 = /^[0-9a-f]{64}$/;
const HF_REVISION = /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/[^/]+\.gguf$/;

describe("model catalogue", () => {
  it("pins every model to a revision, a size and a checksum", () => {
    expect(LLM_MODELS.length).toBeGreaterThanOrEqual(2);
    for (const m of LLM_MODELS) {
      expect(m.sha256).toMatch(HEX64);
      expect(m.bytes).toBeGreaterThan(0);
      // Revision-pinned, never `main`: the checksum belongs to this exact file.
      expect(m.url).toMatch(HF_REVISION);
      expect(m.url.endsWith(`/${m.file}`)).toBe(true);
      expect(m.size).toBe(formatBytes(m.bytes));
      expect(m.contextLength).toBeGreaterThanOrEqual(8192);
      expect(m.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      expect(m.goodFor.length).toBeGreaterThan(10);
      expect(m.ram).toMatch(/GB/);
    }
    expect(new Set(LLM_MODELS.map((m) => m.id)).size).toBe(LLM_MODELS.length);
  });

  it("recommends the 4B and keeps a light one", () => {
    expect(modelById(DEFAULT_LLM_MODEL_ID)?.tags).toContain("recommended");
    expect(LLM_MODELS.some((m) => m.tags.includes("light"))).toBe(true);
    expect(LLM_MODELS.filter((m) => m.tags.includes("recommended"))).toHaveLength(1);
  });

  it("pins the runtime per platform with a checksum", () => {
    for (const rt of Object.values(LLM_RUNTIMES)) {
      expect(rt.sha256).toMatch(HEX64);
      expect(rt.bytes).toBeGreaterThan(0);
      expect(rt.url).toContain(`/releases/download/${LLAMA_CPP_TAG}/`);
      expect(rt.archive.startsWith("llm/")).toBe(true);
      expect(rt.url.endsWith(rt.kind === "zip" ? ".zip" : ".tar.gz")).toBe(true);
    }
  });

  it("formats sizes the way download pages quote them", () => {
    expect(formatBytes(2497280256)).toBe("2.5 GB");
    expect(formatBytes(1834426016)).toBe("1.8 GB");
    expect(formatBytes(18407457)).toBe("18 MB");
  });

  it("only calls a model ready when its runtime is there too", () => {
    const status: LlmBackendStatus = {
      runtime: false,
      models: [{ id: DEFAULT_LLM_MODEL_ID, installed: true, bytes: 1 }],
      server: "off",
      serverModel: null,
      dir: "",
      arch: "x86_64",
    };
    expect(modelInstalled(status, DEFAULT_LLM_MODEL_ID)).toBe(true);
    expect(modelReady(status, DEFAULT_LLM_MODEL_ID)).toBe(false);
    expect(modelReady({ ...status, runtime: true }, DEFAULT_LLM_MODEL_ID)).toBe(true);
    expect(modelReady(null, DEFAULT_LLM_MODEL_ID)).toBe(false);
  });
});
