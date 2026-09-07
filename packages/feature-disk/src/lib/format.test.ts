import { describe, expect, it } from "vitest";
import {
  baseName,
  extOf,
  formatBytes,
  formatCount,
  formatDelta,
  formatDuration,
  formatPercent,
  formatRelative,
  pathSegments,
} from "./format";

describe("formatBytes", () => {
  it("uses three significant digits and drops trailing zeros", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(764 * 1024 * 1024)).toBe("764 MB");
    expect(formatBytes(34.4 * 1024 ** 3)).toBe("34.4 GB");
    expect(formatBytes(5.63 * 1024 ** 3)).toBe("5.63 GB");
    expect(formatBytes(117 * 1024 ** 3)).toBe("117 GB");
    expect(formatBytes(2.5 * 1024 ** 4)).toBe("2.5 TB");
    expect(formatBytes(-1)).toBe("—");
  });

  it("signs deltas", () => {
    expect(formatDelta(0)).toBe("0 B");
    expect(formatDelta(1024 ** 3)).toBe("+1 GB");
    expect(formatDelta(-300 * 1024 ** 2)).toBe("−300 MB");
  });
});

describe("counts and percents", () => {
  it("groups thousands", () => {
    expect(formatCount(2082426)).toBe("2,082,426");
    expect(formatCount(7)).toBe("7");
  });
  it("percent edge cases", () => {
    expect(formatPercent(50, 100)).toBe("50.0%");
    expect(formatPercent(100, 100)).toBe("100%");
    expect(formatPercent(1, 100000)).toBe("<0.1%");
    expect(formatPercent(1, 0)).toBe("0%");
  });
});

describe("times", () => {
  it("relative wording", () => {
    const now = 1_800_000_000;
    expect(formatRelative(now - 10, now)).toBe("just now");
    expect(formatRelative(now - 11 * 60, now)).toBe("11 minutes ago");
    expect(formatRelative(now - 3 * 3600, now)).toBe("3 hours ago");
    expect(formatRelative(now - 2 * 86400, now)).toBe("2 days ago");
    expect(formatRelative(now - 400 * 86400, now)).toBe("1 year ago");
    expect(formatRelative(-9e18, now)).toBe("unknown");
  });
  it("durations", () => {
    expect(formatDuration(830)).toBe("830 ms");
    expect(formatDuration(12_600)).toBe("12.6s");
    expect(formatDuration(95_000)).toBe("1m 35s");
  });
});

describe("paths", () => {
  it("extensions and names", () => {
    expect(extOf("Movie.MKV")).toBe("mkv");
    expect(extOf(".gitignore")).toBe("");
    expect(extOf("README")).toBe("");
    expect(baseName("C:\\Users\\szymo\\Downloads\\")).toBe("Downloads");
    expect(baseName("C:\\")).toBe("C:");
    expect(baseName("/")).toBe("/");
    expect(pathSegments("C:\\Users\\szymo")).toEqual(["C:", "Users", "szymo"]);
    expect(pathSegments("/Users/x/Library")).toEqual(["Users", "x", "Library"]);
  });
});
