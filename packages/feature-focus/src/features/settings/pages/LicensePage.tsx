import { useEffect, useState } from "react";
import { CONTACT_EMAIL, KEY_RECOVERY_URL, PRICING_URL } from "@core/branding";
import {
  activateLicense,
  deactivateLicense,
  getLicense,
  getSwitchedOffLicense,
  licenseKeyProblem,
  maskLicenseKey,
  onLicenseChange,
  type SwitchedOffLicense,
} from "@licensing/license";
import { licenseProblemMessage, switchedOffMessage } from "@licensing/messages";
import { openExternal } from "../../../lib/links";
import { Button, Card, Note, Row } from "../ui";

interface LicenseState {
  key: string | null;
  /** A key that is stored here but was switched off by an update (refunded, passed around). */
  switchedOff: SwitchedOffLicense | null;
}

const read = (): LicenseState => ({ key: getLicense(), switchedOff: getSwitchedOffLicense() });

function useLicenseState(): LicenseState {
  const [state, setState] = useState<LicenseState>(read);
  useEffect(() => {
    // The store load may have finished between the first render and this
    // subscription - re-read once so nothing is missed.
    setState(read());
    return onLicenseChange(() => setState(read()));
  }, []);
  return state;
}

export function LicensePage() {
  const { key, switchedOff } = useLicenseState();
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
        // say what is wrong with *this* paste - "invalid key" is an e-mail to support
        const problem = licenseKeyProblem(input);
        setMsg(
          problem
            ? licenseProblemMessage(problem, CONTACT_EMAIL)
            : "The key is fine, but it could not be saved on this computer. Try once more.",
        );
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
      setMsg("Key removed from this computer. Paste it on the other one and you are set.");
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      await deactivateLicense();
      setMsg(null);
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
          <Row label="Your key" hint="Unlocks every tool on this computer: focus, screeni, capture, board, meet, social, disk and launch.">
            <code className="st-code">{show ? key : maskLicenseKey(key)}</code>
            <Button kind="ghost" onClick={() => setShow((v) => !v)}>
              {show ? "Hide" : "Show"}
            </Button>
          </Row>
          <Row
            label="Remove from this computer"
            hint="Moving to a new computer? Remove the key here and paste it there. If the old computer is gone, just paste the key on the new one - there is nothing to transfer."
          >
            <Button disabled={busy} onClick={() => void deactivate()}>
              Deactivate
            </Button>
          </Row>
        </>
      ) : (
        <>
          {switchedOff ? (
            <Row label="This key was switched off" hint={switchedOffMessage(switchedOff, CONTACT_EMAIL)}>
              <Button disabled={busy} onClick={() => void forget()}>
                Remove it
              </Button>
            </Row>
          ) : null}
          <Row label="Activate a key" hint="Paste the key from the e-mail you got after paying, or from the page you saw then." stack>
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
          <Row label="Lost your key?" hint="The site sends it again to the e-mail address you paid with - a minute, and nobody to write to.">
            <Button onClick={() => void openExternal(KEY_RECOVERY_URL)}>Send it again</Button>
          </Row>
          <Row label="No key yet" hint="dictate and the quick file tools are free. A key unlocks the other eight tools: focus, screeni, capture, board, meet, social, disk and launch.">
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
