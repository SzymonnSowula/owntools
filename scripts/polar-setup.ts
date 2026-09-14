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
 * - LICENSE_KEY_SECRET in web/.env.local when it is missing.
 *
 * What it cannot make, because Polar only allows it in the dashboard: the
 * account and organization, the payout account and identity check, and the
 * access token this script runs with.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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
const installers: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--sandbox") sandbox = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--set-usd") setUsd = true;
  else if (arg === "--installer") {
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

function keyNote(): string {
  const install = [
    downloadWindows ? `[Windows](${downloadWindows})` : null,
    downloadMac ? `[macOS](${downloadMac})` : null,
  ].filter(Boolean);
  const reach = `[${contact}](mailto:${contact})`;
  return [
    "**Your license key is on the page Polar sent you to right after paying** - the address starts with",
    `\`${site}/thanks\`. That link shows the key again whenever you open it, so bookmark it.`,
    "",
    `1. Install owntools: ${install.length ? install.join(" · ") : `[${site.replace(/^https?:\/\//, "")}](${site})`}`,
    "2. Open **Settings → License**, paste the key and press **Activate**.",
    "",
    `The key works offline, never expires and covers every update. Lost it? Write to ${reach} from the address you paid with and you will get it again.`,
  ].join("\n");
}

function productDescription(): string {
  return [
    "One payment removes the \"made with owntools\" badge from everything you export - for good.",
    "",
    "- every tool in the app, on Windows and macOS",
    "- every future update",
    "- an offline license key: no account, nothing phones home",
    "",
    `Your key appears on screen as soon as the payment clears. [${site.replace(/^https?:\/\//, "")}](${site})`,
  ].join("\n");
}

/* ---------------------------------- steps --------------------------------- */

async function organization(): Promise<Organization> {
  const page = await polar.get<Page<Organization>>("/v1/organizations/?limit=10");
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
      appendToWebEnv("LICENSE_KEY_SECRET", secret, "Pro keys are derived from Polar order ids with this. Keep it; set the same value on the host.");
      console.log(`  ${green("✓")} added LICENSE_KEY_SECRET`);
    }
  } else {
    console.log(`  ${dim("✓")} LICENSE_KEY_SECRET is set`);
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
  const prod = await product();
  await discounts(prod?.id ?? null);
  await benefits(prod);
  environment();

  const ladder = TIERS.map((t) => `${labels.get(t.key)} ${usd(t.price)}`).join(" → ");
  console.log(`\n${bold(dryRun ? "dry run done" : "done")} ${dim(`· ${changes} change(s) · ${ladder}`)}`);
  if (dryRun) return;
  console.log(`
next:
  1. put POLAR_ACCESS_TOKEN, POLAR_SERVER and LICENSE_KEY_SECRET from web/.env.local on the
     host that serves the site (e.g. Vercel → Settings → Environment Variables) and redeploy -
     the "get the pro key" button only points at /checkout when the page is built with a token
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
