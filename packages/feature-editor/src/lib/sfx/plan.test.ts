import { describe, expect, it } from "vitest";
import type { CursorSample, InputTrack, Project, Segment, ZoomClip } from "../../types";
import { normalizeProject } from "../defaults";
import { planSfx, sfxCounts, sfxPlanFor, timelineTimeOf } from "./plan";

const RECT = { x: 0, y: 0, width: 1920, height: 1080 };

function project(partial: Partial<Project> = {}): Project {
  const duration = partial.duration ?? 20;
  return normalizeProject({
    id: "p",
    name: "take",
    createdAt: 0,
    duration,
    videoWidth: 1920,
    videoHeight: 1080,
    screenWidth: 1920,
    screenHeight: 1080,
    webcamOffset: 0,
    cursor: [],
    autoZoom: false,
    segments: [{ id: "s", start: 0, end: duration }],
    zooms: [],
    captions: [],
    texts: [],
    overlays: [],
    shares: [],
    aspect: "16:9",
    speechLang: "en-US",
    captureRect: RECT,
    captureSource: "monitor",
    ...partial,
    sfx: { ...normalizeProject({} as Project).sfx, enabled: true, ...(partial.sfx ?? {}) },
  } as Project);
}

/** A coarse cursor track: still at (x, y), the button down between `from` and `to`. */
function track(clicks: { at: number; x?: number; y?: number }[], until = 20): CursorSample[] {
  const out: CursorSample[] = [];
  for (let t = 0; t <= until; t += 1 / 30) {
    const c = clicks.find((k) => t >= k.at && t < k.at + 0.1);
    out.push({ t, x: c?.x ?? 960, y: c?.y ?? 540, down: Boolean(c) });
  }
  return out;
}

function inputs(partial: Partial<InputTrack>): InputTrack {
  return { buttons: [], keys: [], rate: 250, ...partial };
}

describe("timelineTimeOf", () => {
  const segments: Segment[] = [
    { id: "a", start: 0, end: 5 },
    { id: "b", start: 8, end: 12 },
  ];
  const p = project({ segments });

  it("maps into each segment and drops the cut", () => {
    expect(timelineTimeOf(p, 1)).toBe(1);
    expect(timelineTimeOf(p, 9)).toBe(6);
    expect(timelineTimeOf(p, 6)).toBeNull();
    expect(timelineTimeOf(p, 12)).toBeNull();
  });
});

