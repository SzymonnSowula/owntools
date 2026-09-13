import { describe, expect, it } from "vitest";
import { SUBSCRIPTIONS, SUBSCRIPTIONS_TOTAL_CENTS, centsToAmount } from "./comparison";

describe("the bill", () => {
  it("adds up to $964.93 for ten annual plans", () => {
    expect(SUBSCRIPTIONS).toHaveLength(10);
    expect(SUBSCRIPTIONS_TOTAL_CENTS).toBe(96493);
    expect(centsToAmount(SUBSCRIPTIONS_TOTAL_CENTS)).toBe("964.93");
  });

  it("keeps the worked-out Otter figure at twelve times its monthly price", () => {
    const otter = SUBSCRIPTIONS.find((r) => r.app === "Otter Pro");
    expect(otter?.cents).toBe(833 * 12);
  });
});
