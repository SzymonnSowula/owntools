const STORAGE_KEY = "screeni-license";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Offline license key: SCRN-XXXXX-XXXXX-XXXXX where the last character is a
 * checksum over the preceding 14 payload characters. Keys are issued by the
 * store after purchase; this only has to keep honest people honest.
 */
export function isValidLicenseKey(raw: string): boolean {
  const key = raw.trim().toUpperCase();
  const match = /^SCRN-([A-Z2-9]{5})-([A-Z2-9]{5})-([A-Z2-9]{5})$/.exec(key);
  if (!match) return false;
  const payload = (match[1] + match[2] + match[3]).split("");
  const check = payload.pop()!;
  let sum = 0;
  payload.forEach((ch, i) => {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) sum = -1e9;
    sum += v * (i % 2 === 0 ? 3 : 7);
  });
  if (sum < 0) return false;
  return ALPHABET[sum % ALPHABET.length] === check;
}

export function getLicense(): string | null {
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    return key && isValidLicenseKey(key) ? key : null;
  } catch {
    return null;
  }
}

export function isPro(): boolean {
  return getLicense() !== null;
}

export function activateLicense(key: string): boolean {
  if (!isValidLicenseKey(key)) return false;
  try {
    localStorage.setItem(STORAGE_KEY, key.trim().toUpperCase());
  } catch {
    return false;
  }
  return true;
}

export function deactivateLicense(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
