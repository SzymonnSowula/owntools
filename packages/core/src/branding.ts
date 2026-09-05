/**
 * Brand identity. If you rename again, update: this file, tauri.conf.json
 * (productName — NOTE: changing `identifier` moves the AppData folder and
 * orphans user data, so migrate before touching it), the crate name in
 * src-tauri/Cargo.toml (`package.name` + `lib.name`, plus the `..._lib::run()`
 * call in main.rs — the crate is what names the built .exe, not productName),
 * the three *.html titles in apps/desktop, and web/ landing copy.
 *
 * Runner-up names kept for reference: slipway, drydock, lokal, deskhop.
 */
export const SUITE_NAME = "shipshape";
/**
 * Say what the app keeps safe, never who it is for. "people who ship" read as a
 * members-only sign; anyone with a voice, a screen and files belongs here.
 */
export const SUITE_TAGLINE = "your voice, your screen, your files — all on your device";

/**
 * Every outbound link the desktop app shows lives here. The checkout itself is
 * configured on the landing (NEXT_PUBLIC_CHECKOUT_URL), so the app only ever
 * points at the pricing section and never embeds a store URL of its own.
 */
export const SITE_URL = "https://shipshape.app";
export const PRICING_URL = `${SITE_URL}/#pricing`;
export const SUPPORT_URL = `${SITE_URL}/#faq`;
export const PRIVACY_URL = `${SITE_URL}/privacy`;
export const CHANGELOG_URL = `${SITE_URL}/changelog`;
/** Source + releases; the updater manifest is published on the GitHub release. */
export const REPO_URL = "https://github.com/SzymonnSowula/shipshape";
/**
 * Share links: the app uploads an export through the site's API and hands out
 * `${SITE_URL}/v/<id>`. The bucket behind it is configured on the site only.
 */
export const SHARE_API_URL = `${SITE_URL}/api/share`;
/** Watermark text on free-tier exports. */
export const WATERMARK_TEXT = `made with ${SUITE_NAME}`;
