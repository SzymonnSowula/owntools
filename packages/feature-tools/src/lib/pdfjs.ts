/**
 * pdf.js, loaded on first use. The worker is a real file in the bundle
 * (`?url`), and the standard fonts / CMaps / wasm decoders are served from
 * `/pdfjs/` — copied out of `pdfjs-dist` by the `pdfjsAssets` plugin in
 * apps/desktop/vite.config.ts — so a scanned or CJK document works offline
 * and the CSP never has to allow a CDN.
 */

export type Pdfjs = typeof import("pdfjs-dist");

export const PDFJS_ASSETS = "/pdfjs/";

let loading: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return loading;
}

/** `getDocument` parameters pointing every optional resource at `/pdfjs/`. */
export function documentOptions(data: ArrayBuffer) {
  return {
    data: new Uint8Array(data),
    cMapUrl: `${PDFJS_ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSETS}wasm/`,
    iccUrl: `${PDFJS_ASSETS}iccs/`,
  };
}
