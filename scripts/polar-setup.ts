/**
 * polar-setup.ts - builds the owntools shop on Polar through the API, so it
 * never has to be clicked together in the dashboard. Safe to run again: it
 * finds what it made before by metadata and only changes what differs.
 *
 *   pnpm polar:setup                        production (token from web/.env.local)
 *   pnpm polar:setup --sandbox              sandbox-api.polar.sh, test cards
 *   pnpm polar:setup --dry-run              show what would change, change nothing
 *   pnpm polar:setup --installer <file>     also upload an installer (repeatable) as
 *                                           a File Downloads benefit on the product
 *   pnpm polar:setup --set-usd              switch the organization's default
 *                                           currency to USD if it is not already
 *   pnpm polar:setup --webhook-url <url>    where Polar reports paid orders, when it is
 *                                           not <site>/api/polar/webhook (a tunnel, a preview)
 *
 * What it makes, from web/lib/pricing.ts:
 * - product "owntools Pro": one-time, the list price;
 * - one fixed discount per launch step (list price minus the step's price) with
 *   max_redemptions = the step's cap. Polar enforces the cap itself, and the
 *   site's /checkout applies the cheapest step that still has room;
 * - a Custom benefit whose note (shown on Polar's receipt e-mail and customer
 *   portal) says where the key is and how to activate it;
 * - with --installer, a File Downloads benefit carrying the installer(s);
 * - the organization's public support e-mail and website (the contact address
 *   and the site; Polar's review flags a personal address or another domain);
 * - the webhook that tells the site an order was paid, so the key is e-mailed
 *   to the buyer (`order.paid` → <site>/api/polar/webhook); its secret goes into
 *   web/.env.local as POLAR_WEBHOOK_SECRET, and an endpoint Polar switched off
 *   after failed deliveries is switched back on;
 * - LICENSE_KEY_SECRET in web/.env.local when it is missing.
 *
 * What it cannot make, because Polar only allows it in the dashboard: the
 * account and organization, the payout account and identity check, and the
 * access token this script runs with.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { licensePublicKey } from "../web/lib/licenseKey.ts";
import { signPolarWebhook } from "../web/lib/polarWebhook.ts";
import { LIST_PRICE, POLAR_META, TIERS, pricingSnapshot, usd } from "../web/lib/pricing.ts";
import {
  PolarApiError,
  appendToWebEnv,
  bold,
  connect,
  dim,
  fail,
  green,
  listAll,
  money,
  setting,
  warn,
  type Page,
  type Polar,
} from "./lib/polar-cli.ts";

/* --------------------------------- args ---------------------------------- */

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ ?\* ?/gm, ""));
  process.exit(0);
}
let sandbox = false;
let dryRun = false;
let setUsd = false;
let webhookUrlArg: string | null = null;
const installers: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--sandbox") sandbox = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--set-usd") setUsd = true;
  else if (arg === "--webhook-url") {
    const url = argv[++i];
    if (!url || !/^https:\/\//.test(url)) fail("--webhook-url needs an https:// address after it.");
    webhookUrlArg = url;
  } else if (arg === "--installer") {
    const file = argv[++i];
    if (!file || file.startsWith("--")) fail("--installer needs a file path after it.");
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) fail(`Installer not found: ${path}`);
    installers.push(path);
  } else if (arg !== "--") fail(`Unknown argument ${arg}. Try --help.`);
}

const polar = connect({ sandbox });
const site = (setting("NEXT_PUBLIC_SITE_URL") ?? "https://owntools.app").replace(/\/+$/, "");
// the same default as web/lib/site.ts
const contact = setting("NEXT_PUBLIC_CONTACT_EMAIL") ?? "hello@owntools.app";
const downloadWindows = setting("NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS");
const downloadMac = setting("NEXT_PUBLIC_DOWNLOAD_URL_MACOS");

/* ---------------------------------- types --------------------------------- */

type Metadata = Record<string, string | number | boolean>;

interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  default_presentment_currency: string;
  default_tax_behavior: string;
  /** The public support e-mail. */
  email: string | null;
  website: string | null;
  /** What Polar currently lets the organization do; flips as the account review goes through. */
  capabilities?: { checkout_payments?: boolean; payouts?: boolean };
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  metadata: Metadata;
  prices: { id: string; amount_type: string; price_amount?: number; price_currency?: string; is_archived: boolean }[];
  benefits: { id: string }[];
}

