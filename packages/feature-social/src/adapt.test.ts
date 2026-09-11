import { describe, expect, it } from "vitest";
import { adaptPost, adaptRules, fitToLimit, isModelAnswer, splitSentences } from "./adapt";
import { measure } from "./limits";
import type { Channel } from "./types";

const channel = (id: string, provider: Channel["provider"], charLimit?: number): Channel => ({
  id,
  provider,
  handle: `@${id}`,
  displayName: id,
  avatar: null,
  collection: "Personal",
  disabled: false,
  preferences: charLimit ? { charLimit } : {},
  meta: {},
  createdAt: "",
  updatedAt: "",
});

const s1 = "We moved the record button into the tray so a take starts with one click and no window juggling at all.";
const s2 = "The editor still opens on its own the moment the recording stops, exactly where it used to.";
const s3 = "Everything you record stays on your device: no upload, no account, nothing leaves the machine unless you say so.";
const s4 = "The changelog has the details and the download is on the site.";
const long = [s1, s2, s3, s4].join(" ");

describe("fitToLimit", () => {
  it("drops whole trailing sentences until the text fits", () => {
    expect(measure("x", long)).toBeGreaterThan(280);
    const out = fitToLimit("x", long, 280);
    expect(out).toBe([s1, s2].join(" "));
    expect(measure("x", out)).toBeLessThanOrEqual(280);
  });

  it("cuts a single over-long sentence on a word boundary with an ellipsis", () => {
    const one = "word ".repeat(80).trim() + ".";
    const out = fitToLimit("x", one, 60);
    expect(measure("x", out)).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it("leaves text alone when it fits or the network has no limit", () => {
    expect(fitToLimit("x", s1, 280)).toBe(s1);
    expect(fitToLimit("devto", long, 0)).toBe(long);
    expect(splitSentences("One. Two! Three? Four…")).toEqual(["One.", "Two!", "Three?", "Four…"]);
  });
});

describe("adaptRules", () => {
  const channels = [channel("x1", "x"), channel("bsky", "bluesky"), channel("masto", "mastodon"), channel("dev", "devto"), channel("tight", "mastodon", 120)];

  it("gives every channel a version inside its own limit and says what changed", () => {
    const out = adaptRules(long, channels, ["x1", "bsky", "masto", "dev", "tight"]);
    expect(out.map((v) => v.network)).toEqual(["x", "bluesky", "mastodon", "devto", "mastodon"]);
    for (const v of out) expect(v.fits).toBe(true);
    const x = out.find((v) => v.channelId === "x1")!;
    const bsky = out.find((v) => v.channelId === "bsky")!;
    const masto = out.find((v) => v.channelId === "masto")!;
    const dev = out.find((v) => v.channelId === "dev")!;
    const tight = out.find((v) => v.channelId === "tight")!;
    expect(x.changed).toBe(true);
    expect(x.limit).toBe(280);
    expect(bsky.changed).toBe(true);
    // ~375 characters: over X and Bluesky, inside Mastodon's 500.
    expect(masto.changed).toBe(false);
    expect(dev.changed).toBe(false);
    expect(dev.limit).toBe(0);
    // The per-channel override beats the network's number.
    expect(tight.limit).toBe(120);
    expect(tight.characters).toBeLessThanOrEqual(120);
  });

  it("skips unknown channel ids instead of failing", () => {
    expect(adaptRules(s1, channels, ["nope"])).toEqual([]);
  });
});

describe("adaptPost", () => {
  it("answers with the rules and says so while no model is set up", async () => {
    const out = await adaptPost(long, ["x1"], [channel("x1", "x")]);
    expect(out.model).toBe("rules");
    expect(out.variants).toHaveLength(1);
    expect(out.variants[0]!.fits).toBe(true);
  });

  it("guards the model's answer shape", () => {
    expect(isModelAnswer({ variants: [{ channelId: "a", text: "b" }] })).toBe(true);
    expect(isModelAnswer({ variants: [{ channelId: 1, text: "b" }] })).toBe(false);
    expect(isModelAnswer({ variants: "no" })).toBe(false);
    expect(isModelAnswer(null)).toBe(false);
  });
});
