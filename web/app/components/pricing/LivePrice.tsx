"use client";

import { LIST_PRICE, usd } from "@/lib/pricing";
import { usePricing } from "./usePricing";

/**
 * The price a key costs right now: the current launch step's price with the
 * list price struck through next to it, or just the list price once the launch
 * steps are gone.
 *
 * While the numbers load it holds its space with a placeholder rather than
 * flashing a price that may be wrong; if they cannot be read it shows the list
 * price, which is never more than the checkout will charge.
 */
export function LivePrice({
  className = "",
  priceClass,
  mutedClass,
}: {
  className?: string;
  /** The big number. */
  priceClass: string;
  /** Struck-through list price and "once". */
  mutedClass: string;
}) {
  const snapshot = usePricing();

  if (snapshot === undefined) {
    return (
      <span className={`inline-flex items-baseline gap-2 ${className}`} aria-busy="true">
        <span className={`${priceClass} inline-block w-[2.6ch] animate-pulse rounded-lg bg-current opacity-10`}>&nbsp;</span>
        <span className={mutedClass}>once</span>
      </span>
    );
  }

  const listPrice = snapshot?.listPrice ?? LIST_PRICE;
  const price = snapshot?.current.price ?? listPrice;
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${className}`}>
      <span className={priceClass}>{usd(price)}</span>
      {price < listPrice ? (
        <s className={mutedClass} aria-label={`instead of ${usd(listPrice)}`}>
          {usd(listPrice)}
        </s>
      ) : null}
      <span className={mutedClass}>once</span>
    </span>
  );
}

/** "launch price · keys 1-10 · 7 left" - or nothing once the list price applies. */
export function LiveStepNote({ className = "" }: { className?: string }) {
  const snapshot = usePricing();
  if (!snapshot) return <span className={`${className} invisible`}>&nbsp;</span>;

  const { current, listPrice, live } = snapshot;
  if (current.price >= listPrice) return <span className={className}>the full price, for good</span>;

  const left = live && current.left !== null ? ` · ${current.left} left` : "";
  return (
    <span className={className}>
      launch price · {current.label}
      {left}
    </span>
  );
}
