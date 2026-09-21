import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailError } from "./email";
import { RECOVERY_WINDOW_MS, deliverOrderKey, keyMailMissing, recoveryKey, resendKeys } from "./keyMail";
import { licenseKeyForOrder } from "./licenseKey";
import { forgetPolarCache } from "./polar";
import { siteUrl } from "./site";

/*
 * Two stand-ins, behaving the way the real services are documented to
 * (2026-09-19): Polar for the orders, and Resend for the sending - including
 * the part this design leans on, idempotency keys: the same key with the same
 * body answers with the first response and sends nothing, the same key with
 * another body is a 409.
 */

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const OTHER_PRODUCT = "99999999-9999-4999-8999-999999999999";
const SECRET = "test-secret";

interface FakeOrder {
  id: string;
  status: string;
  paid: boolean;
  product_id: string;
  checkout_id: string | null;
  created_at: string;
  customer: { id: string; email: string | null };
}

interface SentMail {
  idempotencyKey: string;
  body: { from: string; to: string[]; reply_to: string; subject: string; text: string; html: string; tags: unknown };
}

let orders: FakeOrder[];
let sent: SentMail[];
let resendStatus: number;
let resendCalls: number;
const remembered = new Map<string, { body: string; id: string }>();

function order(n: number, over: Partial<FakeOrder> = {}): FakeOrder {
  const id = `0000000${n}-0000-4000-8000-00000000000${n}`;
  return {
    id,
    status: "paid",
    paid: true,
    product_id: PRODUCT,
    checkout_id: `c000000${n}-0000-4000-8000-00000000000${n}`,
    created_at: `2026-09-1${n}T10:00:00Z`,
    customer: { id: `cust-${n}`, email: "buyer@example.com" },
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";

  if (url.host === "resend.test") {
    resendCalls += 1;
    if (method !== "POST" || url.pathname !== "/emails") return json(404, {});
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== "Bearer re_test") return json(401, { name: "missing_api_key" });
    if (resendStatus !== 200) return json(resendStatus, { name: "application_error", message: "down" });
    const key = headers.get("idempotency-key") ?? "";
    const body = String(init?.body);
    const before = remembered.get(key);
    if (before) return before.body === body ? json(200, { id: before.id }) : json(409, { name: "invalid_idempotent_request" });
    const id = `mail-${sent.length + 1}`;
    remembered.set(key, { body, id });
    sent.push({ idempotencyKey: key, body: JSON.parse(body) });
    return json(200, { id });
  }

  if (url.host !== "polar.test") return json(404, { detail: "unknown host" });
  if (url.pathname === "/v1/products/") {
    return json(200, {
      items: [{ id: PRODUCT, name: "owntools Pro", is_archived: false, metadata: { owntools_product: "pro" }, prices: [] }],
      pagination: { total_count: 1, max_page: 1 },
    });
  }
  const one = /^\/v1\/orders\/([^/]+)$/.exec(url.pathname);
  if (one) {
    const found = orders.find((o) => o.id === one[1]);
    return found ? json(200, found) : json(404, { detail: "Not found" });
  }
  if (url.pathname === "/v1/customers/") {
    const email = url.searchParams.get("email");
    const ids = [...new Set(orders.filter((o) => o.customer.email?.toLowerCase() === email).map((o) => o.customer.id))];
    return json(200, { items: ids.map((id) => ({ id })), pagination: { total_count: ids.length, max_page: 1 } });
  }
  if (url.pathname === "/v1/orders/") {
    const items = orders.filter(
      (o) => o.customer.id === url.searchParams.get("customer_id") && o.product_id === url.searchParams.get("product_id"),
    );
    return json(200, { items, pagination: { total_count: items.length, max_page: 1 } });
  }
  return json(404, { detail: `no fake for ${method} ${url.pathname}` });
}

