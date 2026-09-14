import { describe, expect, it } from "vitest";
import { accountKey, sameAccount } from "./accounts";
import type { Channel } from "./types";

const ch = (provider: Channel["provider"], meta: Record<string, string>, stub?: boolean) => ({ provider, meta, ...(stub ? { stub } : {}) });

describe("accounts", () => {
  it("names the account from what each network gave at connect time", () => {
    expect(accountKey(ch("x", { userId: "42", username: "a" }))).toBe("42");
    expect(accountKey(ch("bluesky", { did: "did:plc:abc", pds: "https://bsky.social" }))).toBe("did:plc:abc");
    expect(accountKey(ch("mastodon", { instance: "https://mastodon.social", accountId: "7" }))).toBe("https://mastodon.social|7");
    expect(accountKey(ch("mastodon", { instance: "https://mastodon.social" }))).toBeNull();
    expect(accountKey(ch("slack", {}))).toBeNull();
    expect(accountKey(ch("x", { userId: "42" }, true))).toBeNull();
    expect(accountKey(ch("x", { userId: "42", simulated: "true" }))).toBeNull();
  });

  it("tells the same account, another one, and a network that does not say", () => {
    // A renamed X handle is still the same account: the id decides, not the name.
    expect(sameAccount(ch("x", { userId: "42", username: "old" }), ch("x", { userId: "42", username: "new" }))).toBe(true);
    expect(sameAccount(ch("x", { userId: "42" }), ch("x", { userId: "43" }))).toBe(false);
    expect(sameAccount(ch("x", { userId: "42" }), ch("bluesky", { did: "42" }))).toBe(false);
    expect(sameAccount(ch("slack", {}), ch("slack", {}))).toBeNull();
  });
});
