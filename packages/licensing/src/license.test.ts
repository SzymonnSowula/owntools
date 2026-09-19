import { describe, expect, it } from "vitest";
import {
  LICENSE_BODY_LENGTH,
  licenseKeyForOrder,
  licensePublicKey,
  mintLicenseKey,
  orderTag,
} from "../../../web/lib/licenseKey";
import { tagOfLicenseKey } from "../../../web/lib/licenseKey";
import {
  LICENSE_ALPHABET,
  LICENSE_PUBLIC_KEY,
  decodeLicenseKey,
  isSignedLicenseKey,
  isValidLicenseKey,
  licenseKeyProblem,
  maskLicenseKey,
  normalizeLicenseKey,
  revocationOf,
  type LicenseKeyProblem,
} from "./license";
import { licenseProblemMessage, switchedOffMessage } from "./messages";
import { REVOKED_FILE_ENTRIES, REVOKED_KEYS, type RevokedKey } from "./revoked";

/*
 * The key format is the contract with the store: the site signs (web/lib/
 * licenseKey.ts), the app verifies (here). Web cannot import from packages,
 * so the round trip is checked from this side, with a test secret whose
 * public key is handed to the validator - the app itself only ever trusts
 * LICENSE_PUBLIC_KEY.
 */

const SECRET = "test-secret";
const PUBLIC = licensePublicKey(SECRET);
const OTHER_PUBLIC = licensePublicKey("another-secret");

const SHAPE = /^OWNT(-[A-HJ-NP-Z2-9]{8}){14}-[A-HJ-NP-Z2-9]{5}$/;

