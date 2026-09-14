import { describe, expect, it } from "vitest";
import { billingUrl, healthFromError, waitingPosts } from "./channelHealth";
import { newPost } from "./model";
import { ProviderError } from "./providers";

describe("channel health", () => {
  it("notes sign-in and billing failures on the channel, and nothing else", () => {
    const at = "2026-09-14T14:46:35.000Z";
    expect(healthFromError(new ProviderError("X refused to refresh the session", false, "auth"), at)).toEqual({ kind: "auth", message: "X refused to refresh the session", at });
    expect(healthFromError(new ProviderError("out of API credits", false, "billing"), at)?.kind).toBe("billing");
    // About the post, not the channel: too long, a server hiccup, no network.
    expect(healthFromError(new ProviderError("X: 403: duplicate content", false), at)).toBeNull();
    expect(healthFromError(new TypeError("fetch failed"), at)).toBeNull();
  });

  it("counts the posts a broken channel takes down with it", () => {
    const posts = [
      newPost({ status: "scheduled", channelIds: ["x"] }),
      newPost({ status: "needs_review", channelIds: ["x", "bsky"] }),
      newPost({ status: "published", channelIds: ["x"] }),
      newPost({ status: "scheduled", channelIds: ["bsky"] }),
    ];
    expect(waitingPosts(posts, "x")).toBe(2);
    expect(billingUrl({ provider: "x" })).toBe("https://console.x.com");
    expect(billingUrl({ provider: "bluesky" })).toBeNull();
  });
});
