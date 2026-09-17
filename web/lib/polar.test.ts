import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { licenseKeyForOrder } from "./licenseKey";
import {
  PolarError,
  attributionFrom,
  forgetPolarCache,
  loadPricing,
  lookupPurchase,
  openCheckout,
  publicIp,
} from "./polar";

/*
 * A stand-in for the few Polar endpoints lib/polar.ts calls, behaving the way
 * Polar's server does (checked in its source, 2026-09-13): a checkout created
 * with a discount that has reached max_redemptions is refused with a 422 whose
 * `loc` names `discount_id`.
 */

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const D2 = "33333333-3333-4333-8333-333333333333";

interface Fake {
  discounts: { id: string; tier: string; amount: number; max: number; used: number }[];
  checkouts: Map<string, { id: string; status: string; product_id: string; url: string }>;
  orders: { id: string; checkout_id: string; status: string; paid: boolean; total_amount: number; metadata: Record<string, string> }[];
  created: Record<string, unknown>[];
  /** Pretend another buyer took the last key of this discount between our read and our create. */
  raceOn?: string;
}

let fake: Fake;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/v1/products/") {
    return json(200, {
      items: [
        {
          id: PRODUCT,
          name: "owntools Pro",
          is_archived: false,
          metadata: { owntools_product: "pro" },
          prices: [{ id: "p", amount_type: "fixed", price_amount: 3900, price_currency: "usd", is_archived: false }],
        },
      ],
      pagination: { total_count: 1, max_page: 1 },
    });
  }

  if (method === "GET" && path === "/v1/discounts/") {
    return json(200, {
      items: [
        ...fake.discounts.map((d) => ({
          id: d.id,
          name: d.tier,
          type: "fixed",
          amount: d.amount,
          currency: "usd",
          amounts: { usd: d.amount },
          max_redemptions: d.max,
          redemptions_count: d.used,
          metadata: { owntools_tier: d.tier },
        })),
        { id: "x", name: "a code for a newsletter", type: "percentage", max_redemptions: null, redemptions_count: 3, metadata: {} },
      ],
      pagination: { total_count: fake.discounts.length + 1, max_page: 1 },
    });
  }

  if (method === "POST" && path === "/v1/checkouts/") {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.discount_id) {
      const d = fake.discounts.find((x) => x.id === body.discount_id);
      if (d && fake.raceOn === d.id) d.used = d.max;
      if (!d || d.used >= d.max) {
        return json(422, {
          error: "PolarRequestValidationError",
          detail: [{ type: "value_error", loc: ["body", "discount_id"], msg: "Discount does not exist.", input: body.discount_id }],
        });
      }
    }
    fake.created.push(body);
    const id = `4444444${fake.created.length}-4444-4444-8444-444444444444`;
    const checkout = { id, status: "open", product_id: PRODUCT, url: `https://polar.test/checkout/${id}` };
    fake.checkouts.set(id, checkout);
    return json(201, checkout);
  }

  const checkoutMatch = /^\/v1\/checkouts\/([^/]+)$/.exec(path);
  if (method === "GET" && checkoutMatch) {
    const checkout = fake.checkouts.get(checkoutMatch[1]);
    return checkout ? json(200, checkout) : json(404, { error: "ResourceNotFound", detail: "Not found" });
  }

  if (method === "GET" && path === "/v1/orders/") {
    const items = fake.orders.filter((o) => o.checkout_id === url.searchParams.get("checkout_id"));
    return json(200, {
      items: items.map((o) => ({ ...o, currency: "usd", product_id: PRODUCT, created_at: "2026-09-13T12:00:00Z" })),
      pagination: { total_count: items.length, max_page: 1 },
    });
  }

  return json(404, { detail: `no fake for ${method} ${path}` });
}

