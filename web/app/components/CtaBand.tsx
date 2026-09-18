import { ArrowDown } from "lucide-react";
import { Reveal } from "./Reveal";
import { LivePrice, LiveStepNote } from "./pricing/LivePrice";

/**
 * A way to get owntools between two sections. Pricing sits near the end of a
 * long page, so without these the only buttons on the way down were the hero's
 * and the nav's (2026-09-15).
 *
 * One line, what the key buys, the live launch price and one button. Every
 * button leads to the plans (2026-09-18): the free download and the Pro key
 * sit side by side there, so a visitor sees the whole offer before choosing.
 */
export function CtaBand({ title }: { title: string; checkoutHref?: string }) {
  return (
    <div className="px-5 py-6 md:py-8">
      <Reveal className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-5 rounded-[20px] border border-accent/25 bg-accent/[0.07] px-5 py-6 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="display text-2xl leading-tight md:text-[28px]">{title}</p>
            <p className="mt-1.5 text-[14px] text-muted">
              dictate and the quick file tools are free. One key unlocks every other tool, for good.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
            <div className="md:text-right">
              <LivePrice
                priceClass="font-display text-[28px] font-extrabold tracking-[-0.04em] text-accent"
                mutedClass="text-[13px] font-semibold text-muted"
              />
              <LiveStepNote className="block text-[11.5px] font-semibold text-muted" />
            </div>
            <a href="#pricing" className="btn btn-accent !h-11 w-full !px-5 text-[14px] sm:w-auto">
              get owntools <ArrowDown size={15} />
            </a>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
