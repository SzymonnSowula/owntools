import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const dirname = import.meta.dirname;
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@ui": resolve(dirname, "../../packages/ui/src"),
      "@core": resolve(dirname, "../../packages/core/src"),
      "@licensing": resolve(dirname, "../../packages/licensing/src"),
      "@feature-focus": resolve(dirname, "../../packages/feature-focus/src"),
      "@feature-recorder": resolve(dirname, "../../packages/feature-recorder/src"),
      "@feature-editor": resolve(dirname, "../../packages/feature-editor/src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(dirname, "index.html"),
        overlay: resolve(dirname, "overlay.html"),
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
