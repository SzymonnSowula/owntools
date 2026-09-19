/**
 * Google Gemini ("Nano Banana") with an AI Studio key —
 * `models/{model}:generateContent` (checked 2026-09-18; the Imagen `:predict`
 * models were shut down in August 2026 and are not offered). There is no `n`:
 * one picture per call, so a batch is several calls. Gemini 3 image models
 * may send interim "thought" pictures first; the last non-thought one is the
 * result.
 */
import { base64ToBlob, call, json, repeat } from "../http";
import { ProviderError, type GeneratedImage, type ImageModel, type ImageProvider } from "../types";

const API = "https://generativelanguage.googleapis.com/v1beta";
const NAME = "Google Gemini";

interface Part {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}

interface GenerateContentResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

interface ListResponse {
  models?: { name: string; displayName?: string; description?: string; supportedGenerationMethods?: string[] }[];
}

/** 2K output exists on the 3.x flash and pro image models only; asking another model for it is an error. */
export function supportsImageSize(model: string): boolean {
  return /gemini-3(\.\d+)?-(flash|pro)-image$/.test(model);
}

export function pickImage(response: GenerateContentResponse): string | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const images = parts.filter((p) => p.inlineData?.data && !p.thought);
  return images.length ? (images[images.length - 1].inlineData?.data ?? null) : null;
}

export const google: ImageProvider = {
  id: "google",
  name: NAME,
  group: "cloud",
  blurb: "Nano Banana - quick, good with people and with keeping a scene consistent.",
  keyUrl: "https://aistudio.google.com/apikey",
  keyPlaceholder: "AIza…",
  needsKey: true,
  models: [
    { id: "gemini-3.1-flash-image", label: "Nano Banana 2", note: "Google's default · about 7¢ a picture" },
    { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite", note: "The fastest · about 3¢" },
    { id: "gemini-3-pro-image", label: "Nano Banana Pro", note: "The most capable · about 13¢" },
  ],
  customModel: true,
  supportsNegative: false,
  supportsSeed: false,

  async listModels(creds, signal): Promise<ImageModel[]> {
    const res = await call(`${API}/models?pageSize=1000`, {
      headers: { "x-goog-api-key": creds.apiKey.trim() },
      signal,
      purpose: "image models list",
    });
    const body = await json<ListResponse>(res, NAME);
    return (body.models ?? [])
      .filter((m) => /-image/.test(m.name) && (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name.replace(/^models\//, "") }));
  },

  generate(request, model, creds): Promise<GeneratedImage[]> {
    const imageConfig: Record<string, string> = { aspectRatio: request.aspect };
    if (request.quality === "high" && supportsImageSize(model)) imageConfig.imageSize = "2K";
    return repeat(request.count, async () => {
      const res = await call(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        headers: { "x-goog-api-key": creds.apiKey.trim() },
        signal: request.signal,
        body: {
          contents: [{ parts: [{ text: request.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig },
        },
      });
      const body = await json<GenerateContentResponse>(res, NAME);
      const data = pickImage(body);
      if (!data) {
        const why = body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason;
        throw new ProviderError(
          why ? `${NAME} returned no picture (${why.toLowerCase().replace(/_/g, " ")}).` : `${NAME} returned no picture.`,
          why ? "blocked" : "other",
        );
      }
      return [{ blob: base64ToBlob(data) }];
    });
  },
};
