/**
 * Where "download" leads.
 *
 * The installer's file name carries the version (`owntools_0.3.2_x64-setup.exe`),
 * so a link like `…/releases/latest/download/owntools_0.3.0_x64-setup.exe`
 * works on the day it is written and answers 404 from the next release on -
 * "latest" moved, the name did not. That is what the landing's button did
 * between 0.3.1 and 0.3.2. The buttons now point at `/download/<platform>`,
 * which asks GitHub which installer the latest published release holds and
 * redirects there; the environment variable only says *that* a download
 * exists (and stays the fallback when it is a link that cannot go stale).
 */

export type DownloadPlatform = "windows" | "mac";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

const LATEST_DOWNLOAD = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/latest\/download\/([^/?#]+)$/i;

export function isDownloadPlatform(value: string): value is DownloadPlatform {
  return value === "windows" || value === "mac";
}

/** `owner/name` out of a repository URL, or null when it is not a GitHub one. */
export function repoSlug(repoUrl: string): string | null {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(repoUrl.trim());
  return m ? m[1] : null;
}

/**
 * True for a "latest release" link whose file name names a version: it dies
 * with the next release. A versionless name (`owntools-setup.exe`) or a link
 * under a fixed tag never goes stale and is left alone.
 */
export function goesStale(url: string): boolean {
  const m = LATEST_DOWNLOAD.exec(url.trim());
  return m ? /\d+\.\d+\.\d+/.test(m[2]) : false;
}

/** The installer among a release's files: the NSIS setup on Windows, the disk image on a Mac. */
export function pickInstaller(assets: readonly ReleaseAsset[], platform: DownloadPlatform): ReleaseAsset | null {
  const wanted = platform === "windows" ? /-setup\.exe$/i : /\.dmg$/i;
  return assets.find((a) => wanted.test(a.name)) ?? null;
}

/**
 * The latest *published* release's installer, straight from GitHub. Cached for
 * five minutes by Next's fetch cache, so a busy day is a dozen API calls an
 * hour, far under the 60 an anonymous client gets. Null on any trouble - the
 * caller has somewhere else to send people.
 */
export async function latestInstaller(repoUrl: string, platform: DownloadPlatform): Promise<string | null> {
  const slug = repoSlug(repoUrl);
  if (!slug) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "owntools-site" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const release = (await res.json()) as { assets?: ReleaseAsset[] };
    return pickInstaller(release.assets ?? [], platform)?.browser_download_url ?? null;
  } catch {
    return null;
  }
}

/**
 * Where to send someone when GitHub's API did not answer: the configured link
 * if it cannot have gone stale, else the latest release's page, where the
 * installer is one click away. Never a 404.
 */
export function downloadFallback(configured: string | undefined, repoUrl: string): string {
  if (configured && !goesStale(configured)) return configured;
  return `${repoUrl.replace(/\/$/, "")}/releases/latest`;
}
