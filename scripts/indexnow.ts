/**
 * `pnpm seo:indexnow` - tells the search engines that support IndexNow (Bing,
 * Yandex, Seznam, Naver) that these pages exist or changed. One request, no
 * account, no dashboard. Google does **not** take part: for Google the road is
 * the sitemap plus "Request indexing" in Search Console, by hand.
 *
 *   pnpm seo:indexnow                     every page the site publishes
 *   pnpm seo:indexnow --blog              the blog index and the posts only
 *   pnpm seo:indexnow /blog/a-new-post    just these paths (or full URLs)
 *   pnpm seo:indexnow --dry-run           print what would be sent
 *
 * The key is the file in web/public named after it (that is the protocol: the
 * engine fetches https://<host>/<key>.txt and expects the key back). Telling
 * them about a page that 404s or redirects is worse than saying nothing, so
 * every URL is checked first unless --no-check is passed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { POSTS, postPath } from "../web/lib/blog.ts";
import { ROOT, bold, dim, fail, green, setting, yellow } from "./lib/polar-cli.ts";

const ENDPOINT = "https://api.indexnow.org/IndexNow";
const PUBLIC_DIR = join(ROOT, "web", "public");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const blogOnly = args.includes("--blog");
const noCheck = args.includes("--no-check");
const given = args.filter((a) => !a.startsWith("--"));

const configured = (setting("NEXT_PUBLIC_SITE_URL") ?? "https://www.owntools.app").replace(/\/+$/, "");

/**
 * Where the site really answers. The apex 308s to www, and a redirecting URL
 * is the one thing this must never submit - so the host comes from where a
 * request actually lands rather than from the setting, the same way
 * polar-setup.ts resolves the address it registers a webhook at.
 */
async function resolveOrigin(): Promise<string> {
  try {
    const res = await fetch(configured, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (res.url && /^https:\/\//.test(res.url)) {
      const origin = new URL(res.url).origin;
      if (origin !== configured) console.log(dim(`${configured} redirects to ${origin} - submitting that instead`));
      return origin;
    }
  } catch {
    // offline, or the site is down: carry on with what was configured and let
    // the reachability check below say so in words
  }
  return configured;
}

const site = await resolveOrigin();
const host = new URL(site).host;

/** The key file in web/public, whose name must equal its contents. */
function findKey(): string {
  const files = readdirSync(PUBLIC_DIR).filter((f) => /^[a-f0-9]{8,128}\.txt$/i.test(f));
  if (files.length === 0) {
    fail(
      "No IndexNow key file in web/public.",
      "Create one: a file named <key>.txt whose only contents are that key,",
      "where <key> is 8-128 hexadecimal characters.",
    );
  }
  if (files.length > 1) fail(`More than one key file in web/public: ${files.join(", ")}`);
  const key = files[0].replace(/\.txt$/i, "");
  const body = readFileSync(join(PUBLIC_DIR, files[0]), "utf8").trim();
  if (body !== key) {
    fail(`web/public/${files[0]} must contain exactly "${key}" - it contains "${body}".`);
  }
  return key;
}

/** Everything the site publishes and wants found. Never /checkout, /thanks or /v. */
function allUrls(): string[] {
  const blog = [`${site}/blog`, ...POSTS.map((p) => `${site}${postPath(p.slug)}`)];
  if (blogOnly) return blog;
  return [site, ...blog, `${site}/changelog`, `${site}/privacy`, `${site}/terms`, `${site}/refunds`];
}

const urls = given.length
  ? given.map((a) => (a.startsWith("http") ? a : `${site}${a.startsWith("/") ? a : `/${a}`}`))
  : allUrls();

for (const url of urls) {
  if (new URL(url).host !== host) fail(`${url} is not on ${host} - IndexNow refuses the whole batch for one stray URL.`);
}

const key = findKey();
const keyLocation = `${site}/${key}.txt`;

console.log(bold(`IndexNow · ${host}`));
console.log(dim(`key ${keyLocation}`));
for (const url of urls) console.log(dim(`  ${url}`));

/** A 404 or a redirect submitted as a fresh page is a reason to be trusted less. */
async function checkReachable(list: string[]): Promise<void> {
  console.log("\nChecking the pages answer first...");
  const problems: string[] = [];
  await Promise.all(
    list.map(async (url) => {
      try {
        const res = await fetch(url, { method: "HEAD", redirect: "manual" });
        if (res.status >= 300) problems.push(`  ${url} -> ${res.status}`);
      } catch (err) {
        problems.push(`  ${url} -> ${(err as Error).message}`);
      }
    }),
  );
  if (problems.length) {
    fail("These are not live yet:", ...problems, "", "Deploy first, or pass --no-check to submit anyway.");
  }
  const res = await fetch(keyLocation).catch(() => null);
  if (!res?.ok || (await res.text()).trim() !== key) {
    fail(
      `${keyLocation} does not serve the key.`,
      "The key file has to be deployed before a submission is accepted.",
    );
  }
  console.log(green(`  all ${list.length} pages and the key file answer`));
}

if (dryRun) {
  console.log(`\n${yellow("--dry-run")}: nothing was sent.`);
} else {
  if (!noCheck) await checkReachable(urls);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
  });

  /* What the codes mean, from the protocol's own documentation - printed rather
     than swallowed, because a 403 here is silent otherwise. */
  const MEANING: Record<number, string> = {
    200: "accepted",
    202: "accepted - the key is still being validated",
    400: "bad request - the body was rejected",
    403: "the key was not valid for this host",
    422: "a URL does not belong to this host, or the key does not match",
    429: "too many requests - submitting the same pages repeatedly is counted",
  };

  const note = MEANING[res.status] ?? "unexpected response";
  if (res.status === 200 || res.status === 202) {
    console.log(`\n${green(`${res.status} ${note}`)} - ${urls.length} URL(s) submitted.`);
    console.log(dim("Google ignores IndexNow: use Search Console for it."));
  } else {
    const body = await res.text().catch(() => "");
    fail(`${res.status} ${note}`, body.slice(0, 400));
  }
}
