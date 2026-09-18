import { useSyncExternalStore } from "react";
import { isPro, onLicenseChange } from "./license";

/** Whether a Pro key is active - re-renders on activation, deactivation and the store's first load. */
export function useIsPro(): boolean {
  return useSyncExternalStore(onLicenseChange, isPro, () => false);
}
