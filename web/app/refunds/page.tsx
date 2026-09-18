import type { Metadata } from "next";
import { ContactLink, LegalPage, Operator } from "../components/LegalPage";
import { POLICIES_UPDATED, REFUND_DAYS } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refunds",
  description:
    "14 days, no questions asked: how to get your money back on an owntools Pro key, and how Polar.sh processes the refund.",
  alternates: { canonical: "/refunds" },
};

export default function RefundsPage() {
  return (
    <LegalPage
      kicker="legal"
      title="refunds"
      intro={`One rule: if the Pro key is not for you, you get your money back within ${REFUND_DAYS} days. No form, no reason required.`}
      updated={POLICIES_UPDATED}
    >
      <h2>the policy</h2>
      <ul>
        <li>
          <strong>{REFUND_DAYS} days</strong> from the purchase, for any reason or none.
        </li>
        <li>
          It covers the <strong>Pro key</strong> - the only thing we sell. The free app costs
          nothing, so there is nothing to refund.
        </li>
        <li>
          <strong>The full amount</strong>, back to the payment method you used.
        </li>
      </ul>

      <h2>how to ask</h2>
      <ol>
        <li>
          Write to us within {REFUND_DAYS} days of the purchase: <ContactLink />.
        </li>
        <li>
          Include the email address you used at checkout, or the Polar order id from your receipt.
        </li>
        <li>
          We confirm and ask <a href="https://polar.sh" rel="noreferrer">Polar.sh</a>, the merchant
          of record, to issue the refund. Polar sends it back to the card or method you paid with;
          banks usually show it within 5–10 business days.
        </li>
      </ol>
      <p>
        That is it. You do not have to explain why - though if you tell us what did not work, we
        will probably fix it.
      </p>

      <h2>after a refund</h2>
      <p>
        The key is offline, so we cannot switch it off remotely. Once refunded, your license ends:
        please remove the key from the app. dictate and the quick file tools keep working without it.
      </p>

      <h2>your statutory rights</h2>
      <p>
        If you are a consumer in the EU, you have a 14-day right of withdrawal on digital
        purchases. This policy is at least as generous - we honour it even after you have
        downloaded and used the key. Nothing here limits any right the law gives you.
      </p>

      <Operator />
    </LegalPage>
  );
}
