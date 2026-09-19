import type { LicenseKeyProblem, SwitchedOffLicense } from "./license";
import { maskLicenseKey } from "./license";

/**
 * What Settings → License says when a key is not accepted, or stopped being.
 *
 * Every sentence here replaces an e-mail to support: "invalid key" makes a
 * person write in, "part of it did not get copied" makes them copy it again.
 * So each problem names what happened and what to do next, and only the one
 * case a person cannot fix alone (a key switched off for being passed around)
 * points at the contact address.
 */
export function licenseProblemMessage(problem: LicenseKeyProblem, contact: string): string {
  switch (problem) {
    case "empty":
      return "Paste your key first.";
    case "not-a-key":
      return "That is not an owntools key - a key starts with OWNT-. Copy it from the e-mail you got after paying, or from the page you saw then.";
    case "cut-off":
      return "That key is cut short - part of it did not get copied. A key is OWNT- followed by fifteen groups of characters; select all of it and copy again.";
    case "too-long":
      return "There is more here than one key - it may have been pasted twice. Clear the box and paste it once.";
    case "mistyped":
      return "That key does not check out - a character is off. Copy and paste it rather than typing it: a key never contains 0, 1, I or O.";
    case "refunded":
      return "The order behind this key was refunded, so it no longer opens the Pro tools. Bought again since? Use the key from the new order.";
    case "shared":
      return `This key was passed around, so it has been switched off. If you are the one who bought it, write to ${contact} from the address you paid with and you get a new key.`;
  }
}

/** The notice for a key that is still stored on this computer but was switched off by an update. */
export function switchedOffMessage(license: SwitchedOffLicense, contact: string): string {
  const key = maskLicenseKey(license.key);
  if (license.reason === "refunded") {
    return `The key on this computer (${key}) belongs to an order that was refunded, so the Pro tools are locked again. Everything you made stays where it was.`;
  }
  return `The key on this computer (${key}) was passed around and has been switched off, so the Pro tools are locked again. If you are the one who bought it, write to ${contact} from the address you paid with and you get a new key. Everything you made stays where it was.`;
}
