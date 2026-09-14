import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, ChannelCredentials, MediaItem } from "../types";
import { HttpError } from "./http";
import { ProviderError, type PublishInput } from "./types";
import { x, xError } from "./x";

/**
 * The failure of 2026-09-14, replayed against a stand-in for api.x.com that
 * retires a refresh token once it is used, like the real one: the refresh
 * succeeded, the media upload answered 402 (no API credits), the rotated
 * tokens were never stored, and every retry presented the dead refresh token
 * — "X refused to refresh the session" next to a channel that said live.
 */

function reply(status: number, body: unknown = ""): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text } as unknown as Response;
}

const channel: Channel = {
  id: "ch_x",
  provider: "x",
  handle: "@thelostbooks1",
  displayName: "The Lost Books",
  avatar: null,
  collection: "Personal",
  disabled: false,
  preferences: {},
  meta: { userId: "2054016806772252673", username: "thelostbooks1" },
  createdAt: "",
  updatedAt: "",
};

const image: MediaItem = { id: "m1", file: "media/m1.jpg", name: "m1.jpg", mime: "image/jpeg", bytes: 3, createdAt: "" };

/**
 * A stand-in for X. Token names are unique per instance, because the
 * provider remembers rotations for as long as the module lives.
 */
function fakeX() {
  const tag = `t${Math.random().toString(36).slice(2)}`;
  const firstRefreshToken = `${tag}-rt0`;
  const live = new Set([firstRefreshToken]);
  const state = { credits: false, issued: 0, tokenCalls: 0, tweets: 0 };
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      state.tokenCalls += 1;
      const used = new URLSearchParams(typeof init?.body === "string" ? init.body : "").get("refresh_token") ?? "";
      // The answer takes a moment, so two callers can overlap.
      await new Promise((r) => setTimeout(r, 5));
      if (!live.delete(used)) return reply(400, { error: "invalid_request", error_description: "Value passed for the token was invalid." });
      state.issued += 1;
      const next = `${tag}-rt${state.issued}`;
      live.add(next);
      return reply(200, { access_token: `${tag}-at${state.issued}`, refresh_token: next, expires_in: 7200, token_type: "bearer" });
    }
    // The token endpoint is free; everything else draws on the credit balance.
    if (!state.credits) return reply(402, { detail: "credits depleted" });
    if (url.endsWith("/media/upload/initialize")) return reply(200, { data: { id: "media1" } });
    if (url.includes("/media/upload/media1/append")) return reply(204);
    if (url.endsWith("/media/upload/media1/finalize")) return reply(200, { data: { id: "media1" } });
    if (url.endsWith("/users/me")) return reply(200, { data: { id: channel.meta.userId, username: "thelostbooks1", name: "The Lost Books" } });
    if (url.endsWith("/tweets")) {
      state.tweets += 1;
      return reply(201, { data: { id: `tweet${state.tweets}` } });
    }
    return reply(404, { detail: `no route for ${url}` });
  });
  return { fetch, state, firstRefreshToken };
}

const expired = (refreshToken: string): ChannelCredentials => ({
  clientId: "client",
  accessToken: "stale",
  refreshToken,
  expiresAt: new Date(Date.now() - 60_000).toISOString(),
});

function input(creds: ChannelCredentials, saveCreds?: PublishInput["saveCreds"]): PublishInput {
  return {
    channel,
    creds,
    content: { text: "Now read the man in the tombs again.", media: [{ id: "m1" }], thread: [] },
    media: [{ item: image, bytes: new Uint8Array([1, 2, 3]) }],
    threadMedia: [],
    saveCreds,
  };
}

describe("x provider and rotating refresh tokens", () => {
  let server: ReturnType<typeof fakeX>;

  beforeEach(() => {
    server = fakeX();
    vi.stubGlobal("fetch", server.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores rotated tokens before a later call fails, so the next attempt still has a session", async () => {
    const saved: ChannelCredentials[] = [];
    const save = async (c: ChannelCredentials) => void saved.push(c);

    const failure = await x.publish(input(expired(server.firstRefreshToken), save)).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ kind: "billing", retryable: false });
    expect((failure as Error).message).toContain("console.x.com");
    // The refresh worked and its result reached storage before the 402.
    expect(saved).toHaveLength(1);
    expect(saved[0]!.refreshToken).not.toBe(server.firstRefreshToken);

    // Credits added; the stored tokens publish without another refresh.
    server.state.credits = true;
    const out = await x.publish(input(saved[0]!, save));
    expect(out.url).toBe("https://x.com/thelostbooks1/status/tweet1");
    expect(server.state.tokenCalls).toBe(1);
  });

  it("hands a caller holding a copy from before the rotation the rotated tokens instead of spending a dead one", async () => {
    server.state.credits = true;
    const stale = expired(server.firstRefreshToken);
    await x.publish(input(stale));
    const again = await x.publish(input(stale));
    expect(again.creds?.refreshToken).toBe(`${server.firstRefreshToken.replace(/-rt0$/, "")}-rt1`);
    expect(server.state.tokenCalls).toBe(1);
    expect(server.state.tweets).toBe(2);
  });

  it("refreshes once when two posts to the same channel go out together", async () => {
    server.state.credits = true;
    const stale = expired(server.firstRefreshToken);
    const [a, b] = await Promise.all([x.publish(input(stale)), x.publish(input(stale))]);
    expect(server.state.tokenCalls).toBe(1);
    expect(a.creds?.accessToken).toBe(b.creds?.accessToken);
    expect(server.state.tweets).toBe(2);
  });

  it("calls a refused refresh a sign-in problem and keeps X's reason", async () => {
    server.state.credits = true;
    const err = await x.publish(input(expired("never-issued"))).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "auth", retryable: false });
    expect((err as Error).message).toContain("Value passed for the token was invalid.");
  });

  it("saves rotated tokens from Test connection too", async () => {
    server.state.credits = true;
    const saved: ChannelCredentials[] = [];
    const r = await x.verify!(channel, expired(server.firstRefreshToken), async (c) => void saved.push(c));
    expect(r.ok).toBe(true);
    expect(saved).toHaveLength(1);
  });
});

describe("xError", () => {
  it("reads X's status codes the way a person needs them", () => {
    expect(xError(new HttpError(402, "402: credits depleted", ""), "X")).toMatchObject({ kind: "billing", retryable: false });
    expect(xError(new HttpError(401, "401: Unauthorized", ""), "X")).toMatchObject({ kind: "auth", retryable: false });
    const busy = xError(new HttpError(503, "503: Service Unavailable", ""), "X media upload") as ProviderError;
    expect(busy.retryable).toBe(true);
    expect(busy.kind).toBeUndefined();
    expect(busy.message).toBe("X media upload: 503: Service Unavailable");
    const offline = new TypeError("fetch failed");
    expect(xError(offline, "X")).toBe(offline);
  });
});
