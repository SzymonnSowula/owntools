/**
 * Which Polar API contract every request asks for (the `Polar-Version`
 * header). Shared by the site (lib/polar.ts) and the scripts.
 *
 * Without the header Polar answers with its Current version, which changes
 * each quarter (first week of January, April, July, October), so an
 * unpinned shop could change shape under a live checkout. Pinned, the answer
 * stays the same until the version is removed - and a removed version answers
 * 404 to everything, so the pin has a date on it.
 *
 * 2026-04 is what this integration was built and verified against. 2026-10
 * (Current from 1 October 2026) only adds fields to everything used here -
 * checked field by field against both OpenAPI documents on 2026-09-14 - so
 * moving is a one-line change: POLAR_API_VERSION=2026-10, or this default.
 */

export const DEFAULT_POLAR_API_VERSION = "2026-04";

/** The first week a version stops answering (it becomes Deprecated one quarter earlier). */
const REMOVED_ON: Record<string, string> = {
  "2026-04": "2027-01-01",
  "2026-10": "2027-04-01",
};

export function polarApiVersion(env: string | undefined): string {
  const v = env?.trim();
  return v && /^\d{4}-\d{2}$/.test(v) ? v : DEFAULT_POLAR_API_VERSION;
}

/** A sentence to log once the pinned version is within 45 days of removal, else null. */
export function polarVersionWarning(version: string, now = new Date()): string | null {
  const removed = REMOVED_ON[version];
  if (!removed) return null;
  const days = Math.floor((Date.parse(removed) - now.getTime()) / 86_400_000);
  if (days > 45) return null;
  return days > 0
    ? `Polar API version ${version} stops answering around ${removed} (${days} days). Set POLAR_API_VERSION to the Current version and check web/lib/polarVersion.ts.`
    : `Polar API version ${version} was due for removal on ${removed}; requests may already fail. Set POLAR_API_VERSION to the Current version.`;
}
