import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LICENSE_ALPHABET,
  LICENSE_BODY_LENGTH,
  LicenseSecretMissing,
  canonicalLicenseKey,
  decodeBase32,
  encodeBase32,
  formatLicenseKey,
  licenseKeyForOrder,
  licensePublicKey,
  mintLicenseKey,
  orderTag,
  orderTagHex,
  tagOfLicenseKey,
} from "./licenseKey";

/*
 * That the desktop app accepts these keys is tested next to the validator, in
 * packages/licensing/src/license.test.ts (web cannot import from packages).
 */

const SHAPE = /^OWNT(-[A-HJ-NP-Z2-9]{8}){14}-[A-HJ-NP-Z2-9]{5}$/;
const bodyOf = (key: string) => key.replace(/^OWNT-/, "").replace(/-/g, "");

describe("licenseKeyForOrder", () => {
  it("prints the documented shape", () => {
    for (let i = 0; i < 100; i++) {
      const key = licenseKeyForOrder(randomUUID(), "secret");
      expect(key).toMatch(SHAPE);
      expect(bodyOf(key)).toHaveLength(LICENSE_BODY_LENGTH);
    }
  });

  it("gives an order the same key every time, whatever the id's case", () => {
    const id = "3f2c1d7e-8a4b-4c5d-9e6f-0a1b2c3d4e5f";
    expect(licenseKeyForOrder(id, "s")).toBe(licenseKeyForOrder(id, "s"));
    expect(licenseKeyForOrder(id, "s")).toBe(licenseKeyForOrder(` ${id.toUpperCase()} `, "s"));
    expect(Array.from(orderTag(id))).toEqual(Array.from(orderTag(id.toUpperCase())));
  });

  it("depends on the order and on the secret", () => {
    const id = randomUUID();
    const keys = new Set([licenseKeyForOrder(id, "a"), licenseKeyForOrder(id, "b"), licenseKeyForOrder(randomUUID(), "a")]);
    expect(keys.size).toBe(3);
  });

  it("refuses to sign without a secret - such a key would not open the app", () => {
    expect(() => licenseKeyForOrder(randomUUID(), "")).toThrow(LicenseSecretMissing);
    expect(() => licenseKeyForOrder(randomUUID(), "   ")).toThrow(LicenseSecretMissing);
    expect(() => mintLicenseKey("")).toThrow(LicenseSecretMissing);
    expect(() => licensePublicKey("")).toThrow(LicenseSecretMissing);
  });

  it("spreads over the whole alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      bodyOf(licenseKeyForOrder(randomUUID(), "x"))
        .split("")
        .forEach((c) => seen.add(c));
    }
    expect(seen.size).toBe(LICENSE_ALPHABET.length);
  });
});

describe("licensePublicKey", () => {
  it("is 32 bytes of hex, the same for the same secret and different for another", () => {
    expect(licensePublicKey("secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(licensePublicKey("secret")).toBe(licensePublicKey(" secret "));
    expect(licensePublicKey("secret")).not.toBe(licensePublicKey("secret2"));
  });
});

describe("encodeBase32 / formatLicenseKey", () => {
  it("packs five bits a symbol, most significant first, zero-padded", () => {
    expect(encodeBase32(new Uint8Array([]))).toBe("");
    expect(encodeBase32(new Uint8Array([0]))).toBe("AA");
    expect(encodeBase32(new Uint8Array([0xff]))).toBe("96");
    expect(encodeBase32(new Uint8Array([0, 1, 2, 3, 4]))).toBe("AAASEA2E");
  });

  it("groups the body by eight behind the prefix", () => {
    expect(formatLicenseKey("ABCDEFGHJKLMN")).toBe("OWNT-ABCDEFGH-JKLMN");
  });

  it("decodes what it encodes, and only the canonical spelling", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 250, 251, 252]);
    expect(Array.from(decodeBase32(encodeBase32(bytes), bytes.length)!)).toEqual(Array.from(bytes));
    expect(decodeBase32("AA", 1)).not.toBeNull();
    expect(decodeBase32("AB", 1)).toBeNull(); // a padding bit set
    expect(decodeBase32("A0", 1)).toBeNull(); // not in the alphabet
    expect(decodeBase32("AA", 2)).toBeNull(); // too short
  });
});

describe("tagOfLicenseKey", () => {
  it("reads the order's tag back out of its key - which is how a leaked key is traced to its order", () => {
    for (let i = 0; i < 50; i++) {
      const id = randomUUID();
      const key = licenseKeyForOrder(id, "secret");
      expect(tagOfLicenseKey(key)).toBe(orderTagHex(id));
      expect(tagOfLicenseKey(key)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("does not depend on the secret: the tag is the order's, the signature is the shop's", () => {
    const id = randomUUID();
    expect(tagOfLicenseKey(licenseKeyForOrder(id, "a"))).toBe(tagOfLicenseKey(licenseKeyForOrder(id, "b")));
  });

  it("forgives what a paste does to a key, and answers null for anything else", () => {
    const key = licenseKeyForOrder(randomUUID(), "secret");
    const tag = tagOfLicenseKey(key);
    expect(tagOfLicenseKey(` ${key.toLowerCase().replace(/-/g, "\n")} `)).toBe(tag);
    expect(canonicalLicenseKey(key.toLowerCase().replace(/-/g, " "))).toBe(key);
    for (const bad of ["", "OWNT-", key.slice(0, -1), `${key}A`, key.replace("OWNT", "OWNS"), "hello@example.com"]) {
      expect(tagOfLicenseKey(bad), bad).toBeNull();
      expect(canonicalLicenseKey(bad), bad).toBeNull();
    }
  });
});
