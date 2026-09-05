/**
 * The "take": everything that makes two renders of the same brief look like
 * two different edits. A take is just a number — hash(seed, salt) picks the
 * narrative arc, per-beat layouts, entrance directions and framing.
 *
 * Picks are addressed by a string salt rather than by call order, so a scene
 * that renders conditionally can never shift another scene's choices.
 */

/** FNV-1a — small, fast, and stable across runtimes. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 0..1 for a (seed, salt) pair. */
export function rand(seed: number, salt: string): number {
  let t = (hashString(salt) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pick<T>(seed: number, salt: string, options: readonly T[]): T {
  return options[Math.floor(rand(seed, salt) * options.length) % options.length];
}

export function pickIndex(seed: number, salt: string, count: number): number {
  if (count <= 1) return 0;
  return Math.floor(rand(seed, salt) * count) % count;
}

/** 0..1 → range, deterministic. */
export function range(seed: number, salt: string, lo: number, hi: number): number {
  return lo + rand(seed, salt) * (hi - lo);
}

export function chance(seed: number, salt: string, p: number): boolean {
  return rand(seed, salt) < p;
}

/** A fresh take. Kept short so it is easy to read out loud / retype. */
export function newSeed(): number {
  return Math.floor(Math.random() * 900000) + 100000;
}

/** Seed derived from the brief — the "canonical" cut for a given product. */
export function seedFor(name: string, url: string): number {
  return (hashString(`${name}|${url}`) % 900000) + 100000;
}
