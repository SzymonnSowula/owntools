/**
 * The contract every image provider codes against — a cloud API reached with
 * the person's own key, a server they already run on their desk, or the
 * engine owntools installs on this device. One request shape in, blobs out;
 * everything provider-specific (sizes, quality names, polling, multipart)
 * stays inside the provider.
 */

export type AspectRatio = "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16";

export const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "Square 1:1" },
  { value: "16:9", label: "Wide 16:9" },
  { value: "9:16", label: "Tall 9:16" },
  { value: "3:2", label: "Photo 3:2" },
  { value: "2:3", label: "Portrait 2:3" },
  { value: "4:3", label: "Classic 4:3" },
  { value: "3:4", label: "Classic 3:4" },
];

/** draft = the provider's fastest / cheapest setting, high = its best. */
export type Quality = "draft" | "standard" | "high";

export interface GenProgress {
  /** What is happening, in a few words: "Waiting in the queue", "Step 3 of 8". */
  note: string;
  /** 0..1, or null when the provider does not say. */
  fraction: number | null;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  aspect: AspectRatio;
  /** 1–4. A provider that makes one picture per call is called that many times. */
  count: number;
  /** The same seed and prompt give the same picture — where the provider has seeds at all. */
  seed?: number | null;
  quality: Quality;
  signal?: AbortSignal;
  onProgress?: (progress: GenProgress) => void;
}

export interface GeneratedImage {
  blob: Blob;
  seed?: number | null;
  /** Some providers rewrite the prompt and say so. */
  revisedPrompt?: string | null;
}

export interface ImageModel {
  /** The id the provider's API takes. */
  id: string;
  label: string;
  /** One short line: what it is, what it costs when the docs say. */
  note?: string;
}

export interface ProviderCreds {
  apiKey: string;
  /** Only providers with `baseUrl` set read this. */
  baseUrl: string;
  /** Only providers with `extra` set read this (Cloudflare's account id). */
  extra: string;
}

export type ProviderGroup = "cloud" | "server";

export interface ImageProvider {
  id: string;
  name: string;
  group: ProviderGroup;
  /** One sentence for the picker. */
  blurb: string;
  /** Where a key is made, for the "Get a key" link. */
  keyUrl?: string;
  keyPlaceholder?: string;
  needsKey: boolean;
  /** Set for providers whose address the person supplies or may change. */
  baseUrl?: { default: string; label: string; hint?: string };
  extra?: { label: string; placeholder: string };
  /** Curated ids, best default first. The fallback when `listModels` is absent or fails. */
  models: ImageModel[];
  /** A model id may be typed by hand (the catalogue is huge or personal). */
  customModel: boolean;
  /** The provider's own list of image models, live. */
  listModels?: (creds: ProviderCreds, signal?: AbortSignal) => Promise<ImageModel[]>;
  supportsNegative: boolean;
  supportsSeed: boolean;
  generate: (request: ImageRequest, model: string, creds: ProviderCreds) => Promise<GeneratedImage[]>;
}

export type ProviderErrorKind = "auth" | "billing" | "rate" | "blocked" | "input" | "offline" | "other";

/**
 * A failure in words a person can act on. `kind` lets the UI add the right
 * next step (open Settings for "auth", nothing to retry for "blocked").
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  constructor(message: string, kind: ProviderErrorKind = "other", status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
