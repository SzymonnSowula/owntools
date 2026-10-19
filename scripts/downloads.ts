/**
 * `pnpm downloads` - how many times the app has been downloaded, per release.
 *
 * Reads GitHub's own per-file counts (web/lib/downloads.ts is the same module
 * the site's /api/downloads uses, so the terminal and the landing can never
 * disagree). Nothing is written anywhere; it is a look, not a step.
 *
 *   pnpm downloads            the table
 *   pnpm downloads --json     the same numbers as JSON
 *
 * A `GITHUB_TOKEN` in web/.env.local (any read-only token - the repository is
 * public) raises GitHub's anonymous 60-calls-an-hour limit to 5,000.
 */

import { repoSlug } from "../web/lib/download.ts";
import { fetchDownloadCounts, formatCount } from "../web/lib/downloads.ts";
import { bold, dim, fail, green, setting, yellow } from "./lib/polar-cli.ts";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const repo = setting("NEXT_PUBLIC_REPO_URL") ?? "https://github.com/SzymonnSowula/owntools";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const pad = (text: string, width: number) => text.padStart(width);

const slug = repoSlug(repo) ?? fail(`${repo} is not a GitHub repository - check NEXT_PUBLIC_REPO_URL.`);
const counts = await fetchDownloadCounts(slug, { token: setting("GITHUB_TOKEN") }).catch((err: Error) => {
  fail(
    err.message,
    "GitHub allows 60 API calls an hour to an address without a token.",
    "Put a read-only GITHUB_TOKEN in web/.env.local to raise it, or try again later.",
  );
});

if (asJson) {
  console.log(JSON.stringify(counts, null, 2));
} else {
  const mac = counts.mac > 0;
  console.log(`\n${bold("owntools downloads")} ${dim(repo.replace(/^https:\/\//, ""))}\n`);
  console.log(dim(`  ${"release".padEnd(10)}${"published".padEnd(13)}${pad("windows", 8)}${mac ? pad("mac", 7) : ""}${pad("total", 8)}`));
  for (const release of counts.releases) {
    console.log(
      `  ${release.tag.padEnd(10)}${dim(day(release.published).padEnd(13))}` +
        `${pad(formatCount(release.windows), 8)}${mac ? pad(formatCount(release.mac), 7) : ""}${pad(formatCount(release.downloads), 8)}`,
    );
  }
  console.log(dim(`  ${"─".repeat(mac ? 46 : 39)}`));
  console.log(
    `  ${bold("all".padEnd(23))}${pad(formatCount(counts.windows), 8)}` +
      `${mac ? pad(formatCount(counts.mac), 7) : ""}${green(pad(formatCount(counts.total), 8))}\n`,
  );

  console.log(`  ${formatCount(counts.updateChecks)} update checks ${dim("(latest.json - roughly how often an installed build asked)")}`);
  console.log(dim("  Downloads include updates: the updater fetches the same installer file a visitor does."));

  const min = setting("NEXT_PUBLIC_DOWNLOADS_MIN");
  const threshold = min === undefined ? null : Number(min);
  if (threshold === null || !Number.isFinite(threshold)) {
    console.log(
      `  ${yellow("!")} The landing shows no counter: NEXT_PUBLIC_DOWNLOADS_MIN is unset ` +
        dim("(set it to the number that makes it worth showing)"),
    );
  } else if (counts.total >= threshold) {
    console.log(`  The landing shows "${formatCount(counts.total)} downloads" ${dim(`(from ${formatCount(threshold)})`)}`);
  } else {
    console.log(
      `  The landing shows no counter yet: ${formatCount(counts.total)} of the ${formatCount(threshold)} it waits for.`,
    );
  }
  console.log("");
}
