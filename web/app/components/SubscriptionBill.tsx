/**
 * "the math" - the ten jobs owntools does, priced the way they are usually
 * bought: one subscription each. The bill ends in red, and the strip under it
 * is what the same ten jobs cost here, with the live launch price.
 *
 * Data and the rules it was collected under: lib/comparison.ts. Kept neutral
 * on purpose - vendor names, list prices and the date they were checked, no
 * adjectives about anyone's product - because comparative advertising has to
 * be objective and checkable, and because the numbers make the point alone.
 * No footnotes under the bill (taken off on 2026-09-14); how the two figures
 * that are not a plain yearly price were worked out sits next to their rows.
 */

import { ArrowDown } from "lucide-react";
import { SUBSCRIPTIONS, SUBSCRIPTIONS_CHECKED, SUBSCRIPTIONS_TOTAL_CENTS, centsToAmount } from "@/lib/comparison";
import { Reveal } from "./Reveal";
import { WinDots } from "./WinDots";
import { LivePrice, LiveStepNote } from "./pricing/LivePrice";

export function SubscriptionBill() {
  return (
    <section id="the-math" className="cv border-t border-line px-5 py-20 md:py-28" style={{ ["--cv" as string]: "1500px", ["--cv-lg" as string]: "1300px" }}>
      <div className="mx-auto max-w-5xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="kicker">the math</p>
          <h2 className="display mt-3 text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
            ten subscriptions,
            <br />
            <span className="dim">or one app paid once</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-7 text-muted">
            The cheapest yearly plan of each, for one person.
          </p>
        </Reveal>

        <Reveal delay={0.06} className="mt-12">
          <div className="wincard !rounded-[18px]">
            <div className="wincard-bar">
              <WinDots />
              <span className="wincard-title">the-bill.csv</span>
              <span className="ml-auto hidden font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted sm:block">
                list prices · {SUBSCRIPTIONS_CHECKED}
              </span>
            </div>

            <div className="px-4 pt-3 sm:px-8 sm:pt-6">
              <table className="w-full table-fixed border-collapse text-[13.5px] sm:text-[15px]">
                <caption className="sr-only">
                  What the ten jobs cost as separate subscriptions, per year, in US dollars
                </caption>
                <thead>
                  <tr className="border-b-[1.5px] border-ink/70 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted sm:text-[11px]">
                    <th scope="col" className="w-[40%] pb-3 pr-3 font-bold sm:w-[31%]">
                      the job
                    </th>
                    <th scope="col" className="w-[35%] pb-3 pr-3 font-bold sm:w-[28%]">
                      the subscription
                    </th>
                    <th scope="col" className="hidden pb-3 pr-3 font-bold sm:table-cell sm:w-[21%]">
                      in owntools
                    </th>
                    <th scope="col" className="w-[25%] pb-3 text-right font-bold sm:w-[20%]">
                      $ / year
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SUBSCRIPTIONS.map((row) => (
                    <tr key={row.app} className="border-b border-line align-top">
                      <td className="py-3 pr-3 text-ink">
                        {row.job}
                        <span className="mt-0.5 block font-mono text-[11px] text-accent sm:hidden">{row.tool}</span>
                      </td>
                      <td className="py-3 pr-3 text-muted">{row.app}</td>
                      <td className="hidden py-3 pr-3 font-mono text-[13px] text-accent sm:table-cell">{row.tool}</td>
                      <td className="whitespace-nowrap py-3 text-right font-mono tabular-nums text-ink">
                        {centsToAmount(row.cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="align-baseline">
                    <td colSpan={2} className="pb-5 pt-4 font-semibold text-ink sm:pb-6">
                      total, {SUBSCRIPTIONS.length} annual plans
                    </td>
                    <td className="hidden sm:table-cell" />
                    <td className="whitespace-nowrap pb-5 pt-4 text-right font-mono text-lg font-bold tabular-nums text-alert sm:pb-6 sm:text-xl">
                      {centsToAmount(SUBSCRIPTIONS_TOTAL_CENTS)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* what the same ten jobs cost here */}
            <div className="flex flex-col gap-3 border-t border-accent/25 bg-accent/[0.07] px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <div>
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <svg width="16" height="16" viewBox="0 0 12 12" className="text-accent" aria-hidden>
                    <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" fill="currentColor" />
                  </svg>
                  owntools · all ten, in one app
                </p>
                <p className="mt-1 text-[13px] text-muted">
                  no renewal · next year the ten plans cost another{" "}
                  <span className="font-mono text-alert">${centsToAmount(SUBSCRIPTIONS_TOTAL_CENTS)}</span>
                </p>
              </div>
              <div className="sm:text-right">
                <LivePrice
                  priceClass="font-display text-3xl font-extrabold tracking-[-0.04em] text-accent sm:text-4xl"
                  mutedClass="text-[15px] font-semibold text-muted"
                />
                <LiveStepNote className="mt-0.5 block text-[12px] font-semibold text-muted" />
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1} className="mt-6 flex justify-center">
          <a href="#pricing" className="btn btn-primary !h-10 !px-5 text-[13px]">
            see the launch prices <ArrowDown size={14} />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
