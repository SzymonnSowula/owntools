import { ArrowDown, ArrowRight } from "lucide-react";
import { downloadUrl } from "@/lib/site";
import { CheckoutCta, DownloadCta } from "./Cta";
import { Reveal } from "./Reveal";
import { LivePrice, LiveStepNote } from "./pricing/LivePrice";

/**
 * A way to get owntools between two sections. Pricing sits near the end of a
 * long page, so without these the only buttons on the way down were the hero's
 * and the nav's (2026-09-15).
 *
 * One line, what the price buys, the live launch price and a button: the pro
 * key before launch - its receipt carries the installer - and the free
 * download next to it once there is one. With neither a download nor a
 * checkout configured the button leads to the plans instead of going dead.
 */
export function CtaBand({ title, checkoutHref }: { title: string; checkoutHref?: string }) {
  return (
    <div className="px-5 py-6 md:py-8">
      <Reveal className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-5 rounded-[20px] border border-accent/25 bg-accent/[0.07] px-5 py-6 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="display text-2xl leading-tight md:text-[28px]">{title}</p>
            <p className="mt-1.5 text-[14px] text-muted">Every tool is free. Pro removes the badge from exports.</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
            <div className="md:text-right">
              <LivePrice
                priceClass="font-display text-[28px] font-extrabold tracking-[-0.04em] text-accent"
                mutedClass="text-[13px] font-semibold text-muted"
              />
              <LiveStepNote className="block text-[11.5px] font-semibold text-muted" />
            </div>
            <div className="flex w-full flex-wrap gap-2.5 sm:w-auto">
              {downloadUrl ? (
                <DownloadCta className="btn btn-primary !h-11 flex-1 !px-5 text-[14px] sm:flex-none">download free</DownloadCta>
              ) : null}
              {checkoutHref ? (
                <CheckoutCta href={checkoutHref} className="btn btn-accent !h-11 flex-1 !px-5 text-[14px] sm:flex-none">
                  get the pro key <ArrowRight size={15} />
                </CheckoutCta>
              ) : downloadUrl ? null : (
                <a href="#pricing" className="btn btn-accent !h-11 flex-1 !px-5 text-[14px] sm:flex-none">
                  see pricing <ArrowDown size={15} />
                </a>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
