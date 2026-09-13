/**
 * "the math" - what the ten jobs owntools does cost as separate subscriptions.
 *
 * Rules the numbers were collected under, and have to keep following:
 * - each vendor's own pricing page, in USD, checked on SUBSCRIPTIONS_CHECKED;
 * - the cheapest paid plan for one person, billed yearly;
 * - only apps that run on Windows (Screen Studio and CleanShot X are Mac-only,
 *   so FocuSee and Snagit stand in for them).
 * Source: the "Tablica suneai" artifact (2026-09-13). Comparative advertising
 * in the EU has to be objective and checkable, so a figure that was worked out
 * or read indirectly carries a mark and a footnote rather than passing as a
 * list price. Prices drift - re-check before quoting them anywhere new.
 */

export interface SubscriptionRow {
  /** What the job is, in plain words. */
  job: string;
  /** The subscription it is usually bought as. */
  app: string;
  /** Per year, in cents (floats do not add up to 964.93). */
  cents: number;
  /** Where the same job lives in owntools. */
  tool: string;
  /** "≈" worked out from a monthly price, "*" read from page data - see NOTES. */
  mark?: "≈" | "*";
}

export const SUBSCRIPTIONS_CHECKED = "13 Sep 2026";

export const SUBSCRIPTIONS: readonly SubscriptionRow[] = [
  { job: "dictation", app: "Superwhisper Pro", cents: 8499, tool: "dictate" },
  { job: "screen recording with auto-zoom", app: "FocuSee Standard", cents: 4999, tool: "screeni" },
  { job: "editing video by editing text", app: "Descript Hobbyist", cents: 19200, tool: "screeni · script" },
  { job: "transcribing files", app: "TurboScribe Unlimited", cents: 12000, tool: "transcribe" },
  { job: "meeting notes", app: "Otter Pro", cents: 9996, tool: "meet", mark: "≈" },
  { job: "scheduling posts", app: "Typefully Creator", cents: 9900, tool: "social" },
  { job: "screenshots", app: "Snagit", cents: 3900, tool: "capture" },
  { job: "whiteboard", app: "Excalidraw+", cents: 7200, tool: "board" },
  { job: "focus music", app: "Brain.fm", cents: 9999, tool: "focus · sounds" },
  { job: "PDF tools", app: "Smallpdf Pro", cents: 10800, tool: "quick tools", mark: "*" },
];

export const SUBSCRIPTIONS_TOTAL_CENTS = SUBSCRIPTIONS.reduce((sum, row) => sum + row.cents, 0);

/** The footnotes the marks point at. */
export const SUBSCRIPTION_NOTES: Record<NonNullable<SubscriptionRow["mark"]>, string> = {
  "≈": "Otter lists Pro at $8.33 a month on the yearly plan; the figure is that times 12.",
  "*": "Smallpdf's price table did not load when checked; the figure comes from the pricing data on its own page.",
};

/** 96493 → "964.93" (no currency sign - the column header carries it). */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}
