/**
 * polar-test-link.ts - a checkout that costs $0, for trying the live shop.
 *
 *   pnpm polar:test-link              a single-use 100% code (valid 7 days) + a checkout with it
 *   pnpm polar:test-link --days 2     the code expires sooner (1-30 days)
 *   pnpm polar:test-link --remove     delete test codes that were never used
 *   add --sandbox for the sandbox
 *
 * Polar's account-review guide says not to test a live checkout with a real
 * card (it looks like card testing) and may ask for a 100% discount code so a
 * reviewer can walk through the purchase. This makes a 100%-off discount with
 * a code, limited to the Pro product, **one redemption** and an end date, and
 * opens a checkout session with it applied. Paying creates a real, paid $0
 * order, so /thanks shows a real key - the whole path is tested without money
 * moving and without using up a launch-price key (the launch steps are
 * separate discounts).
 *
 * Why a session and not a checkout link: a link lives until it is deleted and
 * silently drops a discount that no longer applies, so once the code was used
 * or had expired the same link would open an ordinary $39 checkout. A session
 * can be paid once, expires on its own, and cannot be created with a spent
 * code (Polar answers 422). Run the script again for a fresh one: it reuses a
 * code that is still unused and makes a new code once the old one is spent.
 */

import { randomBytes } from "node:crypto";
import { POLAR_META } from "../web/lib/pricing.ts";
import { bold, connect, dim, fail, green, listAll, setting, type Polar } from "./lib/polar-cli.ts";

interface Discount {
  id: string;
  code: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions_count: number;
  metadata: Record<string, unknown>;
}

interface Checkout {
  id: string;
  url: string;
  expires_at: string;
}

const MARK = "owntools_test";

const args = process.argv.slice(2).filter((a) => a !== "--");
if (args.includes("--uses")) fail("Test codes are single-use now: run the command again for a fresh one.");
const sandbox = args.includes("--sandbox");
const remove = args.includes("--remove");
const daysAt = args.indexOf("--days");
const days = daysAt >= 0 ? Number(args[daysAt + 1]) : 7;
if (!Number.isInteger(days) || days < 1 || days > 30) fail("--days takes a whole number from 1 to 30.");

const polar: Polar = connect({ sandbox });
const site = (setting("NEXT_PUBLIC_SITE_URL") ?? "https://owntools.app").replace(/\/+$/, "");

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Still good for one more purchase: not used up and not past its end date. */
function usable(d: Discount, now = Date.now()): boolean {
  const left = d.max_redemptions === null || d.redemptions_count < d.max_redemptions;
  return left && (d.ends_at === null || Date.parse(d.ends_at) > now);
}

async function main(): Promise<void> {
  console.log(`\nowntools test checkout ${dim(`(${polar.base} · API ${polar.version})`)}\n`);

  const discounts = (await listAll<Discount>(polar, "/v1/discounts/")).filter((d) => d.metadata?.[MARK] === "free");

  if (remove) {
    // a used or expired code is already dead and stays as the record of the test order
    const unused = discounts.filter((d) => usable(d));
    for (const d of unused) {
      await polar.del(`/v1/discounts/${d.id}`);
      console.log(`  ${green("✓")} deleted the unused code ${d.code ?? ""} ${dim(d.id)}`);
    }
    if (!unused.length) console.log("  no unused test code to remove");
    console.log("");
    return;
  }

  const products = await listAll<{ id: string; is_archived: boolean }>(
    polar,
    `/v1/products/?metadata[${POLAR_META.product}]=${POLAR_META.productValue}&is_archived=false`,
  );
  const product = products[0];
  if (!product) fail("No owntools Pro product on this Polar organization. Run pnpm polar:setup first.");

  let discount = discounts.find((d) => usable(d));
  if (discount) {
    console.log(`  ${green("✓")} the unused code from before still works`);
  } else {
    const code = `OWNTOOLSTEST${randomBytes(3).toString("hex").toUpperCase()}`;
    discount = await polar.post<Discount>("/v1/discounts/", {
      type: "percentage",
      basis_points: 10_000,
      duration: "once",
      name: "Test purchase (free)",
      code,
      max_redemptions: 1,
      ends_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      products: [product.id],
      metadata: { [MARK]: "free" },
    });
    console.log(`  ${green("✓")} created a single-use 100% code`);
  }

  const checkout = await polar.post<Checkout>("/v1/checkouts/", {
    products: [product.id],
    discount_id: discount.id,
    allow_discount_codes: false,
    success_url: `${site}/thanks?checkout_id={CHECKOUT_ID}`,
    metadata: { [MARK]: "checkout" },
  });
  console.log(`  ${green("✓")} opened a checkout with it`);

  console.log(`
  ${bold("checkout")}  ${checkout.url}
            ${dim(`pays once · expires ${when(checkout.expires_at)}`)}
  ${bold("code")}      ${discount.code ?? "(none)"} ${dim(`· single use · valid until ${discount.ends_at ? when(discount.ends_at) : "no end date"}`)}

  Open the checkout, enter an e-mail, finish: the total is $0 and Polar sends you on to
  ${site}/thanks, which shows the key. Once the code is used, or its date passes, it stops
  working everywhere; run this again for a fresh code and checkout.
  ${dim("pnpm polar:test-link --remove deletes a code that was never used.")}
`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
