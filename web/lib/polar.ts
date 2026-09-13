/**
 * Polar, seen from the landing's server. The only module that holds the access
 * token - never import it from a client component.
 *
 * What it does, and nothing more: finds the Pro product and the launch-price
 * discounts by the metadata `scripts/polar-setup.ts` wrote on them, reads how
 * many keys each step has taken, opens a checkout session at the cheapest step
 * that still has keys, and looks a finished checkout up for /thanks. Nothing is
 * stored on our side - Polar is the database, and keys are derived from order
 * ids (lib/licenseKey.ts).
 *
 * Verified against the 2026-04 OpenAPI document and Polar's server source
 * (2026-09-13): a discount with `max_redemptions` is checked when the session
 * is created (an exhausted one answers 422 "Discount does not exist." on
 * `discount_id`) and again, under a row lock, when the buyer presses pay; a
 * failed payment gives its slot back, a refund does not.
 */

import { isIP } from "node:net";
import { licenseKeyForOrder } from "./licenseKey";
import { POLAR_META, TIERS, pricingSnapshot, type PricingSnapshot, type TierCount, type TierKey } from "./pricing";

const BASES = {
  production: "https://api.polar.sh",
  sandbox: "https://sandbox-api.polar.sh",
} as const;

export interface PolarConfig {
  token: string;
  base: string;
  server: keyof typeof BASES;
}

/** Null until POLAR_ACCESS_TOKEN is set - the site then shows "not on sale yet". */
export function polarConfig(): PolarConfig | null {
  const token = process.env.POLAR_ACCESS_TOKEN?.trim();
  if (!token) return null;
  const server = process.env.POLAR_SERVER?.trim() === "sandbox" ? "sandbox" : "production";
  // POLAR_API_URL exists for local tests against a stand-in server only
  const base = (process.env.POLAR_API_URL?.trim() || BASES[server]).replace(/\/+$/, "");
  return { token, base, server };
}

/* ------------------------------ wire types ------------------------------ */
/* Only the fields this file reads. */

type Metadata = Record<string, string | number | boolean>;

interface Page<T> {
  items: T[];
  pagination: { total_count: number; max_page: number };
}

export interface PolarPrice {
  id: string;
  amount_type: string;
  price_amount?: number;
  price_currency?: string;
  is_archived: boolean;
}

export interface PolarProduct {
  id: string;
  name: string;
  is_archived: boolean;
  metadata: Metadata;
  prices: PolarPrice[];
}

export interface PolarDiscount {
  id: string;
  name: string;
  type: "fixed" | "percentage";
  amount?: number;
  currency?: string;
  amounts?: Record<string, number>;
  max_redemptions: number | null;
  redemptions_count: number;
  metadata: Metadata;
}

export type CheckoutStatus = "open" | "expired" | "confirmed" | "succeeded" | "failed";

export interface PolarCheckout {
  id: string;
  url: string;
  status: CheckoutStatus;
  product_id: string | null;
}

export type OrderStatus = "draft" | "pending" | "paid" | "refunded" | "partially_refunded" | "void";

export interface PolarOrder {
  id: string;
  status: OrderStatus;
  paid: boolean;
  total_amount: number;
  currency: string;
  product_id: string | null;
  created_at: string;
  metadata: Metadata;
}

export class PolarError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, what: string) {
    super(`Polar answered ${status} to ${what}`);
    this.name = "PolarError";
    this.status = status;
    this.body = body;
  }

  /** A 422 about `discount_id`: that step's keys are gone (or it was removed). */
  get rejectsDiscount(): boolean {
    if (this.status !== 422) return false;
    const detail = (this.body as { detail?: unknown } | null)?.detail;
    return (
      Array.isArray(detail) &&
      detail.some((d) => Array.isArray((d as { loc?: unknown })?.loc) && (d as { loc: unknown[] }).loc.includes("discount_id"))
    );
  }
}

async function call<T>(cfg: PolarConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new PolarError(res.status, data, `${method} ${path.split("?")[0]}`);
  return data as T;
}

/* ------------------------------ discovery ------------------------------- */

const PRODUCT_TTL = 5 * 60_000;
const DISCOUNT_TTL = 15_000;

let productCache: { at: number; value: PolarProduct | null } | null = null;
let discountCache: { at: number; value: Map<TierKey, PolarDiscount> } | null = null;

/** Drop what we know, e.g. after Polar refused a discount we thought had room. */
export function forgetPolarCache(): void {
  productCache = null;
  discountCache = null;
  pricingCache = null;
}

