import type { ReactNode } from "react";
import { pricingSnapshot, usd } from "@/lib/pricing";

/** Written from lib/pricing.ts, so the answer cannot drift from the ladder. */
function launchPriceAnswer(): string {
  const tiers = pricingSnapshot(null).tiers;
  const steps = tiers.slice(0, -1).map((t, i) => `${i === 0 ? "the first" : "the next"} ${t.cap} keys cost ${usd(t.price)}`);
  const list = usd(tiers[tiers.length - 1].price);
  return `Launch pricing: ${steps.join(", ")}, then ${list}. Every step gets the same key and the same updates.`;
}

const ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: "Who is it for?",
    a: "Anyone who works on a screen - students, teachers, writers, support teams, developers. No job title required.",
  },
  {
    q: "What's in the app?",
    a: "Eight tools: dictate, screeni (screen recording), meet (call transcripts), focus, board (whiteboard), social (post scheduler), disk (drive cleanup) and launch (link to video), plus twelve quick file tools.",
  },
  {
    q: "Is my data really local?",
    a: "Yes. There is no account, no telemetry and no cloud. Settings → Privacy lists every request the app makes, such as a model download or an update check, and offline mode blocks them all.",
  },
  {
    q: "Does meet join my calls?",
    a: "No. It records your mic and your speakers on your computer, so no bot joins and nothing is uploaded.",
  },
  {
    q: "What does the on-device AI need?",
    a: "About 2.5 GB of disk and 4 GB of free RAM; a lighter model fits an 8 GB laptop. It runs on your CPU, so the first answer takes a moment. A cloud key is optional and off by default.",
  },
  {
    q: "Does sync need an account?",
    a: "No. It syncs through a folder you already sync, like Dropbox or iCloud Drive. Recordings and keys never sync.",
  },
  {
    q: "Which social networks work today?",
    a: "Bluesky, Mastodon, Telegram, Discord, Slack, Dev.to and Medium. X and LinkedIn work with your own developer app, and more networks are coming.",
  },
  {
    q: "What's the difference between free and Pro?",
    a: "Only the small badge on exported videos. Pro removes it with a one-time payment.",
  },
  {
    q: "Why is it cheaper at the start?",
    a: launchPriceAnswer(),
  },
  {
    q: "How does the Pro key work?",
    a: (
      <>
        Paste it into the app once. It is checked on your computer, with no account and no server. Not for you?
        There is a 14-day{" "}
        <a href="/refunds" className="font-semibold text-accent underline underline-offset-4">
          refund
        </a>
        , no questions asked.
      </>
    ),
  },
  {
    q: "Which platforms?",
    a: "Windows 10 and 11, and macOS 11 or newer on Apple Silicon and Intel. meet is Windows-only for now.",
  },
  {
    q: "Do I need any setup?",
    a: "No. Dictation downloads its speech model once (about 575 MB); after that everything works offline.",
  },
];

/**
 * Native <details>: every answer is in the HTML (readable without script, and
 * by search engines), and opening one costs no JavaScript. The look lives in
 * .faq in globals.css - twelve copies of a utility string and an inline
 * chevron were a few KB of the page, twice over (HTML and the RSC payload).
 */
export function Faq() {
  return (
    <div className="faq">
      {ITEMS.map((item, i) => (
        <details key={item.q} open={i === 0}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
