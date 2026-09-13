/**
 * Launch pricing - the one place the price ladder is defined.
 *
 * Every step but the last sells a fixed number of keys at its own price; the
 * last step has no cap and is the list price. Nothing on the site keeps the
 * count: Polar does. `scripts/polar-setup.ts` turns each capped step into a
 * fixed discount on the Pro product with `max_redemptions` = the cap, Polar
 * refuses the discount once the cap is reached (it locks the row and counts at
 * payment time), and /api/pricing reads the counts back for the page. Change a
 * number here, run `pnpm polar:setup`, deploy.
 *
 * Pure on purpose: client components import it, and so does the setup script
 * (Node strips the types) - no env, no Node APIs, no TS-only runtime syntax.
 */

export const CURRENCY = "usd";

export type TierKey = "launch1" | "launch2" | "list";

export interface TierPlan {
  key: TierKey;
  /** Whole US dollars. */
  price: number;
  /** Keys sold at this price. `null` = no limit, which only the last step may be. */
  cap: number | null;
}

export const TIERS: readonly TierPlan[] = [
  { key: "launch1", price: 25, cap: 10 },
  { key: "launch2", price: 35, cap: 100 },
  { key: "list", price: 49, cap: null },
];

/** The price once every launch step is gone. */
export const LIST_PRICE: number = TIERS[TIERS.length - 1].price;

/** Metadata the setup script writes on Polar objects and the site finds them by. */
export const POLAR_META = {
  product: "owntools_product",
  productValue: "pro",
  tier: "owntools_tier",
  benefit: "owntools_benefit",
} as const;

export type TierStatus = "sold-out" | "current" | "upcoming";

export interface TierView extends TierPlan {
  /** "keys 1-10", "keys 11-110", "from key 111". */
  label: string;
  firstKey: number;
  /** Keys taken at this step (a payment in flight counts until it fails). */
  sold: number;
  /** Keys still available at this step; `null` for the uncapped step. */
  left: number | null;
  status: TierStatus;
}

export interface PricingSnapshot {
  /** True when the counts come from Polar; false before the shop is switched on. */
  live: boolean;
  currency: typeof CURRENCY;
  listPrice: number;
  current: TierView;
  tiers: TierView[];
}

/** What Polar knows about one step. Missing fields fall back to the plan. */
export interface TierCount {
  key: TierKey;
  sold?: number;
  cap?: number | null;
  price?: number;
}

/** "keys 1-10" for a capped step, "from key 111" for the open one. */
export function tierLabel(firstKey: number, cap: number | null): string {
  if (cap === null) return `from key ${firstKey}`;
  if (cap === 1) return `key ${firstKey}`;
  return `keys ${firstKey}-${firstKey + cap - 1}`;
}

/**
 * Lays the plan and whatever Polar reported side by side.
 *
 * `counts === null` means "nothing is on sale yet": every step shows its plan
 * and the first one is current. With counts, a capped step Polar does not know
 * (its discount was never created, or was deleted) is left out, because the
 * checkout cannot sell it either - showing it would advertise a price nobody
 * can pay.
 */
export function pricingSnapshot(counts: TierCount[] | null, plan: readonly TierPlan[] = TIERS): PricingSnapshot {
  const live = counts !== null;
  const byKey = new Map((counts ?? []).map((c) => [c.key, c]));

  const tiers: TierView[] = [];
  let firstKey = 1;
  let currentFound = false;

  plan.forEach((step, index) => {
    const isLast = index === plan.length - 1;
    const count = byKey.get(step.key);
    if (live && !count && !isLast) return;

    const cap = isLast ? null : (count?.cap ?? step.cap);
    const price = count?.price ?? step.price;
    const sold = cap === null ? Math.max(0, count?.sold ?? 0) : clamp(count?.sold ?? 0, 0, cap);
    const left = cap === null ? null : cap - sold;

    let status: TierStatus;
    if (currentFound) status = "upcoming";
    else if (left === 0) status = "sold-out";
    else {
      status = "current";
      currentFound = true;
    }

    tiers.push({ key: step.key, price, cap, label: tierLabel(firstKey, cap), firstKey, sold, left, status });
    if (cap !== null) firstKey += cap;
  });

  const current = tiers.find((t) => t.status === "current") ?? tiers[tiers.length - 1];
  const listPrice = tiers[tiers.length - 1]?.price ?? LIST_PRICE;
  return { live, currency: CURRENCY, listPrice, current, tiers };
}

/** $25, $964.93 - cents only when there are any. */
export function usd(amount: number): string {
  const cents = Math.round(amount * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
