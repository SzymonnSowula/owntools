import type { Metadata } from "next";
import { LegalPage, Operator } from "../components/LegalPage";
import { shareTtlDays } from "@/lib/share";
import { POLICIES_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What owntools does with your data: no accounts, no telemetry, everything stays in files on your disk. What the app downloads, what the website sees, how payments work.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      kicker="legal"
      title="privacy"
      intro="owntools is built so that your work never has to leave your machine. That keeps this page short: here is what the app and the website do with your data, in plain words."
      updated={POLICIES_UPDATED}
    >
      <h2>the short version</h2>
      <ul>
        <li>
          <strong>No accounts.</strong> You never sign in, and there is no user database.
        </li>
        <li>
          <strong>No telemetry, no analytics, no crash reports</strong> in the desktop app. It
          does not phone home.
        </li>
        <li>
          <strong>Your files stay yours.</strong> Recordings, notes, tasks, habits, statistics,
          transcripts and your license key are files on your own disk. Delete the folder and they
          are gone. A video leaves your machine only when you create a share link for it.
        </li>
        <li>
          <strong>Speech recognition runs on your CPU.</strong> Audio is never sent anywhere.
        </li>
      </ul>

      <h2>the desktop app</h2>
      <p>
        Everything the app makes lives in its data folder on your computer (in AppData, under{" "}
        <code>app.owntools.desktop</code>). Nothing in that folder is synced, backed up or read by
        us. If you uninstall the app, the folder is yours to keep or delete.
      </p>
      <p>The app connects to the internet only when you ask it to do something that needs it:</p>
      <ul>
        <li>
          <strong>Dictation and transcription, first use.</strong> The app downloads the
          whisper.cpp engine from GitHub Releases and the speech model you pick from Hugging Face.
          Like any download, those servers see the request and your IP address. From then on
          dictation, transcription and translation work with the wi-fi off, and you can remove
          models again from the model manager in dictate.
        </li>
        <li>
          <strong>Launch, when you paste a URL.</strong> The app fetches that page from your
          computer, the way a browser would, to read its title, copy, colours and images. The site
          you paste sees a request from you; we see nothing.
        </li>
        <li>
          <strong>Share links, when you create one.</strong> screeni uploads that one exported
          video, with a still for the preview, to storage we rent from Cloudflare (R2), and the
          link plays it on owntools.app. Anyone who has the link can watch and download it; it is
          unlisted and kept out of search engines.{" "}
          {shareTtlDays() > 0
            ? `It stops working after ${shareTtlDays()} days and the files are deleted from storage within a couple of days after that - sooner if you remove the link in the export dialog.`
            : "It stays up until you remove it in the export dialog."}{" "}
          We do not watch shared videos unless one is reported to us.
        </li>
        <li>
          <strong>Update checks.</strong> The app may ask our release server whether a newer
          version exists. That request carries the app version and your platform - nothing about
          you or your files.
        </li>
      </ul>
      <p>
        The screen-time heatmap and the scroll guard in focus watch which window is in front. That
        happens on your machine, for your eyes only, and never leaves the app.
      </p>

      <h2>the website</h2>
      <p>
        owntools.app has no login and sets no cookies of its own. Your day/night choice is kept in
        your browser’s local storage and is never sent to us.
      </p>
      <ul>
        <li>
          <strong>Analytics.</strong> We may use Plausible, a privacy-friendly analytics service:
          no cookies, no personal data, no cross-site tracking - only aggregate counts of page views
          and referrers. When it is on, its script loads from plausible.io.
        </li>
        <li>
          <strong>Hosting.</strong> Like every website, the server that hosts this one keeps
          ordinary access logs (IP address, time, page requested) for a short time to run the
          service.
        </li>
        <li>
          <strong>Watching a shared video.</strong> The page comes from this site and the video from
          Cloudflare&rsquo;s storage; both see your IP address the way any server does. The page sets
          no cookies and counts nothing.
        </li>
      </ul>

      <h2>payments</h2>
      <p>
        The Pro key is sold through <a href="https://polar.sh" rel="noreferrer">Polar.sh</a>, which
        acts as merchant of record: Polar takes the payment, issues the invoice and handles VAT.
        Polar’s own privacy policy applies to the checkout.
      </p>
      <p>
        From each order we receive what is needed to deliver and support your key: your email
        address and the order details (product, amount, country). We use them to send you the key,
        to answer your support requests and to process refunds - and for nothing else. No
        newsletters unless you ask for one, no sharing with anyone.
      </p>
      <p>
        The key is e-mailed to the address you paid with, and again whenever that address is
        entered at <a href="/key">owntools.app/key</a>. Those e-mails are sent through{" "}
        <a href="https://resend.com" rel="noreferrer">Resend</a>, which receives your address and
        the e-mail&rsquo;s content to deliver it and keeps a delivery log for a short time. We keep
        no copy and no list of our own: the record of your purchase stays with Polar, and the key
        is worked out from the order each time. Open and click tracking are switched off.
      </p>

      <h2>your rights</h2>
      <p>
        Because the app keeps no account, most of what would be “your data” is already in your
        hands: it is on your disk. What we hold is the purchase record described above. You can ask
        us to show it, correct it or delete it (once any legal retention period for invoices has
        passed) - write to the contact below. If you are in the EU, you also have the right to
        complain to your local data protection authority.
      </p>

      <h2>changes</h2>
      <p>
        When something here changes, we update the date at the top of this page. Substantial changes
        are also listed in the <a href="/changelog">changelog</a>.
      </p>

      <Operator />
    </LegalPage>
  );
}
