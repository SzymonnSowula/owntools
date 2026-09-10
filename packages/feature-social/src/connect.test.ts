import { describe, expect, it } from "vitest";
import { detectPaste, missingFields } from "./connect";
import { networksMirror } from "./networks";

describe("detectPaste", () => {
  it("recognises a Discord webhook anywhere in the paste", () => {
    const m = detectPaste("here you go: https://discord.com/api/webhooks/123456789012345678/aB3-x_YZ token");
    expect(m?.network).toBe("discord");
    expect(m?.confidence).toBe("exact");
    expect(m?.values.webhook).toBe("https://discord.com/api/webhooks/123456789012345678/aB3-x_YZ");
  });

  it("takes discordapp.com and the canary host too", () => {
    expect(detectPaste("https://canary.discordapp.com/api/v10/webhooks/1/abcdef")?.network).toBe("discord");
  });

  it("recognises a Slack incoming webhook", () => {
    const m = detectPaste("https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX");
    expect(m?.network).toBe("slack");
    expect(m?.confidence).toBe("exact");
  });

  it("recognises a self-hosted incoming webhook as Mattermost", () => {
    const m = detectPaste("https://chat.example.com/hooks/xxxxxxxxxxxxxxxxxxxxxxx");
    expect(m?.network).toBe("mattermost");
    expect(m?.values.webhook).toContain("/hooks/");
  });

  it("recognises a Telegram bot token and the channel next to it", () => {
    const m = detectPaste("123456789:AAHqwerty_uiop-ASDFGHJKLzxcvbnm12345\n@owntoolsnews");
    expect(m?.network).toBe("telegram");
    expect(m?.values.token).toBe("123456789:AAHqwerty_uiop-ASDFGHJKLzxcvbnm12345");
    expect(m?.values.chatId).toBe("@owntoolsnews");
  });

  it("reads the chat out of a t.me link", () => {
    const m = detectPaste("token 987654321:BBHqwerty_uiop-ASDFGHJKLzxcvbnm12345 for https://t.me/mychannel");
    expect(m?.values.chatId).toBe("@mychannel");
  });

  it("keeps a numeric supergroup id as it is", () => {
    const m = detectPaste("111222333:CCHqwerty_uiop-ASDFGHJKLzxcvbnm12345 -1001234567890");
    expect(m?.values.chatId).toBe("-1001234567890");
  });

  it("recognises a Bluesky app password with the handle", () => {
    const m = detectPaste("me.bsky.social\nabcd-efgh-ijkl-mnop");
    expect(m?.network).toBe("bluesky");
    expect(m?.confidence).toBe("exact");
    expect(m?.values).toEqual({ password: "abcd-efgh-ijkl-mnop", identifier: "me.bsky.social" });
  });

  it("takes the handle out of a Bluesky profile link", () => {
    const m = detectPaste("https://bsky.app/profile/owntools.app");
    expect(m?.network).toBe("bluesky");
    expect(m?.values.identifier).toBe("owntools.app");
  });

  it("turns a fediverse address into its instance", () => {
    const m = detectPaste("@szymon@mastodon.social");
    expect(m?.network).toBe("mastodon");
    expect(m?.values.instance).toBe("https://mastodon.social");
  });

  it("does not mistake a bsky address written the fediverse way for Mastodon", () => {
    const m = detectPaste("@me@myhandle.bsky.social");
    expect(m?.network).toBe("bluesky");
  });

  it("reads an instance out of a Mastodon profile URL on an unknown host", () => {
    const m = detectPaste("https://pol.social/@ktos");
    expect(m?.network).toBe("mastodon");
    expect(m?.values.instance).toBe("https://pol.social");
  });

  it("maps known hosts to their network as a hint", () => {
    expect(detectPaste("https://x.com/owntoolsapp")?.network).toBe("x");
    expect(detectPaste("https://www.linkedin.com/in/someone/")?.network).toBe("linkedin");
    expect(detectPaste("https://dev.to/szymon")?.network).toBe("devto");
    expect(detectPaste("https://x.com/owntoolsapp")?.confidence).toBe("hint");
  });

  it("says nothing when there is nothing to say", () => {
    expect(detectPaste("")).toBeNull();
    expect(detectPaste("just some words about posting")).toBeNull();
    expect(detectPaste("a".repeat(5000))).toBeNull();
  });
});

describe("missingFields", () => {
  const fields = [
    { key: "token", label: "Bot token" },
    { key: "chatId", label: "Channel or chat" },
    { key: "name", label: "Name", optional: true },
  ];

  it("lists required fields that are still empty", () => {
    expect(missingFields({ token: "x" }, fields)).toEqual(["Channel or chat"]);
    expect(missingFields({ token: "x", chatId: "@c" }, fields)).toEqual([]);
    expect(missingFields({ token: " " }, fields)).toEqual(["Bot token", "Channel or chat"]);
  });
});

/**
 * The Rust agent server reads `networks.json` — this mirror — to answer
 * check_post and list_networks. If a key here is renamed, Rust silently falls
 * back to its small built-in table and starts giving different answers than
 * the composer, which is exactly the kind of drift nobody notices.
 */
describe("networksMirror", () => {
  const byId = Object.fromEntries(networksMirror().networks.map((n) => [n.id as string, n]));

  it("carries the fields plan.rs reads", () => {
    expect(byId.bluesky).toMatchObject({
      id: "bluesky",
      name: "Bluesky",
      availability: "live",
      chars: 300,
      images: 4,
      videos: 1,
      videoBytes: 50 * 1024 * 1024,
      videoSeconds: 180,
    });
    expect(byId.telegram).toMatchObject({ chars: 4096, charsWithMedia: 1024 });
    expect(byId.devto).toMatchObject({ titleRequired: true });
  });

  it("writes an unlimited character count as 0, which Rust reads as “no limit”", () => {
    expect(byId.medium!.chars).toBe(0);
  });

  it("leaves out limits a network does not set", () => {
    expect(byId.mastodon).not.toHaveProperty("videoBytes");
    expect(byId.discord).not.toHaveProperty("videoBytes");
  });
});
