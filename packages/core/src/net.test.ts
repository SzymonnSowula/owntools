import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OfflineMode,
  bodySize,
  classify,
  clearMemoryLog,
  isLoopback,
  isPrivateNetwork,
  memoryEntries,
  monthOf,
  noteRequest,
  offlineMode,
  setOfflineMode,
  shiftMonth,
  summarize,
  trackedFetch,
  type NetEntry,
} from "./net";

/** A Response-shaped object: jsdom has no Response of its own and the wrapper only reads these. */
function fakeResponse(status: number, headers: Record<string, string> = {}): Response {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
  } as unknown as Response;
}

const u = (s: string) => new URL(s);

describe("classification", () => {
  it("knows the machine talking to itself", () => {
    expect(isLoopback(u("http://localhost:7474/mcp"))).toBe(true);
    expect(isLoopback(u("https://tauri.localhost/"))).toBe(true);
    expect(isLoopback(u("http://127.0.0.1:11434/v1/chat/completions"))).toBe(true);
    expect(isLoopback(u("http://127.42.0.9/"))).toBe(true);
    expect(isLoopback(u("http://[::1]:8080/"))).toBe(true);
    expect(isLoopback(u("https://bsky.social/xrpc/x"))).toBe(false);
    expect(isLoopback(u("http://localhost.evil.com/"))).toBe(false);
  });

  it("treats the LAN as local and everything else as cloud", () => {
    expect(isPrivateNetwork(u("http://10.0.0.5:1234/"))).toBe(true);
    expect(isPrivateNetwork(u("http://172.16.0.1/"))).toBe(true);
    expect(isPrivateNetwork(u("http://172.31.255.254/"))).toBe(true);
    expect(isPrivateNetwork(u("http://172.32.0.1/"))).toBe(false);
    expect(isPrivateNetwork(u("http://192.168.1.10:8000/"))).toBe(true);
    expect(isPrivateNetwork(u("http://[fd12:3456::1]/"))).toBe(true);
    expect(isPrivateNetwork(u("http://8.8.8.8/"))).toBe(false);
    expect(classify(u("http://192.168.1.10/"))).toBe("local");
    expect(classify(u("http://localhost/"))).toBe("local");
    expect(classify(u("https://huggingface.co/x"))).toBe("cloud");
    expect(classify(u("https://api.anthropic.com/v1/messages"))).toBe("cloud");
  });
});

describe("body sizes", () => {
  it("counts payload bytes for the body shapes callers use", () => {
    expect(bodySize(undefined)).toBe(0);
    expect(bodySize(null)).toBe(0);
    expect(bodySize("hello")).toBe(5);
    expect(bodySize("zażółć")).toBe(10);
    expect(bodySize(new Uint8Array(1234))).toBe(1234);
    expect(bodySize(new ArrayBuffer(77))).toBe(77);
    expect(bodySize(new Blob([new Uint8Array(500)]))).toBe(500);
    expect(bodySize(new URLSearchParams({ a: "1", b: "żż" }))).toBe("a=1&b=%C5%BB%C5%BB".length);
  });

  it("sums the parts of a multipart form", () => {
    const form = new FormData();
    form.append("text", "hi");
    form.append("file", new File([new Uint8Array(300)], "a.png", { type: "image/png" }));
    expect(bodySize(form)).toBe(4 + 2 + 4 + 300);
  });

  it("gives up honestly on a stream", () => {
    if (typeof ReadableStream === "undefined") return;
    expect(bodySize(new ReadableStream())).toBeNull();
  });
});

