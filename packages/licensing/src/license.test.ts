import { describe, expect, it } from "vitest";
import { licenseKeyForOrder } from "../../../web/lib/licenseKey";
import { isValidLicenseKey } from "./license";

/**
 * The key format is the contract with the store: SCRN-XXXXX-XXXXX-XXXXX over a
 * 32-symbol alphabet (A–Z without I and O, digits 2–9), last character = checksum
 * of the 14 payload characters. The generator is re-implemented here on purpose:
 * if either side drifts, this test is where it shows up.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function checksum(payload: string): string {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum += ALPHABET.indexOf(payload[i]) * (i % 2 === 0 ? 3 : 7);
  }
  return ALPHABET[sum % ALPHABET.length];
}

function formatKey(body: string): string {
  return `SCRN-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}`;
}

function generateKey(rng: () => number): string {
  let payload = "";
  for (let i = 0; i < 14; i++) payload += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return formatKey(payload + checksum(payload));
}

/** Small deterministic PRNG (mulberry32) so a failing key is reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 15 key characters without prefix and dashes: 14 payload + check. */
function bodyOf(key: string): string {
  return key.replace(/-/g, "").slice(4);
}

const rng = seeded(20260901);
const KEYS = Array.from({ length: 200 }, () => generateKey(rng));

describe("isValidLicenseKey", () => {
  it("accepts 200 generated keys", () => {
    const rejected = KEYS.filter((key) => !isValidLicenseKey(key));
    expect(rejected).toEqual([]);
  });

  it("generates keys in the documented shape (no 0, 1, I or O)", () => {
    for (const key of KEYS) {
      expect(key).toMatch(/^SCRN-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    }
  });

  it("rejects the key when any single payload character is changed", () => {
    const body = bodyOf(KEYS[0]);
    for (let i = 0; i < 14; i++) {
      const replacement = ALPHABET[(ALPHABET.indexOf(body[i]) + 1) % ALPHABET.length];
      const tampered = formatKey(body.slice(0, i) + replacement + body.slice(i + 1));
      expect(isValidLicenseKey(tampered), `payload position ${i}`).toBe(false);
    }
  });

  it("rejects every wrong checksum character", () => {
    for (const key of KEYS.slice(0, 20)) {
      const body = bodyOf(key);
      for (const ch of ALPHABET) {
        if (ch === body[14]) continue;
        expect(isValidLicenseKey(formatKey(body.slice(0, 14) + ch))).toBe(false);
      }
    }
  });

  it("accepts lower-case input and surrounding whitespace", () => {
    const key = KEYS[1];
    expect(isValidLicenseKey(key.toLowerCase())).toBe(true);
    expect(isValidLicenseKey(`  ${key}  `)).toBe(true);
    expect(isValidLicenseKey(`\n${key.toLowerCase()}\t`)).toBe(true);
  });

  it("rejects malformed input", () => {
    const key = KEYS[2];
    const malformed = [
      "",
      "   ",
      "SCRN",
      "SCRN-",
      "SCRN-AAAAA-AAAAA", // a group short
      "SCRN-AAAAA-AAAAA-AAAA", // last group too short
      `${key}-AAAAA`, // extra group
      key.replace(/-/g, ""), // no dashes
      key.replace(/-/g, " "), // spaces instead of dashes
      key.replace("SCRN", "SCRM"), // wrong prefix
      key.replace("SCRN", "XSCRN"),
      key.slice(5), // prefix missing
      `${key.slice(0, -1)}0`, // 0 and 1 are not in the alphabet
      `${key.slice(0, -1)}1`,
      `${key.slice(0, 5)}O${key.slice(6)}`, // neither are O and I (look-alikes)
      `${key.slice(0, 5)}I${key.slice(6)}`,
      "SCRN-ABCDE-FGHIJ-KLMNO",
    ];
    for (const input of malformed) {
      expect(isValidLicenseKey(input), JSON.stringify(input)).toBe(false);
    }
  });
});

/**
 * The keys buyers actually get: the landing derives one per Polar order
 * (web/lib/licenseKey.ts) instead of printing them with the CLI. Web cannot
 * import from packages, so the round trip is checked from this side.
 */
describe("keys the landing derives from Polar orders", () => {
  const orderIds = Array.from({ length: 300 }, (_, i) => {
    const hex = (Math.imul(i + 1, 2654435761) >>> 0).toString(16).padStart(8, "0");
    return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`;
  });

  it("are all accepted by the app, with or without a secret", () => {
    const rejected = orderIds.flatMap((id) =>
      [licenseKeyForOrder(id, "a-secret"), licenseKeyForOrder(id, "")].filter((key) => !isValidLicenseKey(key)),
    );
    expect(rejected).toEqual([]);
  });
});
