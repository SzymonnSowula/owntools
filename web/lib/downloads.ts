/**
 * How many times the app has been downloaded.
 *
 * GitHub already counts it: every file on a release carries a
 * `download_count`, and that number is a *file that was actually fetched* -
 * from the landing's `/download/<platform>` redirect, from a link someone
 * pasted, from the release page. A click counter on our own route would count
 * intentions instead, and would need a database the rest of this site does
 * without.
 *
 * Two things the number is not:
 *
 * - **unique people.** One person who downloads twice counts twice, and so
 *   does every mirror and bot that fetches the installer.
 * - **free of updates.** The updater pulls the very same installer file as a
 *   human does (tauri.conf.json → `releases/latest/download/latest.json`,
 *   which points at that asset), so an update is one more "download". To keep
 *   them apart, release.yml would have to upload a second copy under its own
 *   name for the updater to use.
 *
 * `latest.json` is counted separately: every start of an installed build asks
 * for it, so it is a rough "how many installs are alive", not a download.
 */

/** A file on a release, as the API lists it. */
export interface CountedAsset {
  name: string;
  download_count: number;
}

/** A release, as the API lists it (only the fields this module reads). */
export interface CountedRelease {
  tag_name: string;
  published_at?: string | null;
  draft?: boolean;
  assets?: CountedAsset[];
}

export interface ReleaseDownloads {
  tag: string;
  published: string | null;
  windows: number;
  mac: number;
  downloads: number;
}

export interface DownloadCounts {
  /** Installers fetched, every published release together. */
  total: number;
  windows: number;
  mac: number;
  /** `latest.json` fetches: update checks, not downloads. */
  updateChecks: number;
  /** Newest release first. */
  releases: ReleaseDownloads[];
  /** When this was read from GitHub (ISO). */
  asOf: string;
}

const WINDOWS_INSTALLER = /-setup\.exe$/i;
const MAC_INSTALLER = /\.dmg$/i;
const UPDATE_MANIFEST = /^latest\.json$/i;

/**
 * What a release's files add up to. Signatures (`.sig`), the updater manifest
 * and the macOS updater bundle (`.app.tar.gz`) are not downloads - nobody
 * fetches one on purpose.
 */
export function countRelease(release: CountedRelease): ReleaseDownloads & { updateChecks: number } {
  let windows = 0;
  let mac = 0;
  let updateChecks = 0;
  for (const asset of release.assets ?? []) {
    const count = Number.isFinite(asset.download_count) ? asset.download_count : 0;
    if (WINDOWS_INSTALLER.test(asset.name)) windows += count;
    else if (MAC_INSTALLER.test(asset.name)) mac += count;
    else if (UPDATE_MANIFEST.test(asset.name)) updateChecks += count;
  }
  return {
    tag: release.tag_name,
    published: release.published_at ?? null,
    windows,
    mac,
    downloads: windows + mac,
    updateChecks,
  };
}

/** Every published release added up, newest first. Drafts do not count - they are not out. */
export function countDownloads(releases: readonly CountedRelease[], asOf = new Date()): DownloadCounts {
  const counted = releases.filter((r) => !r.draft).map(countRelease);
  counted.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
  const sum = (pick: (r: (typeof counted)[number]) => number) => counted.reduce((n, r) => n + pick(r), 0);
  return {
    total: sum((r) => r.downloads),
    windows: sum((r) => r.windows),
    mac: sum((r) => r.mac),
    updateChecks: sum((r) => r.updateChecks),
    releases: counted.map(({ updateChecks: _drop, ...rest }) => rest),
    asOf: asOf.toISOString(),
  };
}

export class GithubRefused extends Error {
  status: number;

  constructor(status: number, detail: string) {
    super(`GitHub answered ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "GithubRefused";
    this.status = status;
  }
}

/**
 * Every release of the repository, by `owner/name` (lib/download.ts
 * `repoSlug` turns the configured URL into one). This module is imported by
 * `scripts/downloads.ts`, which runs on Node's type stripping and resolves no
 * extensionless imports - so it stays free of sibling imports.
 *
 * Anonymous callers get 60 API calls an hour *per address* and a host's
 * addresses are shared, so this throws rather than guessing when GitHub
 * refuses - the caller then says nothing instead of showing a wrong number.
 * `GITHUB_TOKEN` (any read-only token; the repository is public) raises the
 * limit to 5,000.
 */
export async function fetchDownloadCounts(
  slug: string,
  options: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<DownloadCounts> {
  const call = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "owntools-site",
    "x-github-api-version": "2022-11-28",
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const releases: CountedRelease[] = [];
  // 100 releases a page; the loop stops at the first short page. Five pages is
  // 500 releases - far past anything this repository will have.
  for (let page = 1; page <= 5; page++) {
    const res = await call(`https://api.github.com/repos/${slug}/releases?per_page=100&page=${page}`, {
      headers,
      // The one cache is the route's, at the CDN. Two layers kept a stale
      // installer on the download button for ten minutes once.
      cache: "no-store",
    });
    if (!res.ok) throw new GithubRefused(res.status, (await res.text().catch(() => "")).slice(0, 200));
    const batch = (await res.json()) as CountedRelease[];
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return countDownloads(releases);
}

/** "1,204" - the grouping a visitor expects, in the site's one language. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Whether the number is worth showing.
 *
 * A download counter is social proof above some size and an argument against
 * buying below it, so the landing only shows one once it passes
 * `NEXT_PUBLIC_DOWNLOADS_MIN`. Unset means never: the badge stays off until
 * someone decides it helps.
 */
export function showsCount(total: number | null | undefined, min: number | null | undefined): boolean {
  return typeof total === "number" && total > 0 && typeof min === "number" && total >= min;
}
