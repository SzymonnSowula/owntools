import data from "./revoked.json";

/**
 * Keys that no longer open owntools - the one thing an offline key could not
 * do before: be switched off.
 *
 * A key is a signature, so it cannot expire or be looked up anywhere; without
 * this list a refunded key kept working for good, and one key posted on a forum
 * opened the app for everybody, for ever. The list travels *inside the build*:
 * a key on it stops working with the update that carries it. Nothing is asked
 * of any server, so "never phones home" stays true - the price is that a
 * switched-off key keeps working in the builds released before it was listed.
 *
 * An entry is the key's 8-byte tag (hex), not the key: for a bought key that
 * is a hash of the Polar order id, so the list says nothing about anyone and
 * can sit in a public repository.
 *
 * `revoked.json` is written by `pnpm license:revoke` - `--sync` adds every
 * refunded order from Polar (the release script runs it, so a refund needs no
 * thought), `pnpm license:revoke <key>` adds a key that was passed around. Do
 * not edit it by hand except to take an entry out.
 */

/** Why a key was switched off; decides the sentence the app shows. */
export type RevokedReason = "refunded" | "shared";

export interface RevokedKey {
  /** The key's tag: 16 hex digits, lower case. */
  tag: string;
  reason: RevokedReason;
  /** The day it was listed, YYYY-MM-DD. */
  since: string;
}

const TAG = /^[0-9a-f]{16}$/;

function wellFormed(entry: unknown): entry is RevokedKey {
  const e = entry as Partial<RevokedKey> | null;
  return (
    !!e &&
    typeof e.tag === "string" &&
    TAG.test(e.tag) &&
    (e.reason === "refunded" || e.reason === "shared") &&
    typeof e.since === "string"
  );
}

/**
 * A malformed entry is skipped rather than allowed to take the app down at
 * start-up; `license.test.ts` fails the build when the file has one.
 */
export const REVOKED_KEYS: readonly RevokedKey[] = (data.keys as unknown[]).filter(wellFormed);

/** How many entries the file has, well-formed or not - for the test that compares the two. */
export const REVOKED_FILE_ENTRIES: number = (data.keys as unknown[]).length;
