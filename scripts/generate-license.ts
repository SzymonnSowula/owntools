/**
 * generate-license.ts [count=1] - Pro keys by hand: gifts, giveaways, a reviewer.
 *
 *   pnpm license:generate        one key
 *   pnpm license:generate 5      five keys, one per line
 *
 * A key is an Ed25519 signature (web/lib/licenseKey.ts) made with the private
 * key derived from LICENSE_KEY_SECRET in web/.env.local - the same secret the
 * site signs buyers' keys with, so a key from here opens the app exactly like
 * one from /thanks. Without that secret nothing can be minted: the app only
 * trusts the public key baked into packages/licensing/src/license.ts, which is
 * what makes a public repository and a paid key compatible.
 *
 * Keys made here are random, so nothing records them - note where each one
 * went. A buyer's key is never made here: it is derived from the Polar order
 * (`pnpm polar:key <e-mail>` recomputes a lost one).
 */

import { mintLicenseKey } from "../web/lib/licenseKey.ts";
import { fail, setting } from "./lib/polar-cli.ts";

const MAX_COUNT = 1000;

const arg = process.argv.slice(2).filter((a) => a !== "--")[0] ?? "1";
if (arg === "-h" || arg === "--help") {
  console.log("Usage: pnpm license:generate [count=1]");
  process.exit(0);
}
const count = Number(arg);
if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
  fail(`Usage: pnpm license:generate [count=1]   (1-${MAX_COUNT}, got "${arg}")`);
}

const secret = setting("LICENSE_KEY_SECRET");
if (!secret) {
  fail("LICENSE_KEY_SECRET is not set (web/.env.local). Keys signed with anything else would not open the app; `pnpm polar:setup` writes one.");
}

for (let i = 0; i < count; i++) console.log(mintLicenseKey(secret!));
