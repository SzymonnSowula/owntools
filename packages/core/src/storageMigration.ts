/**
 * localStorage keys carry the brand in their prefix, and the app has renamed
 * twice (suite -> shipshape -> owntools).
 *
 * The WebView2 profile that *holds* localStorage moves with the AppData folder
 * (src-tauri/src/migrate.rs), so the values survive a rename - but they survive
 * under the old key names, which nothing reads any more. Without this pass the
 * app looks factory-fresh after an update: onboarding runs a second time, the
 * theme resets to Day, the disk tool forgets its preferences and the hub loses
 * its notes. That reads as data loss even though every byte is still there.
 *
 * Prefix-based on purpose: several keys are built at runtime (per board, per
 * workspace), so an enumerated list would quietly miss them.
 */
const LEGACY_PREFIX = "shipshape-";
const PREFIX = "owntools-";

/** Returns the new key names it filled in. Idempotent - a second run moves nothing. */
export function migrateBrandedStorageKeys(storage: Storage): string[] {
  const moved: string[] = [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(LEGACY_PREFIX)) keys.push(key);
    }
  } catch {
    return moved;
  }

  for (const key of keys) {
    const next = `${PREFIX}${key.slice(LEGACY_PREFIX.length)}`;
    try {
      // A value already written under the new name is the newer one: the stale
      // twin goes, so this never runs again and never overwrites live state.
      if (storage.getItem(next) === null) {
        const value = storage.getItem(key);
        if (value === null) continue;
        storage.setItem(next, value);
        moved.push(next);
      }
      storage.removeItem(key);
    } catch {
      // Quota or a blocked store: keep the old key rather than drop the value.
    }
  }
  return moved;
}

if (typeof localStorage !== "undefined") {
  try {
    migrateBrandedStorageKeys(localStorage);
  } catch {
    // Private mode, or a context without storage: nothing to carry over.
  }
}