describe("planSfx · clicks", () => {
  it("hears the cursor track's down-edges when there is no precise track, press and release together", () => {
    const p = project({ cursor: track([{ at: 2 }, { at: 5 }]) });
    const events = planSfx(p).filter((e) => e.kind === "click");
    expect(events.map((e) => e.sound)).toEqual(["clickFull", "clickFull"]);
    expect(events[0].t).toBeCloseTo(2, 1);
    expect(events[1].t).toBeCloseTo(5, 1);
    // No releases off the coarse track.
    expect(events.some((e) => e.sound === "clickUp")).toBe(false);
  });

  it("prefers the precise track: press and release, every button", () => {
    const p = project({
      cursor: track([{ at: 2 }]),
      inputs: inputs({
        buttons: [
          { t: 3, button: "left", down: true, x: 100, y: 100 },
          { t: 3.09, button: "left", down: false, x: 100, y: 100 },
          { t: 4, button: "right", down: true, x: 1800, y: 100 },
          { t: 4.1, button: "right", down: false, x: 1800, y: 100 },
        ],
      }),
    });
    const events = planSfx(p).filter((e) => e.kind === "click");
    // A right click plays whole at the press; the recording has its release in it.
    expect(events.map((e) => [e.sound, e.t])).toEqual([
      ["click", 3],
      ["clickUp", 3.09],
      ["rightClick", 4],
    ]);
    // The cursor track's click at t=2 is ignored once the precise one is there.
    expect(events.some((e) => Math.abs(e.t - 2) < 0.2)).toBe(false);
  });

  it("drops a click inside a cut and shifts the ones after it", () => {
    const p = project({
      cursor: track([{ at: 2 }, { at: 6 }, { at: 10 }]),
      segments: [
        { id: "a", start: 0, end: 4 },
        { id: "b", start: 8, end: 20 },
      ],
    });
    const events = planSfx(p).filter((e) => e.kind === "click");
    expect(events).toHaveLength(2);
    expect(events[0].t).toBeCloseTo(2, 1);
    expect(events[1].t).toBeCloseTo(6, 1);
  });

  it("swallows a bounce but keeps a double-click", () => {
    const p = project({
      inputs: inputs({
        buttons: [
          { t: 1, button: "left", down: true, x: 0, y: 0 },
          { t: 1.01, button: "left", down: true, x: 0, y: 0 },
          { t: 1.12, button: "left", down: true, x: 0, y: 0 },
        ],
      }),
    });
    const events = planSfx(p).filter((e) => e.sound === "click");
    expect(events.map((e) => e.t)).toEqual([1, 1.12]);
  });

  it("pans by where the click landed, and not without a recorded area", () => {
    const left = project({ inputs: inputs({ buttons: [{ t: 1, button: "left", down: true, x: 40, y: 540 }] }) });
    const right = project({ inputs: inputs({ buttons: [{ t: 1, button: "left", down: true, x: 1880, y: 540 }] }) });
    const centre = project({ inputs: inputs({ buttons: [{ t: 1, button: "left", down: true, x: 960, y: 540 }] }) });
    expect(planSfx(left)[0].pan).toBeLessThan(-0.4);
    expect(planSfx(right)[0].pan).toBeGreaterThan(0.4);
    expect(Math.abs(planSfx(centre)[0].pan)).toBeLessThan(0.05);
    const noRect = project({ ...left, captureRect: undefined });
    expect(planSfx(noRect)[0].pan).toBe(0);
    const flat = project({ ...left, sfx: { ...left.sfx, spatial: false } });
    expect(planSfx(flat)[0].pan).toBe(0);
  });

  it("scales with the click level and the master volume", () => {
    const base = project({ cursor: track([{ at: 2 }]) });
    const g = planSfx(base)[0].gain;
    expect(planSfx(project({ ...base, sfx: { ...base.sfx, clickVolume: 0.5 } }))[0].gain).toBeCloseTo(g / 2, 6);
    expect(planSfx(project({ ...base, sfx: { ...base.sfx, volume: 2 } }))[0].gain).toBeCloseTo(g * 2, 6);
    expect(planSfx(project({ ...base, sfx: { ...base.sfx, clicks: false } }))).toHaveLength(0);
  });
});

describe("planSfx · typing", () => {
  it("needs the precise track and picks a sound per kind", () => {
    const p = project({
      inputs: inputs({
        keys: [
          { t: 1, kind: "key" },
          { t: 1.1, kind: "space" },
          { t: 1.2, kind: "enter" },
          { t: 1.3, kind: "backspace" },
          { t: 1.4, kind: "modifier" },
        ],
      }),
    });
    const events = planSfx(p).filter((e) => e.kind === "key");
    expect(events.map((e) => e.sound)).toEqual(["key", "keySpace", "keyEnter", "keyBackspace", "key"]);
    // A modifier is softer than a letter.
    expect(events[4].gain).toBeLessThan(events[0].gain);
    for (const e of events) {
      expect(e.rate).toBeGreaterThan(0.95);
      expect(e.rate).toBeLessThan(1.05);
    }
    expect(planSfx(project({ cursor: track([{ at: 1 }]) })).filter((e) => e.kind === "key")).toHaveLength(0);
  });

  it("thins a burst faster than any typist", () => {
    const keys = Array.from({ length: 10 }, (_, i) => ({ t: 1 + i * 0.01, kind: "key" as const }));
    const p = project({ inputs: inputs({ keys }) });
    const events = planSfx(p).filter((e) => e.kind === "key");
    expect(events.length).toBeLessThan(5);
    expect(events.length).toBeGreaterThan(2);
  });

  it("is deterministic", () => {
    const keys = Array.from({ length: 30 }, (_, i) => ({ t: 1 + i * 0.2, kind: "key" as const }));
    const p = project({ inputs: inputs({ keys }) });
    expect(planSfx(p)).toEqual(planSfx(project({ inputs: inputs({ keys }) })));
  });
});

