/**
 * license-revoke.ts - switches Pro keys off, and keeps refunds switched off
 * without anyone thinking about it.
 *
 *   pnpm license:revoke --sync               every refunded Pro order on Polar goes on the list
 *                                            (the release script runs this; add --quiet there)
 *   pnpm license:revoke <OWNT-key>           a key that was passed around: off, as "shared"
 *   pnpm license:revoke <order id>           the same, by the Polar order id
 *   pnpm license:revoke <key> --refunded     list it as refunded instead
 *   pnpm license:revoke --remove <key|tag>   take an entry off again
 *   pnpm license:revoke --list               what is on the list
 *   add --sandbox for the sandbox, --dry-run to change nothing
 *
 * The list is packages/licensing/src/revoked.json and travels inside the
 * desktop build: a key on it stops opening the app with the release that
 * carries it (revoked.ts explains why that, and not a server). So after this
 * script changes the file: commit it, and the next release does the rest.
 *
 * An entry is a key's 8-byte tag - for an order's key a hash of the order id,
 * which is why `--sync` needs nothing but the order list, and why
 * `pnpm polar:key <OWNT-key>` can tell whose key turned up somewhere.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orderTagHex, tagOfLicenseKey } from "../web/lib/licenseKey.ts";
import { POLAR_META } from "../web/lib/pricing.ts";
import {
  parseRevokedFile,
  serializeRevokedFile,
  withRevoked,
  withoutRevoked,
  type RevokedFile,
  type RevokedReason,
} from "../web/lib/revokedList.ts";
import { ROOT, bold, connect, dim, fail, green, listAll, setting, warn, yellow, type Page, type Polar } from "./lib/polar-cli.ts";

const FILE = join(ROOT, "packages", "licensing", "src", "revoked.json");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG = /^[0-9a-f]{16}$/i;

interface Order {
  id: string;
  created_at: string;
  status: string;
  paid: boolean;
  product_id: string | null;
  customer?: { email?: string | null } | null;
}

const argv = process.argv.slice(2).filter((a) => a !== "--");
if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ ?\* ?/gm, ""));
  process.exit(0);
}
const flag = (name: string) => argv.includes(name);
const sandbox = flag("--sandbox");
const dryRun = flag("--dry-run");
const quiet = flag("--quiet");
const targets = argv.filter((a) => !a.startsWith("--"));
const say = (line: string) => {
  if (!quiet) console.log(line);
};

const today = () => new Date().toISOString().slice(0, 10);

function load(): RevokedFile {
  if (!existsSync(FILE)) return { keys: [] };
  return parseRevokedFile(readFileSync(FILE, "utf8"));
}

function save(file: RevokedFile, before: string): boolean {
  const after = serializeRevokedFile(file);
  // a Windows checkout may hold the file with CRLF: that is not a change to the list
  if (after === before.replace(/\r\n/g, "\n")) return false;
  if (!dryRun) writeFileSync(FILE, after);
  return true;
}

/** Every order of the Pro product; needs the token, so only the commands that ask Polar call it. */
async function proOrders(polar: Polar): Promise<Order[]> {
  const products = await polar.get<Page<{ id: string }>>(
    `/v1/products/?metadata[${POLAR_META.product}]=${POLAR_META.productValue}&limit=10`,
  );
  const orders: Order[] = [];
  for (const product of products.items) orders.push(...(await listAll<Order>(polar, `/v1/orders/?product_id=${product.id}`)));
  return orders;
}

/** A key, an order id or a bare tag → the tag it means. */
function tagOf(target: string): string {
  if (UUID.test(target)) return orderTagHex(target);
  if (TAG.test(target)) return target.toLowerCase();
  const tag = tagOfLicenseKey(target);
  if (!tag) fail(`"${target.slice(0, 24)}${target.length > 24 ? "…" : ""}" is not a key (OWNT-…), a Polar order id or a 16-digit tag.`);
  return tag;
}

