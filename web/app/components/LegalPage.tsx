import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { contactEmail, legalAddress, legalEntity, xUrl } from "@/lib/site";

/** The document pages, in the order they are cross-linked. */
const DOCS = [
  { href: "/privacy", label: "privacy" },
  { href: "/terms", label: "terms" },
  { href: "/refunds", label: "refunds" },
  { href: "/changelog", label: "changelog" },
];

/**
 * Shared frame for the legal pages and the changelog: the sticky header from
 * the free-tool page, the dotted desk, one readable column of prose (styled
 * by `.doc` in globals.css) and a small docs nav at the bottom.
 */
export function LegalPage({
  kicker,
  title,
  intro,
  updated,
  children,
}: {
  kicker: string;
  title: string;
  intro?: ReactNode;
  /** ISO date shown as "last updated …". */
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div id="top">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="display text-[17px] font-bold tracking-[-0.03em]">
            shipshape
          </Link>
          <div className="flex items-center gap-3">
            <nav className="hidden items-center gap-4 text-sm font-medium text-muted md:flex">
              {DOCS.map((d) => (
                <Link key={d.href} href={d.href} className="transition hover:text-ink">
                  {d.label}
                </Link>
              ))}
            </nav>
            <ThemeToggle />
            <Link href="/#pricing" className="btn btn-primary !h-9 !px-4 text-[13px]">
              get the desktop app
            </Link>
          </div>
        </div>
      </header>

      <main className="dotted">
        <div className="mx-auto max-w-2xl px-5 pb-24 pt-14 md:pt-20">
          <p className="kicker">{kicker}</p>
          <h1 className="display mt-3 text-4xl md:text-5xl">{title}</h1>
          {intro ? <p className="mt-4 text-[16px] leading-7 text-muted">{intro}</p> : null}
          {updated ? (
            <p className="mt-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              last updated {updated}
            </p>
          ) : null}

          <div className="doc mt-10">{children}</div>

          <footer className="mt-16 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6 text-sm text-muted">
            <Link href="/" className="transition hover:text-ink">
              ← shipshape
            </Link>
            {DOCS.map((d) => (
              <Link key={d.href} href={d.href} className="transition hover:text-ink">
                {d.label}
              </Link>
            ))}
          </footer>
        </div>
      </main>
    </div>
  );
}

/**
 * How to reach the operator. Email when configured, otherwise the account on
 * X, otherwise an honest placeholder — never an invented address.
 */
export function ContactLink() {
  if (contactEmail) {
    return <a href={`mailto:${contactEmail}`}>{contactEmail}</a>;
  }
  if (xUrl) {
    return (
      <>
        via the account on X —{" "}
        <a href={xUrl} rel="noreferrer">
          {xUrl.replace(/^https?:\/\//, "")}
        </a>
      </>
    );
  }
  return <>contact details will be published before launch</>;
}

/** Operator details + contact, closing every legal page. */
export function Operator() {
  return (
    <>
      <h2 id="contact">operator &amp; contact</h2>
      {legalEntity ? (
        <p>
          shipshape is operated by <strong>{legalEntity}</strong>
          {legalAddress ? <>, {legalAddress}</> : null}.
        </p>
      ) : (
        <p>Operator details are listed at the address below.</p>
      )}
      <p>
        Contact: <ContactLink />
      </p>
    </>
  );
}
