"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-asks the server every few seconds while a payment is being confirmed -
 * a card with 3-D Secure can take a moment after Polar has already redirected.
 * Gives up after two minutes; the page then says what to do.
 */
export function AutoRefresh({ everyMs = 3000, tries = 40 }: { everyMs?: number; tries?: number }) {
  const router = useRouter();

  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      if (count > tries) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs, tries]);

  return null;
}
