/**
 * resend-setup.ts - the sending domain on Resend, through the API, so the key
 * e-mails (web/lib/keyMail.ts) can go out from hello@<the site's domain>
 * without anything being clicked together in a dashboard. Safe to run again:
 * it finds the domain it made before and only changes what differs - and it is
 * also how to ask "did my DNS records land yet?".
 *
 *   pnpm resend:setup                 add (or find) the domain, tracking off, start the
 *                                     verification, show every DNS record and where it stands
 *   pnpm resend:setup --dry-run       look, change nothing
 *   pnpm resend:setup --region <r>    where a NEW domain sends from: eu-west-1 (default - an EU
 *                                     seller, EU data), us-east-1, sa-east-1, ap-northeast-1.
 *                                     A region cannot be changed later, only by re-adding the domain.
 *
 * What it cannot do: put the records into the DNS - that is the DNS host's
 * panel (OVH for owntools.app). The records sit on subdomains (`send`,
 * `resend._domainkey`), so a mailbox on the same domain keeps its own MX and SPF.
 *
 * The key: RESEND_API_KEY from the shell or web/.env.local, and it has to be a
 * *Full access* key - a "Sending access" key cannot read or add domains. Give
 * the host (Vercel) a Sending-access key limited to this domain instead; the
 * site only ever sends.
 *
 * Open and click tracking are switched OFF and kept off: the privacy page says
 * so, and a tracked link in an e-mail that carries a licence key is exactly the
 * kind of thing this product promises not to do.
 */

import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { bold, dim, fail, green, setting, warn, yellow } from "./lib/polar-cli.ts";

const API = "https://api.resend.com";

interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  status: string;
  priority?: number;
  ttl?: string;
}

interface Domain {
  id: string;
  name: string;
  status: string;
  region: string;
  open_tracking?: boolean;
  click_tracking?: boolean;
  records?: DnsRecord[];
}

const argv = process.argv.slice(2).filter((a) => a !== "--");
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ ?\* ?/gm, ""));
  process.exit(0);
}
const dryRun = argv.includes("--dry-run");
const regionAt = argv.indexOf("--region");
const region = regionAt >= 0 ? argv[regionAt + 1] : "eu-west-1";
if (!["eu-west-1", "us-east-1", "sa-east-1", "ap-northeast-1"].includes(region ?? "")) fail(`Unknown region ${region}. Try --help.`);

const apiKey = setting("RESEND_API_KEY");
if (!apiKey) fail("RESEND_API_KEY is not set (the shell or web/.env.local).", "resend.com → API Keys → Create API key → Full access.");

// the sender decides the domain: LICENSE_EMAIL_FROM when set, the contact address otherwise (as web/lib/email.ts)
const from = setting("LICENSE_EMAIL_FROM") ?? `owntools <${setting("NEXT_PUBLIC_CONTACT_EMAIL") ?? "hello@owntools.app"}>`;
const domainName = /@([^>\s]+)>?\s*$/.exec(from)?.[1]?.toLowerCase();
if (!domainName) fail(`Cannot tell the sending domain from "${from}".`);

class ResendError extends Error {
  status: number;
  code: string;

