"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { WinDots } from "../components/WinDots";

/** The key, big enough to read aloud, with a copy button that says it worked. */
export function KeyBox({ licenseKey }: { licenseKey: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(licenseKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // clipboard refused (an old browser, an iframe) - the key is select-all anyway
    }
  };

  return (
    <div className="terminal">
      <div className="terminal-bar">
        <WinDots />
        <span className="ml-1.5 text-[11px] font-medium text-white/40">pro.license</span>
      </div>
      <div className="flex flex-col items-start gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
        <code className="select-all break-all font-mono text-[22px] font-semibold tracking-[0.06em] text-white sm:text-[26px]">
          {licenseKey}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="btn !h-10 shrink-0 bg-white/10 !px-5 text-[13px] text-white hover:bg-white/20"
        >
          {copied ? <Check size={15} className="text-[#30d158]" /> : <Copy size={15} />}
          {copied ? "copied" : "copy key"}
        </button>
      </div>
    </div>
  );
}
