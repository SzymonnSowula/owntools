import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LICENSE_ALPHABET,
  LICENSE_BODY_LENGTH,
  LicenseSecretMissing,
  encodeBase32,
  formatLicenseKey,
  licenseKeyForOrder,
  licensePublicKey,
  mintLicenseKey,
  orderTag,
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
});