beforeEach(() => {
  vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_oat_test");
  vi.stubEnv("POLAR_API_URL", "https://polar.test");
  vi.stubEnv("LICENSE_KEY_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn(handle));
  forgetPolarCache();
  fake = {
    discounts: [
      { id: D1, tier: "launch1", amount: 2400, max: 10, used: 0 },
      { id: D2, tier: "launch2", amount: 1400, max: 20, used: 0 },
    ],
    checkouts: new Map(),
    orders: [],
    created: [],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadPricing", () => {
  it("reads the ladder off the product price and the discounts", async () => {
    fake.discounts[0].used = 7;
    const s = await loadPricing(0);
    expect(s.live).toBe(true);
    expect(s.tiers.map((t) => [t.key, t.price, t.left])).toEqual([
      ["launch1", 15, 3],
      ["launch2", 25, 20],
      ["list", 39, null],
    ]);
  });

  it("is the plan with nothing sold when no token is set", async () => {
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    const s = await loadPricing(0);
    expect(s.live).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("openCheckout", () => {
  const req = { origin: "https://owntools.app", customerIp: "83.1.2.3", attribution: { utm_source: "youtube" } };

  it("opens the first step while it has keys, with the success link and attribution", async () => {
    const res = await openCheckout(req);
    expect(res.tier).toBe("launch1");
    expect(fake.created[0]).toMatchObject({
      products: [PRODUCT],
      discount_id: D1,
      allow_discount_codes: false,
      success_url: "https://owntools.app/thanks?checkout_id={CHECKOUT_ID}",
      return_url: "https://owntools.app/#pricing",
      customer_ip_address: "83.1.2.3",
      metadata: { utm_source: "youtube", owntools_tier: "launch1" },
    });
  });

  it("goes straight to the next step when the counts say the first is gone", async () => {
    fake.discounts[0].used = 10;
    const res = await openCheckout(req);
    expect(res.tier).toBe("launch2");
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].discount_id).toBe(D2);
  });

  it("falls through to the next step when Polar refuses a discount it thought had room", async () => {
    fake.discounts[0].used = 9;
    fake.raceOn = D1;
    const res = await openCheckout(req);
    expect(res.tier).toBe("launch2");
    expect(fake.created[0].discount_id).toBe(D2);
  });

  it("sells at the list price, codes allowed, once every launch key is gone", async () => {
    fake.discounts[0].used = 10;
    fake.discounts[1].used = 20;
    const res = await openCheckout(req);
    expect(res.tier).toBe("list");
    expect(fake.created[0]).not.toHaveProperty("discount_id");
    expect(fake.created[0]).toMatchObject({ allow_discount_codes: true, metadata: { owntools_tier: "list" } });
  });

  it("does not swallow errors that are not about the discount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        (init?.method ?? "GET") === "POST" ? json(500, { detail: "boom" }) : handle(input, init),
      ),
    );
    await expect(openCheckout(req)).rejects.toBeInstanceOf(PolarError);
  });
});

describe("lookupPurchase", () => {
  async function checkoutWith(status: string) {
    const { url } = await openCheckout({ origin: "https://owntools.app" });
    const id = url.split("/").pop()!;
    fake.checkouts.get(id)!.status = status;
    return id;
  }

  it("does not look up anything that is not a checkout id", async () => {
    expect(await lookupPurchase(undefined)).toEqual({ state: "not-found" });
    expect(await lookupPurchase("../orders")).toEqual({ state: "not-found" });
    expect(await lookupPurchase("55555555-5555-4555-8555-555555555555")).toEqual({ state: "not-found" });
  });

  it("waits while the payment is confirmed but not settled", async () => {
    expect(await lookupPurchase(await checkoutWith("confirmed"))).toEqual({ state: "pending" });
    // succeeded, but the order is not visible yet
    expect(await lookupPurchase(await checkoutWith("succeeded"))).toEqual({ state: "pending" });
  });

  it("sends an unfinished checkout back to Polar", async () => {
    const id = await checkoutWith("open");
    expect(await lookupPurchase(id)).toMatchObject({ state: "unpaid", status: "open", url: `https://polar.test/checkout/${id}` });
  });

  it("shows the key derived from the paid order", async () => {
    const id = await checkoutWith("succeeded");
    const orderId = "66666666-6666-4666-8666-666666666666";
    fake.orders.push({ id: orderId, checkout_id: id, status: "paid", paid: true, total_amount: 1500, metadata: { owntools_tier: "launch1" } });
    const purchase = await lookupPurchase(id);
    expect(purchase).toMatchObject({ state: "paid", tier: "launch1", key: licenseKeyForOrder(orderId, "test-secret") });
  });

  it("shows no key for a refunded order", async () => {
    const id = await checkoutWith("succeeded");
    fake.orders.push({ id: "77777777-7777-4777-8777-777777777777", checkout_id: id, status: "refunded", paid: true, total_amount: 1500, metadata: {} });
    expect(await lookupPurchase(id)).toMatchObject({ state: "refunded" });
  });
});

describe("request helpers", () => {
  it("passes Polar only a public client address", () => {
    expect(publicIp("83.1.2.3, 10.0.0.1", null)).toBe("83.1.2.3");
    expect(publicIp(null, "2a02:a311::1")).toBe("2a02:a311::1");
    expect(publicIp("127.0.0.1", null)).toBeNull();
    expect(publicIp("192.168.1.5", null)).toBeNull();
    expect(publicIp("::1", null)).toBeNull();
    expect(publicIp("not-an-ip", null)).toBeNull();
  });

  it("keeps utm_* and ref, nothing else", () => {
    const out = attributionFrom(new URLSearchParams("utm_source=youtube&utm_campaign=s1e0&ref=pilot&token=x&utm_medium="));
    expect(out).toEqual({ utm_source: "youtube", utm_campaign: "s1e0", ref: "pilot" });
  });
});
