import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareConfig } from "./share";
import {
  PART_SIZE,
  PENDING_MAX_AGE_MS,
  allowedOrigin,
  attachmentDisposition,
  bucketUsage,
  buildMeta,
  cleanName,
  corsHeaders,
  finiteNumber,
  fullReason,
  isExpired,
  isPendingStale,
  isValidId,
  looksLikeJpeg,
  looksLikeVideo,
  measureUsage,
  mediaKey,
  mediaUrl,
  newId,
  newToken,
  noteUpload,
  noteUsage,
  objectKey,
  parseListing,
  resetUsageCache,
  serveAsFor,
  sha256Hex,
  shareConfig,
  shareTtlDays,
  timingSafeEqualHex,
} from "./share";

describe("share ids and tokens", () => {
  it("makes unambiguous, url-safe ids", () => {
    for (let i = 0; i < 50; i++) {
      const id = newId();
      expect(id).toHaveLength(12);
      expect(isValidId(id)).toBe(true);
      expect(id).not.toMatch(/[01ilo]/);
    }
    expect(isValidId("../etc")).toBe(false);
    expect(isValidId("ABC")).toBe(false);
    expect(isValidId("abc")).toBe(false);
  });

  it("hashes owner tokens deterministically", async () => {
    const token = newToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(token)).toBe(await sha256Hex(token));
    expect(await sha256Hex(token)).not.toBe(await sha256Hex(newToken()));
  });

  it("keys every file under the share's folder", () => {
    expect(objectKey("abc123", "video.mp4")).toBe("shares/abc123/video.mp4");
    expect(PART_SIZE).toBe(8 * 1024 * 1024);
  });
});

describe("media addresses", () => {
  const meta = { id: "abcdefghij", ext: "mp4" as const, poster: false };

  it("lives at a stable address under the link", () => {
    expect(mediaUrl("abcdefghij", "video.mp4")).toMatch(/\/v\/abcdefghij\/video\.mp4$/);
  });

  it("only ever reaches the share's own video and poster", () => {
    expect(mediaKey(meta, "video.mp4")).toBe("shares/abcdefghij/video.mp4");
    expect(mediaKey(meta, "video.webm")).toBeNull();
    expect(mediaKey(meta, "poster.jpg")).toBeNull();
    expect(mediaKey({ ...meta, poster: true }, "poster.jpg")).toBe("shares/abcdefghij/poster.jpg");
    for (const file of ["meta.json", "pending.json", "../meta.json", "", "video.mp4/"]) {
      expect(mediaKey({ ...meta, poster: true }, file)).toBeNull();
    }
  });

  it("downloads under the share's name, with an ASCII fallback", () => {
    expect(attachmentDisposition("Demo & wyniki - ćwiczenie 2", "mp4")).toBe(
      `attachment; filename="Demo & wyniki - cwiczenie 2.mp4"; filename*=UTF-8''Demo%20%26%20wyniki%20-%20%C4%87wiczenie%202.mp4`,
    );
    expect(attachmentDisposition('Łódź: "plan" / Q3', "webm")).toBe(
      `attachment; filename="Lodz plan Q3.webm"; filename*=UTF-8''%C5%81%C3%B3d%C5%BA%20plan%20Q3.webm`,
    );
    expect(attachmentDisposition("it's (final)*", "mp4")).toBe(
      `attachment; filename="it's (final).mp4"; filename*=UTF-8''it%27s%20%28final%29.mp4`,
    );
    expect(attachmentDisposition("  ", "mp4")).toBe(`attachment; filename="recording.mp4"; filename*=UTF-8''recording.mp4`);
    // a header value has to stay printable ASCII whatever the name was
    expect(attachmentDisposition("日本語 🎬", "mp4")).toMatch(/^[ -~]+$/);
  });
});

