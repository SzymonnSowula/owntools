"use client";

import { useEffect, useState } from "react";
import type { PricingSnapshot } from "@/lib/pricing";

/*
 * One request per page view, however many components show a price: the bill,
 * the pro card and the ladder all read this promise.
 */
let request: Promise<PricingSnapshot | null> | null = null;

function fetchPricing(): Promise<PricingSnapshot | null> {
  request ??= fetch("/api/pricing", { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? (res.json() as Promise<PricingSnapshot>) : null))
    .catch(() => null);
  return request;
}

/**
 * The launch-price ladder as the server sees it.
 *
 * `undefined` while it loads, `null` when it could not be read - callers then
 * show the plan without counts, never a guess at which step is current.
 */
export function usePricing(): PricingSnapshot | null | undefined {
  const [snapshot, setSnapshot] = useState<PricingSnapshot | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void fetchPricing().then((value) => {
      if (alive) setSnapshot(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return snapshot;
}