  constructor(status: number, body: unknown, what: string) {
    const b = body as { name?: string; message?: string } | null;
    super(`${what} → ${status}${b?.name ? ` ${b.name}` : ""}${b?.message ? `: ${b.message}` : ""}`);
    this.status = status;
    this.code = b?.name ?? "";
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "owntools-setup/1 (+https://owntools.app)",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ResendError(res.status, data, `${method} ${path}`);
  return data as T;
}

let changes = 0;
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

/** Is this record already what the public DNS answers? Looked up here, so the answer does not wait for Resend's next check. */
async function inDns(record: DnsRecord, domain: string): Promise<boolean> {
  const host = record.name.endsWith(domain) ? record.name : `${record.name}.${domain}`;
  const want = record.value.replace(/^"|"$/g, "").replace(/\.$/, "").toLowerCase();
  try {
    if (record.type === "MX") return (await resolveMx(host)).some((mx) => mx.exchange.replace(/\.$/, "").toLowerCase() === want);
    if (record.type === "CNAME") return (await resolveCname(host)).some((c) => c.replace(/\.$/, "").toLowerCase() === want);
    if (record.type === "TXT") return (await resolveTxt(host)).some((chunks) => chunks.join("").toLowerCase() === want);
  } catch {
    /* NXDOMAIN / no such record: not there yet */
  }
  return false;
}

async function main(): Promise<void> {
  console.log(`\nowntools → Resend ${dim(`(${domainName}${dryRun ? " · dry run" : ""})`)}\n`);

  let list: { data: Domain[] };
  try {
    list = await call<{ data: Domain[] }>("GET", "/domains");
  } catch (err) {
    if (err instanceof ResendError && (err.status === 401 || err.status === 403)) {
      fail(
        err.code === "restricted_api_key" ? "This RESEND_API_KEY only has Sending access - it cannot manage domains." : `Resend refused the key (${err.message}).`,
        "Make a Full access key for this script (resend.com → API Keys) and keep it in web/.env.local only;",
        "the host is better off with a Sending-access key limited to this domain.",
      );
    }
    throw err;
  }

  console.log(bold("domain"));
  let domain = list.data.find((d) => d.name.toLowerCase() === domainName) ?? null;
  if (!domain) {
    domain = await write(`add ${domainName} in ${region}, open and click tracking off`, () =>
      call<Domain>("POST", "/domains", { name: domainName, region, open_tracking: false, click_tracking: false }),
    );
    if (!domain) return; // dry run
  } else {
    domain = await call<Domain>("GET", `/domains/${domain.id}`);
    console.log(`  ${dim("✓")} ${domain.name} ${dim(`· ${domain.region} · ${domain.id}`)}`);
    if (domain.open_tracking || domain.click_tracking) {
      const id = domain.id;
      await write("switch open and click tracking off", () => call("PATCH", `/domains/${id}`, { open_tracking: false, click_tracking: false }));
    }
  }

  const records = (domain.records ?? []).filter((r) => r.record !== "Tracking");
  const seen = await Promise.all(records.map((r) => inDns(r, domainName!)));

  console.log(`\n${bold("DNS records")} ${dim(`· put these in at the DNS host of ${domainName}; the name is the subdomain, without the domain`)}`);
  records.forEach((r, i) => {
    const state = r.status === "verified" ? green("verified") : seen[i] ? yellow("in the DNS, waiting for Resend") : yellow("not in the DNS yet");
    console.log(`\n  ${bold(`${r.type}`)} ${dim(`(${r.record})`)}  ${state}`);
    console.log(`    name      ${r.name}`);
    console.log(`    value     ${r.value}`);
    if (r.priority !== undefined) console.log(`    priority  ${r.priority}`);
  });

  // DMARC is not Resend's record, but Gmail and Yahoo want one from anyone who sends
  let dmarc = false;
  try {
    dmarc = (await resolveTxt(`_dmarc.${domainName}`)).some((chunks) => chunks.join("").toLowerCase().startsWith("v=dmarc1"));
  } catch {
    /* none */
  }
  console.log(`\n  ${bold("TXT")} ${dim("(DMARC - yours, not Resend's)")}  ${dmarc ? green("in the DNS") : yellow("not in the DNS yet")}`);
  if (!dmarc) {
    console.log(`    name      _dmarc`);
    console.log(`    value     v=DMARC1; p=none; rua=mailto:${setting("NEXT_PUBLIC_CONTACT_EMAIL") ?? `hello@${domainName}`}`);
  }

  console.log(`\n${bold("verification")}`);
  if (domain.status === "verified") {
    console.log(`  ${green("✓")} ${domainName} is verified: ${from} can send`);
  } else {
    const missing = seen.filter((ok) => !ok).length;
    if (missing === 0 || domain.status === "not_started" || domain.status === "failed" || domain.status === "temporary_failure") {
      const id = domain.id;
      await write(`ask Resend to check the records ${dim(`(status was ${domain.status})`)}`, () => call("POST", `/domains/${id}/verify`));
    }
    console.log(
      missing > 0
        ? `  ${yellow("!")} ${missing} of ${records.length} records are not in the DNS yet. Add them, give the DNS a few minutes, run this again.`
        : `  ${yellow("!")} every record is in the DNS; Resend usually needs a few minutes to see them. Run this again.`,
    );
    console.log(`  ${dim("Until the domain is verified Resend refuses to send from it, and the webhook answers 5xx so Polar retries - an e-mail is late, not lost.")}`);
  }

  console.log(`\n${bold(dryRun ? "dry run done" : "done")} ${dim(`· ${changes} change(s)`)}\n`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