export async function findProduct(cfg: PolarConfig): Promise<PolarProduct | null> {
  if (productCache && Date.now() - productCache.at < PRODUCT_TTL) return productCache.value;
  const query = new URLSearchParams({
    [`metadata[${POLAR_META.product}]`]: POLAR_META.productValue,
    is_archived: "false",
    limit: "10",
  });
  const page = await call<Page<PolarProduct>>(cfg, "GET", `/v1/products/?${query}`);
  const value = page.items.find((p) => !p.is_archived && p.metadata?.[POLAR_META.product] === POLAR_META.productValue) ?? null;
  productCache = { at: Date.now(), value };
  return value;
}

/** The launch-step discounts, keyed by step. Discounts list has no metadata filter. */
export async function tierDiscounts(cfg: PolarConfig, maxAgeMs = DISCOUNT_TTL): Promise<Map<TierKey, PolarDiscount>> {
  if (discountCache && Date.now() - discountCache.at < maxAgeMs) return discountCache.value;
  const keys = new Set<string>(TIERS.map((t) => t.key));
  const value = new Map<TierKey, PolarDiscount>();
  for (let page = 1; page <= 5; page++) {
    const res = await call<Page<PolarDiscount>>(cfg, "GET", `/v1/discounts/?limit=100&page=${page}`);
    for (const d of res.items) {
      const tier = d.metadata?.[POLAR_META.tier];
      if (typeof tier === "string" && keys.has(tier) && !value.has(tier as TierKey)) value.set(tier as TierKey, d);
    }
    if (page >= res.pagination.max_page) break;
  }
  discountCache = { at: Date.now(), value };
  return value;
}

/** The product's live one-time price, in cents. */
function listPriceCents(product: PolarProduct): number | null {
  const price = product.prices.find((p) => !p.is_archived && p.amount_type === "fixed" && p.price_currency === "usd");
  return price?.price_amount ?? null;
}

/** A fixed discount's USD amount in cents (newer discounts keep it in `amounts`). */
function discountCents(d: PolarDiscount): number | null {
  if (d.type !== "fixed") return null;
  return d.amounts?.usd ?? (d.currency === "usd" ? (d.amount ?? null) : null);
}

/* -------------------------------- pricing -------------------------------- */

let pricingCache: { at: number; value: PricingSnapshot } | null = null;

/**
 * Where the ladder stands. Before the shop is switched on (no token, or the
 * setup script has not created the product yet) this is the plan with nothing
 * sold; after that every number comes from Polar.
 */
