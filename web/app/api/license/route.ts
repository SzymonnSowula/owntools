import { NextResponse } from "next/server";
import { LICENSE_KEY_PREFIX, LicenseSecretMissing, licensePublicKey } from "@/lib/licenseKey";

export const dynamic = "force-dynamic";

/**
 * The public half of the key that signs Pro keys on this server - public by
 * nature, and the one way to check from outside that the deployed
 * LICENSE_KEY_SECRET is the one the app's `LICENSE_PUBLIC_KEY` was made from
 * (`pnpm polar:setup` compares the two after a deploy). `publicKey: null`
 * means the secret is not set here, so /thanks could not issue a key.
 */
export function GET() {
  let publicKey: string | null;
  try {
    publicKey = licensePublicKey(process.env.LICENSE_KEY_SECRET ?? "");
  } catch (err) {
    if (!(err instanceof LicenseSecretMissing)) throw err;
    publicKey = null;
  }
  return NextResponse.json(
    { publicKey, prefix: LICENSE_KEY_PREFIX, algorithm: "ed25519" },
    { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
  );
}
