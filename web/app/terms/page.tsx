import type { Metadata } from "next";
import { LegalPage, Operator } from "../components/LegalPage";
import { POLICIES_UPDATED, REFUND_DAYS } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The plain-English rules for using owntools and the Pro key: a personal, non-transferable license, no resale of keys, software provided as is, Polish law.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      kicker="legal"
      title="terms"
      intro="The plain-English rules for using owntools and the Pro key. They are short because the product is simple: a desktop app that runs on your machine, and a key that removes a badge."
      updated={POLICIES_UPDATED}
    >
      <h2>the free app</h2>
      <p>
        owntools is free to download and use, for personal and commercial work alike. Every tool
        is included. The only difference from Pro is a small “made with owntools” badge on the
        videos you export.
      </p>

      <h2>the pro key</h2>
      <p>
        Buying a Pro key gives you a personal, non-exclusive, non-transferable license to use
        owntools without the badge. The key:
      </p>
      <ul>
        <li>works offline and without an account - it is checked on your machine, not on a server;</li>
        <li>may be used on the devices you own and use yourself;</li>
        <li>covers updates to the app as we release them;</li>
        <li>
          removes the badge from video exports. That is the only paid feature - nothing else is
          locked behind it.
        </li>
      </ul>

      <h2>what you may not do</h2>
      <ul>
        <li>resell, rent, give away or publicly share your key;</li>
        <li>remove or alter the badge by any means other than a key;</li>
        <li>use the software to break the law.</li>
      </ul>
      <p>That is the whole list.</p>

      <h2>your files</h2>
      <p>
        Everything you make with owntools is yours. We claim no rights to your recordings, notes,
        transcripts or videos, and we never see them. Because they live only on your disk, keeping
        backups is your responsibility.
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
