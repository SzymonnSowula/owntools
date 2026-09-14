"use client";

import { Check } from "lucide-react";
import { pricingSnapshot, usd, type PricingSnapshot, type TierView } from "@/lib/pricing";
import { WinDots } from "../WinDots";
import { usePricing } from "./usePricing";

/** The plan as written in lib/pricing.ts - what shows until the live numbers arrive. */
const PLAN = pricingSnapshot(null);

/**
 * The launch-price ladder, for the pricing section (forced-light, like the
 * plan windows around it). Every step is shown from the first paint - the rule
 * is public and does not change - and only "which step is now" and "how many
 * are left" wait for /api/pricing.
 */
export function PriceLadder() {
  const snapshot = usePricing() ?? null;
  const tiers = (snapshot ?? PLAN).tiers;

  return (
    <div className="wincard wincard--light">
      <div className="wincard-bar">
        <WinDots />
        <span className="wincard-title">launch.pricing</span>
        <span className="ml-auto text-[10.5px] font-semibold text-[#6e6e73]">the price only goes up</span>
      </div>
      <ol className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
        {tiers.map((tier) => (
          <Step key={tier.key} tier={tier} snapshot={snapshot} />
        ))}
      </ol>
      <p className="border-t border-[#1d1d1f]/10 px-5 py-4 text-[13px] leading-6 text-[#6e6e73]">
        Every step buys the same key, with every future update.
      </p>
    </div>
  );
}

function Step({ tier, snapshot }: { tier: TierView; snapshot: PricingSnapshot | null }) {
  const status = snapshot ? tier.status : null;
  const current = status === "current";
  const gone = status === "sold-out";

  return (
    <li
      className={`flex flex-col rounded-[12px] border p-4 ${
        current
          ? "border-accent bg-[#eef6ff] shadow-[0_10px_28px_rgba(10,132,255,0.16)]"
          : "border-[#1d1d1f]/12 bg-white"
      }`}
      aria-current={current ? "step" : undefined}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#6e6e73]">{tier.label}</span>
        {current ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">now</span>
        ) : gone ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6e6e73]">
            <Check size={11} strokeWidth={3} /> gone
          </span>
        ) : null}
      </div>
      <p
        className={`mt-2 font-display text-4xl font-extrabold tracking-[-0.045em] ${
          gone ? "text-[#6e6e73] line-through decoration-2" : "text-[#1d1d1f]"
        }`}
      >
        {usd(tier.price)}
      </p>
      <p className="mt-1 text-[12.5px] leading-5 text-[#6e6e73]">{caption(tier, snapshot)}</p>
      {current && snapshot?.live && tier.cap !== null ? <Meter sold={tier.sold} cap={tier.cap} /> : null}
    </li>
  );
}

function caption(tier: TierView, snapshot: PricingSnapshot | null): string {
  if (tier.cap === null) {
    return snapshot && tier.status === "current" ? "every key from now on" : "every key after that";
  }
  if (snapshot?.live && tier.status === "sold-out") return `all ${tier.cap} taken`;
  if (snapshot?.live && tier.status === "current") return `${tier.left} of ${tier.cap} left`;
  return tier.firstKey === 1 ? `the first ${tier.cap} keys` : `the next ${tier.cap} keys`;
}

/** Dots while a step is small enough to count by eye, a bar after that. */
function Meter({ sold, cap }: { sold: number; cap: number }) {
  const label = `${sold} of ${cap} keys taken`;
  if (cap <= 20) {
    return (
      <span className="mt-3 flex flex-wrap gap-1" role="img" aria-label={label}>
        {Array.from({ length: cap }, (_, i) => (
          <span
            key={i}
            className={`h-2 w-2 rounded-full ${i < sold ? "bg-accent" : "border border-accent/40 bg-white"}`}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#1d1d1f]/10"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={sold}
    >
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(sold > 0 ? 3 : 0, (sold / cap) * 100)}%` }} />
    </span>
  );
}