interface Discount {
  id: string;
  name: string;
  type: string;
  amount?: number;
  currency?: string;
  amounts?: Record<string, number>;
  max_redemptions: number | null;
  redemptions_count: number;
  products: { id: string }[];
  metadata: Metadata;
}

interface Benefit {
  id: string;
  type: string;
  description: string;
  properties: { note?: string | null; files?: string[] };
  metadata: Metadata;
}

interface FileUpload {
  id: string;
  upload: {
    id: string;
    path: string;
    parts: { number: number; chunk_start: number; chunk_end: number; checksum_sha256_base64?: string | null; url: string; headers?: Record<string, string> }[];
  };
}

/* --------------------------------- helpers -------------------------------- */

let changes = 0;

/** Runs a write, or in a dry run only says it would. */
async function write<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  changes += 1;
  if (dryRun) {
    console.log(`  ${dim("would")} ${label}`);
    return null;
  }
  const result = await run();
  console.log(`  ${green("✓")} ${label}`);
  return result;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("base64");
const listCents = LIST_PRICE * 100;
const labels = new Map(pricingSnapshot(null).tiers.map((t) => [t.key, t.label]));

/** The public key baked into the app, read off the source so the two are compared, not assumed. */
function appPublicKey(): string | null {
  try {
    const source = readFileSync(resolve(import.meta.dirname, "../packages/licensing/src/license.ts"), "utf8");
    return /LICENSE_PUBLIC_KEY = "([0-9a-f]{64})"/.exec(source)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Does the site e-mail keys right now? Set by the `webhook` step from what the
 * live site reports, *before* the texts below are written: a receipt that
 * promises an e-mail which never comes is a support request per sale, so the
 * promise is only made once it is true - and the next run adds it.
 */
let siteEmailsKeys = false;

function keyNote(): string {
  const install = [
    downloadWindows ? `[Windows](${downloadWindows})` : null,
    downloadMac ? `[macOS](${downloadMac})` : null,
  ].filter(Boolean);
  const reach = `[${contact}](mailto:${contact})`;
  const bare = site.replace(/^https?:\/\//, "");
  const where = siteEmailsKeys
    ? [
        "**Your license key was e-mailed to this address** and is on the page Polar sent you to right after paying -",
        `the address starts with \`${site}/thanks\`. That link shows the key again whenever you open it, so bookmark it.`,
      ]
    : [
        "**Your license key is on the page Polar sent you to right after paying** - the address starts with",
        `\`${site}/thanks\`. That link shows the key again whenever you open it, so bookmark it.`,
      ];
  const lost = siteEmailsKeys
    ? `Lost it? [${bare}/key](${site}/key) sends it to this address again - a minute, and nobody to write to.`
    : `Lost it? Write to ${reach} from the address you paid with and you will get it again.`;
  return [
    ...where,
    "",
    `1. Install owntools: ${install.length ? install.join(" · ") : `[${bare}](${site})`}`,
    "2. Open **Settings → License**, paste the key and press **Activate**.",
    "3. One key covers one computer at a time. New computer? Paste the same key there - there is nothing to transfer.",
    "",
    `The key unlocks every tool - focus, screeni, capture, board, meet, social, disk and launch - works offline, never expires and covers every update. ${lost}`,
  ].join("\n");
}

function productDescription(): string {
  return [
    "One payment unlocks every tool in owntools - for good. dictate and the quick file tools are free; the key opens the rest.",
    "",
    "- focus, screeni, capture, board, meet, social, disk and launch (Windows today; the same key opens the macOS build when it ships)",
    "- every future update",
    "- an offline license key: no account, nothing phones home",
    "",
    `Your key appears on screen as soon as the payment clears${siteEmailsKeys ? " and is e-mailed to you" : ""}. [${site.replace(/^https?:\/\//, "")}](${site})`,
  ].join("\n");
}

/* ---------------------------------- steps --------------------------------- */

async function organization(): Promise<Organization | null> {
  let page: Page<Organization>;
  try {
    page = await polar.get<Page<Organization>>("/v1/organizations/?limit=10");
  } catch (err) {
    if (!(err instanceof PolarApiError && err.status === 403)) throw err;
    // An organization token acts on its own organization anyway; without the
    // organizations scopes only these checks and settings are left to a person.
    console.log(`${bold("organization")} ${dim(`· ${polar.server} · the token has no organizations:read, so not checked here`)}`);
    warn("In the dashboard, check Settings → Payments: default currency USD (a product without a price in it sells for nothing).");
    warn(`And Settings → General: support e-mail ${contact}, website ${site}.`);
    return null;
  }
  const org = page.items[0];
  if (!org) fail("The token does not see an organization. Does it have the organizations:read scope?");

  const caps = org.capabilities;
  const yesNo = (v: boolean | undefined) => (v ? "yes" : "no");
  console.log(
    `${bold(org.name)} ${dim(`(${org.slug}) · ${polar.server} · status ${org.status}${
      caps ? ` · takes payments: ${yesNo(caps.checkout_payments)} · payouts: ${yesNo(caps.payouts)}` : ""
    }`)}`,
  );
  if (org.status !== "active" || (caps && (!caps.checkout_payments || !caps.payouts))) {
    warn(
      `Polar has not cleared this organization for ${caps && caps.checkout_payments ? "payouts" : "payments"} yet (${org.status}). Everything can be set up now; the account review is Finance → Account in the dashboard (docs/payments.md §3).`,
    );
  }
  if (org.default_presentment_currency !== "usd") {
    if (!setUsd) {
      fail(
        `The organization's default currency is ${org.default_presentment_currency.toUpperCase()}, and the ladder is priced in USD.`,
        "Polar requires a price in the default currency, so run again with --set-usd to switch it,",
        "or change it in the dashboard under Settings → Payments.",
      );
    }
    await write("default currency → USD", () => polar.patch(`/v1/organizations/${org.id}`, { default_presentment_currency: "usd" }));
  }

  // what buyers see as the seller's contact, and what the account review compares it with
  const bare = (url: string | null) => (url ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const profile: { email?: string; website?: string } = {};
  if ((org.email ?? "").toLowerCase() !== contact.toLowerCase()) profile.email = contact;
  if (bare(org.website) !== bare(site)) profile.website = site;
  if (profile.email || profile.website) {
    const label = [profile.email ? `support e-mail → ${contact}` : null, profile.website ? `website → ${site}` : null].filter(Boolean).join(", ");
    try {
      await write(label, () => polar.patch(`/v1/organizations/${org.id}`, profile));
    } catch (err) {
      if (!(err instanceof PolarApiError && err.status === 403)) throw err;
      changes -= 1;
      warn(`The token cannot edit the organization (organizations:write), so set it by hand in Settings → General: ${label}.`);
    }
  }
  return org;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  name?: string | null;
  format: string;
  secret: string;
  events: string[];
  enabled: boolean;
}

/** What the live site says it has for e-mailing keys (GET /api/polar/webhook): booleans, no values. */
interface SiteStatus {
  webhook: boolean;
  email: boolean;
  signing: boolean;
  polar: boolean;
}

const WEBHOOK_NAME = "owntools key e-mails";
const WEBHOOK_EVENTS = ["order.paid"];

/**
 * Where the site really answers, and what it has. The apex redirects to www
 * and **Polar counts a redirect as a failed delivery**, so the webhook has to
 * be registered at the address the redirects end at, not at the one in the
 * config.
 */
async function siteStatus(): Promise<{ url: string; status: SiteStatus | null }> {
  const asked = webhookUrlArg ?? `${site}/api/polar/webhook`;
  try {
    const res = await fetch(asked, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    const url = res.url && /^https:\/\//.test(res.url) ? res.url : asked;
    if (!res.ok) return { url, status: null };
    const body = (await res.json()) as Partial<SiteStatus> | null;
    const ok = body && typeof body.webhook === "boolean" && typeof body.email === "boolean";
    return { url, status: ok ? { webhook: !!body.webhook, email: !!body.email, signing: !!body.signing, polar: !!body.polar } : null };
  } catch {
    return { url: asked, status: null };
  }
}

/**
 * The `order.paid` webhook behind the key e-mail. Sets `siteEmailsKeys`, which
 * decides what the receipt note and the product description promise.
 */
async function webhook(): Promise<void> {
  console.log(`\n${bold("key e-mails")}`);
  if (polar.server === "sandbox" && !webhookUrlArg) {
    console.log(`  ${dim("skipped in the sandbox: the live site verifies production's secret. To try it, pass --webhook-url https://<tunnel>/api/polar/webhook")}`);
    return;
  }

  const { url, status } = await siteStatus();
  if (!status) {
    warn(`${url} does not answer yet - deploy the site first, then run this again. Until then the key is on /thanks only, as before.`);
    return;
  }

  // A token of its own for this one job is fine, and tidy: POLAR_WEBHOOK_TOKEN with
  // webhooks:read + webhooks:write only, next to a shop token that cannot touch webhooks.
  const webhookToken = setting("POLAR_WEBHOOK_TOKEN");
  const hooks = webhookToken ? connect({ sandbox, token: webhookToken }) : polar;

  // The mix-up this was written after: the webhook *token* saved under the *secret's* name. A
  // secret is made by Polar when the endpoint is created and never starts with a token prefix;
  // put on the host, a token there would have every delivery refused until Polar gave up.
  if (/^polar_(oat|pat)_/.test(setting("POLAR_WEBHOOK_SECRET") ?? "")) {
    fail(
      "POLAR_WEBHOOK_SECRET in web/.env.local holds a Polar access token, not a webhook secret.",
      "If that is the token with the webhook scopes, rename the line to POLAR_WEBHOOK_TOKEN and run this again:",
      "the script then creates the endpoint with it and writes the real POLAR_WEBHOOK_SECRET itself.",
    );
  }

  let endpoints: WebhookEndpoint[];
  try {
    endpoints = await listAll<WebhookEndpoint>(hooks, "/v1/webhooks/endpoints");
  } catch (err) {
    if (!(err instanceof PolarApiError && err.status === 403)) throw err;
    warn("The token cannot manage webhooks (webhooks:read + webhooks:write), so the key is not e-mailed yet. Either add those");
    warn("two scopes to a new token (as POLAR_ACCESS_TOKEN, or a webhooks-only one as POLAR_WEBHOOK_TOKEN) and run this again,");
    warn(`or add the endpoint by hand: dashboard → Settings → Webhooks → Add endpoint → URL ${url}, format Raw, event`);
    warn("order.paid → copy its secret into POLAR_WEBHOOK_SECRET (web/.env.local + the host).");
    return;
  }

  let endpoint = endpoints.find((e) => e.url === url) ?? endpoints.find((e) => e.name === WEBHOOK_NAME) ?? null;
  if (!endpoint) {
    endpoint = await write(`create the webhook: order.paid → ${url}`, () =>
      hooks.post<WebhookEndpoint>("/v1/webhooks/endpoints", {
        url,
        name: WEBHOOK_NAME,
        format: "raw",
        events: WEBHOOK_EVENTS,
        api_version: polar.version,
      }),
    );
  } else {
    const patch: Record<string, unknown> = {};
    if (endpoint.url !== url) patch.url = url;
    if (endpoint.format !== "raw") patch.format = "raw";
    if (WEBHOOK_EVENTS.some((e) => !endpoint!.events.includes(e))) patch.events = [...new Set([...endpoint.events, ...WEBHOOK_EVENTS])];
    if (!endpoint.enabled) patch.enabled = true;
    if (Object.keys(patch).length === 0) {
      console.log(`  ${dim("✓")} webhook order.paid → ${url} ${dim(endpoint.id)}`);
    } else {
      if (patch.enabled) warn("Polar had switched the webhook off (ten failed deliveries in a row). Switching it back on - orders paid meanwhile got no e-mail; their keys are on /thanks and at /key.");
      const id = endpoint.id;
      endpoint = (await write(`update the webhook: ${Object.keys(patch).join(", ")}`, () => hooks.patch<WebhookEndpoint>(`/v1/webhooks/endpoints/${id}`, patch))) ?? endpoint;
    }
  }
  if (!endpoint) return; // a dry run that would have created it

  // the secret is Polar's to make; ours to carry to the site
  const local = setting("POLAR_WEBHOOK_SECRET");
  if (!local) {
    if (dryRun) console.log(`  ${dim("would")} add POLAR_WEBHOOK_SECRET to web/.env.local`);
    else {
      appendToWebEnv("POLAR_WEBHOOK_SECRET", endpoint.secret, "Signs Polar's webhook deliveries (order.paid → the key e-mail). Set the same value on the host.");
      console.log(`  ${green("✓")} added POLAR_WEBHOOK_SECRET to web/.env.local`);
    }
  } else if (local !== endpoint.secret) {
    warn("POLAR_WEBHOOK_SECRET in web/.env.local is not this endpoint's secret - deliveries would be refused (403). Replace it with the one in the dashboard → Settings → Webhooks, there and on the host.");
  } else {
    console.log(`  ${dim("✓")} POLAR_WEBHOOK_SECRET is set`);
  }

  const missing = [
    status.webhook ? null : "POLAR_WEBHOOK_SECRET (the value now in web/.env.local)",
    status.email ? null : "RESEND_API_KEY (resend.com → API Keys; the domain has to be verified there first)",
    status.signing ? null : "LICENSE_KEY_SECRET",
    status.polar ? null : "POLAR_ACCESS_TOKEN",
  ].filter(Boolean);
  if (missing.length > 0) {
    warn(`The host is missing: ${missing.join("; ")}. Add it, redeploy, run this again.`);
    warn("Until then Polar's deliveries are refused and retried - nothing is lost, the e-mail just comes late - and the receipt does not promise an e-mail.");
    return;
  }
  if (!endpoint.enabled) return;

  // The host says it *has* a secret; is it this endpoint's? A delivery signed here, carrying an
  // event type the handler only acknowledges (no order is read, no e-mail sent), answers that
  // before the first real order does: 202 = the signature held, 403 = another secret is up there.
  const probe = JSON.stringify({ type: "owntools.probe", timestamp: new Date().toISOString(), data: {} });
  const probeId = `msg_probe_${randomBytes(8).toString("hex")}`;
  const probeAt = Math.floor(Date.now() / 1000);
  let probeStatus = 0;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": probeId,
        "webhook-timestamp": String(probeAt),
        "webhook-signature": signPolarWebhook(probeId, probeAt, probe, endpoint.secret),
      },
      body: probe,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    probeStatus = res.status;
  } catch {
    /* unreachable: reported below as 0 */
  }
  if (probeStatus !== 202) {
    warn(
      probeStatus === 403
        ? "The host refused a delivery signed with this endpoint's secret (403): its POLAR_WEBHOOK_SECRET is a different value. Put the one from web/.env.local there and redeploy."
        : `A signed test delivery to ${url} answered ${probeStatus || "nothing"} instead of 202 - Polar's deliveries would fail the same way. The receipt does not promise an e-mail yet.`,
    );
    return;
  }
  siteEmailsKeys = true;
  console.log(`  ${dim("✓")} the site has everything and accepts deliveries signed with this secret: a paid order's key is e-mailed, /key sends a lost one again`);
}

async function product(): Promise<Product | null> {
  console.log(`\n${bold("product")}`);
  const metadata = { [POLAR_META.product]: POLAR_META.productValue };
  const found = await listAll<Product>(polar, `/v1/products/?metadata[${POLAR_META.product}]=${POLAR_META.productValue}`);
  const existing = found.find((p) => !p.is_archived) ?? found[0];
  const name = "owntools Pro";
  const description = productDescription();
  const price = { amount_type: "fixed", price_amount: listCents, price_currency: "usd" };

  if (!existing) {
    return write(`create "${name}" at ${usd(LIST_PRICE)}, one-time`, () =>
      polar.post<Product>("/v1/products/", { name, description, prices: [price], metadata, recurring_interval: null }),
    );
  }

  const patch: Record<string, unknown> = {};
  if (existing.is_archived) patch.is_archived = false;
  if (existing.name !== name) patch.name = name;
  if ((existing.description ?? "") !== description) patch.description = description;
  const live = existing.prices.find((p) => !p.is_archived && p.amount_type === "fixed" && p.price_currency === "usd");
  if (!live || live.price_amount !== listCents) patch.prices = [price];

  if (Object.keys(patch).length === 0) {
    console.log(`  ${dim("✓")} "${existing.name}" at ${usd(LIST_PRICE)} ${dim(existing.id)}`);
    return existing;
  }
  const what = Object.keys(patch).map((k) => (k === "prices" ? `price → ${usd(LIST_PRICE)}` : k)).join(", ");
  const updated = await write(`update "${name}": ${what}`, () => polar.patch<Product>(`/v1/products/${existing.id}`, patch));
  return updated ?? existing;
}

async function discounts(productId: string | null): Promise<void> {
  console.log(`\n${bold("launch prices")}`);
  const all = await listAll<Discount>(polar, "/v1/discounts/");
  const ours = all.filter((d) => typeof d.metadata?.[POLAR_META.tier] === "string");
  const steps = TIERS.slice(0, -1);

  for (const step of steps) {
    const label = labels.get(step.key) ?? step.key;
    const off = listCents - step.price * 100;
    if (off <= 0) fail(`The ${label} step (${usd(step.price)}) is not below the list price ${usd(LIST_PRICE)}.`);
    const name = `Launch price - ${label}`;
    const existing = ours.find((d) => d.metadata[POLAR_META.tier] === step.key);

    if (!existing) {
      await write(`create "${name}": ${usd(step.price)} (${money(off)} off) for ${step.cap} keys`, () =>
        polar.post<Discount>("/v1/discounts/", {
          type: "fixed",
          name,
          amount: off,
          currency: "usd",
          duration: "once",
          max_redemptions: step.cap,
          products: productId ? [productId] : [],
          metadata: { [POLAR_META.tier]: step.key },
        }),
      );
      continue;
    }

    const currentOff = existing.amounts?.usd ?? existing.amount;
    const patch: Record<string, unknown> = {};
    if (existing.name !== name) patch.name = name;
    if (existing.max_redemptions !== step.cap) {
      if (step.cap !== null && existing.redemptions_count > step.cap) {
        warn(`${label}: ${existing.redemptions_count} keys are already taken, more than the new cap of ${step.cap}. The step stays closed.`);
      }
      patch.max_redemptions = step.cap;
    }
    if (productId && (existing.products.length !== 1 || existing.products[0].id !== productId)) patch.products = [productId];
    if (currentOff !== off) {
      if (existing.redemptions_count === 0) {
        patch.amount = off;
        patch.currency = "usd";
      } else {
        warn(
          `${label}: Polar will not change a discount that has been used (${existing.redemptions_count}×), so this step still takes ${money(currentOff ?? 0)} off - ${money(listCents - (currentOff ?? 0))} instead of ${usd(step.price)}. Give the step a new key in web/lib/pricing.ts to start it fresh.`,
        );
      }
    }

    const taken = `${existing.redemptions_count} of ${existing.max_redemptions ?? "∞"} taken`;
    if (Object.keys(patch).length === 0) {
      console.log(`  ${dim("✓")} ${label}: ${usd(step.price)} · ${taken} ${dim(existing.id)}`);
    } else {
      await write(`update ${label}: ${Object.keys(patch).join(", ")} ${dim(`(${taken})`)}`, () =>
        polar.patch(`/v1/discounts/${existing.id}`, patch),
      );
    }
  }

  const planned = new Set<string>(steps.map((s) => s.key));
  for (const d of ours) {
    const tier = String(d.metadata[POLAR_META.tier]);
    if (!planned.has(tier)) warn(`"${d.name}" (${tier}) is not in web/lib/pricing.ts any more; the site ignores it. Delete it in the dashboard if it is dead.`);
  }
}

async function uploadInstaller(file: string, existingFiles: { id: string; checksum_sha256_base64?: string | null; name: string }[]): Promise<string | null> {
  const bytes = readFileSync(file);
  const name = basename(file);
  const checksum = sha256(bytes);
  const same = existingFiles.find((f) => f.checksum_sha256_base64 === checksum);
  if (same) {
    console.log(`  ${dim("✓")} ${name} is already uploaded ${dim(same.id)}`);
    return same.id;
  }

  const mime = name.endsWith(".exe")
    ? "application/vnd.microsoft.portable-executable"
    : name.endsWith(".dmg")
      ? "application/x-apple-diskimage"
      : name.endsWith(".msi")
        ? "application/x-msi"
        : "application/octet-stream";
  const CHUNK = 10_000_000; // what Polar's own uploader uses
  const parts: { number: number; chunk_start: number; chunk_end: number; checksum_sha256_base64: string }[] = [];
  for (let start = 0, number = 1; start < bytes.length || number === 1; start += CHUNK, number += 1) {
    const end = Math.min(start + CHUNK, bytes.length);
    parts.push({ number, chunk_start: start, chunk_end: end, checksum_sha256_base64: sha256(bytes.subarray(start, end)) });
    if (end >= bytes.length) break;
  }

  return write(`upload ${name} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`, async () => {
    const created = await polar.post<FileUpload>("/v1/files/", {
      service: "downloadable",
      name,
      mime_type: mime,
      size: bytes.length,
      checksum_sha256_base64: checksum,
      upload: { parts },
    });
    const done: { number: number; checksum_etag: string; checksum_sha256_base64: string | null }[] = [];
    // one part after another: S3 rejects checksummed parts that arrive out of order
    for (const part of created.upload.parts) {
      const res = await fetch(part.url, {
        method: "PUT",
        headers: part.headers ?? {},
        body: bytes.subarray(part.chunk_start, part.chunk_end),
      });
      const etag = res.headers.get("etag");
      if (!res.ok || !etag) throw new Error(`Uploading part ${part.number} of ${name} failed: HTTP ${res.status}`);
      done.push({ number: part.number, checksum_etag: etag, checksum_sha256_base64: part.checksum_sha256_base64 ?? null });
    }
    await polar.post(`/v1/files/${created.id}/uploaded`, { id: created.upload.id, path: created.upload.path, parts: done });
    return created.id;
  });
}

async function benefits(prod: Product | null): Promise<void> {
  console.log(`\n${bold("what the buyer gets")}`);
  const byRole = async (role: string) =>
    (await listAll<Benefit>(polar, `/v1/benefits/?metadata[${POLAR_META.benefit}]=${role}`))[0] ?? null;

  const ids: string[] = [];

  // 1. the note: where the key is, how to activate
  const note = keyNote();
  const description = "owntools Pro license key";
  const license = await byRole("license");
  if (!license) {
    const created = await write(`create the "${description}" note`, () =>
      polar.post<Benefit>("/v1/benefits/", {
        type: "custom",
        description,
        properties: { note },
        metadata: { [POLAR_META.benefit]: "license" },
      }),
    );
    if (created) ids.push(created.id);
  } else {
    ids.push(license.id);
    if (license.description !== description || (license.properties.note ?? "") !== note) {
      await write(`update the "${description}" note`, () =>
        polar.patch(`/v1/benefits/${license.id}`, { type: "custom", description, properties: { note } }),
      );
    } else {
      console.log(`  ${dim("✓")} "${description}" note ${dim(license.id)}`);
    }
  }

  // 2. the installer(s), only when asked for
  const downloads = await byRole("installer");
  if (installers.length > 0) {
    const existingFiles = downloads
      ? await listAll<{ id: string; name: string; checksum_sha256_base64?: string | null }>(polar, `/v1/benefits/${downloads.id}/files`).catch(() => [])
      : [];
    const fileIds: string[] = [];
    for (const file of installers) {
      const id = await uploadInstaller(file, existingFiles);
      if (id) fileIds.push(id);
    }
    const summary = installers.map((f) => basename(f)).join(", ");
    if (!downloads) {
      // in a dry run nothing was uploaded, so `write` only reports the step
      const created = await write(`create the installer download (${summary})`, () =>
        polar.post<Benefit>("/v1/benefits/", {
          type: "downloadables",
          description: "owntools installer",
          properties: { files: fileIds },
          metadata: { [POLAR_META.benefit]: "installer" },
        }),
      );
      if (created) ids.push(created.id);
    } else {
      ids.push(downloads.id);
      const current = downloads.properties.files ?? [];
      if (fileIds.length && (current.length !== fileIds.length || current.some((id, i) => id !== fileIds[i]))) {
        await write(`point the installer download at ${summary}`, () =>
          polar.patch(`/v1/benefits/${downloads.id}`, { type: "downloadables", properties: { files: fileIds } }),
        );
      }
    }
  } else if (downloads) {
    ids.push(downloads.id);
    console.log(`  ${dim("✓")} installer download ${dim(`${downloads.id} (pass --installer to replace the file)`)}`);
  }

  // 3. attached to the product, next to anything added by hand
  if (!prod) {
    if (dryRun) console.log(`  ${dim("would")} attach them to the product`);
    return;
  }
  const attached = new Set(prod.benefits.map((b) => b.id));
  const missing = ids.filter((id) => !attached.has(id));
  if (missing.length > 0) {
    await write(`attach ${missing.length} benefit(s) to the product`, () =>
      polar.post(`/v1/products/${prod.id}/benefits`, { benefits: [...attached, ...missing] }),
    );
  }
}

function environment(): void {
  console.log(`\n${bold("web/.env.local")}`);
  if (!setting("LICENSE_KEY_SECRET")) {
    const secret = randomBytes(32).toString("base64url");
    if (dryRun) console.log(`  ${dim("would")} add LICENSE_KEY_SECRET`);
    else {
      appendToWebEnv(
        "LICENSE_KEY_SECRET",
        secret,
        "Pro keys are signed with a key derived from this. Never change it once a key has been sold; set the same value on the host.",
      );
      console.log(`  ${green("✓")} added LICENSE_KEY_SECRET`);
    }
  } else {
    console.log(`  ${dim("✓")} LICENSE_KEY_SECRET is set`);
  }
  const secret = setting("LICENSE_KEY_SECRET");
  if (secret) {
    const derived = licensePublicKey(secret);
    const inApp = appPublicKey();
    if (inApp === derived) console.log(`  ${dim("✓")} the app's LICENSE_PUBLIC_KEY belongs to this secret ${dim(`${derived.slice(0, 12)}…`)}`);
    else {
      warn(
        `the app's LICENSE_PUBLIC_KEY (${inApp ?? "not found"}) does not belong to this secret (${derived}): keys issued with it would not open the app. Put the derived value into packages/licensing/src/license.ts and rebuild - or restore the secret the app was built for.`,
      );
    }
  }
  if (polar.server === "sandbox" && setting("POLAR_SERVER") !== "sandbox") {
    if (dryRun) console.log(`  ${dim("would")} add POLAR_SERVER=sandbox`);
    else {
      appendToWebEnv("POLAR_SERVER", "sandbox", "The token above is a sandbox token.");
      console.log(`  ${green("✓")} added POLAR_SERVER=sandbox`);
    }
  }
}

/* ----------------------------------- run ---------------------------------- */

async function main(): Promise<void> {
  console.log(`\nowntools → Polar ${dim(`(${polar.base} · API ${polar.version}${dryRun ? " · dry run" : ""})`)}\n`);
  await organization();
  // before the product and the receipt note: both say whether the key is e-mailed
  await webhook();
  const prod = await product();
  await discounts(prod?.id ?? null);
  await benefits(prod);
  environment();

  const ladder = TIERS.map((t) => `${labels.get(t.key)} ${usd(t.price)}`).join(" → ");
  console.log(`\n${bold(dryRun ? "dry run done" : "done")} ${dim(`· ${changes} change(s) · ${ladder}`)}`);
  if (dryRun) return;
  console.log(`
next:
  1. put POLAR_ACCESS_TOKEN, POLAR_SERVER, LICENSE_KEY_SECRET and POLAR_WEBHOOK_SECRET from
     web/.env.local on the host that serves the site (e.g. Vercel → Settings → Environment
     Variables), RESEND_API_KEY next to them, and redeploy - the "get the pro key" button only
     points at /checkout when the page is built with a token, and keys are only e-mailed once
     the host has all five (run this again afterwards: it checks, and updates the receipt note)
${
  polar.server === "sandbox"
    ? `  2. open ${site}/checkout (or http://localhost:3006/checkout): it should land on Polar at ${usd(TIERS[0].price)}; pay with 4242 4242 4242 4242
  3. after paying, /thanks shows the key - paste it into a clean install once`
    : `  2. open ${site}/checkout: it should land on Polar at ${usd(TIERS[0].price)} - look, but do not pay with a real card
     (Polar reads that as card testing)
  3. pnpm polar:test-link makes a $0 checkout: finish it, /thanks shows the key - paste it into a clean install once`
}
`);
}

main().catch((err: unknown) => {
  if (err instanceof PolarApiError) {
    const hint =
      err.status === 403
        ? "The token is missing a scope for this step - see the list in web/.env.example."
        : "Nothing after this step was changed; fix it and run again, the script picks up where it stopped.";
    fail(err.message, hint);
  }
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
