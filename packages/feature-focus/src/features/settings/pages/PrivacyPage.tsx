import { lazy, Suspense } from "react";
import { useAppStore } from "../../../store/useAppStore";
import { Card, Row, Switch } from "../ui";

// Lazy: the network log reader only loads when this page is opened.
const PrivacyCard = lazy(() => import("@feature-privacy/PrivacyCard"));

export function PrivacyPage() {
  const usageTracking = useAppStore((s) => s.settings.usageTracking);
  const setUsageTracking = useAppStore((s) => s.setUsageTracking);

  return (
    <>
      <Card id="activity" title="On this device">
        <Row
          label="Track time in apps and on websites"
          hint="Reads the active window's title (and the site, in a browser) every 2 seconds for focus's stats. It stays on this device; off means nothing is read."
        >
          <Switch
            label="Track time in apps and on websites"
            checked={usageTracking}
            onCheckedChange={(on) => setUsageTracking(on)}
          />
        </Row>
      </Card>
      <Suspense fallback={null}>
        <PrivacyCard />
      </Suspense>
    </>
  );
}
