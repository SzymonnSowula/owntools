import { describe, expect, it } from "vitest";
import { describeRepeat, expandOccurrences, nextOccurrence, normalizeRepeat } from "./recurrence";

describe("nextOccurrence", () => {
  it("steps by day, week, month and N days", () => {
    const from = "2026-01-31T09:00:00.000Z";
    expect(nextOccurrence({ kind: "daily" }, from)?.toISOString()).toBe("2026-02-01T09:00:00.000Z");
    expect(nextOccurrence({ kind: "weekly" }, from)?.toISOString()).toBe("2026-02-07T09:00:00.000Z");
    // Jan 31 + 1 month clamps to the last day of February.
    expect(nextOccurrence({ kind: "monthly" }, from)?.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(nextOccurrence({ kind: "every-n-days", every: 3 }, from)?.toISOString()).toBe("2026-02-03T09:00:00.000Z");
  });

  it("stops at `until` and for `none`", () => {
    const from = "2026-01-01T09:00:00.000Z";
    expect(nextOccurrence({ kind: "none" }, from)).toBeNull();
    expect(nextOccurrence({ kind: "daily", until: "2026-01-01T12:00:00.000Z" }, from)).toBeNull();
    expect(nextOccurrence({ kind: "daily", until: "2026-01-02T12:00:00.000Z" }, from)).not.toBeNull();
    expect(nextOccurrence({ kind: "daily" }, "garbage")).toBeNull();
  });

  it("expands a preview and normalises garbage rules", () => {
    expect(expandOccurrences({ kind: "weekly" }, "2026-01-01T09:00:00.000Z", 3)).toHaveLength(3);
    expect(expandOccurrences({ kind: "daily", until: "2026-01-02T23:00:00.000Z" }, "2026-01-01T09:00:00.000Z", 5)).toHaveLength(1);
    expect(normalizeRepeat(null)).toEqual({ kind: "none" });
    expect(normalizeRepeat({ kind: "every-n-days", every: "x" })).toEqual({ kind: "every-n-days", every: 2 });
    expect(normalizeRepeat({ kind: "bogus" })).toEqual({ kind: "none" });
    expect(describeRepeat({ kind: "every-n-days", every: 4 })).toBe("Every 4 days");
  });
});
