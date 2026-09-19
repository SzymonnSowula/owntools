import { describe, expect, it } from "vitest";
import { purchaseEmail, recoveryEmail, type MailLinks } from "./keyEmail";
import { licenseKeyForOrder } from "./licenseKey";

const LINKS: MailLinks = {
  site: "https://owntools.app",
  contact: "hello@owntools.app",
  downloadWindows: "https://owntools.app/download/windows",
  refundDays: 14,
};
const KEY = licenseKeyForOrder("3f2c1d7e-8a4b-4c5d-9e6f-0a1b2c3d4e5f", "secret");
const THANKS = "https://owntools.app/thanks?checkout_id=c0000001-0000-4000-8000-000000000001";

describe("purchaseEmail", () => {
  const mail = purchaseEmail({ ...LINKS, key: KEY, thanksUrl: THANKS });

  it("carries the whole key, unbroken, in both parts", () => {
    expect(mail.text).toContain(KEY);
    expect(mail.html).toContain(KEY);
    // on a line of its own in the text part: a wrapped or prefixed key is a support e-mail
    expect(mail.text.split("\n")).toContain(KEY);
  });

  it("answers what a buyer would otherwise write in about", () => {
    expect(mail.text).toContain("Settings -> License");
    expect(mail.text).toContain("https://owntools.app/download/windows");
    expect(mail.text).toContain(THANKS);
    expect(mail.text).toContain("https://owntools.app/key");
    expect(mail.text).toContain("https://owntools.app/refunds");
    expect(mail.text).toContain("14 days");
    expect(mail.text).toMatch(/New computer\? Paste the same key there/);
  });

  it("loads nothing from anywhere: no images, no scripts, no tracking", () => {
    expect(mail.html).not.toMatch(/<img|<script|<link|url\(/i);
    const hosts = [...mail.html.matchAll(/href="https?:\/\/([^/"]+)/g)].map((m) => m[1]);
    expect(new Set(hosts)).toEqual(new Set(["owntools.app"]));
  });

  it("does without the links it was not given", () => {
    const bare = purchaseEmail({ site: LINKS.site, contact: LINKS.contact, refundDays: 14, key: KEY });
    expect(bare.text).toContain("Install owntools: https://owntools.app");
    expect(bare.text).not.toContain("thanks?checkout_id");
    expect(bare.text).not.toContain("undefined");
    expect(bare.html).not.toContain("undefined");
  });

  it("escapes what it is given", () => {
    const odd = purchaseEmail({ ...LINKS, key: KEY, thanksUrl: 'https://owntools.app/thanks?checkout_id=x"><b>' });
    expect(odd.html).not.toContain('"><b>');
    expect(odd.html).toContain("&quot;&gt;&lt;b&gt;");
  });
});

describe("recoveryEmail", () => {
  it("is singular for one key and says so when there are several", () => {
    const one = recoveryEmail({ ...LINKS, keys: [{ key: KEY, bought: "2026-09-19" }] });
    expect(one.subject).toBe("Your owntools Pro key, again");
    expect(one.text.split("\n")).toContain(KEY);
    expect(one.text).not.toContain("Bought 2026-09-19");

    const other = licenseKeyForOrder("00000002-0000-4000-8000-000000000002", "secret");
    const two = recoveryEmail({ ...LINKS, keys: [{ key: KEY, bought: "2026-09-19" }, { key: other, bought: "2026-08-01" }] });
    expect(two.subject).toBe("Your owntools Pro keys, again");
    expect(two.text).toContain("2 orders");
    expect(two.text).toContain("Bought 2026-08-01:");
    expect(two.html).toContain(other);
  });

  it("tells someone who did not ask what happened, and that nothing else did", () => {
    const mail = recoveryEmail({ ...LINKS, keys: [{ key: KEY, bought: "2026-09-19" }] });
    expect(mail.text).toMatch(/Did not ask for this\?/);
    expect(mail.text).toMatch(/only ever sent here/);
  });
});
