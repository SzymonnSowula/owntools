/**
 * The revocation list as a file: reading, changing and writing
 * `packages/licensing/src/revoked.json`, which the desktop app bakes in
 * (packages/licensing/src/revoked.ts says what the list is for).
 *
 * It lives here because the scripts that maintain it (`pnpm license:revoke`)
 * run on Node's type stripping and import from web/lib, like the rest of the
 * shop's tooling - and because web/lib is where its tests run. The app does not
 * import this file; it reads the JSON.
 *
 * Pure on purpose: text in, text out, so the rules are tested without a disk.
 */

export type RevokedReason = "refunded" | "shared";

export interface RevokedKey {
  /** 16 hex digits, lower case: the key's tag (for an order's key, a hash of the order id). */
  tag: string;
  reason: RevokedReason;
  /** YYYY-MM-DD. */
  since: string;
}

export interface RevokedFile {
  keys: RevokedKey[];
}

export class RevokedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevokedFileError";
  }
}

const TAG = /^[0-9a-f]{16}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict: an entry this cannot read is an error, never something to drop. A
 * tool that "cleans up" what it does not understand would switch a revoked key
 * back on without anyone deciding to.
 */
export function parseRevokedFile(text: string): RevokedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RevokedFileError("revoked.json is not JSON");
  }
  const keys = (data as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) throw new RevokedFileError('revoked.json has no "keys" list');
  const seen = new Set<string>();
  const out: RevokedKey[] = [];
  keys.forEach((raw, index) => {
    const entry = raw as Partial<RevokedKey> | null;
    const where = `revoked.json, entry ${index + 1}`;
    if (!entry || typeof entry.tag !== "string" || !TAG.test(entry.tag)) throw new RevokedFileError(`${where}: the tag is not 16 lower-case hex digits`);
    if (entry.reason !== "refunded" && entry.reason !== "shared") throw new RevokedFileError(`${where}: the reason is neither "refunded" nor "shared"`);
    if (typeof entry.since !== "string" || !DAY.test(entry.since)) throw new RevokedFileError(`${where}: "since" is not a YYYY-MM-DD date`);
    if (seen.has(entry.tag)) throw new RevokedFileError(`${where}: the tag ${entry.tag} is listed twice`);
    seen.add(entry.tag);
    out.push({ tag: entry.tag, reason: entry.reason, since: entry.since });
  });
  return { keys: out };
}

export type RevokeChange = "added" | "now-refunded" | "kept";

/**
 * Adds a key to the list. A tag that is already there keeps its entry and its
 * date, with one exception: a key listed as "shared" whose order is then
 * refunded becomes "refunded" - the app tells a refunded buyer that the matter
 * is settled, and a shared-key buyer to write in, and after a refund only the
 * first is true.
 */
export function withRevoked(file: RevokedFile, entry: RevokedKey): { file: RevokedFile; change: RevokeChange } {
  const tag = entry.tag.toLowerCase();
  if (!TAG.test(tag)) throw new RevokedFileError(`${entry.tag} is not a key tag (16 hex digits)`);
  if (!DAY.test(entry.since)) throw new RevokedFileError(`${entry.since} is not a YYYY-MM-DD date`);
  const existing = file.keys.find((k) => k.tag === tag);
  if (!existing) return { file: { keys: [...file.keys, { tag, reason: entry.reason, since: entry.since }] }, change: "added" };
  if (existing.reason === "shared" && entry.reason === "refunded") {
    return { file: { keys: file.keys.map((k) => (k.tag === tag ? { ...k, reason: "refunded" as const } : k)) }, change: "now-refunded" };
  }
  return { file, change: "kept" };
}

/** Takes a tag off the list - the key opens the app again from the next build. */
export function withoutRevoked(file: RevokedFile, tag: string): { file: RevokedFile; removed: boolean } {
  const wanted = tag.toLowerCase();
  const keys = file.keys.filter((k) => k.tag !== wanted);
  return { file: { keys }, removed: keys.length !== file.keys.length };
}

/** Oldest first, then by tag, one entry a line: a change to the list is a one-line diff. */
export function serializeRevokedFile(file: RevokedFile): string {
  const keys = [...file.keys].sort((a, b) => a.since.localeCompare(b.since) || a.tag.localeCompare(b.tag));
  if (keys.length === 0) return '{\n  "keys": []\n}\n';
  const lines = keys.map((k) => `    ${JSON.stringify({ tag: k.tag, reason: k.reason, since: k.since })}`);
  return `{\n  "keys": [\n${lines.join(",\n")}\n  ]\n}\n`;
}
