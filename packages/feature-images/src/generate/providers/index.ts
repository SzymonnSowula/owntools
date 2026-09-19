/**
 * Every place a picture can come from besides this device, in the order the
 * picker lists them: the big general-purpose APIs first, then the routers and
 * hosts of open models, then the labs with an API of their own, then the
 * servers on the person's own desk.
 *
 * Each of these was written against the provider's documentation as it read
 * on 2026-09-18 and is covered by a request-shape test; none has been run
 * with a real key from this repository. Left out on purpose, with the reason,
 * so nobody adds them back from memory: Fireworks (deprecated image generation
 * in June 2026), Nebius (shut text-to-image down in April 2026), Ollama
 * (removed its experimental image generation in v0.32.6), Imagen on the
 * Gemini API (shut down in August 2026), LM Studio (has no images endpoint),
 * and the providers whose API is a job queue with nothing else to tell them
 * apart (Leonardo, Luma, Novita, Alibaba Model Studio).
 */
import type { ImageProvider } from "../types";
import { fal } from "./fal";
import { google } from "./google";
import { huggingface } from "./huggingface";
import { cloudflare, getimg, minimax, runware, segmind, siliconflow } from "./more";
import { openai } from "./openai";
import { byteplus, custom, deepinfra, recraft } from "./openaiCompatible";
import { openrouter } from "./openrouter";
import { replicate } from "./replicate";
import { a1111, comfyui } from "./servers";
import { bfl, ideogram, stability } from "./studios";
import { together } from "./together";
import { xai } from "./xai";

export const PROVIDERS: ImageProvider[] = [
  openai,
  google,
  openrouter,
  replicate,
  fal,
  together,
  huggingface,
  deepinfra,
  bfl,
  stability,
  ideogram,
  recraft,
  xai,
  byteplus,
  minimax,
  runware,
  siliconflow,
  cloudflare,
  getimg,
  segmind,
  a1111,
  comfyui,
  custom,
];

export function provider(id: string): ImageProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
