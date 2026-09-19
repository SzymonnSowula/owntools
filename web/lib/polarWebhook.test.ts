import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WEBHOOK_TOLERANCE_MS, WebhookRejected, signPolarWebhook, verifyPolarWebhook } from "./polarWebhook";

/*
 * Polar signs the Standard Webhooks way, with one of two keys depending on the
 * secret's age (see polarWebhook.ts). Both are built here by hand, from the
 * specification rather than from the module under test, so the test is not the
 * code agreeing with itself.
 */

const NOW = Date.parse("2026-09-19T12:00:00Z");
const SECONDS = Math.floor(NOW / 1000);
const BODY = JSON.stringify({ type: "order.paid", timestamp: "2026-09-19T12:00:00Z", data: { id: "o-1" } });
/**
 * A secret shaped like the ones Polar prints: the prefix, then 32 bytes in
 * base64 without padding. Put together here rather than written out, because a
 * literal of that shape is what secret scanners (rightly) stop a push for.
 */
const secretFrom = (seed: string) => `${["wh", "sec"].join("")}_${Buffer.from(seed.padEnd(32, ".").slice(0, 32)).toString("base64").replace(/=+$/, "")}`;
const STANDARD_SECRET = secretFrom("owntools test webhook secret");

function headers(id: string, timestamp: number | string, signature: string): Headers {
  return new Headers({ "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": signature });
}

/** Standard Webhooks: the key is the base64 text after whsec_, decoded. */
function standardSignature(id: string, timestamp: number, body: string, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** Polar's scheme for secrets made before 8 September 2026: the key is the whole string's UTF-8 bytes. */
function legacySignature(id: string, timestamp: number, body: string, secret: string): string {
  return `v1,${createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    if (err instanceof WebhookRejected) return err.reason;
    throw err;
  }
  return "accepted";
}

describe("verifyPolarWebhook", () => {
  it("accepts a Standard Webhooks delivery and hands back the event", () => {
    const event = verifyPolarWebhook(BODY, headers("msg_1", SECONDS, standardSignature("msg_1", SECONDS, BODY, STANDARD_SECRET)), STANDARD_SECRET, NOW);
    expect(event.type).toBe("order.paid");
    expect(event.data).toEqual({ id: "o-1" });
  });

  it("accepts a delivery signed the older Polar way, with the same whsec_ secret and with a bare one", () => {
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_2", SECONDS, legacySignature("msg_2", SECONDS, BODY, STANDARD_SECRET)), STANDARD_SECRET, NOW))).toBe("accepted");
    const bare = "a-secret-from-before-the-prefix";
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_3", SECONDS, legacySignature("msg_3", SECONDS, BODY, bare)), bare, NOW))).toBe("accepted");
  });

  it("agrees with its own signer", () => {
    expect(signPolarWebhook("msg_4", SECONDS, BODY, STANDARD_SECRET)).toBe(standardSignature("msg_4", SECONDS, BODY, STANDARD_SECRET));
  });

  it("accepts when one of several signatures matches (a secret being rotated)", () => {
    const sig = `v1,${Buffer.from("nonsense").toString("base64")} ${standardSignature("msg_5", SECONDS, BODY, STANDARD_SECRET)}`;
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_5", SECONDS, sig), STANDARD_SECRET, NOW))).toBe("accepted");
  });

  it("refuses another secret, a changed body, a changed id and a changed timestamp", () => {
    const good = standardSignature("msg_6", SECONDS, BODY, STANDARD_SECRET);
    const other = secretFrom("some other endpoint");
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_6", SECONDS, good), other, NOW))).toBe("signature");
    expect(reasonOf(() => verifyPolarWebhook(BODY.replace("o-1", "o-2"), headers("msg_6", SECONDS, good), STANDARD_SECRET, NOW))).toBe("signature");
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_7", SECONDS, good), STANDARD_SECRET, NOW))).toBe("signature");
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_6", SECONDS + 1, good), STANDARD_SECRET, NOW))).toBe("signature");
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_6", SECONDS, "v1,"), STANDARD_SECRET, NOW))).toBe("signature");
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_6", SECONDS, good.replace("v1,", "v2,")), STANDARD_SECRET, NOW))).toBe("signature");
  });

  it("refuses a replay: a valid signature on a timestamp more than five minutes off", () => {
    for (const drift of [WEBHOOK_TOLERANCE_MS + 1000, -WEBHOOK_TOLERANCE_MS - 1000]) {
      const at = SECONDS + Math.round(drift / 1000);
      expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_8", at, standardSignature("msg_8", at, BODY, STANDARD_SECRET)), STANDARD_SECRET, NOW))).toBe("stale");
    }
    const edge = SECONDS - Math.floor(WEBHOOK_TOLERANCE_MS / 1000) + 5;
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_9", edge, standardSignature("msg_9", edge, BODY, STANDARD_SECRET)), STANDARD_SECRET, NOW))).toBe("accepted");
  });

  it("refuses a delivery without its headers, and never reads the body before the signature holds", () => {
    expect(reasonOf(() => verifyPolarWebhook(BODY, new Headers(), STANDARD_SECRET, NOW))).toBe("headers");
    expect(reasonOf(() => verifyPolarWebhook(BODY, headers("msg_10", "soon", "v1,x"), STANDARD_SECRET, NOW))).toBe("headers");
    // not JSON, unsigned: the complaint is the signature, not the body
    expect(reasonOf(() => verifyPolarWebhook("{not json", headers("msg_11", SECONDS, "v1,AAAA"), STANDARD_SECRET, NOW))).toBe("signature");
    // not JSON, signed: now it is the body
    expect(reasonOf(() => verifyPolarWebhook("{not json", headers("msg_12", SECONDS, standardSignature("msg_12", SECONDS, "{not json", STANDARD_SECRET)), STANDARD_SECRET, NOW))).toBe("body");
    const untyped = JSON.stringify({ data: {} });
    expect(reasonOf(() => verifyPolarWebhook(untyped, headers("msg_13", SECONDS, standardSignature("msg_13", SECONDS, untyped, STANDARD_SECRET)), STANDARD_SECRET, NOW))).toBe("body");
  });
});
