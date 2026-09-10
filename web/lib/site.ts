/**
 * Single source for the public links, contact points and the price used by
 * the landing, the metadata routes and the legal pages.
 *
 * Everything comes from NEXT_PUBLIC_* variables (documented in
 * web/.env.example). An unset or empty variable yields `undefined`, so the UI
 * can render an honest "not yet" state instead of a dead link.
 */

const env = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v ? v : undefined;
};

/** Canonical origin of the website (metadataBase, sitemap, robots, JSON-LD). */
export const siteUrl = env(process.env.NEXT_PUBLIC_SITE_URL) ?? "https://owntools.app";

/** Direct link to the Windows installer. Unset until the first release ships. */
export const downloadUrl = env(process.env.NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS);

/**
 * Direct link to the macOS disk image (universal — Apple Silicon and
 * Intel from one file). Set it and the Mac button becomes a link; leave
 * it unset and the button says so instead of lying about what exists.
 */
export const downloadUrlMac = env(process.env.NEXT_PUBLIC_DOWNLOAD_URL_MACOS);

/** Polar.sh checkout link for the Pro key. Unset until launch day. */
export const checkoutUrl = env(process.env.NEXT_PUBLIC_CHECKOUT_URL);

/** Support and legal contact address. */
export const contactEmail = env(process.env.NEXT_PUBLIC_CONTACT_EMAIL);

/** Profile on X — "ask on x" and the footer link render only when set. */
export const xUrl = env(process.env.NEXT_PUBLIC_X_URL);

/** Public source repository. */
export const repoUrl =
  env(process.env.NEXT_PUBLIC_REPO_URL) ?? "https://github.com/SzymonnSowula/owntools";

/** Plausible `data-domain`. Analytics stay off unless this is set. */
export const plausibleDomain = env(process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN);

/** Operator shown on the legal pages (legal name and postal address). */
export const legalEntity = env(process.env.NEXT_PUBLIC_LEGAL_ENTITY);
export const legalAddress = env(process.env.NEXT_PUBLIC_LEGAL_ADDRESS);

/**
 * The ONLY place the price is defined — cards, JSON-LD offers and policies
 * all read from here. The business plan still weighs $49 against 149 zł;
 * decide before launch and change it in this one spot.
 */
export const PRICE = {
  amount: 49,
  currency: "USD",
  display: "$49",
} as const;

/** Date stamped on the privacy / terms / refund pages. */
export const POLICIES_UPDATED = "2026-09-01";

/** Refund window for the Pro key, in days. */
export const REFUND_DAYS = 14;
