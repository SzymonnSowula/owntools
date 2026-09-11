import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Root test runner. Aliases mirror apps/desktop/vite.config.ts so a module under
 * test can import the way the app does (`@core/env`, `@feature-focus/...`).
 * Tests live next to the code they cover, as `*.test.ts`.
 */
const dirname = import.meta.dirname;
const pkg = (name: string) => resolve(dirname, "packages", name, "src");

export default defineConfig({
  resolve: {
    alias: {
      "@ui": pkg("ui"),
      "@core": pkg("core"),
      "@licensing": pkg("licensing"),
      "@feature-focus": pkg("feature-focus"),
      "@feature-recorder": pkg("feature-recorder"),
      "@feature-editor": pkg("feature-editor"),
      "@feature-launch": pkg("feature-launch"),
      "@feature-dictation": pkg("feature-dictation"),
      "@feature-board": pkg("feature-board"),
      "@feature-social": pkg("feature-social"),
      "@feature-tools": pkg("feature-tools"),
      "@feature-disk": pkg("feature-disk"),
      "@feature-meet": pkg("feature-meet"),
      "@feature-capture": pkg("feature-capture"),
      "@feature-automations": pkg("feature-automations"),
      "@feature-sync": pkg("feature-sync"),
      "@feature-privacy": pkg("feature-privacy"),
      "@feature-llm": pkg("feature-llm"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "web/lib/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/src-tauri/**", "**/.next/**"],
  },
});
