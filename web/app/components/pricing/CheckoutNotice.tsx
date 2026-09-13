"use client";

import { useEffect, useState } from "react";

const MESSAGES: Record<string, string> = {
  unavailable: "The checkout could not be opened just now. Nothing was charged - try again in a minute.",
  busy: "That was a lot of checkout attempts from one network. Wait a minute and try again.",
  soon: "Checkout opens on launch day.",
};

/**
 * Says why /checkout sent the buyer back here (`?checkout=<reason>`), once,
 * above the plans. The page is static, so the reason is read in the browser.
 */
export function CheckoutNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("checkout");
    if (reason && MESSAGES[reason]) setMessage(MESSAGES[reason]);
  }, []);

  if (!message) return null;
  return (
    <p
      role="status"
      className="mx-auto mt-8 max-w-xl rounded-[12px] border border-[#1d1d1f]/10 bg-white/90 px-4 py-3 text-center text-[13.5px] font-medium text-[#1d1d1f] shadow-sm"
    >
      {message}
    </p>
  );
}