describe("planSfx · zooms", () => {
  const clip = (id: string, start: number, end: number): ZoomClip => ({
    id,
    start,
    end,
    scale: 1.8,
    x: 0.5,
    y: 0.5,
    easing: "ease-in-out",
    followCursor: true,
  });

  it("whooshes in at the start and out as the ease-out begins", () => {
    const p = project({ zooms: [clip("z", 4, 10)] });
    const events = planSfx(p).filter((e) => e.kind === "zoom");
    expect(events.map((e) => e.sound)).toEqual(["zoomIn", "zoomOut"]);
    expect(events[0].t).toBeCloseTo(4 - 0.03, 5);
    // ZOOM_OUT_TIME is 1.05 s for a clip this long.
    expect(events[1].t).toBeCloseTo(10 - 1.05, 5);
  });

  it("skips the out-and-in where two clips join", () => {
    const p = project({ zooms: [clip("a", 2, 6), clip("b", 6.05, 10)] });
    const events = planSfx(p).filter((e) => e.kind === "zoom");
    expect(events.map((e) => e.sound)).toEqual(["zoomIn", "zoomOut"]);
  });

  it("drops a zoom-in that sits inside a cut", () => {
    const p = project({
      zooms: [clip("z", 5, 12)],
      segments: [
        { id: "a", start: 0, end: 4 },
        { id: "b", start: 7, end: 20 },
      ],
    });
    const events = planSfx(p).filter((e) => e.kind === "zoom");
    expect(events.map((e) => e.sound)).toEqual(["zoomOut"]);
  });
});

describe("planSfx · transitions", () => {
  it("sounds each transition by kind, just ahead of the cut", () => {
    const p = project({
      segments: [
        { id: "a", start: 0, end: 5 },
        { id: "b", start: 6, end: 10, transition: { kind: "crossfade", duration: 0.5 } },
        { id: "c", start: 11, end: 15, transition: { kind: "slide-left", duration: 0.4 } },
        { id: "d", start: 16, end: 20, transition: { kind: "dip-black", duration: 0.6 } },
        { id: "e", start: 20, end: 22 },
      ],
    });
    const events = planSfx(p).filter((e) => e.kind === "transition");
    expect(events.map((e) => e.sound)).toEqual(["swell", "whoosh", "dip"]);
    expect(events[0].t).toBeCloseTo(5 - 0.08, 5);
    expect(events[1].t).toBeCloseTo(9 - 0.08, 5);
    expect(events[2].t).toBeCloseTo(13 - 0.08, 5);
  });

  it("plays a short transition faster than a long one", () => {
    const at = (duration: number) =>
      planSfx(
        project({
          segments: [
            { id: "a", start: 0, end: 5 },
            { id: "b", start: 6, end: 10, transition: { kind: "slide-up", duration } },
          ],
        }),
      )[0].rate;
    expect(at(0.2)).toBeGreaterThan(at(1.5));
  });
});

describe("planSfx · the whole plan", () => {
  it("comes out sorted, is cached per project object, and counts by kind", () => {
    const p = project({
      cursor: track([{ at: 9 }]),
      inputs: inputs({
        buttons: [{ t: 9, button: "left", down: true, x: 500, y: 500 }],
        keys: [{ t: 2, kind: "key" }],
      }),
      zooms: [{ id: "z", start: 4, end: 8, scale: 1.8, x: 0.5, y: 0.5, easing: "ease-in-out", followCursor: true }],
      segments: [
        { id: "a", start: 0, end: 5 },
        { id: "b", start: 5, end: 20, transition: { kind: "crossfade", duration: 0.5 } },
      ],
    });
    const events = sfxPlanFor(p);
    expect(sfxPlanFor(p)).toBe(events);
    for (let i = 1; i < events.length; i++) expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    expect(sfxCounts(events)).toEqual({ click: 1, key: 1, zoom: 2, transition: 1 });
  });

  it("is empty for an empty timeline", () => {
    expect(planSfx(project({ segments: [] }))).toEqual([]);
  });
});