describe("trackedFetch", () => {
  const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    clearMemoryLog();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await setOfflineMode(false);
    vi.unstubAllGlobals();
  });

  it("performs the request and notes host, purpose, sizes and status", async () => {
    fetchMock.mockResolvedValue(fakeResponse(201, { "Content-Length": "42" }));
    const res = await trackedFetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "post",
      body: JSON.stringify({ text: "hello" }),
      purpose: "post to Bluesky",
    });
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The wrapper's own fields never reach the transport.
    const passed = fetchMock.mock.calls[0][1] as Record<string, unknown>;
    expect("purpose" in passed).toBe(false);
    expect("destination" in passed).toBe(false);
    const [entry] = memoryEntries();
    expect(entry).toMatchObject({
      host: "bsky.social",
      method: "POST",
      bytesOut: JSON.stringify({ text: "hello" }).length,
      bytesIn: 42,
      purpose: "post to Bluesky",
      ok: true,
      status: 201,
      kind: "cloud",
    });
    expect(typeof entry.ts).toBe("number");
  });

  it("logs an unknown answer size as null rather than guessing", async () => {
    fetchMock.mockResolvedValue(fakeResponse(200));
    await trackedFetch("https://www.youtube.com/youtubei/v1/player", { purpose: "YouTube transcript" });
    expect(memoryEntries()[0].bytesIn).toBeNull();
    expect(memoryEntries()[0].bytesOut).toBe(0);
  });

  it("notes a request that got no answer — it did leave — and rethrows", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(trackedFetch("https://owntools.app/api/share", { method: "POST", body: "x", purpose: "share link" })).rejects.toThrow(
      "Failed to fetch",
    );
    expect(memoryEntries()[0]).toMatchObject({ host: "owntools.app", ok: false, status: null, bytesOut: 1, bytesIn: null });
  });

  it("classifies loopback as local", async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { "content-length": "10" }));
    await trackedFetch("http://127.0.0.1:8081/v1/chat/completions", { method: "POST", body: "{}", purpose: "meeting summary" });
    expect(memoryEntries()[0]).toMatchObject({ host: "127.0.0.1", kind: "local" });
  });

  it("logs the real destination when the request goes through a relay", async () => {
    fetchMock.mockResolvedValue(fakeResponse(200));
    await trackedFetch("/__proxy?url=https%3A%2F%2Fwww.youtube.com%2Fwatch", {
      purpose: "YouTube transcript",
      destination: "https://www.youtube.com/watch?v=abc",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/__proxy?url=https%3A%2F%2Fwww.youtube.com%2Fwatch");
    expect(memoryEntries()[0]).toMatchObject({ host: "www.youtube.com", kind: "cloud" });
  });

  it("refuses non-local requests before sending while Offline mode is on", async () => {
    await setOfflineMode(true);
    expect(offlineMode()).toBe(true);
    let caught: unknown;
    try {
      await trackedFetch("https://bsky.social/xrpc/x", { purpose: "post to Bluesky" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OfflineMode);
    expect((caught as Error).message).toBe("Offline mode is on — 'post to Bluesky' was not sent.");
    expect((caught as OfflineMode).purpose).toBe("post to Bluesky");
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing left the machine, so nothing is in the log.
    expect(memoryEntries()).toHaveLength(0);
  });

  it("still lets the machine talk to itself in Offline mode", async () => {
    await setOfflineMode(true);
    fetchMock.mockResolvedValue(fakeResponse(200));
    await trackedFetch("http://localhost:11434/api/tags", { purpose: "local model" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(memoryEntries()[0].kind).toBe("local");
  });

  it("mirrors the flag in localStorage and comes back off", async () => {
    await setOfflineMode(true);
    expect(localStorage.getItem("owntools-offline")).toBe("1");
    await setOfflineMode(false);
    expect(localStorage.getItem("owntools-offline")).toBe("0");
    expect(offlineMode()).toBe(false);
  });
});

describe("noteRequest", () => {
  beforeEach(clearMemoryLog);

  it("classifies from the host when no kind is given and upper-cases the method", () => {
    const a = noteRequest({ host: "github.com", method: "get", bytesOut: 0, bytesIn: null, purpose: "update check", ok: true, status: null });
    const b = noteRequest({ host: "127.0.0.1", method: "post", bytesOut: 5, bytesIn: 5, purpose: "local", ok: true, status: 200 });
    expect(a.kind).toBe("cloud");
    expect(a.method).toBe("GET");
    expect(b.kind).toBe("local");
    expect(memoryEntries()).toHaveLength(2);
  });
});

describe("months", () => {
  it("uses the local calendar month", () => {
    const d = new Date(2026, 8, 11, 23, 30);
    expect(monthOf(d.getTime())).toBe("2026-09");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("summarize", () => {
  const sep = (day: number, hour = 12) => new Date(2026, 8, day, hour).getTime();
  const aug = new Date(2026, 7, 20).getTime();
  const e = (over: Partial<NetEntry>): NetEntry => ({
    ts: sep(1),
    host: "bsky.social",
    method: "POST",
    bytesOut: 100,
    bytesIn: 50,
    purpose: "post to Bluesky",
    ok: true,
    status: 200,
    kind: "cloud",
    ...over,
  });

  it("keeps the headline to what left the machine this month, grouped by host + purpose", () => {
    const s = summarize(
      [
        e({}),
        e({ ts: sep(2), bytesOut: 300, bytesIn: null, ok: false, status: 500 }),
        e({ host: "huggingface.co", purpose: "whisper model download", method: "GET", bytesOut: 0, bytesIn: 600_000_000, ts: sep(3) }),
        e({ host: "127.0.0.1", purpose: "meeting summary", kind: "local", bytesOut: 5000, bytesIn: 2000 }),
        e({ ts: aug, bytesOut: 999 }),
      ],
      "2026-09",
    );
    expect(s.requests).toBe(3);
    expect(s.cloudRequests).toBe(3);
    expect(s.localRequests).toBe(1);
    expect(s.bytesOut).toBe(400);
    expect(s.bytesIn).toBe(600_000_050);
    expect(s.unknownIn).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.byHost).toHaveLength(2);
    expect(s.byHost[0]).toMatchObject({ host: "huggingface.co", requests: 1, bytesIn: 600_000_000 });
    expect(s.byHost[1]).toMatchObject({ host: "bsky.social", purpose: "post to Bluesky", requests: 2, failed: 1, bytesOut: 400, bytesIn: 50, unknownIn: 1, last: sep(2) });
    expect(s.local).toHaveLength(1);
    expect(s.local[0]).toMatchObject({ host: "127.0.0.1", kind: "local", bytesOut: 5000 });
  });

  it("is empty for a quiet month", () => {
    const s = summarize([e({ ts: aug })], "2026-09");
    expect(s).toMatchObject({ requests: 0, bytesOut: 0, bytesIn: 0, byHost: [], local: [] });
  });
});
