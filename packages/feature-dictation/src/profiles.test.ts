import { describe, expect, it } from "vitest";
import {
  appBasename,
  createProfile,
  describeProfile,
  matchProfile,
  MODE_INSTRUCTIONS,
  patternScore,
  PROFILE_MODES,
  removeProfile,
  sanitizeProfiles,
  STARTER_PROFILES,
  upsertProfile,
  type AppProfile,
} from "./profiles";

const slack: AppProfile = { id: "a", appPattern: "slack", removeFillers: true };
const slackExe: AppProfile = { id: "b", appPattern: "slack.exe", mode: "casual" };
const anyCode: AppProfile = { id: "c", appPattern: "code*", mode: "formal" };
const inbox: AppProfile = { id: "d", appPattern: "inbox", mode: "email" };

describe("pattern matching", () => {
  it("matches a plain word as a case-insensitive substring of the process name", () => {
    expect(patternScore("slack", { app: "Slack.exe", title: null })).not.toBeNull();
    expect(patternScore("slack", { app: "C:\\Apps\\Slack\\slack.exe", title: null })).not.toBeNull();
    expect(patternScore("slack", { app: "Code.exe", title: "notes.md" })).toBeNull();
  });

  it("treats * and ? as a glob over the whole name, .exe optional", () => {
    expect(patternScore("code*", { app: "Code.exe", title: null })).not.toBeNull();
    expect(patternScore("code*", { app: "Code - Insiders.exe", title: null })).not.toBeNull();
    expect(patternScore("c?de", { app: "code.exe", title: null })).not.toBeNull();
    expect(patternScore("code*", { app: "vscode.exe", title: null })).toBeNull();
    expect(patternScore("*outlook*", { app: "olk.exe", title: "Inbox - Outlook" })).not.toBeNull();
  });

  it("falls back to the window title", () => {
    expect(patternScore("inbox", { app: "chrome.exe", title: "Inbox (3) - Gmail" })).not.toBeNull();
    expect(patternScore("inbox", { app: "chrome.exe", title: "YouTube" })).toBeNull();
  });

  it("ranks an exact process name over a glob over a substring over a title", () => {
    const exact = patternScore("slack.exe", { app: "slack.exe", title: "general - Slack" })!;
    // ".exe" is optional, so the bare name is exact too.
    const bare = patternScore("slack", { app: "slack.exe", title: "general - Slack" })!;
    const glob = patternScore("sla*", { app: "slack.exe", title: "general - Slack" })!;
    const sub = patternScore("lack", { app: "slack.exe", title: "general - Slack" })!;
    const title = patternScore("general", { app: "slack.exe", title: "general - Slack" })!;
    expect(exact).toBeGreaterThan(glob);
    expect(bare).toBeGreaterThan(glob);
    expect(glob).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(title);
  });
});

describe("matchProfile", () => {
  it("picks the most specific profile and keeps list order on ties", () => {
    const profiles = [slack, slackExe, anyCode, inbox];
    expect(matchProfile(profiles, { app: "slack.exe", title: "general" })?.id).toBe("b");
    expect(matchProfile(profiles, { app: "Code.exe", title: "engine.ts" })?.id).toBe("c");
    expect(matchProfile(profiles, { app: "chrome.exe", title: "Inbox - Gmail" })?.id).toBe("d");
    expect(matchProfile(profiles, { app: "notepad.exe", title: "Untitled" })).toBeNull();
    // Two substrings of equal weight: the earlier one wins.
    const tie = [{ id: "x", appPattern: "chrom" }, { id: "y", appPattern: "rome." }];
    expect(matchProfile(tie, { app: "chrome.exe", title: null })?.id).toBe("x");
  });

  it("matches nothing when the foreground app is unknown", () => {
    expect(matchProfile([slack], { app: null, title: null })).toBeNull();
  });
});

describe("sanitizeProfiles", () => {
  it("drops rows without a pattern and unknown modes, keeps valid fields", () => {
    const out = sanitizeProfiles([
      { id: "1", appPattern: "  slack  ", removeFillers: true, mode: "email", autoSend: true },
      { id: "2", appPattern: "", mode: "email" },
      { id: "3", appPattern: "code", mode: "shouty", autoSend: "yes" },
      { id: "1", appPattern: "dup id" },
      "nonsense",
      null,
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ id: "1", appPattern: "slack", removeFillers: true, mode: "email", autoSend: true });
    expect(out[1]).toEqual({ id: "3", appPattern: "code" });
    expect(out[2].appPattern).toBe("dup id");
    expect(out[2].id).not.toBe("1");
    expect(sanitizeProfiles(undefined)).toEqual([]);
    expect(sanitizeProfiles("x")).toEqual([]);
  });

  it("stores 'plain' as no mode at all", () => {
    expect(sanitizeProfiles([{ id: "1", appPattern: "a", mode: "plain" }])[0].mode).toBeUndefined();
  });
});

describe("editing", () => {
  it("creates, upserts in place and removes", () => {
    expect(createProfile("   ")).toBeNull();
    const p = createProfile("outlook", { mode: "email" })!;
    expect(p.appPattern).toBe("outlook");
    let list = upsertProfile([slack], p);
    expect(list.map((x) => x.id)).toEqual(["a", p.id]);
    list = upsertProfile(list, { ...p, autoSend: true });
    expect(list).toHaveLength(2);
    expect(list[1].autoSend).toBe(true);
    expect(removeProfile(list, "a").map((x) => x.id)).toEqual([p.id]);
  });

  it("describes a profile in words and knows the starters and modes", () => {
    expect(describeProfile({ id: "1", appPattern: "x" })).toBe("as dictated");
    expect(describeProfile({ id: "1", appPattern: "x", removeFillers: true, mode: "email", autoSend: true })).toBe(
      "remove fillers · e-mail tone · presses Enter",
    );
    expect(STARTER_PROFILES.map((s) => s.label)).toContain("Slack: remove fillers");
    expect(STARTER_PROFILES.map((s) => s.label)).toContain("Outlook: e-mail tone");
    for (const mode of PROFILE_MODES) {
      if (mode.id === "plain") continue;
      expect(MODE_INSTRUCTIONS[mode.id]).toMatch(/Return only the rewritten text/);
    }
    expect(appBasename("/Applications/Slack.app/Contents/MacOS/Slack")).toBe("Slack");
  });
});