describe("input cleaning", () => {
  it("bounds names and numbers", () => {
    expect(cleanName("  My   take ")).toBe("My take");
    expect(cleanName("")).toBe("Recording");
    expect(cleanName(42)).toBe("Recording");
    expect(cleanName("x".repeat(500))).toHaveLength(120);
    expect(finiteNumber("3")).toBe(0);
    expect(finiteNumber(Number.NaN, 7)).toBe(7);
    expect(finiteNumber(2.5)).toBe(2.5);
  });

  it("knows an expired share", () => {
    expect(isExpired({ expiresAt: null })).toBe(false);
    expect(isExpired({ expiresAt: Date.now() + 60_000 })).toBe(false);
    expect(isExpired({ expiresAt: Date.now() - 1 })).toBe(true);
  });

  it("builds meta from the pending record and the completion body", () => {
    const meta = buildMeta(
      {
        id: "abcdefghij",
        key: "shares/abcdefghij/video.mp4",
        uploadId: "u1",
        ownerHash: "h",
        contentType: "video/mp4",
        ext: "mp4",
        bytes: 10,
        createdAt: 5,
        expiresAt: 99,
      },
      { name: "Take", width: 1920, height: 1080, duration: 12.5, poster: true, bytes: 12 },
    );
    expect(meta).toMatchObject({ id: "abcdefghij", ext: "mp4", bytes: 12, poster: true, ownerHash: "h", expiresAt: 99, version: 1 });
  });

  it("is off until the bucket is configured", () => {
    const saved = { ...process.env };
    delete process.env.SHARE_S3_ENDPOINT;
    expect(shareConfig()).toBeNull();
    process.env.SHARE_S3_ENDPOINT = "https://acc.r2.cloudflarestorage.com/";
    process.env.SHARE_S3_BUCKET = "shares";
    process.env.SHARE_S3_ACCESS_KEY_ID = "k";
    process.env.SHARE_S3_SECRET_ACCESS_KEY = "s";
    process.env.SHARE_MAX_MB = "100";
    process.env.SHARE_TTL_DAYS = "0";
    const cfg = shareConfig();
    expect(cfg?.endpoint).toBe("https://acc.r2.cloudflarestorage.com");
    expect(cfg?.region).toBe("auto");
    expect(cfg?.maxBytes).toBe(100 * 1024 * 1024);
    expect(cfg?.ttlDays).toBe(0);
    process.env = saved;
  });

  it("reads the link lifetime the legal pages quote, with the same fallback", () => {
    const saved = process.env.SHARE_TTL_DAYS;
    for (const [value, days] of [["7", 7], ["0", 0], ["", 30], ["-1", 30], ["soon", 30]] as const) {
      process.env.SHARE_TTL_DAYS = value;
      expect(shareTtlDays()).toBe(days);
    }
    delete process.env.SHARE_TTL_DAYS;
    expect(shareTtlDays()).toBe(30);
    if (saved !== undefined) process.env.SHARE_TTL_DAYS = saved;
  });
});

const chr = (...codes: number[]) => String.fromCharCode(...codes);
const bytesOf = (s: string) => new Uint8Array([...[...s].map((c) => c.charCodeAt(0)), ...new Array(16).fill(0)]);

describe("what a browser may call, and from where", () => {
  it("answers the webview and a dev server, and nobody else", () => {
    for (const ok of [
      "https://tauri.localhost",
      "http://tauri.localhost",
      "tauri://localhost",
      "http://localhost:1430",
      "http://127.0.0.1:3006",
    ]) {
      expect(allowedOrigin(ok)).toBe(ok);
    }
    for (const no of [
      "https://evil.example",
      "https://tauri.localhost.evil.example",
      "http://localhost.evil.example",
      "https://tauri.localhost:8080",
      "null",
      "",
      null,
      undefined,
    ]) {
      expect(allowedOrigin(no)).toBeNull();
    }
  });

  it("never sends a wildcard: an unknown origin simply gets no permission", () => {
    expect(corsHeaders(null)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders("https://tauri.localhost")["Access-Control-Allow-Origin"]).toBe("https://tauri.localhost");
    expect(corsHeaders(null).Vary).toBe("Origin");
  });
});

describe("is this a video at all", () => {
  const mp4 = (box: string) => new Uint8Array([0, 0, 0, 24, ...[...box].map((c) => c.charCodeAt(0)), ...new Array(16).fill(0)]);

  it("takes the containers an export actually produces", () => {
    expect(looksLikeVideo(mp4("ftyp"))).toBe(true);
    expect(looksLikeVideo(mp4("moov"))).toBe(true);
    expect(looksLikeVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(12).fill(1)]))).toBe(true);
  });

  it("refuses what someone renamed to .mp4", () => {
    expect(looksLikeVideo(bytesOf(chr(0x50, 0x4b, 3, 4)))).toBe(false); // a zip
    expect(looksLikeVideo(bytesOf("MZ"))).toBe(false); // a windows executable
    expect(looksLikeVideo(bytesOf("<!DOCTYPE html>"))).toBe(false);
    expect(looksLikeVideo(bytesOf("%PDF-1.7"))).toBe(false);
    expect(looksLikeVideo(null)).toBe(false);
    expect(looksLikeVideo(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("knows a JPEG poster from anything else", () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // a png
    expect(looksLikeJpeg(null)).toBe(false);
  });
});

describe("owner tokens and ids", () => {
  it("compares digests without leaking how much was right", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(true);
    expect(timingSafeEqualHex("a", undefined as unknown as string)).toBe(false);
  });

  it("ids are long enough that guessing one is the only way in", () => {
    expect(newId()).toHaveLength(12);
    expect(Math.log2(31 ** 12)).toBeGreaterThan(59);
    expect(isValidId("abcdefghij")).toBe(true); // older, shorter ids still resolve
  });
});

