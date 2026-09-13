import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";
import { lookupPurchase, type Purchase } from "@/lib/polar";
import { pricingSnapshot } from "@/lib/pricing";
import { allowRequest, clientAddress } from "@/lib/rateLimit";
import { REFUND_DAYS, contactEmail, downloadUrl, downloadUrlMac, xUrl } from "@/lib/site";
import { AutoRefresh } from "./AutoRefresh";
import { KeyBox } from "./KeyBox";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Pro key",
  robots: { index: false, follow: false },
  // the URL carries the checkout id; keep it out of Referer headers
  referrer: "no-referrer",
};

type View = Purchase | { state: "error" } | { state: "busy" };

/**
 * Where Polar sends the buyer after paying (`success_url` =
 * /thanks?checkout_id={CHECKOUT_ID}, set in lib/polar.ts).
 *
 * The page asks Polar about that checkout and, once the order is paid, shows
 * the key derived from the order id - so the same link shows the same key
 * next week too, and nothing had to be stored or e-mailed for it to work.
 */
export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const checkoutId = typeof params.checkout_id === "string" ? params.checkout_id : undefined;

  let view: View;
  if (!allowRequest(`thanks:${clientAddress(await headers())}`, 30, 60_000)) {
    view = { state: "busy" };
  } else {
    try {
      view = await lookupPurchase(checkoutId);
    } catch (err) {
      console.error("[thanks]", err);
      view = { state: "error" };
    }
  }

  return (
    <div id="top">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="display text-[17px] font-bold tracking-[-0.03em]">
            owntools
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="dotted min-h-[calc(100vh-61px)]">
        <div className="mx-auto max-w-2xl px-5 pb-24 pt-14 md:pt-20">{render(view)}</div>
      </main>
    </div>
  );
}

/**
 * "Write to … from the address you paid with." as a whole sentence - the
 * shared ContactLink reads as a placeholder mid-sentence when no address is
 * configured yet.
 */
function WriteToUs({ lead }: { lead: string }) {
  // "Lost both? Write to…" but "…anyway, write to…"
  const verb = (word: string) => (/[.?!]$/.test(lead.trim()) ? word[0].toUpperCase() + word.slice(1) : word);
  if (contactEmail) {
    return (
      <>
        {lead} {verb("write")} to{" "}
        <a href={`mailto:${contactEmail}`} className="font-semibold text-accent underline underline-offset-4">
          {contactEmail}
        </a>{" "}
        from the address you paid with.
      </>
    );
  }
  if (xUrl) {
    return (
      <>
        {lead} {verb("send")} a message{" "}
        <a href={xUrl} rel="noreferrer" className="font-semibold text-accent underline underline-offset-4">
          on X
        </a>{" "}
        with the address you paid with.
      </>
    );
  }
  return (
    <>
      {lead} {verb("get")} in touch through owntools.app with the address you paid with.
    </>
  );
}

function render(view: View): ReactNode {
  switch (view.state) {
    case "paid":
      return <Paid view={view} />;
    case "pending":
      return (
        <Message kicker="one moment" title="confirming your payment">
          <AutoRefresh />
          <p className="flex items-center gap-2">
            <LoaderCircle size={16} className="shrink-0 animate-spin text-accent" />
            Polar is confirming it with your bank. This page refreshes by itself and shows your key as
            soon as the payment clears.
          </p>
          <p>
            <WriteToUs lead="Still here after a couple of minutes? Keep this tab open and" />
          </p>
        </Message>
      );
    case "unpaid":
      return view.status === "open" ? (
        <Message kicker="not finished" title="the checkout is still open">
          <p>Nothing has been charged yet. Pick up where you left off:</p>
          <a href={view.url} className="btn btn-accent mt-2 !h-11">
            back to the checkout <ArrowRight size={15} />
          </a>
        </Message>
      ) : (
        <Message kicker="nothing charged" title={view.status === "failed" ? "the payment didn't go through" : "this checkout expired"}>
          <p>No money moved. Start a fresh checkout - it opens at the current launch price.</p>
          <a href="/checkout" className="btn btn-accent mt-2 !h-11">
            start again <ArrowRight size={15} />
          </a>
        </Message>
      );
    case "refunded":
      return (
        <Message kicker="refunded" title="this order was refunded">
          <p>
            There is no key to show for it any more. The free version keeps working, badge and all -
            and if you remove the key from Settings → License, you are square.
          </p>
        </Message>
      );
    case "not-found":
      return (
        <Message kicker="nothing here" title="no purchase at this link">
          <p>
            This page shows a Pro key right after a checkout.{" "}
            <WriteToUs lead="If you just paid and landed here anyway," /> You will get your key.
          </p>
          <Link href="/#pricing" className="btn btn-primary mt-2 !h-11">
            see pricing <ArrowRight size={15} />
          </Link>
        </Message>
      );
    case "unconfigured":
      return (
        <Message kicker="not on sale yet" title="checkout opens on launch day">
          <p>The shop is not switched on on this server, so there is no purchase to look up.</p>
        </Message>
      );
    case "busy":
    case "error":
      return (
        <Message kicker="try again" title="couldn't reach the payment provider">
          <p>
            Your payment is safe either way - this page only reads it. Refresh in a minute.{" "}
            <WriteToUs lead="If it keeps happening," />
          </p>
        </Message>
      );
  }
}

