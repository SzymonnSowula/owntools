import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * What the app does with a key that is *stored* and then lands on the list -
 * the update that switches a refunded key off. The interesting part is not the
 * check (license.test.ts) but that the key is not dropped silently: Settings
 * has to be able to say why Pro is gone.
 *
 * The app only trusts its baked-in public key, whose private half no test has.
 * So the signature check is stubbed to "holds" here, and the list is replaced
 * by one that names a known order - everything else is the real module.
 */

const ORDER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_ORDER = "11111111-2222-4333-8444-555555555555";

vi.mock("@noble/ed25519", async (original) => ({ ...(await original<typeof import("@noble/ed25519")>()), verify: () => true }));
vi.mock("./revoked", () => ({
  // orderTagHex(ORDER) - asserted below, so it cannot drift from the constant
  REVOKED_KEYS: [{ tag: "e3a0485f4e59ebef", reason: "refunded", since: "2026-09-19" }],
  REVOKED_FILE_ENTRIES: 1,
}));

const STORAGE_KEY = "screeni-license";

async function freshModule() {
  vi.resetModules();
  return import("./license");
}

describe("a stored key that was switched off", () => {
  let revokedKey: string;
  let goodKey: string;

  beforeEach(async () => {
    localStorage.clear();
    const web = await import("../../../web/lib/licenseKey");
    expect(web.orderTagHex(ORDER)).toBe("e3a0485f4e59ebef");
    revokedKey = web.licenseKeyForOrder(ORDER, "test-secret");
    goodKey = web.licenseKeyForOrder(OTHER_ORDER, "test-secret");
  });

  it("no longer makes the app Pro, stays stored, and the app can say why", async () => {
    localStorage.setItem(STORAGE_KEY, revokedKey);
    const license = await freshModule();
    expect(license.isPro()).toBe(false);
    expect(license.getLicense()).toBeNull();
    expect(license.getSwitchedOffLicense()).toEqual({ key: revokedKey, reason: "refunded", since: "2026-09-19" });
    // not thrown away: the notice needs it, and only the person removes it
    expect(localStorage.getItem(STORAGE_KEY)).toBe(revokedKey);
  });

  it("is not accepted when pasted either, and leaves a working key alone", async () => {
    const license = await freshModule();
    expect(await license.activateLicense(revokedKey)).toBe(false);
    expect(license.licenseKeyProblem(revokedKey)).toBe("refunded");
    expect(license.isPro()).toBe(false);

    expect(await license.activateLicense(goodKey)).toBe(true);
    expect(license.isPro()).toBe(true);
    expect(license.getSwitchedOffLicense()).toBeNull();
  });

  it("a working key pasted over it clears the notice, and tells subscribers", async () => {
    localStorage.setItem(STORAGE_KEY, revokedKey);
    const license = await freshModule();
    expect(license.getSwitchedOffLicense()).not.toBeNull();
    const heard = vi.fn();
    license.onLicenseChange(heard);
    expect(await license.activateLicense(goodKey)).toBe(true);
    expect(license.getSwitchedOffLicense()).toBeNull();
    expect(license.isPro()).toBe(true);
    expect(heard).toHaveBeenCalled();
  });

  it('"Remove it" clears the notice and the stored key', async () => {
    localStorage.setItem(STORAGE_KEY, revokedKey);
    const license = await freshModule();
    expect(license.getSwitchedOffLicense()).not.toBeNull();
    const heard = vi.fn();
    license.onLicenseChange(heard);
    await license.deactivateLicense();
    expect(license.getSwitchedOffLicense()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(heard).toHaveBeenCalled();
  });

  it("a working stored key is simply Pro, with nothing to say", async () => {
    localStorage.setItem(STORAGE_KEY, goodKey);
    const license = await freshModule();
    expect(license.isPro()).toBe(true);
    expect(license.getSwitchedOffLicense()).toBeNull();
  });
});