describe("names that travel into a header and a filename", () => {
  it("drops control characters and invisible direction marks", () => {
    expect(cleanName("take" + chr(0) + "one")).toBe("takeone");
    expect(cleanName("report" + chr(0x202e) + "fdp.exe")).toBe("reportfdp.exe");
    expect(cleanName("line" + chr(10) + "break")).toBe("line break");
    expect(attachmentDisposition(cleanName("a" + chr(0) + "b"), "mp4")).toMatch(/^[ -~]+$/);
  });
});

describe("pending uploads", () => {
  it("is stale once it has outlived its presigned urls", () => {
    const now = 1_000_000_000;
    expect(isPendingStale({ createdAt: now }, now)).toBe(false);
    expect(isPendingStale({ createdAt: now - PENDING_MAX_AGE_MS + 1 }, now)).toBe(false);
    expect(isPendingStale({ createdAt: now - PENDING_MAX_AGE_MS - 1 }, now)).toBe(true);
  });
});

describe("the ceiling that decides what this can cost", () => {
  const cfg = (over: Partial<ShareConfig> = {}): ShareConfig => ({
    endpoint: "https://acc.r2.cloudflarestorage.com",
    bucket: "owntools-shares",
    region: "auto",
    accessKeyId: "k",
    secretAccessKey: "s",
    maxBytes: 200 * 1024 * 1024,
    ttlDays: 30,
    maxTotalBytes: 1000,
    maxShares: 10,
    maxPending: 3,
    uploadsOff: false,
    ...over,
  });

  const page = (keys: { key: string; size: number }[], next?: string) =>
    `<?xml version="1.0"?><ListBucketResult>${keys
      .map((k) => `<Contents><Key>${k.key}</Key><Size>${k.size}</Size></Contents>`)
      .join("")}<IsTruncated>${next ? "true" : "false"}</IsTruncated>${
      next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""
    }</ListBucketResult>`;

  const share = (id: string, size: number) => [
    { key: `shares/${id}/video.mp4`, size },
    { key: `shares/${id}/meta.json`, size: 200 },
  ];

  beforeEach(() => resetUsageCache());
  afterEach(() => vi.unstubAllGlobals());

  it("reads a listing page into bytes, shares and uploads in flight", () => {
    const parsed = parseListing(page([...share("aaa", 10), { key: "shares/bbb/pending.json", size: 5 }], "tok"));
    expect(parsed.keys).toHaveLength(3);
    expect(parsed.keys[0]).toEqual({ key: "shares/aaa/video.mp4", size: 10 });
    expect(parsed.next).toBe("tok");
    expect(parseListing(page([])).next).toBeNull();
  });

  it("walks every page and adds them up", async () => {
    const pages = [page(share("aaa", 100), "t1"), page([...share("bbb", 150), { key: "shares/ccc/pending.json", size: 1 }])];
    let calls = 0;
    vi.stubGlobal("fetch", async () => new Response(pages[calls++]));
    const usage = await measureUsage(cfg({ maxTotalBytes: 1_000_000 }));
    expect(calls).toBe(2);
    expect(usage).toMatchObject({ bytes: 651, shares: 2, pending: 1, complete: true });
  });

  it("stops the moment a ceiling is passed - how far over changes nothing", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response(page(share("aaa", 5_000), "more"));
    });
    const usage = await measureUsage(cfg());
    expect(calls).toBe(1);
    expect(usage?.complete).toBe(false);
  });

  it("does not list the bucket on every request", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response(page(share("aaa", 10)));
    });
    const c = cfg();
    expect((await bucketUsage(c))?.bytes).toBe(210);
    expect((await bucketUsage(c))?.bytes).toBe(210);
    expect(calls).toBe(1);
  });

  it("a listing that failed keeps the last reading instead of switching the ceiling off", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      vi.stubGlobal("fetch", async () => {
        calls++;
        return calls === 1 ? new Response(page(share("aaa", 900))) : new Response("denied", { status: 403 });
      });
      const c = cfg({ maxTotalBytes: 2000 });
      expect((await bucketUsage(c))?.bytes).toBe(1100);
      vi.advanceTimersByTime(11 * 60_000);
      // the storage is unreachable now: the ceiling must not fall open
      const stale = await bucketUsage(c);
      expect(calls).toBe(2);
      expect(stale?.bytes).toBe(1100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with nothing ever measured, a refusal is not invented", async () => {
    vi.stubGlobal("fetch", async () => new Response("denied", { status: 403 }));
    expect(await bucketUsage(cfg())).toBeNull();
  });

  it("books each upload, so a burst inside one cache window still hits the ceiling", async () => {
    vi.stubGlobal("fetch", async () => new Response(page([])));
    const c = cfg({ maxTotalBytes: 500, maxPending: 100 });
    expect(fullReason(c, await bucketUsage(c), 200)).toBeNull();
    noteUpload(c, 200);
    noteUpload(c, 200);
    expect(fullReason(c, await bucketUsage(c), 200)).toBe("bytes");
  });

  it("names which ceiling was reached", () => {
    const c = cfg();
    const usage = { bytes: 0, shares: 0, pending: 0, complete: true, at: Date.now() };
    expect(fullReason(c, usage)).toBeNull();
    expect(fullReason(c, { ...usage, bytes: 1001 })).toBe("bytes");
    expect(fullReason(c, { ...usage, bytes: 900 }, 200)).toBe("bytes");
    expect(fullReason(c, { ...usage, shares: 10 })).toBe("shares");
    expect(fullReason(c, { ...usage, pending: 3 })).toBe("pending");
    // nothing measured is not a reason to refuse
    expect(fullReason(c, null)).toBeNull();
  });

  it("hands room back when a share is removed", async () => {
    vi.stubGlobal("fetch", async () => new Response(page(share("aaa", 900))));
    const c = cfg({ maxTotalBytes: 1200 });
    expect(fullReason(c, await bucketUsage(c), 200)).toBe("bytes");
    noteUsage(c, { bytes: -1100, shares: -1 });
    expect(fullReason(c, await bucketUsage(c), 200)).toBeNull();
  });
});

