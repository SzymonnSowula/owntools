import { isTauri } from "@core/env";
import { isPro, onLicenseChange } from "./license";

/**
 * Tells Rust whether a key is active - now and on every change. The key is
 * verified in TypeScript (an Ed25519 signature against the public key in
 * license.ts), and the one part of Rust that gates on it, the social agent
 * server, reads the answer from `license.rs` instead of re-verifying.
 */
export function syncLicenseToNative(): void {
  if (!isTauri()) return;
  const push = () => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("license_set_pro", { pro: isPro() }))
      .catch(() => undefined);
  };
  push();
  onLicenseChange(push);
}
