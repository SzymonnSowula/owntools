import { createReadStream, cpSync, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const dirname = import.meta.dirname;
const host = process.env.TAURI_DEV_HOST;

/**
 * Excalidraw (the board module) loads its fonts from
 * `window.EXCALIDRAW_ASSET_PATH` — set to `/excalidraw/` in
 * packages/feature-board/src/assetPath.ts — and otherwise from a CDN, which the
 * app's CSP blocks. This plugin serves the package's `fonts/` folder there in
 * dev and copies it into dist/ for the bundle, so the board works offline.
 * The 13 MB CJK fallback (Xiaolai) is left out; Excalidraw falls back to
 * system fonts for those glyphs.
 */
const EXCALIDRAW_DIST = resolve(dirname, "node_modules/@excalidraw/excalidraw/dist/prod");
const EXCALIDRAW_PUBLIC = "/excalidraw/";
const FONT_MIME: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const skipCjk = (src: string) => !src.includes("Xiaolai");

function excalidrawAssets(): Plugin {
  return {
    name: "owntools:excalidraw-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(EXCALIDRAW_PUBLIC)) return next();
        const rel = decodeURIComponent(url.slice(EXCALIDRAW_PUBLIC.length).split("?")[0] ?? "");
        const file = resolve(EXCALIDRAW_DIST, rel);
        if (!file.startsWith(EXCALIDRAW_DIST) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", FONT_MIME[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const from = resolve(EXCALIDRAW_DIST, "fonts");
      if (!existsSync(from)) return;
      cpSync(from, resolve(dirname, "dist/excalidraw/fonts"), { recursive: true, filter: skipCjk });
    },
  };
}

/**
 * pdf.js (the PDF quick tools) loads its standard fonts, CMaps, ICC profile
 * and wasm decoders from a URL — `/pdfjs/` in
 * packages/feature-tools/src/lib/pdfjs.ts. Same trick as above: served from
 * the package in dev, copied into dist/ for the bundle. ~4 MB, all offline.
 */
const PDFJS_DIST = resolve(dirname, "node_modules/pdfjs-dist");
const PDFJS_PUBLIC = "/pdfjs/";
const PDFJS_DIRS = ["standard_fonts", "cmaps", "wasm", "iccs"];
const PDFJS_MIME: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".ttf": "font/ttf",
  ".icc": "application/vnd.iccprofile",
};

function pdfjsAssets(): Plugin {
  return {
    name: "owntools:pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(PDFJS_PUBLIC)) return next();
        const rel = decodeURIComponent(url.slice(PDFJS_PUBLIC.length).split("?")[0] ?? "");
        if (!PDFJS_DIRS.some((dir) => rel.startsWith(`${dir}/`))) return next();
        const file = resolve(PDFJS_DIST, rel);
        if (!file.startsWith(PDFJS_DIST) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", PDFJS_MIME[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const dir of PDFJS_DIRS) {
        const from = resolve(PDFJS_DIST, dir);
        if (existsSync(from)) cpSync(from, resolve(dirname, "dist/pdfjs", dir), { recursive: true });
      }
    },
  };
}

/**
 * `pnpm dev` only: the YouTube quick tool talks to youtube.com through
 * Tauri's HTTP plugin in the app, but the browser preview has CORS in the
 * way — so `/__proxy?url=` relays those few hosts from the dev server
 * (packages/feature-tools/src/lib/net.ts). Never part of the bundle.
 */
const PROXY_HOSTS = [/^(www\.|m\.)?youtube\.com$/, /^i\.ytimg\.com$/, /\.googlevideo\.com$/];
const PROXY_REQUEST_HEADERS = ["content-type", "user-agent", "range", "accept-language"];
const PROXY_RESPONSE_HEADERS = ["content-type", "content-range", "accept-ranges"];

async function relay(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = new URL(req.url ?? "", "http://localhost").searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    res.statusCode = 400;
    res.end("bad url");
    return;
  }
  if (url.protocol !== "https:" || !PROXY_HOSTS.some((re) => re.test(url.hostname))) {
    res.statusCode = 403;
    res.end("host not allowed");
    return;
  }
  const headers: Record<string, string> = {};
  for (const name of PROXY_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "POST" && chunks.length ? Buffer.concat(chunks) : undefined,
    });
    res.statusCode = upstream.status;
    for (const name of PROXY_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as unknown as NodeReadableStream).pipe(res);
  } catch (err) {
    res.statusCode = 502;
    res.end(String(err));
  }
}

function devProxy(): Plugin {
  return {
    name: "owntools:dev-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__proxy", (req, res) => {
        void relay(req, res);
      });
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), excalidrawAssets(), pdfjsAssets(), devProxy()],
  clearScreen: false,
  // Excalidraw's bundle reads this flag; without the define, `process` is not defined in the browser.
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  resolve: {
    alias: {
      "@ui": resolve(dirname, "../../packages/ui/src"),
      "@core": resolve(dirname, "../../packages/core/src"),
      "@licensing": resolve(dirname, "../../packages/licensing/src"),
      "@feature-focus": resolve(dirname, "../../packages/feature-focus/src"),
      "@feature-recorder": resolve(dirname, "../../packages/feature-recorder/src"),
      "@feature-editor": resolve(dirname, "../../packages/feature-editor/src"),
      "@feature-launch": resolve(dirname, "../../packages/feature-launch/src"),
      "@feature-dictation": resolve(dirname, "../../packages/feature-dictation/src"),
      "@feature-board": resolve(dirname, "../../packages/feature-board/src"),
      "@feature-social": resolve(dirname, "../../packages/feature-social/src"),
      "@feature-tools": resolve(dirname, "../../packages/feature-tools/src"),
      "@feature-disk": resolve(dirname, "../../packages/feature-disk/src"),
      "@feature-meet": resolve(dirname, "../../packages/feature-meet/src"),
      "@feature-capture": resolve(dirname, "../../packages/feature-capture/src"),
      "@feature-automations": resolve(dirname, "../../packages/feature-automations/src"),
      "@feature-sync": resolve(dirname, "../../packages/feature-sync/src"),
      "@feature-privacy": resolve(dirname, "../../packages/feature-privacy/src"),
      "@feature-llm": resolve(dirname, "../../packages/feature-llm/src"),
      "@feature-images": resolve(dirname, "../../packages/feature-images/src"),
    },
    // The launch engine lives outside this app's node_modules; without dedupe
    // its `react`/`remotion` imports would resolve to a second copy and break
    // hooks (and Remotion's frame context) at runtime.
    dedupe: ["react", "react-dom", "remotion", "@remotion/player", "@remotion/web-renderer"],
  },
  // The background-removal worker (packages/feature-images) imports onnxruntime-web,
  // which code-splits; the default iife worker format cannot.
  worker: {
    format: "es" as const,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(dirname, "index.html"),
        overlay: resolve(dirname, "overlay.html"),
        dictation: resolve(dirname, "dictation.html"),
        captions: resolve(dirname, "captions.html"),
        capture: resolve(dirname, "capture.html"),
      },
    },
  },
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    fs: {
      allow: [resolve(dirname, "../..")],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