describe("how a share is served", () => {
  const meta = {
    version: 1,
    id: "abcdefghijkl",
    name: "Demo take",
    bytes: 10,
    contentType: "video/mp4",
    ext: "mp4" as const,
    width: 1920,
    height: 1080,
    duration: 12,
    createdAt: 0,
    expiresAt: null,
    poster: true,
    ownerHash: "h",
  };

  it("pins the type the storage must answer with, whatever landed in the bucket", () => {
    expect(serveAsFor(meta, "video.mp4")).toEqual({
      type: "video/mp4",
      disposition: attachmentDisposition("Demo take", "mp4"),
    });
    expect(serveAsFor(meta, "poster.jpg")).toEqual({ type: "image/jpeg", disposition: "inline" });
  });
});

describe("the switches on the feature", () => {
  it("reads the ceilings and the pause from the environment", () => {
    const saved = { ...process.env };
    process.env.SHARE_S3_ENDPOINT = "https://acc.r2.cloudflarestorage.com";
    process.env.SHARE_S3_BUCKET = "shares";
    process.env.SHARE_S3_ACCESS_KEY_ID = "k";
    process.env.SHARE_S3_SECRET_ACCESS_KEY = "s";
    delete process.env.SHARE_MAX_MB;
    delete process.env.SHARE_MAX_TOTAL_GB;
    delete process.env.SHARE_MAX_SHARES;
    delete process.env.SHARE_MAX_PENDING;
    delete process.env.SHARE_UPLOADS_OFF;
    const fallback = shareConfig();
    expect(fallback?.maxBytes).toBe(200 * 1024 * 1024);
    expect(fallback?.maxTotalBytes).toBe(20 * 1024 * 1024 * 1024);
    expect(fallback?.maxShares).toBe(2000);
    expect(fallback?.maxPending).toBe(40);
    expect(fallback?.uploadsOff).toBe(false);

    process.env.SHARE_MAX_TOTAL_GB = "5";
    process.env.SHARE_MAX_SHARES = "50";
    process.env.SHARE_MAX_PENDING = "0";
    process.env.SHARE_UPLOADS_OFF = "1";
    const tuned = shareConfig();
    expect(tuned?.maxTotalBytes).toBe(5 * 1024 * 1024 * 1024);
    expect(tuned?.maxShares).toBe(50);
    expect(tuned?.maxPending).toBe(40); // nonsense falls back rather than locking the feature shut
    expect(tuned?.uploadsOff).toBe(true);

    process.env.SHARE_UPLOADS_OFF = "no";
    expect(shareConfig()?.uploadsOff).toBe(false);
    process.env = saved;
  });
});