async function sync(): Promise<void> {
  const polar = connect({ sandbox });
  const before = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
  let file = load();
  const refunded = (await proOrders(polar)).filter((o) => o.status === "refunded");
  let added = 0;
  for (const order of refunded) {
    const result = withRevoked(file, { tag: orderTagHex(order.id), reason: "refunded", since: today() });
    file = result.file;
    if (result.change === "kept") continue;
    added += 1;
    say(`  ${green("+")} order ${dim(order.id)} ${dim(`· refunded · ${order.customer?.email ?? "no e-mail"}`)}${result.change === "now-refunded" ? dim(" · was listed as shared") : ""}`);
  }
  const changed = save(file, before);
  const summary = `${refunded.length} refunded order(s) on Polar ${dim(`(${polar.server})`)}, ${added} new on the list, ${file.keys.length} key(s) switched off in all`;
  if (quiet) {
    // one line for the release script
    console.log(`revoked keys: ${summary.replace(/\x1b\[[0-9;]*m/g, "")}${dryRun && changed ? " (dry run: nothing written)" : ""}`);
    return;
  }
  console.log(`\n${bold(dryRun ? "dry run" : "synced")} ${dim("·")} ${summary}`);
  if (changed && !dryRun) console.log(`${yellow("!")} packages/licensing/src/revoked.json changed - commit it; the next release carries it.`);
}

async function revoke(): Promise<void> {
  const reason: RevokedReason = flag("--refunded") ? "refunded" : "shared";
  const before = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
  let file = load();

  // who is being switched off - shown when Polar can be asked, never required
  let orders: Order[] | null = null;
  if (setting("POLAR_ACCESS_TOKEN")) {
    try {
      orders = await proOrders(connect({ sandbox }));
    } catch (err) {
      warn(`Polar could not be asked whose key this is (${err instanceof Error ? err.message : String(err)}); switching it off anyway.`);
    }
  }

  for (const target of targets) {
    const tag = tagOf(target);
    const order = orders?.find((o) => orderTagHex(o.id) === tag);
    const result = withRevoked(file, { tag, reason, since: today() });
    file = result.file;
    const whose = order
      ? `order ${order.id} · ${order.customer?.email ?? "no e-mail"} · ${order.status}`
      : orders
        ? "no order has this tag: a gift key, or not one of ours"
        : "Polar not asked";
    const mark = result.change === "kept" ? dim("=") : green("+");
    console.log(`  ${mark} ${tag} ${dim(`· ${result.change === "kept" ? "already on the list" : reason} · ${whose}`)}`);
  }

  if (save(file, before)) {
    console.log(`\n${bold(dryRun ? "dry run" : "done")} ${dim(`· ${file.keys.length} key(s) switched off in all`)}`);
    if (!dryRun) console.log(`${yellow("!")} Commit packages/licensing/src/revoked.json. The key stops working with the next release, in the builds from then on - not in the ones already installed.`);
  } else {
    console.log(`\n${dim("nothing changed")}`);
  }
}

function remove(): void {
  const before = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
  let file = load();
  for (const target of targets) {
    const tag = tagOf(target);
    const result = withoutRevoked(file, tag);
    file = result.file;
    console.log(`  ${result.removed ? green("-") : dim("=")} ${tag} ${dim(result.removed ? "· taken off the list" : "· was not on the list")}`);
  }
  if (save(file, before) && !dryRun) console.log(`\n${yellow("!")} Commit packages/licensing/src/revoked.json; the key opens the app again from the next release.`);
}

function list(): void {
  const file = load();
  if (file.keys.length === 0) {
    console.log(dim("No key is switched off."));
    return;
  }
  for (const k of file.keys) console.log(`  ${k.since}  ${k.tag}  ${k.reason}`);
  console.log(dim(`\n${file.keys.length} key(s). pnpm polar:key <OWNT-key> says whose a key is.`));
}

async function main(): Promise<void> {
  if (flag("--list")) return list();
  if (flag("--sync")) return sync();
  if (targets.length === 0) fail("Nothing to switch off: pass a key, an order id or --sync. Try --help.");
  if (flag("--remove")) return remove();
  return revoke();
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
