import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LICENSE_ALPHABET, licenseChecksum, licenseKeyForOrder } from "./licenseKey";

/*
 * That the desktop app accepts these keys is tested next to the validator, in
 * packages/licensing/src/license.test.ts (web cannot import from packages).
 */

const SHAPE = /^SCRN-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;
const bodyOf = (key: string) => key.replace(/^SCRN-/, "").replace(/-/g, "");

describe("licenseKeyForOrder", () => {
  it("prints the documented shape with a matching checksum", () => {
    for (let i = 0; i < 500; i++) {
      const key = licenseKeyForOrder(randomUUID(), "secret");
      expect(key).toMatch(SHAPE);
      const body = bodyOf(key);
      expect(body[14]).toBe(licenseChecksum(body.slice(0, 14)));
    }
  });

  it("gives an order the same key every time, whatever the id's case", () => {
    const id = "3f2c1d7e-8a4b-4c5d-9e6f-0a1b2c3d4e5f";
    expect(licenseKeyForOrder(id, "s")).toBe(licenseKeyForOrder(id, "s"));
    expect(licenseKeyForOrder(id, "s")).toBe(licenseKeyForOrder(` ${id.toUpperCase()} `, "s"));
  });

  it("depends on the order and on the secret", () => {
    const id = randomUUID();
    const keys = new Set([licenseKeyForOrder(id, "a"), licenseKeyForOrder(id, "b"), licenseKeyForOrder(randomUUID(), "a")]);
    expect(keys.size).toBe(3);
  });

  it("still makes a well-formed key with no secret configured", () => {
    expect(licenseKeyForOrder(randomUUID(), "")).toMatch(SHAPE);
  });

  it("spreads over the whole alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      bodyOf(licenseKeyForOrder(randomUUID(), "x"))
        .slice(0, 14)
        .split("")
        .forEach((c) => seen.add(c));
    }
    expect(seen.size).toBe(LICENSE_ALPHABET.length);
  });
});
