import { describe, expect, it } from "vitest";
import {
  downloadFallback,
  goesStale,
  isDownloadPlatform,
  pickInstaller,
  repoSlug,
  tagFromLocation,
  windowsInstallerFor,
} from "./download";

const REPO = "https://github.com/SzymonnSowula/owntools";

describe("the download link", () => {
  it("knows a latest-release link with a version in the file name dies with the next release", () => {
    // the link the landing carried while 0.3.1 and 0.3.2 were the latest: a 404
    expect(goesStale(`${REPO}/releases/latest/download/owntools_0.3.0_x64-setup.exe`)).toBe(true);
    expect(goesStale(`${REPO}/releases/latest/download/owntools-setup.exe`)).toBe(false);
    expect(goesStale(`${REPO}/releases/download/v0.3.0/owntools_0.3.0_x64-setup.exe`)).toBe(false);
    expect(goesStale("https://example.com/owntools_0.3.0_x64-setup.exe")).toBe(false);
  });

  it("picks the installer out of a release's files, not its signature or the updater manifest", () => {
    const assets = [
      { name: "latest.json", browser_download_url: "u/latest.json" },
      { name: "owntools_0.3.2_x64-setup.exe.sig", browser_download_url: "u/sig" },
      { name: "owntools_0.3.2_x64-setup.exe", browser_download_url: "u/exe" },
      { name: "owntools_0.3.2_universal.dmg", browser_download_url: "u/dmg" },
      { name: "owntools.app.tar.gz", browser_download_url: "u/tar" },
    ];
    expect(pickInstaller(assets, "windows")?.browser_download_url).toBe("u/exe");
    expect(pickInstaller(assets, "mac")?.browser_download_url).toBe("u/dmg");
    expect(pickInstaller(assets.slice(0, 2), "windows")).toBeNull();
  });

  it("falls back to something that exists", () => {
    expect(downloadFallback(`${REPO}/releases/latest/download/owntools_0.3.0_x64-setup.exe`, REPO)).toBe(
      `${REPO}/releases/latest`,
    );
    expect(downloadFallback("https://cdn.example.com/owntools-setup.exe", REPO)).toBe(
      "https://cdn.example.com/owntools-setup.exe",
    );
    expect(downloadFallback(undefined, `${REPO}/`)).toBe(`${REPO}/releases/latest`);
  });

  it("finds the installer from the tag alone when the API will not answer", () => {
    expect(tagFromLocation(`${REPO}/releases/tag/v0.3.3`)).toBe("v0.3.3");
    expect(tagFromLocation(`${REPO}/releases/tag/v0.3.3/`)).toBe("v0.3.3");
    expect(tagFromLocation(`${REPO}/releases`)).toBeNull(); // no release published yet
    expect(tagFromLocation(null)).toBeNull();
    expect(windowsInstallerFor(`${REPO}/`, "v0.3.3")).toBe(
      `${REPO}/releases/download/v0.3.3/owntools_0.3.3_x64-setup.exe`,
    );
  });

  it("reads the repository out of its address and the platform out of the path", () => {
    expect(repoSlug(REPO)).toBe("SzymonnSowula/owntools");
    expect(repoSlug(`${REPO}.git`)).toBe("SzymonnSowula/owntools");
    expect(repoSlug("https://gitlab.com/a/b")).toBeNull();
    expect(isDownloadPlatform("windows")).toBe(true);
    expect(isDownloadPlatform("mac")).toBe(true);
    expect(isDownloadPlatform("linux")).toBe(false);
  });
});
