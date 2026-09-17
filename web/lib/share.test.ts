import { describe, expect, it } from "vitest";
import {
  PART_SIZE,
  attachmentDisposition,
  buildMeta,
  cleanName,
  finiteNumber,
  isExpired,
  isValidId,
  mediaKey,
  mediaUrl,
  newId,
  newToken,
  objectKey,
  sha256Hex,
  shareConfig,
  shareTtlDays,
} from "./share";

describe("share ids and tokens", () => {
  it("makes unambiguous, url-safe ids", () => {
    for (let i = 0; i < 50; i++) {
      const id = newId();
      expect(id).toHaveLength(10);
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
