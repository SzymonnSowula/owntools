import { APPLE_BLUE } from "./brand";
import { seedFor } from "./take";
import type { LaunchInput } from "./types";

/** The brief the studio opens with, before a URL is fetched. */
export function defaultLaunchInput(overrides: Partial<LaunchInput> = {}): LaunchInput {
  const base: LaunchInput = {
    name: "your product",
    tagline: "the fastest way to do the thing",
    features: ["set up in 30 seconds", "works offline", "no subscription"],
    url: "",
    accent: APPLE_BLUE,
    theme: "day",
    imageDataUrl: null,
    logoDataUrl: null,
    watermark: true,
    style: "desk",
    format: "landscape",
    seconds: 30,
    seed: seedFor("your product", ""),
  };
  return { ...base, ...overrides };
}
