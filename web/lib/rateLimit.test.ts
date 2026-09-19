import { describe, expect, it } from "vitest";
import { allowRequest, clientAddress } from "./rateLimit";

/*
 * /checkout, /thanks and /api/key all lean on this counter to keep one caller
 * from spending the Polar request budget the next real buyer needs.
 */

describe("allowRequest", () => {
  it("lets the limit through, refuses the next one, and starts over when the window ends", () => {
    const key = `t:${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(allowRequest(key, 5, 60_000, t0 + i)).toBe(true);
    expect(allowRequest(key, 5, 60_000, t0 + 10)).toBe(false);
    expect(allowRequest(key, 5, 60_000, t0 + 59_999)).toBe(false);
    expect(allowRequest(key, 5, 60_000, t0 + 60_000)).toBe(true);
  });

  it("counts every key on its own", () => {
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    expect(allowRequest(a, 1, 60_000, 0)).toBe(true);
    expect(allowRequest(a, 1, 60_000, 1)).toBe(false);
    expect(allowRequest(b, 1, 60_000, 1)).toBe(true);
  });

  it("a refused request does not push the window out - waiting is always enough", () => {
    const key = `w:${Math.random()}`;
    expect(allowRequest(key, 1, 1_000, 0)).toBe(true);
    for (let t = 100; t < 1_000; t += 100) expect(allowRequest(key, 1, 1_000, t)).toBe(false);
    expect(allowRequest(key, 1, 1_000, 1_000)).toBe(true);
  });

  it("how /api/key stacks them: a noisy caller is stopped by its own limit before it can use up the shared one", () => {
    const run = Math.random();
    const shared = `all:${run}`;
    let reachedPolar = 0;
    const ask = (ip: string, now: number) => {
      if (!allowRequest(`ip:${run}:${ip}`, 5, 600_000, now)) return "busy";
      if (!allowRequest(shared, 30, 60_000, now)) return "busy";
      reachedPolar += 1;
      return "asked";
    };
    // one caller hammering: five get through, the rest never touch the shared ceiling
    for (let i = 0; i < 100; i++) ask("203.0.113.7", i);
    expect(reachedPolar).toBe(5);
    // a crowd of callers, one request each: the instance-wide ceiling holds at 30 a minute
    for (let i = 0; i < 100; i++) ask(`198.51.100.${i}`, 200 + i);
    expect(reachedPolar).toBe(30);
    // and an ordinary buyer a minute later is served
    expect(ask("192.0.2.1", 61_000)).toBe("asked");
  });
});

describe("clientAddress", () => {
  it("takes the first forwarded address, then x-real-ip, then says it does not know", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});
