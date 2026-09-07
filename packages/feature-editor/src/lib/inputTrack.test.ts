import { describe, expect, it } from "vitest";
import { collectInputTrack, normalizeInputTrack, type RawInputTrack } from "./inputTrack";

describe("collectInputTrack", () => {
  const raw: RawInputTrack = {
    rate: 250,
    events: [
      { type: "button", t: 500, button: "left", down: true, x: 10, y: 20 },
      { type: "button", t: 580, button: "left", down: false, x: 10, y: 20 },
      { type: "key", t: 1200, kind: "key" },
      { type: "key", t: 2500, kind: "space" },
      { type: "key", t: 4100, kind: "enter" },
      { type: "key", t: -20, kind: "key" },
      { type: "key", t: 5000, kind: "banana" },
      { type: "button", t: 5100, button: "side", down: true },
    ],
  };

  it("rebases onto recording seconds from the sampler's clock", () => {
    // Recorders started at 10 000 ms; the sampler's clock started 4 ms later.
    const track = collectInputTrack(raw, 10004, 10000, []);
    expect(track.rate).toBe(250);
    expect(track.buttons.map((b) => [b.button, b.down, Number(b.t.toFixed(3))])).toEqual([
      ["left", true, 0.504],
      ["left", false, 0.584],
    ]);
    expect(track.buttons[0]).toMatchObject({ x: 10, y: 20 });
    expect(track.keys.map((k) => [k.kind, Number(k.t.toFixed(3))])).toEqual([
      ["key", 1.204],
      ["space", 2.504],
      ["enter", 4.104],
    ]);
  });

  it("takes the pauses out and drops what happened inside one", () => {
    // Paused from 2.0 s to 3.0 s of wall time: the space bar (2.5 s) is gone, enter moves up by a second.
    const track = collectInputTrack(raw, 10000, 10000, [{ from: 12000, to: 13000 }]);
    expect(track.keys.map((k) => [k.kind, Number(k.t.toFixed(3))])).toEqual([
      ["key", 1.2],
      ["enter", 3.1],
    ]);
  });

  it("drops anything before the recorders started", () => {
    const track = collectInputTrack(raw, 10000, 11000, []);
    expect(track.buttons).toHaveLength(0);
    expect(track.keys.map((k) => k.kind)).toEqual(["key", "space", "enter"]);
  });

  it("sorts by time even when the sampler did not", () => {
    const shuffled: RawInputTrack = {
      rate: 250,
      events: [
        { type: "key", t: 300, kind: "key" },
        { type: "key", t: 100, kind: "key" },
      ],
    };
    expect(collectInputTrack(shuffled, 0, 0, []).keys.map((k) => k.t)).toEqual([0.1, 0.3]);
  });
});

describe("normalizeInputTrack", () => {
  it("keeps a well-formed track and drops junk entries", () => {
    const track = normalizeInputTrack({
      buttons: [{ t: 1, button: "right", down: true, x: 1, y: 2 }, { t: "x" }, null, { t: 0.5, button: "left", down: true }],
      keys: [{ t: 2, kind: "space" }, { t: 1, kind: "nope" }, 7],
    });
    expect(track).toEqual({
      buttons: [
        { t: 0.5, button: "left", down: true, x: 0, y: 0 },
        { t: 1, button: "right", down: true, x: 1, y: 2 },
      ],
      keys: [{ t: 2, kind: "space" }],
      rate: 250,
    });
  });

  it("is undefined for anything that is not a track", () => {
    expect(normalizeInputTrack(undefined)).toBeUndefined();
    expect(normalizeInputTrack(null)).toBeUndefined();
    expect(normalizeInputTrack([])).toBeUndefined();
    expect(normalizeInputTrack({ buttons: [] })).toBeUndefined();
    expect(normalizeInputTrack("x")).toBeUndefined();
  });
});