export async function loadPricing(maxAgeMs = 15_000): Promise<PricingSnapshot> {
  const cfg = polarConfig();
  if (!cfg) return pricingSnapshot(null);
  if (pricingCache && Date.now() - pricingCache.at < maxAgeMs) return pricingCache.value;

  const [product, discounts] = await Promise.all([findProduct(cfg), tierDiscounts(cfg, maxAgeMs)]);
  if (!product) {
    console.warn("[polar] no product with metadata owntools_product=pro - run pnpm polar:setup");
    return pricingSnapshot(null);
  }

  const listCents = listPriceCents(product) ?? TIERS[TIERS.length - 1].price * 100;
  const counts: TierCount[] = [];
  TIERS.forEach((step, index) => {
    if (index === TIERS.length - 1) {
      counts.push({ key: step.key, price: listCents / 100 });
      return;
    }
    const d = discounts.get(step.key);
    const off = d ? discountCents(d) : null;
    if (!d || off === null) return;
    counts.push({
      key: step.key,
      sold: d.redemptions_count,
      cap: d.max_redemptions ?? step.cap,
      price: (listCents - off) / 100,
    });
  });

  const value = pricingSnapshot(counts);
  pricingCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------- checkout -------------------------------- */

export interface CheckoutRequest {
  /** Origin of this site, for the success and back links. */
  origin: string;
  /** The buyer's IP, so Polar picks the right country for tax. */
  customerIp?: string | null;
  /** utm_* and ref from the link that brought the buyer here. */
  attribution?: Record<string, string>;
}

/**
 * Opens a Polar checkout at the cheapest step that still has keys.
 *
 * The cached counts only decide which step to try first; Polar has the final
 * word. If it refuses a step's discount (the last key went a second ago), the
 * next step is tried, and after the last launch step the list price needs no
 * discount at all - so a buyer is never sent away because a step ran out.
 */
export async function openCheckout(req: CheckoutRequest): Promise<{ url: string; tier: TierKey }> {
  const cfg = polarConfig();
  if (!cfg) throw new Error("Polar is not configured (POLAR_ACCESS_TOKEN).");

  const product = await findProduct(cfg);
  if (!product) throw new Error("No owntools Pro product on Polar - run pnpm polar:setup.");

  const discounts = await tierDiscounts(cfg, 5_000);
  const pricing = await loadPricing(5_000).catch(() => null);
  const soldOut = new Set(pricing?.tiers.filter((t) => t.status === "sold-out").map((t) => t.key) ?? []);

  const base = {
    products: [product.id],
    success_url: `${req.origin}/thanks?checkout_id={CHECKOUT_ID}`,
    return_url: `${req.origin}/#pricing`,
    ...(req.customerIp ? { customer_ip_address: req.customerIp } : {}),
  };

  for (const step of TIERS.slice(0, -1)) {
    const discount = discounts.get(step.key);
    if (!discount || soldOut.has(step.key)) continue;
    try {
      const checkout = await call<PolarCheckout>(cfg, "POST", "/v1/checkouts/", {
        ...base,
        discount_id: discount.id,
        allow_discount_codes: false,
        metadata: { ...req.attribution, [POLAR_META.tier]: step.key },
      });
      return { url: checkout.url, tier: step.key };
    } catch (err) {
      if (err instanceof PolarError && err.rejectsDiscount) {
        forgetPolarCache();
        continue;
      }
      throw err;
    }
  }

  const list = TIERS[TIERS.length - 1].key;
  const checkout = await call<PolarCheckout>(cfg, "POST", "/v1/checkouts/", {
    ...base,
    // at the list price, launch codes (a newsletter, a video) may still apply
    allow_discount_codes: true,
    metadata: { ...req.attribution, [POLAR_META.tier]: list },
  });
  return { url: checkout.url, tier: list };
}

/** A public IP for Polar's tax country, or nothing (loopback / private ranges help nobody). */
export function publicIp(forwardedFor: string | null, realIp: string | null): string | null {
  const candidate = (forwardedFor?.split(",")[0] ?? realIp ?? "").trim();
  if (!isIP(candidate)) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(candidate)) return null;
  if (/^(::1$|fc|fd|fe80:)/i.test(candidate)) return null;
  return candidate;
}

/** utm_* and ref, trimmed to what Polar metadata allows (40-char keys, 500-char values). */
export function attributionFrom(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!/^(utm_[a-z]+|ref)$/.test(key) || !value.trim()) continue;
    out[key.slice(0, 40)] = value.trim().slice(0, 500);
    if (Object.keys(out).length >= 8) break;
  }
  return out;
}

/* ------------------------------- purchase -------------------------------- */

export type Purchase =
  | { state: "unconfigured" }
  | { state: "not-found" }
  | { state: "unpaid"; status: CheckoutStatus; url: string }
  | { state: "pending" }
  | { state: "refunded"; order: PolarOrder }
  | { state: "paid"; order: PolarOrder; key: string; tier: TierKey | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What /thanks shows for a checkout id Polar put in the success URL. */
export async function lookupPurchase(checkoutId: string | undefined): Promise<Purchase> {
  const cfg = polarConfig();
  if (!cfg) return { state: "unconfigured" };
  if (!checkoutId || !UUID.test(checkoutId)) return { state: "not-found" };

  let checkout: PolarCheckout;
  try {
    checkout = await call<PolarCheckout>(cfg, "GET", `/v1/checkouts/${checkoutId}`);
  } catch (err) {
    if (err instanceof PolarError && (err.status === 404 || err.status === 422)) return { state: "not-found" };
    throw err;
  }

  const product = await findProduct(cfg);
  if (!product || checkout.product_id !== product.id) return { state: "not-found" };
  if (checkout.status === "confirmed") return { state: "pending" };
  if (checkout.status !== "succeeded") return { state: "unpaid", status: checkout.status, url: checkout.url };

  const orders = await call<Page<PolarOrder>>(cfg, "GET", `/v1/orders/?checkout_id=${checkoutId}&limit=1`);
  const order = orders.items[0];
  if (!order || !order.paid) return { state: "pending" };
  if (order.status === "refunded") return { state: "refunded", order };

  const tier = order.metadata?.[POLAR_META.tier];
  return {
    state: "paid",
    order,
    key: licenseKeyForOrder(order.id, process.env.LICENSE_KEY_SECRET?.trim() ?? ""),
    tier: typeof tier === "string" && TIERS.some((t) => t.key === tier) ? (tier as TierKey) : null,
  };
}
