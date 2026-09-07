import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_FILE,
  dictationReady,
  EMPTY_STATUS,
  formatBytes,
  modelById,
  modelReady,
  MODELS,
  PARAKEET_V3_ID,
  resolveActiveModel,
  WHISPER_MODELS,
  type EngineStatus,
} from "./models";

type StatusPatch = Partial<Omit<EngineStatus, "parakeet">> & { parakeet?: Partial<EngineStatus["parakeet"]> };

function status(patch: StatusPatch): EngineStatus {
  return {
    ...EMPTY_STATUS,
    ...patch,
    parakeet: { ...EMPTY_STATUS.parakeet, ...(patch.parakeet ?? {}) },
  };
}

describe("catalogue", () => {
  it("pins every file with a size and a checksum", () => {
    for (const model of MODELS) {
      expect(model.files.length).toBeGreaterThan(0);
      for (const f of model.files) {
        expect(f.bytes).toBeGreaterThan(0);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.url).toMatch(/^https:\/\//);
      }
      expect(model.bytes).toBe(model.files.reduce((n, f) => n + f.bytes, 0));
      expect(model.size).toBe(formatBytes(model.bytes));
    }
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
  });

  it("keeps whisper file names as ids, so old settings still resolve", () => {
    expect(modelById(DEFAULT_MODEL_FILE)?.engine).toBe("whisper");
    expect(WHISPER_MODELS.every((m) => m.id.startsWith("ggml-") && m.id.endsWith(".bin"))).toBe(true);
    expect(modelById(PARAKEET_V3_ID)?.vendor).toBe("nvidia");
  });

  it("formats sizes the way download pages quote them", () => {
    expect(formatBytes(147951465)).toBe("148 MB");
    expect(formatBytes(1624555275)).toBe("1.6 GB");
    expect(formatBytes(93939)).toBe("94 kB");
  });
});

describe("resolveActiveModel", () => {
  const parakeet = modelById(PARAKEET_V3_ID)!;
  const turbo = modelById(DEFAULT_MODEL_FILE)!;

  it("is empty without a backend or without anything runnable", () => {
    expect(resolveActiveModel(PARAKEET_V3_ID, null)).toBeNull();
    expect(resolveActiveModel(PARAKEET_V3_ID, status({}))).toBeNull();
    // A model folder without its runtime is not runnable.
    expect(modelReady(status({ parakeet: { models: [PARAKEET_V3_ID] } }), parakeet)).toBe(false);
    expect(dictationReady(status({ engine: true }))).toBe(false);
  });

  it("uses the chosen model when it is runnable", () => {
    const both = status({
      engine: true,
      model: true,
      models: [DEFAULT_MODEL_FILE],
      parakeet: { runtime: true, models: [PARAKEET_V3_ID] },
    });
    expect(resolveActiveModel(PARAKEET_V3_ID, both)).toMatchObject({ id: PARAKEET_V3_ID, engine: "parakeet" });
    expect(resolveActiveModel(DEFAULT_MODEL_FILE, both)).toMatchObject({ id: turbo.id, engine: "whisper" });
  });

  it("falls back to Parakeet, then to the best whisper, when nothing is chosen", () => {
    const both = status({
      engine: true,
      model: true,
      models: ["ggml-base.bin", DEFAULT_MODEL_FILE],
      parakeet: { runtime: true, models: [PARAKEET_V3_ID] },
    });
    expect(resolveActiveModel("", both)?.id).toBe(PARAKEET_V3_ID);
    const whisperOnly = status({ engine: true, model: true, models: ["ggml-base.bin"] });
    expect(resolveActiveModel("", whisperOnly)).toMatchObject({ id: "ggml-base.bin", engine: "whisper" });
    // A chosen model that is not installed falls through the same way.
    expect(resolveActiveModel(PARAKEET_V3_ID, whisperOnly)?.id).toBe("ggml-base.bin");
  });

  it("accepts a whisper file the catalogue does not know", () => {
    const custom = status({ engine: true, model: true, models: ["ggml-medium.bin"] });
    expect(resolveActiveModel("ggml-medium.bin", custom)).toEqual({
      id: "ggml-medium.bin",
      engine: "whisper",
      model: undefined,
    });
    expect(dictationReady(custom)).toBe(true);
  });
});
