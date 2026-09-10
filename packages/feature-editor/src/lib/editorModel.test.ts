import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { activeClicks, extractClicks } from "./cursorFx";
import { DEFAULT_BACKGROUND, DEFAULT_CURSOR, DEFAULT_WEBCAM, PROJECT_SCHEMA, normalizeProject } from "./defaults";
import { GRADIENT_PRESETS } from "./gradients";
import {
  BUILT_IN_PRESETS,
  applyLook,
  deleteCustomPreset,
  extractLook,
  loadCustomPresets,
  saveCustomPreset,
} from "./presets";
import { LINEAR_GRADIENTS, WALLPAPERS, WALLPAPER_CATEGORIES, getWallpaper, isLight, luma } from "./wallpapers";

function legacyProject(): Record<string, unknown> {
  // A project.json as written before cursor/overlay/audio settings existed.
  return {
    id: "proj_1",
    name: "Old take",
    createdAt: 1,
    duration: 12,
    videoWidth: 1920,
    videoHeight: 1080,
    screenWidth: 1920,
    screenHeight: 1080,
    webcamOffset: 0,
    cursor: [],
    autoZoom: true,
    segments: [{ id: "s1", start: 0, end: 12 }],
    zooms: [],
    captions: [],
    texts: [{ id: "t1", start: 0, end: 2, text: "Hi", x: 0.5, y: 0.2, fontSize: 0.06, color: "#fff", weight: 700, align: "center" }],
    webcam: { enabled: true, corner: "br", size: 0.22, radius: 28, border: true, borderColor: "#fffdfb" },
    background: { presetId: "sunset", padding: 0.1, windowRadius: 20, shadow: 0.5 },
    aspect: "16:9",
    speechLang: "en-US",
  };
}

describe("normalizeProject", () => {
  it("fills every new field without touching what was saved", () => {
    const p = normalizeProject(legacyProject() as unknown as Project);
    expect(p.background.mode).toBe("wallpaper");
    expect(p.background.presetId).toBe("sunset");
    expect(p.background.padding).toBe(0.1);
    expect(p.background.blur).toBe(DEFAULT_BACKGROUND.blur);
    expect(p.webcam.enabled).toBe(true);
    expect(p.webcam.shape).toBe(DEFAULT_WEBCAM.shape);
    expect(p.cursorStyle).toEqual(DEFAULT_CURSOR);
    expect(p.overlays).toEqual([]);
    expect(p.shares).toEqual([]);
    expect(p.audio.volume).toBe(1);
    expect(p.texts[0].background).toBe(false);
    expect(p.texts[0].font).toBe("outfit");
    expect(p.texts[0].text).toBe("Hi");
  });

  it("treats a stored custom image as the image mode", () => {
    const raw = legacyProject();
    raw.backgroundPath = "screeni/projects/proj_1/background.jpg";
    expect(normalizeProject(raw as unknown as Project).background.mode).toBe("image");
  });

  it("gives a project written before schema 1 the new sound-effects default", () => {
    // Effects shipped off, so `false` in an old file is the old default, not a choice.
    const raw = legacyProject();
    raw.sfx = { enabled: false, pack: "mechanical", clickVolume: 0.4 };
    const p = normalizeProject(raw as unknown as Project);
    expect(p.sfx.enabled).toBe(true);
    expect(p.sfx.pack).toBe("mechanical");
    expect(p.sfx.clickVolume).toBe(0.4);
    expect(p.schema).toBe(PROJECT_SCHEMA);
  });

  it("leaves sound effects switched off when the file knows the current default", () => {
    const raw = legacyProject();
    raw.schema = PROJECT_SCHEMA;
    raw.sfx = { enabled: false };
    expect(normalizeProject(raw as unknown as Project).sfx.enabled).toBe(false);
  });

  it("keeps transitions that are well formed and drops broken segments", () => {
    const raw = legacyProject();
    raw.segments = [
      { id: "a", start: 0, end: 3 },
      { id: "b", start: 5, end: 8, transition: { kind: "crossfade", duration: 0.4 } },
      { id: "broken" },
    ];
    const p = normalizeProject(raw as unknown as Project);
    expect(p.segments).toHaveLength(2);
    expect(p.segments[1].transition).toEqual({ kind: "crossfade", duration: 0.4 });
  });
});

