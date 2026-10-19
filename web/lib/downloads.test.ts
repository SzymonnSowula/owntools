import { describe, expect, it, vi } from "vitest";
import { GithubRefused, countDownloads, fetchDownloadCounts, formatCount, showsCount } from "./downloads";

const SLUG = "SzymonnSowula/owntools";

/** What the API listed for this repository on 2026-09-19, trimmed to what we read. */
const RELEASES = [
  {
    tag_name: "v0.3.4",
    published_at: "2026-09-19T14:06:22Z",
    assets: [
      { name: "latest.json", download_count: 2 },
      { name: "owntools_0.3.4_x64-setup.exe", download_count: 2 },
      { name: "owntools_0.3.4_x64-setup.exe.sig", download_count: 1 },
    ],
  },
  {
    tag_name: "v0.3.3",
    published_at: "2026-09-19T10:19:34Z",
    assets: [
      { name: "latest.json", download_count: 4 },
      { name: "owntools_0.3.3_x64-setup.exe", download_count: 3 },
      { name: "owntools_0.3.3_x64-setup.exe.sig", download_count: 1 },
    ],
  },
  {
    tag_name: "v0.3.0",
    published_at: "2026-09-18T07:47:45Z",
    assets: [
      { name: "latest.json", download_count: 1 },
      { name: "owntools_0.3.0_x64-setup.exe", download_count: 4 },
      { name: "owntools_0.3.0_x64-setup.exe.sig", download_count: 0 },
    ],
  },
];

describe("counting downloads", () => {
  it("adds up the installers and leaves out what nobody downloads on purpose", () => {
    const counts = countDownloads(RELEASES);
    expect(counts.total).toBe(9); // 2 + 3 + 4; signatures are not downloads
    expect(counts.windows).toBe(9);
    expect(counts.mac).toBe(0);
    expect(counts.updateChecks).toBe(7); // latest.json: update checks, counted apart
  });

  it("counts a disk image as a download and the macOS updater bundle as neither", () => {
    const counts = countDownloads([
      {
        tag_name: "v0.4.0",
        published_at: "2026-10-01T09:00:00Z",
        assets: [
          { name: "owntools_0.4.0_universal.dmg", download_count: 12 },
          { name: "owntools.app.tar.gz", download_count: 30 },
          { name: "owntools.app.tar.gz.sig", download_count: 30 },
          { name: "owntools_0.4.0_x64-setup.exe", download_count: 5 },
        ],
      },
    ]);
    expect(counts).toMatchObject({ total: 17, windows: 5, mac: 12, updateChecks: 0 });
  });

  it("puts the newest release first and ignores a draft, which is not out yet", () => {
    const counts = countDownloads([
      ...RELEASES,
      {
        tag_name: "v0.3.5",
        published_at: null,
        draft: true,
        assets: [{ name: "owntools_0.3.5_x64-setup.exe", download_count: 3 }],
      },
    ]);
    expect(counts.releases.map((r) => r.tag)).toEqual(["v0.3.4", "v0.3.3", "v0.3.0"]);
    expect(counts.total).toBe(9);
  });

  it("survives a release with no files at all", () => {
    expect(countDownloads([{ tag_name: "v0.1.0", published_at: "2026-01-01T00:00:00Z" }]).total).toBe(0);
  });
});

describe("reading them from GitHub", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("asks page by page and stops at the first short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      tag_name: `v0.0.${i}`,
      published_at: "2026-01-01T00:00:00Z",
      assets: [{ name: `owntools_0.0.${i}_x64-setup.exe`, download_count: 1 }],
    }));
    // "&page=1", not "page=1": "per_page=100" contains that too
    const fetchImpl = vi.fn(async (url: string) => ok(url.includes("&page=1") ? full : RELEASES));
    const counts = await fetchDownloadCounts(SLUG, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain("/repos/SzymonnSowula/owntools/releases?per_page=100&page=1");
    expect(counts.total).toBe(109);
  });

  it("sends the token when there is one, and never a stale cached answer", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ok(RELEASES));
    await fetchDownloadCounts(SLUG, { token: "ghp_x", fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = fetchImpl.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ghp_x");
    expect(init.cache).toBe("no-store");
  });

  it("throws when GitHub refuses, so the caller can say nothing instead of guessing", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limit exceeded", { status: 403 }));
    await expect(
      fetchDownloadCounts(SLUG, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(GithubRefused);
  });
});

describe("showing the number", () => {
  it("waits for the threshold, and stays away when there is none", () => {
    expect(showsCount(13, null)).toBe(false); // unset: the badge is off
    expect(showsCount(13, 250)).toBe(false);
    expect(showsCount(250, 250)).toBe(true);
    expect(showsCount(0, 0)).toBe(false); // nothing to boast about
    expect(showsCount(undefined, 0)).toBe(false);
  });

  it("groups thousands", () => {
    expect(formatCount(1204)).toBe("1,204");
  });
});
