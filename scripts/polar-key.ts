/**
 * polar-key.ts - answers "I lost my key" in one command.
 *
 *   pnpm polar:key someone@example.com     every Pro order paid with that e-mail, with its key
 *   pnpm polar:key <order id>              one order (the id from the Polar dashboard)
 *   add --sandbox for the sandbox
 *
 * Keys are derived from the order id (web/lib/licenseKey.ts), so nothing is
 * looked up in a database: it asks Polar for the orders and recomputes. It has
 * to run with the same LICENSE_KEY_SECRET as the site - the one in
 * web/.env.local that `pnpm polar:setup` wrote and the host was given. A
 * different secret prints different keys; the one the buyer already has keeps
 * working either way, so re-sending one of these is always safe.
 */

import { licenseKeyForOrder } from "../web/lib/licenseKey.ts";
import { POLAR_META, TIERS, pricingSnapshot } from "../web/lib/pricing.ts";
import { bold, connect, dim, fail, green, listAll, money, setting, warn, type Page } from "./lib/polar-cli.ts";

interface Order {
  id: string;
  created_at: string;
  status: string;
  paid: boolean;
  total_amount: number;
  currency: string;
  product_id: string | null;
  metadata: Record<string, string | number | boolean>;
  customer: { email: string | null };
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const sandbox = args.includes("--sandbox");
const target = args.find((a) => !a.startsWith("--"));
if (!target || args.includes("--help") || args.includes("-h")) {
  fail("Usage: pnpm polar:key <e-mail | order id> [--sandbox]");
}

const polar = connect({ sandbox });
const secret = setting("LICENSE_KEY_SECRET");
const labels = new Map(pricingSnapshot(null).tiers.map((t) => [t.key, t.label]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function show(order: Order): void {
  const tier = String(order.metadata?.[POLAR_META.tier] ?? "");
  const step = TIERS.some((t) => t.key === tier) ? labels.get(tier as (typeof TIERS)[number]["key"]) : null;
  const when = order.created_at.slice(0, 10);
  const refunded = order.status === "refunded";
  console.log(
    `\n${bold(when)} ${money(order.total_amount, order.currency)} ${dim(`· ${order.status}${step ? ` · ${step}` : ""} · ${order.customer?.email ?? ""}`)}`,
  );
  console.log(`  order ${dim(order.id)}`);
  if (refunded) {
    console.log(`  ${dim("refunded - no key to send")}`);
    return;
  }
  console.log(`  key   ${green(licenseKeyForOrder(order.id, secret ?? ""))}`);
}

async function main(): Promise<void> {
  if (!secret) warn("LICENSE_KEY_SECRET is not set here, so these keys will not match the ones the site showed (they still work in the app).");

  if (UUID.test(target!)) {
    show(await polar.get<Order>(`/v1/orders/${target}`));
    return;
  }

  const products = await polar.get<Page<{ id: string }>>(
    `/v1/products/?metadata[${POLAR_META.product}]=${POLAR_META.productValue}&limit=10`,
  );
  const productIds = new Set(products.items.map((p) => p.id));
  const customers = await polar.get<Page<{ id: string; email: string }>>(`/v1/customers/?email=${encodeURIComponent(target!)}&limit=10`);
  if (customers.items.length === 0) fail(`No Polar customer with the e-mail ${target}. Try the order id from their receipt.`);

  let found = 0;
  for (const customer of customers.items) {
    const orders = await listAll<Order>(polar, `/v1/orders/?customer_id=${customer.id}`);
    for (const order of orders.filter((o) => o.paid && o.product_id !== null && productIds.has(o.product_id))) {
      show(order);
      found += 1;
    }
  }
  if (found === 0) fail(`${target} is a customer, but has no paid owntools Pro order.`);
  console.log("");
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
