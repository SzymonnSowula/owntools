/**
 * `generateImages()` — the one call a tool makes to get pictures. It reads
 * where pictures come from (Settings → Intelligence), runs the on-device
 * engine or the chosen provider, and hands back blobs with what made them.
 * Callers never pick a provider themselves.
 */
import { logError, logInfo } from "@core/errors";
import { generateOnDevice } from "./device/engine";
import { deviceModel } from "./device/models";
import { provider } from "./providers";
import { credsFor, DEVICE_SOURCE, imageSettings, modelFor, providerConfigured, type ImageSettings } from "./settings";
import { isAbort, ProviderError, type GeneratedImage, type ImageRequest } from "./types";

export interface GenerationResult {
  images: GeneratedImage[];
  /** "device" or the provider id. */
  source: string;
  sourceName: string;
  model: string;
  ms: number;
}

export function sourceName(source: string): string {
  return source === DEVICE_SOURCE ? "This device" : (provider(source)?.name ?? source);
}

export function modelLabel(source: string, model: string): string {
  if (source === DEVICE_SOURCE) return deviceModel(model)?.label ?? model;
  return provider(source)?.models.find((m) => m.id === model)?.label ?? model;
}

export async function generateImages(request: ImageRequest, settings: ImageSettings = imageSettings()): Promise<GenerationResult> {
  const source = settings.source;
  const model = modelFor(source, settings);
  const prompt = request.prompt.trim();
  if (!prompt) throw new ProviderError("Write what the picture should show first.", "input");
  const clean: ImageRequest = { ...request, prompt, count: Math.min(4, Math.max(1, Math.round(request.count))) };
  const started = Date.now();
  try {
    let images: GeneratedImage[];
    if (source === DEVICE_SOURCE) {
      images = await generateOnDevice(clean, model, { cpuOnly: settings.device.cpuOnly });
    } else {
      const p = provider(source);
      if (!p) throw new ProviderError("That image provider is no longer available - pick another in Settings → Intelligence.", "input");
      if (!providerConfigured(p, settings)) {
        throw new ProviderError(`${p.name} is not set up yet - add ${p.needsKey ? "your key" : "its address"} in Settings → Intelligence.`, "auth");
      }
      if (!model && !p.models.some((m) => m.id === "")) throw new ProviderError(`Pick a model for ${p.name} first.`, "input");
      images = await p.generate(
        { ...clean, negativePrompt: p.supportsNegative ? clean.negativePrompt : undefined, seed: p.supportsSeed ? clean.seed : null },
        model,
        credsFor(p, settings),
      );
    }
    if (!images.length) throw new ProviderError(`${sourceName(source)} answered without a picture.`);
    const ms = Date.now() - started;
    // The prompt is the person's; the log gets where and how long, never what.
    logInfo("images", `generated ${images.length} · ${source} · ${model || "default"} · ${ms} ms`);
    return { images, source, sourceName: sourceName(source), model, ms };
  } catch (err) {
    if (!isAbort(err)) logError("images", `generate (${source})`, err);
    throw err;
  }
}
