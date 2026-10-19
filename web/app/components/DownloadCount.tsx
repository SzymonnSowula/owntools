"use client";

import { useEffect, useState } from "react";
import type { DownloadCounts } from "@/lib/downloads";
import { formatCount, showsCount } from "@/lib/downloads";
import { downloadsMin } from "@/lib/site";

/*
 * One request per page view, however many places show the number.
 */
let request: Promise<DownloadCounts | null> | null = null;

function fetchDownloads(): Promise<DownloadCounts | null> {
  request ??= fetch("/api/downloads", { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? (res.json() as Promise<DownloadCounts>) : null))
    .catch(() => null);
  return request;
}

/**
 * How many downloads GitHub has counted.
 *
 * `undefined` while it loads, `null` when it could not be read - the badge
 * then renders nothing at all, which is also what it does below
 * `NEXT_PUBLIC_DOWNLOADS_MIN` (lib/site.ts). It is a number that helps only
 * once it is big; until then the space is better left empty than filled with
 * a discouraging figure.
 */
export function useDownloads(): DownloadCounts | null | undefined {
  const [counts, setCounts] = useState<DownloadCounts | null | undefined>(undefined);

  useEffect(() => {
    // Nothing to fetch while the badge is switched off - and nothing to pay
    // for it either.
    if (downloadsMin === null) {
      setCounts(null);
      return;
    }
    let alive = true;
    void fetchDownloads().then((value) => {
      if (alive) setCounts(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return counts;
}

/**
 * "2,481 downloads" - or nothing. It takes no space of its own while it
 * loads, so the layout around it must not depend on it being there.
 */
export function DownloadCount({ className = "", suffix = "downloads" }: { className?: string; suffix?: string }) {
  const counts = useDownloads();
  if (!counts || !showsCount(counts.total, downloadsMin)) return null;
  return (
    <span className={className}>
      <strong className="font-semibold">{formatCount(counts.total)}</strong> {suffix}
    </span>
  );
}
