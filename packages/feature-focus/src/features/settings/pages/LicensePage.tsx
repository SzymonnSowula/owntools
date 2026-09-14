import { useEffect, useState } from "react";
import { PRICING_URL } from "@core/branding";
import { activateLicense, deactivateLicense, getLicense, maskLicenseKey, onLicenseChange } from "@licensing/license";
import { openExternal } from "../../../lib/links";
import { Button, Card, Note, Row } from "../ui";

function useLicenseKey(): string | null {
  const [key, setKey] = useState<string | null>(() => getLicense());
  useEffect(() => {
    // The store load may have finished between the first render and this
    // subscription - re-read once so nothing is missed.
    setKey(getLicense());
    return onLicenseChange(() => setKey(getLicense()));
  }, []);
  return key;
}

export function LicensePage() {
  const key = useLicenseKey();
  const [input, setInput] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const activate = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      if (await activateLicense(input)) {
        setInput("");
        setMsg("License active. Thanks for the support!");
      } else {
        setMsg("That key doesn't check out - it looks like SCRN-XXXXX-XXXXX-XXXXX.");
      }
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await deactivateLicense();
      setShow(false);
      setMsg("License removed from this device. The key still works elsewhere.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      id="license"
      title="License"
      desc="The key is checked on this device - no account, nothing to sign into."
      action={<span className={`st-badge${key ? " on" : ""}`}>{key ? "Pro" : "Free"}</span>}
    >
      {key ? (
        <>
          <Row label="Your key" hint="Removes the “made with owntools” badge from everything you export.">
            <code className="st-code">{show ? key : maskLicenseKey(key)}</code>
            <Button kind="ghost" onClick={() => setShow((v) => !v)}>
              {show ? "Hide" : "Show"}
            </Button>
          </Row>
          <Row label="Remove from this device" hint="The key keeps working on your other machines.">
            <Button disabled={busy} onClick={() => void deactivate()}>
              Deactivate
            </Button>
          </Row>
        </>
      ) : (
        <>
          <Row label="Activate a key" hint="Paste the key from the page you saw after paying." stack>
            <div className="st-inline">
              <input
                className="st-input mono"
                placeholder="SCRN-XXXXX-XXXXX-XXXXX"
                value={input}
                spellCheck={false}
                autoCapitalize="characters"
                aria-label="License key"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void activate();
                }}
              />
              <Button kind="primary" disabled={busy || !input.trim()} onClick={() => void activate()}>
                {busy ? "Checking…" : "Activate"}
              </Button>
            </div>
          </Row>
          <Row label="No key yet" hint="Everything works without one; the key only removes the badge from exports.">
            <Button onClick={() => void openExternal(PRICING_URL)}>Get Pro</Button>
          </Row>
        </>
      )}
      {msg ? (
        <div className="st-row-foot">
          <Note>{msg}</Note>
        </div>
      ) : null}
    </Card>
  );
}
