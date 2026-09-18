import type { Metadata } from "next";
import { LegalPage, Operator } from "../components/LegalPage";
import { shareTtlDays } from "@/lib/share";
import { POLICIES_UPDATED, REFUND_DAYS } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The plain-English rules for using owntools and the Pro key: a personal license for one computer at a time, no resale of keys, software provided as is, Polish law.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      kicker="legal"
      title="terms"
      intro="The plain-English rules for using owntools and the Pro key. They are short because the product is simple: a desktop app that runs on your machine, and a key that unlocks its tools."
      updated={POLICIES_UPDATED}
    >
      <h2>the free app</h2>
      <p>
        owntools is free to download and use, for personal and commercial work alike. Without a
        key the app holds dictate and the quick file tools, with no time limit; every other tool
        shows what it does and asks for a key.
      </p>

      <h2>the pro key</h2>
      <p>
        Buying a Pro key gives you a personal, non-exclusive license to use every tool in
        owntools - yours, not for passing on to someone else. The key:
      </p>
      <ul>
        <li>works offline and without an account - it is checked on your machine, not on a server;</li>
        <li>
          covers one computer at a time. Moving to a new one? Deactivate it on the old computer first
          (Settings → License → Deactivate) and activate it on the new one. If the old computer is
          gone, write to us and we move the key;
        </li>
        <li>covers updates to the app as we release them;</li>
        <li>
          unlocks focus, screeni, capture, board, meet, social, disk and launch.
        </li>
      </ul>

      <h2>what you may not do</h2>
      <ul>
        <li>resell, rent, give away or publicly share your key;</li>
        <li>unlock the Pro tools in the builds we publish by any means other than a key;</li>
        <li>use the software to break the law.</li>
      </ul>
      <p>That is the whole list.</p>

      <h2>your files</h2>
      <p>
        Everything you make with owntools is yours. We claim no rights to your recordings, notes,
        transcripts or videos, and we never see them. Because they live only on your disk, keeping
        backups is your responsibility.
      </p>

      <h2>share links</h2>
      <p>
        A share link puts one exported video online for anyone who has the link. It is a copy for
        watching, not a backup:{" "}
        {shareTtlDays() > 0
          ? `it stops working after ${shareTtlDays()} days, and you can remove it from the export dialog at any time.`
          : "it stays up until you remove it from the export dialog."}{" "}
        Only share what you have the right to share, and nothing unlawful. Every shared page has a
        report link; we take down a link that breaks these terms or the law. Because there are no
        accounts, we cannot tell the person who shared it.
      </p>

      <h2>as is</h2>
      <p>
        owntools is provided as is, without warranty of any kind. We work hard to make it
        reliable, but we cannot promise it will be free of errors or fit every purpose. To the
        extent the law allows, we are not liable for lost data, lost profit or other damages
        arising from its use, and our total liability is limited to what you paid for the Pro key.
        Nothing here limits rights that consumer law gives you and that cannot be waived.
      </p>

      <h2>third-party components</h2>
      <p>
        Dictation uses the open-source whisper.cpp engine and speech models published on Hugging
        Face; both are downloaded from their publishers under their own licenses when you first use
        the feature. Payments run on Polar.sh under Polar’s terms.
      </p>

      <h2>refunds</h2>
      <p>
        You can return a Pro key within {REFUND_DAYS} days, no questions asked. See the{" "}
        <a href="/refunds">refund policy</a>.
      </p>

      <h2>changes</h2>
      <p>
        We may update these terms; the date at the top tells you when. Continuing to use the app
        after a change means you accept it - and if you do not, you can stop using it at any time.
      </p>

      <h2>governing law</h2>
      <p>
        owntools is operated from Poland. These terms are governed by Polish law, and disputes
        belong to the Polish courts - unless you are a consumer in another EU country, in which
        case the mandatory rules of your own country still protect you.
      </p>

      <Operator />
    </LegalPage>
  );
}
