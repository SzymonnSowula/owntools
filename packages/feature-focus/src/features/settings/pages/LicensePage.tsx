import { useEffect, useState } from "react";
import { CONTACT_EMAIL, PRICING_URL } from "@core/branding";
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
        setMsg("That key doesn't check out. A key starts with OWNT- and is about 130 characters long - paste the whole thing, dashes and all.");
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
      setMsg("Key removed from this computer. You can activate it on another one now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      id="license"
      title="License"
      desc="The key is checked on this computer - no account, nothing to sign into. One key covers one computer at a time."
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
          <Row
            label="Remove from this computer"
            hint={`Moving to a new computer? Deactivate here first, then activate there. If the old computer is gone, write to ${CONTACT_EMAIL} and the key is moved for you.`}
          >
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
                placeholder="OWNT-XXXXXXXX-XXXXXXXX-…"
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