function Paid({ view }: { view: Extract<Purchase, { state: "paid" }> }) {
  const step = view.tier ? pricingSnapshot(null).tiers.find((t) => t.key === view.tier) : null;
  const paid = new Intl.NumberFormat("en-US", { style: "currency", currency: view.order.currency.toUpperCase() }).format(
    view.order.total_amount / 100,
  );

  return (
    <>
      <p className="kicker">thank you</p>
      <h1 className="display mt-3 text-4xl md:text-5xl">your pro key</h1>
      <p className="mt-4 text-[16px] leading-7 text-muted">
        Paste it into owntools once and the badge is gone from everything you export - on each machine
        you own, with the wi-fi on or off.
      </p>

      <div className="mt-8">
        <KeyBox licenseKey={view.key} />
      </div>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        paid {paid}
        {step && step.key !== "list" ? ` · launch price, ${step.label}` : ""} · receipt from polar in your inbox
      </p>

      <ol className="mt-10 space-y-4">
        <Step n={1} title="install owntools">
          {downloadUrl || downloadUrlMac ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {downloadUrl ? (
                <a href={downloadUrl} className="btn btn-primary !h-10 !px-4 text-[13px]">
                  download for windows
                </a>
              ) : null}
              {downloadUrlMac ? (
                <a href={downloadUrlMac} className="btn !h-10 border border-line bg-card !px-4 text-[13px] font-semibold">
                  download for mac
                </a>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-[14px] leading-6 text-muted">
              The installer is in the receipt e-mail from Polar, under your purchase.
            </p>
          )}
        </Step>
        <Step n={2} title="paste the key">
          <p className="mt-1 text-[14px] leading-6 text-muted">
            Open <span className="font-semibold text-ink">Settings → License</span>, paste the key and press{" "}
            <span className="font-semibold text-ink">Activate</span>. It is checked on your machine - no
            account, nothing to sign into.
          </p>
        </Step>
        <Step n={3} title="that's it">
          <p className="mt-1 text-[14px] leading-6 text-muted">
            The key never expires and covers every future update. If owntools is not for you, there are{" "}
            <Link href="/refunds" className="font-semibold text-accent underline underline-offset-4">
              {REFUND_DAYS} days to get your money back
            </Link>
            .
          </p>
        </Step>
      </ol>

      <p className="mt-10 rounded-[14px] border border-line bg-card px-5 py-4 text-[13.5px] leading-6 text-muted">
        <span className="font-semibold text-ink">keep the key somewhere safe.</span> This link shows it
        again whenever you open it, so bookmark it. <WriteToUs lead="Lost both?" />
      </p>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    // `!` because the un-layered .wincard rule sets flex-direction: column
    <li className="wincard !flex-row gap-4 p-5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 font-mono text-[12px] font-bold text-accent">
        {n}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold text-ink">
          {title}
          {n === 3 ? <Check size={15} className="text-accent" /> : null}
        </p>
        {children}
      </div>
    </li>
  );
}

function Message({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <>
      <p className="kicker">{kicker}</p>
      <h1 className="display mt-3 text-4xl md:text-5xl">{title}</h1>
      <div className="mt-6 space-y-4 text-[15.5px] leading-7 text-muted">{children}</div>
    </>
  );
}