const orderIds = Array.from({ length: 200 }, (_, i) => {
  const hex = (Math.imul(i + 1, 2654435761) >>> 0).toString(16).padStart(8, "0");
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`;
});
const KEYS = orderIds.map((id) => licenseKeyForOrder(id, SECRET));

/** The 117 symbols without prefix and dashes. */
function bodyOf(key: string): string {
  return key.replace(/^OWNT-/, "").replace(/-/g, "");
}

function withBody(body: string): string {
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += 8) groups.push(body.slice(i, i + 8));
  return `OWNT-${groups.join("-")}`;
}

describe("keys the site signs", () => {
  it("are all accepted by the app against the matching public key", () => {
    const rejected = KEYS.filter((key) => !isValidLicenseKey(key, PUBLIC));
    expect(rejected).toEqual([]);
  });

  it("have the documented shape: OWNT-, 117 symbols in groups of eight, no 0, 1, I or O", () => {
    for (const key of KEYS) expect(key).toMatch(SHAPE);
    expect(bodyOf(KEYS[0])).toHaveLength(LICENSE_BODY_LENGTH);
  });

  it("carry the order's tag and version 1", () => {
    const decoded = decodeLicenseKey(KEYS[3]);
    expect(decoded?.version).toBe(1);
    expect(Array.from(decoded!.tag)).toEqual(Array.from(orderTag(orderIds[3])));
    expect(decoded?.signature).toHaveLength(64);
  });

  it("are rejected by any other public key - including the one baked into the app", () => {
    for (const key of KEYS.slice(0, 20)) {
      expect(isValidLicenseKey(key, OTHER_PUBLIC)).toBe(false);
      expect(isValidLicenseKey(key)).toBe(false);
      expect(isValidLicenseKey(key, LICENSE_PUBLIC_KEY)).toBe(false);
    }
  });

  it("include gift keys with a random tag", () => {
    const gifts = Array.from({ length: 20 }, () => mintLicenseKey(SECRET));
    expect(new Set(gifts).size).toBe(20);
    for (const key of gifts) {
      expect(key).toMatch(SHAPE);
      expect(isValidLicenseKey(key, PUBLIC)).toBe(true);
    }
  });
});

describe("isValidLicenseKey", () => {
  it("rejects the key when any single symbol is changed", () => {
    const body = bodyOf(KEYS[0]);
    for (let i = 0; i < body.length; i++) {
      const replacement = LICENSE_ALPHABET[(LICENSE_ALPHABET.indexOf(body[i]) + 1) % LICENSE_ALPHABET.length];
      const tampered = withBody(body.slice(0, i) + replacement + body.slice(i + 1));
      expect(isValidLicenseKey(tampered, PUBLIC), `symbol ${i}`).toBe(false);
    }
  });

  it("rejects a signature moved onto another tag", () => {
    const a = bodyOf(KEYS[0]);
    const b = bodyOf(KEYS[1]);
    // the first 15 symbols hold the version and the tag (9 bytes = 72 bits + 3 bits of the signature)
    expect(isValidLicenseKey(withBody(b.slice(0, 15) + a.slice(15)), PUBLIC)).toBe(false);
  });

  it("accepts lower case, whitespace, line breaks and missing dashes", () => {
    const key = KEYS[1];
    expect(isValidLicenseKey(key.toLowerCase(), PUBLIC)).toBe(true);
    expect(isValidLicenseKey(`  ${key}  `, PUBLIC)).toBe(true);
    expect(isValidLicenseKey(key.replace(/-/g, ""), PUBLIC)).toBe(true);
    expect(isValidLicenseKey(key.replace(/-/g, " "), PUBLIC)).toBe(true);
    expect(isValidLicenseKey(key.replace(/-/g, "\n"), PUBLIC)).toBe(true);
  });

  it("rejects malformed input", () => {
    const key = KEYS[2];
    const body = bodyOf(key);
    const malformed = [
      "",
      "   ",
      "OWNT",
      "OWNT-",
      key.slice(0, -1), // a symbol short
      `${key}A`, // a symbol long
      `${key}-AAAAAAAA`, // an extra group
      key.replace("OWNT", "OWNS"), // wrong prefix
      key.replace("OWNT", "XOWNT"),
      key.slice(5), // prefix missing
      withBody(`${body.slice(0, -1)}0`), // 0 and 1 are not in the alphabet
      withBody(`${body.slice(0, -1)}1`),
      withBody(`O${body.slice(1)}`), // neither are O and I (look-alikes)
      withBody(`I${body.slice(1)}`),
      "SCRN-AB3F4-QWERT-ZXC89", // the format before 2026-09-17
    ];
    for (const input of malformed) {
      expect(isValidLicenseKey(input, PUBLIC), JSON.stringify(input)).toBe(false);
    }
  });

  it("rejects a key whose padding bit is set, so every key has one spelling", () => {
    const body = bodyOf(KEYS[4]);
    const last = body[body.length - 1];
    const flipped = LICENSE_ALPHABET[LICENSE_ALPHABET.indexOf(last) ^ 1];
    const key = withBody(body.slice(0, -1) + flipped);
    expect(decodeLicenseKey(key)).toBeNull();
    expect(isValidLicenseKey(key, PUBLIC)).toBe(false);
  });

  it("does not trust a public key that is not one", () => {
    expect(isValidLicenseKey(KEYS[0], "")).toBe(false);
    expect(isValidLicenseKey(KEYS[0], "zz")).toBe(false);
  });
});

describe("normalizeLicenseKey / maskLicenseKey", () => {
  it("spells a pasted key the canonical way", () => {
    const key = KEYS[5];
    expect(normalizeLicenseKey(key.toLowerCase().replace(/-/g, " "))).toBe(key);
    expect(normalizeLicenseKey("not a key")).toBeNull();
  });

  it("shows the first group and the last two symbols", () => {
    const key = KEYS[6];
    const masked = maskLicenseKey(key);
    expect(masked).toMatch(/^OWNT-[A-HJ-NP-Z2-9]{8}-…-•••[A-HJ-NP-Z2-9]{2}$/);
    expect(masked.startsWith(key.slice(0, 13))).toBe(true);
    expect(masked.endsWith(key.slice(-2))).toBe(true);
    expect(maskLicenseKey("SOMETHINGELSE")).toBe("SOME•••••••SE");
  });
});

describe("the app's public key", () => {
  it("is a 32-byte hex string", () => {
    expect(LICENSE_PUBLIC_KEY).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("switched-off keys", () => {
  const refunded = KEYS[10];
  const shared = KEYS[11];
  const list: RevokedKey[] = [
    { tag: tagOfLicenseKey(refunded)!, reason: "refunded", since: "2026-09-19" },
    { tag: tagOfLicenseKey(shared)!, reason: "shared", since: "2026-09-19" },
  ];

  it("a key on the list no longer opens the app, though its signature still holds", () => {
    expect(isSignedLicenseKey(refunded, PUBLIC)).toBe(true);
    expect(isValidLicenseKey(refunded, PUBLIC, [])).toBe(true);
    expect(isValidLicenseKey(refunded, PUBLIC, list)).toBe(false);
    expect(isValidLicenseKey(shared, PUBLIC, list)).toBe(false);
    // however it is typed
    expect(isValidLicenseKey(refunded.toLowerCase().replace(/-/g, " "), PUBLIC, list)).toBe(false);
  });

  it("every other key is untouched by the list", () => {
    const others = KEYS.filter((k) => k !== refunded && k !== shared);
    expect(others.filter((k) => !isValidLicenseKey(k, PUBLIC, list))).toEqual([]);
  });

  it("says why", () => {
    expect(revocationOf(refunded, list)?.reason).toBe("refunded");
    expect(revocationOf(shared, list)?.reason).toBe("shared");
    expect(revocationOf(KEYS[12], list)).toBeNull();
    expect(revocationOf("not a key", list)).toBeNull();
  });

  it("the web side reads the same tag out of a key as the app does", () => {
    for (const key of KEYS.slice(0, 20)) {
      const decoded = decodeLicenseKey(key)!;
      expect(tagOfLicenseKey(key)).toBe(Array.from(decoded.tag, (b) => b.toString(16).padStart(2, "0")).join(""));
    }
  });

  it("the list baked into this build is well-formed: nothing in revoked.json is skipped", () => {
    expect(REVOKED_KEYS).toHaveLength(REVOKED_FILE_ENTRIES);
    expect(new Set(REVOKED_KEYS.map((k) => k.tag)).size).toBe(REVOKED_KEYS.length);
    for (const entry of REVOKED_KEYS) expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("licenseKeyProblem", () => {
  const key = KEYS[7];
  const body = bodyOf(key);
  const list: RevokedKey[] = [{ tag: tagOfLicenseKey(KEYS[8])!, reason: "shared", since: "2026-09-19" }];
  const problem = (raw: string) => licenseKeyProblem(raw, PUBLIC, list);

  it("finds nothing wrong with a good key", () => {
    expect(problem(key)).toBeNull();
    expect(problem(`  ${key.toLowerCase()}\n`)).toBeNull();
  });

  it("tells a partial copy from a wrong paste from a changed character", () => {
    expect(problem("")).toBe("empty");
    expect(problem(" - ")).toBe("empty");
    expect(problem("hello@example.com")).toBe("not-a-key");
    expect(problem("SCRN-AB3F4-QWERT-ZXC89")).toBe("not-a-key");
    expect(problem(key.slice(0, 60))).toBe("cut-off");
    expect(problem("OWNT-")).toBe("cut-off");
    expect(problem(`${key} ${key}`)).toBe("too-long");
    expect(problem(withBody(`${body.slice(0, -1)}0`))).toBe("mistyped"); // a look-alike keys never contain
    const changed = LICENSE_ALPHABET[(LICENSE_ALPHABET.indexOf(body[40]) + 1) % LICENSE_ALPHABET.length];
    expect(problem(withBody(body.slice(0, 40) + changed + body.slice(41)))).toBe("mistyped");
  });

  it("names a switched-off key as what it is, not as a typo", () => {
    expect(problem(KEYS[8])).toBe("shared");
    expect(licenseKeyProblem(KEYS[8], PUBLIC, [{ ...list[0], reason: "refunded" }])).toBe("refunded");
  });

  it("has a sentence for every problem, and only the shared one sends people to the inbox", () => {
    const all: LicenseKeyProblem[] = ["empty", "not-a-key", "cut-off", "too-long", "mistyped", "refunded", "shared"];
    for (const p of all) {
      const message = licenseProblemMessage(p, "hello@example.com");
      expect(message.length).toBeGreaterThan(10);
      expect(message.includes("hello@example.com")).toBe(p === "shared");
    }
    const notice = switchedOffMessage({ key, reason: "refunded", since: "2026-09-19" }, "hello@example.com");
    expect(notice).toContain(maskLicenseKey(key));
    expect(notice).not.toContain(key);
    expect(notice).not.toContain("hello@example.com");
  });
});
