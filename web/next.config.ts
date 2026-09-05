import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The launch engine is shared with the desktop app and ships as TypeScript
  // source, so Next has to compile it like first-party code.
  transpilePackages: ["@shipshape/launch-engine"],
  // Next 16 builds with Turbopack and dev-runs with webpack here, so the same
  // aliases have to be declared for both.
  turbopack: {
    resolveAlias: {
      react: "./node_modules/react",
      "react-dom": "./node_modules/react-dom",
      remotion: "./node_modules/remotion",
      "@remotion/player": "./node_modules/@remotion/player",
      "@remotion/web-renderer": "./node_modules/@remotion/web-renderer",
    },
  },
  webpack: (config) => {
    // The engine is a workspace package with React/Remotion as optional peers and
    // no node_modules of its own, so its bare imports have to resolve into *this*
    // app's tree — otherwise the composition renders against a second Remotion
    // context. Resolve from the project dir webpack was handed, never the shell's
    // cwd, and go through module lookup rather than path aliases: @remotion/* are
    // ESM-only packages whose entry lives behind an `exports` map, which a
    // directory alias would bypass (their `main` file does not exist).
    const appDir = config.context ?? process.cwd();
    config.resolve.modules = [
      path.resolve(appDir, "node_modules"),
      ...(config.resolve.modules ?? ["node_modules"]),
    ];
    return config;
  },
};

export default nextConfig;
