import { describe, expect, it } from "vitest";
import { edgeCurve, matteBounds, matteCoverage, modelInputSize, padBounds, toMatte, toTensor } from "./mask";
import { MATTING_MODELS, mattingModel, mattingModelDest } from "./models";

const general = mattingModel("general")!;
const portrait = mattingModel("portrait")!;

describe("modelInputSize", () => {
  it("stretches to the fixed square a model was trained on", () => {
    expect(modelInputSize(general, { width: 4000, height: 3000 })).toEqual({ width: 1024, height: 1024 });
  });

  it("keeps the aspect ratio for a convolutional model, on its grid", () => {
    // 360×450 → shortest edge 512 → 512×640, both multiples of 32
    expect(modelInputSize(portrait, { width: 360, height: 450 })).toEqual({ width: 512, height: 640 });
    const wide = modelInputSize(portrait, { width: 1920, height: 1080 });
    expect(wide.width % 32).toBe(0);
    expect(wide.height % 32).toBe(0);
    expect(wide.height).toBe(512);
  });

  it("caps the long side of a panorama instead of feeding the model a ribbon", () => {
    const size = modelInputSize(portrait, { width: 6000, height: 1000 });
    expect(size.width).toBeLessThanOrEqual(1024);
    expect(size.height).toBeGreaterThanOrEqual(32);
  });
});

describe("toTensor", () => {
  it("is planar RGB, normalised per model", () => {
    // two pixels: pure red, mid grey
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255]);
    const size = { width: 2, height: 1 };
    const p = toTensor(rgba, size, portrait); // v/255 → (x - 0.5) / 0.5
    expect(Array.from(p).map((v) => +v.toFixed(3))).toEqual([1, 0.004, -1, 0.004, -1, 0.004]);
    const g = toTensor(rgba, size, general); // (v - 128) / 256
    expect(+g[0].toFixed(4)).toBe(+((255 - 128) / 256).toFixed(4));
    expect(g[1]).toBe(0);
    expect(+g[2].toFixed(4)).toBe(-0.5);
  });
});

describe("toMatte", () => {
  it("passes a 0..1 matte through", () => {
    expect(Array.from(toMatte([0, 0.5, 1], { activation: "none", normalizeOutput: false }))).toEqual([0, 128, 255]);
  });

  it("applies a sigmoid to logits", () => {
    const [lo, mid, hi] = Array.from(toMatte([-20, 0, 20], { activation: "sigmoid", normalizeOutput: false }));
    expect(lo).toBe(0);
    expect(mid).toBe(128);
    expect(hi).toBe(255);
  });

  it("stretches a compressed range to the full one", () => {
    expect(Array.from(toMatte([0.2, 0.4, 0.6], { activation: "none", normalizeOutput: true }))).toEqual([0, 128, 255]);
  });

  it("does not turn a flat output into a white matte", () => {
    expect(Array.from(toMatte([0, 0, 0], { activation: "none", normalizeOutput: true }))).toEqual([0, 0, 0]);
  });
});

describe("edgeCurve", () => {
  it("leaves the soft matte alone", () => {
    const lut = edgeCurve("soft");
    expect(lut[0]).toBe(0);
    expect(lut[77]).toBe(77);
    expect(lut[255]).toBe(255);
  });

  it("clears the haze and firms up the top without flattening the middle", () => {
    const lut = edgeCurve("balanced");
    expect(lut[10]).toBe(0);
    expect(lut[250]).toBe(255);
    expect(lut[128]).toBeGreaterThan(110);
    expect(lut[128]).toBeLessThan(146);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });

  it("is steeper when crisp", () => {
    expect(edgeCurve("crisp")[60]).toBe(0);
    expect(edgeCurve("crisp")[200]).toBe(255);
  });
});

describe("bounds", () => {
  it("finds the subject's box", () => {
    const size = { width: 5, height: 4 };
    const matte = new Uint8ClampedArray(20);
    matte[1 * 5 + 2] = 255;
    matte[2 * 5 + 3] = 200;
    expect(matteBounds(matte, size)).toEqual({ x: 2, y: 1, width: 2, height: 2 });
  });

  it("ignores haze and answers null for an empty matte", () => {
    expect(matteBounds(new Uint8ClampedArray([5, 9, 0, 3]), { width: 2, height: 2 })).toBeNull();
  });

  it("pads inside the image", () => {
    const padded = padBounds({ x: 2, y: 2, width: 96, height: 46 }, { width: 100, height: 50 }, 0.1);
    expect(padded).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it("measures coverage", () => {
    expect(matteCoverage(new Uint8ClampedArray([255, 255, 0, 0]))).toBe(0.5);
    expect(matteCoverage(new Uint8ClampedArray(0))).toBe(0);
  });
});

describe("catalogue", () => {
  it("pins every model to a revision, a size and a checksum", () => {
    const ids = new Set<string>();
    for (const model of MATTING_MODELS) {
      expect(model.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes).toBeGreaterThan(1_000_000);
      expect(model.backends.length).toBeGreaterThan(0);
      expect(mattingModelDest(model)).toMatch(/^images\/matting\/[a-z0-9.-]+\.onnx$/);
      ids.add(model.id);
    }
    expect(ids.size).toBe(MATTING_MODELS.length);
  });
});