beforeEach(() => {
  vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_oat_test");
  vi.stubEnv("POLAR_API_URL", "https://polar.test");
  vi.stubEnv("LICENSE_KEY_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_API_URL", "https://resend.test");
  vi.stubGlobal("fetch", vi.fn(handle));
  forgetPolarCache();
  orders = [order(1)];
  sent = [];
  resendStatus = 200;
  resendCalls = 0;
  remembered.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("deliverOrderKey", () => {
  it("e-mails the order's key to the address that paid, with the way back to it", async () => {
    expect(await deliverOrderKey(orders[0].id)).toEqual({ state: "sent", duplicate: false });
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    const key = licenseKeyForOrder(orders[0].id, SECRET);
    expect(mail.body.to).toEqual(["buyer@example.com"]);
    expect(mail.body.from).toBe("owntools <hello@owntools.app>");
    expect(mail.body.reply_to).toBe("hello@owntools.app");
    expect(mail.body.subject).toBe("Your owntools Pro key");
    expect(mail.body.text).toContain(key);
    expect(mail.body.html).toContain(key);
    // built from siteUrl, not spelled out: the canonical host is www and the
    // apex only redirects to it, so a link in an e-mail must not be pinned here
    expect(mail.body.text).toContain(`${siteUrl}/thanks?checkout_id=${orders[0].checkout_id}`);
    expect(mail.body.text).toContain(`${siteUrl}/key`);
    expect(mail.idempotencyKey).toBe(`owntools-order-${orders[0].id}`);
  });

  it("sends once however often it is asked - a webhook retry, /thanks racing the webhook", async () => {
    await Promise.all([deliverOrderKey(orders[0].id), deliverOrderKey(orders[0].id)]);
    await deliverOrderKey(orders[0].id);
    expect(sent).toHaveLength(1);
  });

  it("takes a 409 from Resend as 'already sent', not as a failure", async () => {
    await deliverOrderKey(orders[0].id);
    // the same order, a different body (say the download link changed in between)
    remembered.set(`owntools-order-${orders[0].id}`, { body: "something else", id: "mail-1" });
    expect(await deliverOrderKey(orders[0].id)).toEqual({ state: "sent", duplicate: true });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing for an order that carries no key", async () => {
    orders = [
      order(1, { status: "refunded" }),
      order(2, { paid: false, status: "pending" }),
      order(3, { product_id: OTHER_PRODUCT }),
      order(4, { customer: { id: "cust-4", email: null } }),
    ];
    expect(await deliverOrderKey(orders[0].id)).toEqual({ state: "ignored", why: "not-a-key-order" });
    expect(await deliverOrderKey(orders[1].id)).toEqual({ state: "ignored", why: "not-a-key-order" });
    expect(await deliverOrderKey(orders[2].id)).toEqual({ state: "ignored", why: "not-a-key-order" });
    expect(await deliverOrderKey(orders[3].id)).toEqual({ state: "ignored", why: "no-address" });
    expect(await deliverOrderKey("00000009-0000-4000-8000-000000000009")).toEqual({ state: "ignored", why: "not-found" });
    expect(await deliverOrderKey("not-an-id")).toEqual({ state: "ignored", why: "not-found" });
    expect(sent).toHaveLength(0);
  });

  it("says what is missing instead of pretending, so the webhook can ask Polar to retry", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(keyMailMissing()).toBe("email");
    expect(await deliverOrderKey(orders[0].id)).toEqual({ state: "unconfigured", missing: "email" });
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("LICENSE_KEY_SECRET", " ");
    expect(await deliverOrderKey(orders[0].id)).toEqual({ state: "unconfigured", missing: "signing" });
    vi.stubEnv("LICENSE_KEY_SECRET", SECRET);
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    expect(await deliverOrderKey(orders[0].id)).toEqual({ state: "unconfigured", missing: "polar" });
    expect(sent).toHaveLength(0);
  });

  it("lets a provider failure through as an error - a 5xx to Polar, which retries", async () => {
    resendStatus = 500;
    await expect(deliverOrderKey(orders[0].id)).rejects.toBeInstanceOf(EmailError);
    resendStatus = 200;
    expect(await deliverOrderKey(orders[0].id)).toEqual({ state: "sent", duplicate: false });
    expect(sent).toHaveLength(1);
  });
});

describe("resendKeys", () => {
  const NOW = Date.parse("2026-09-19T12:00:00Z");

  it("sends every key bought under an address to that address - refunded orders left out", async () => {
    orders = [order(1), order(2), order(3, { status: "refunded" }), order(4, { customer: { id: "cust-x", email: "someone@else.com" } })];
    expect(await resendKeys("  Buyer@Example.com ", NOW)).toEqual({ state: "done", sent: true });
    expect(sent).toHaveLength(1);
    const mail = sent[0].body;
    expect(mail.to).toEqual(["buyer@example.com"]);
    expect(mail.subject).toBe("Your owntools Pro keys, again");
    expect(mail.text).toContain(licenseKeyForOrder(orders[0].id, SECRET));
    expect(mail.text).toContain(licenseKeyForOrder(orders[1].id, SECRET));
    expect(mail.text).not.toContain(licenseKeyForOrder(orders[2].id, SECRET));
    expect(mail.text).not.toContain(licenseKeyForOrder(orders[3].id, SECRET));
    // newest first
    expect(mail.text.indexOf("Bought 2026-09-12")).toBeLessThan(mail.text.indexOf("Bought 2026-09-11"));
  });

  it("answers the same for an address that bought nothing, and sends nothing - not even a request", async () => {
    expect(await resendKeys("nobody@example.com", NOW)).toEqual({ state: "done", sent: false });
    expect(sent).toHaveLength(0);
    expect(resendCalls).toBe(0);
  });

  it("sends one e-mail per address per window, however often it is asked", async () => {
    await resendKeys("buyer@example.com", NOW);
    await resendKeys("BUYER@example.com", NOW + 60_000);
    await resendKeys("buyer@example.com", NOW + RECOVERY_WINDOW_MS - 1);
    expect(sent).toHaveLength(1);
    await resendKeys("buyer@example.com", NOW + RECOVERY_WINDOW_MS);
    expect(sent).toHaveLength(2);
  });

  it("keeps the address out of the idempotency key", () => {
    const key = recoveryKey("buyer@example.com", NOW);
    expect(key).toMatch(/^owntools-recover-[0-9a-f]{32}-\d+$/);
    expect(key).not.toContain("buyer");
    expect(key.length).toBeLessThanOrEqual(256);
    expect(recoveryKey("other@example.com", NOW)).not.toBe(key);
  });

  it("reports a missing setting, so the page can say 'write to us' instead of 'sent'", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await resendKeys("buyer@example.com", NOW)).toEqual({ state: "unconfigured", missing: "email" });
  });
});
