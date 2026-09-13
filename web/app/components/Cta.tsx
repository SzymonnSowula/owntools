import type { ReactNode } from "react";
import { checkoutUrl, downloadUrl, downloadUrlMac } from "@/lib/site";

/** Copy shown in place of the two CTAs while their destinations are unset. */
export const DOWNLOAD_SOON = "windows build - launching soon";
export const MAC_DOWNLOAD_SOON = "mac build - launching soon";
export const CHECKOUT_SOON = "checkout opens on launch day";

/**
 * A call to action that is only a link once its destination exists.
 *
 * Download and checkout URLs come from env (`lib/site.ts`) and are unset
 * before launch. Rather than pointing a button at "#pricing" — where it would
 * scroll to itself — the same pill renders as inert text carrying the reason,
 * so every "get it" button on the site tells one story from one place.
 */
export function Cta({
  href,
  fallback,
  className,
  children,
}: {
  /** Destination; when undefined the fallback state renders instead. */
  href?: string;
  /** What the pill says while there is no destination yet. */
  fallback: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <span
      role="link"
      aria-disabled="true"
      className={`${className ?? ""} pointer-events-none cursor-default`.trim()}
    >
      {fallback}
    </span>
  );
}

/** "download for windows" — a link once NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS is set. */
export function DownloadCta({
  className,
  children,
  fallback = DOWNLOAD_SOON,
}: {
  className?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <Cta href={downloadUrl} fallback={fallback} className={className}>
      {children}
    </Cta>
  );
}

/** "download for mac" — a link once NEXT_PUBLIC_DOWNLOAD_URL_MACOS is set. */
export function MacDownloadCta({
  className,
  children,
  fallback = MAC_DOWNLOAD_SOON,
}: {
  className?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <Cta href={downloadUrlMac} fallback={fallback} className={className}>
      {children}
    </Cta>
  );
}

/**
 * "get the pro key" — a link once there is somewhere to buy. The page passes
 * `/checkout` when Polar is configured (that route picks the launch-price step);
 * without it, a checkout link pasted into NEXT_PUBLIC_CHECKOUT_URL still works.
 */
export function CheckoutCta({
  className,
  children,
  href = checkoutUrl,
  fallback = CHECKOUT_SOON,
}: {
  className?: string;
  children: ReactNode;
  href?: string;
  fallback?: ReactNode;
}) {
  return (
    <Cta href={href} fallback={fallback} className={className}>
      {children}
    </Cta>
  );
}
