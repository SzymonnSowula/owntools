/**
 * Who this device is in the folder: a uuid nobody sees plus a name people
 * read ("This PC", "MacBook"). Both live in localStorage; Rust keeps a copy in
 * `<AppData>/sync/state.json` so a wiped WebView profile can adopt the id its
 * files were written under instead of appearing as a third device.
 */

export const DEVICE_ID_KEY = "owntools-device-id";
export const DEVICE_NAME_KEY = "owntools-device-name";

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no storage */
  }
}

/** The stored id, or a fresh one (stored on the way out). */
export function deviceId(): string {
  const existing = read(DEVICE_ID_KEY);
  if (existing) return existing;
  const fresh = uuid();
  write(DEVICE_ID_KEY, fresh);
  return fresh;
}

export function storedDeviceId(): string | null {
  return read(DEVICE_ID_KEY);
}

/** Takes over an id Rust remembered (only when this profile has none yet). */
export function adoptDeviceId(id: string): string {
  const existing = read(DEVICE_ID_KEY);
  if (existing) return existing;
  write(DEVICE_ID_KEY, id);
  return id;
}

export function storedDeviceName(): string | null {
  return read(DEVICE_NAME_KEY);
}

export function setDeviceName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (clean) write(DEVICE_NAME_KEY, clean);
  return clean;
}

/** The hostname when the machine has one, else a plain word for the platform. */
export function defaultDeviceName(hostname: string | null | undefined, platform: string): string {
  const host = hostname?.trim();
  if (host) return host.slice(0, 40);
  return platform === "macos" ? "This Mac" : "This PC";
}

/** The name to show and write: what was set, else the default for this machine. */
export function deviceName(hostname: string | null | undefined, platform: string): string {
  return storedDeviceName() ?? defaultDeviceName(hostname, platform);
}
