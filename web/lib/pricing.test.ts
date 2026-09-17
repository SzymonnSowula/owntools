import { describe, expect, it } from "vitest";
import { LIST_PRICE, TIERS, pricingSnapshot, tierLabel, usd, type TierPlan } from "./pricing";

describe("the plan", () => {
  it("is 10 keys at $15, 20 at $25, then $39 for good", () => {
    expect(TIERS.map((t) => [t.price, t.cap])).toEqual([
      [15, 10],
      [25, 20],
      [39, null],
    ]);
    expect(LIST_PRICE).toBe(39);
  });

  it("only lets the last step go uncapped, and never gets cheaper", () => {
    TIERS.slice(0, -1).forEach((t) => expect(t.cap).toBeGreaterThan(0));
    TIERS.forEach((t, i) => {
      if (i > 0) expect(t.price).toBeGreaterThan(TIERS[i - 1].price);
    });
  });
});

describe("pricingSnapshot", () => {
  it("before launch, shows the plan with the first step current", () => {
    const s = pricingSnapshot(null);
    expect(s.live).toBe(false);
    expect(s.current.key).toBe("launch1");
    expect(s.tiers.map((t) => t.label)).toEqual(["keys 1-10", "keys 11-30", "from key 31"]);
    expect(s.tiers.map((t) => t.status)).toEqual(["current", "upcoming", "upcoming"]);
    expect(s.current.left).toBe(10);
  });

  it("counts down the current step", () => {
    const s = pricingSnapshot([
      { key: "launch1", sold: 7 },
      { key: "launch2", sold: 0 },
      { key: "list" },
    ]);
    expect(s.live).toBe(true);
    expect(s.current).toMatchObject({ key: "launch1", price: 15, sold: 7, left: 3 });
  });

  it("moves on when a step is sold out", () => {
    const s = pricingSnapshot([
      { key: "launch1", sold: 10 },
      { key: "launch2", sold: 12 },
      { key: "list" },
    ]);
    expect(s.tiers.map((t) => t.status)).toEqual(["sold-out", "current", "upcoming"]);
    expect(s.current).toMatchObject({ key: "launch2", price: 25, left: 8 });
  });

  it("lands on the list price once every launch key is gone", () => {
    const s = pricingSnapshot([
      { key: "launch1", sold: 10 },
      { key: "launch2", sold: 20 },
      { key: "list", sold: 3 },
    ]);
    expect(s.current).toMatchObject({ key: "list", price: 39, left: null, status: "current" });
  });

  it("clamps a count past the cap (a cap lowered by hand after sales)", () => {
    const s = pricingSnapshot([{ key: "launch1", sold: 12 }, { key: "launch2", sold: 0 }, { key: "list" }]);
    expect(s.tiers[0]).toMatchObject({ sold: 10, left: 0, status: "sold-out" });
  });

  it("trusts Polar's cap and price over the plan, and relabels the ranges", () => {
    const s = pricingSnapshot([
      { key: "launch1", sold: 1, cap: 20, price: 9 },
      { key: "launch2", sold: 0, cap: 100 },
      { key: "list", price: 59 },
    ]);
    expect(s.tiers.map((t) => t.label)).toEqual(["keys 1-20", "keys 21-120", "from key 121"]);
    expect(s.current.price).toBe(9);
    expect(s.listPrice).toBe(59);
  });

  it("leaves out a launch step Polar has no discount for - the checkout could not sell it", () => {
    const s = pricingSnapshot([{ key: "launch2", sold: 5 }, { key: "list" }]);
    expect(s.tiers.map((t) => t.key)).toEqual(["launch2", "list"]);
    expect(s.current).toMatchObject({ key: "launch2", label: "keys 1-20", left: 15 });
  });

  it("works for any plan shape", () => {
    const plan: TierPlan[] = [
      { key: "launch1", price: 9, cap: 1 },
      { key: "list", price: 29, cap: null },
    ];
    expect(pricingSnapshot(null, plan).tiers.map((t) => t.label)).toEqual(["key 1", "from key 2"]);
  });
});

describe("tierLabel / usd", () => {
  it("labels ranges", () => {
    expect(tierLabel(11, 20)).toBe("keys 11-30");
    expect(tierLabel(31, null)).toBe("from key 31");
  });

  it("prints dollars without noise", () => {
    expect(usd(15)).toBe("$15");
    expect(usd(964.93)).toBe("$964.93");
    expect(usd(99.9)).toBe("$99.90");
  });
});