describe("wallpapers", () => {
  it("keeps the six original mesh ids so old projects still resolve", () => {
    for (const legacy of GRADIENT_PRESETS) {
      expect(getWallpaper(legacy.id).id).toBe(legacy.id);
    }
  });

  it("has unique ids and a known category for every wallpaper", () => {
    const ids = new Set(WALLPAPERS.map((w) => w.id));
    expect(ids.size).toBe(WALLPAPERS.length);
    const categories = new Set(WALLPAPER_CATEGORIES.map((c) => c.id));
    for (const w of WALLPAPERS) expect(categories.has(w.category)).toBe(true);
    for (const c of WALLPAPER_CATEGORIES) {
      expect(WALLPAPERS.some((w) => w.category === c.id)).toBe(true);
    }
    expect(new Set(LINEAR_GRADIENTS.map((g) => g.id)).size).toBe(LINEAR_GRADIENTS.length);
  });

  it("falls back to the first wallpaper for an unknown id", () => {
    expect(getWallpaper("nope").id).toBe(WALLPAPERS[0].id);
  });

  it("reads luminance", () => {
    expect(luma("#ffffff")).toBeCloseTo(1);
    expect(luma("#000000")).toBe(0);
    expect(isLight("#f5f5f7")).toBe(true);
    expect(isLight("#1d1d1f")).toBe(false);
  });
});

describe("clicks", () => {
  const samples = [
    { t: 0, x: 10, y: 10, down: false },
    { t: 0.1, x: 12, y: 10, down: true },
    { t: 0.2, x: 14, y: 10, down: true },
    { t: 0.3, x: 16, y: 10, down: false },
    { t: 2, x: 30, y: 30, down: true },
  ];

  it("finds each press once", () => {
    expect(extractClicks(samples)).toEqual([
      { t: 0.1, x: 12, y: 10 },
      { t: 2, x: 30, y: 30 },
    ]);
  });

  it("returns only ripples still visible", () => {
    const clicks = extractClicks(samples);
    expect(activeClicks(clicks, 0.05)).toEqual([]);
    expect(activeClicks(clicks, 0.3).map((c) => c.t)).toEqual([0.1]);
    expect(activeClicks(clicks, 1.5)).toEqual([]);
    expect(activeClicks(clicks, 2.2).map((c) => c.t)).toEqual([2]);
  });
});

describe("look presets", () => {
  it("apply everything but the camera switch", () => {
    const project = normalizeProject(legacyProject() as unknown as Project);
    const keynote = BUILT_IN_PRESETS.find((p) => p.id === "keynote")!;
    const next = applyLook(project, keynote.look);
    expect(next.background.presetId).toBe("graphite");
    expect(next.background.frame).toBe("bar");
    expect(next.cursorStyle.style).toBe("arrow");
    expect(next.webcam.enabled).toBe(true);
    expect(next.name).toBe("Old take");
  });

  it("round-trip through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage;
    const project = normalizeProject(legacyProject() as unknown as Project);
    const saved = saveCustomPreset("  Night desk  ", extractLook(project), storage);
    expect(saved.name).toBe("Night desk");
    expect(loadCustomPresets(storage)).toHaveLength(1);
    expect(loadCustomPresets(storage)[0].look.background.presetId).toBe("sunset");
    // Same name replaces instead of piling up.
    saveCustomPreset("Night desk", extractLook(project), storage);
    expect(loadCustomPresets(storage)).toHaveLength(1);
    deleteCustomPreset(loadCustomPresets(storage)[0].id, storage);
    expect(loadCustomPresets(storage)).toHaveLength(0);
  });

  it("never carries a custom image into a preset", () => {
    const project = normalizeProject(legacyProject() as unknown as Project);
    project.background.customImage = "photo.jpg";
    expect(extractLook(project).background.customImage).toBeUndefined();
  });
});
