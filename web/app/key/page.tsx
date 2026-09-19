import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { contactEmail } from "@/lib/site";
import { KeyForm, type KeyFormState } from "./KeyForm";

export const metadata: Metadata = {
  title: "Get your Pro key again",
  description: "Lost your owntools Pro key? Enter the e-mail address you paid with and it is sent to you again.",
  robots: { index: false, follow: false },
};

const STATES: KeyFormState[] = ["sent", "invalid", "busy", "unconfigured", "error"];

/**
 * "I lost my key" without anyone having to be written to: the address goes to
 * /api/key, and the key - if that address bought one - goes to the address.
 * The receipt note, the purchase e-mail, the FAQ and Settings → License all
 * point here.
 *
 * `?state=` is only ever set by /api/key answering a plain form post (the
 * page's script did not run); it names an outcome, never an address.
 */
export default async function KeyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initial = STATES.find((s) => s === params.state) ?? "idle";

  return (
    <div id="top">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="display text-[17px] font-bold tracking-[-0.03em]">
            owntools
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="dotted min-h-[calc(100vh-61px)]">
        <div className="mx-auto max-w-2xl px-5 pb-24 pt-14 md:pt-20">
          <p className="kicker">lost your key?</p>
          <h1 className="display mt-3 text-4xl md:text-5xl">get it again</h1>
          <p className="mt-4 text-[16px] leading-7 text-muted">
            Enter the e-mail address you paid with and your Pro key is sent there again. It is only ever sent to
            the address that bought it.
          </p>

          <div className="mt-8">
            <KeyForm contact={contactEmail} initial={initial} />
          </div>

          <div className="mt-8 space-y-3 text-[14px] leading-6 text-muted">
            <p>
              <span className="font-semibold text-ink">New computer?</span> You do not need this page - paste the key
              you already have into Settings → License there. One key covers one computer at a time, and there is
              nothing to transfer.
            </p>
            <p>
              <span className="font-semibold text-ink">The address no longer exists?</span> Write to{" "}
              <a href={`mailto:${contactEmail}`} className="font-semibold text-accent underline underline-offset-4">
                {contactEmail}
              </a>{" "}
              with the order number from Polar&rsquo;s receipt.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
