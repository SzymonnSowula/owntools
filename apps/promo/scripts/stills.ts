/**
 * Render a handful of frames from one bundle and one browser — the check
 * loop while a scene is being built. Usage:
 *   node scripts/stills.ts Launch30 30 90 175 --scale 0.5 --sheet
 * Writes out/stills/<composition>-<frame>.png; --sheet also tiles them into
 * out/stills/sheet.png through a tiny composition? No: a contact sheet needs
 * an image library, so the frames stay separate and small.
 */
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const args = process.argv.slice(2);
const compositionId = args[0] ?? "Launch30";
let scale = 0.5;
const frames: number[] = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--scale") {
    scale = Number(args[++i]);
    continue;
  }
  const n = Number(args[i]);
  if (Number.isFinite(n)) frames.push(n);
}
if (frames.length === 0) {
  console.error("no frames given");
  process.exit(1);
}

const root = process.cwd();
const outDir = path.join(root, "out", "stills");
fs.mkdirSync(outDir, { recursive: true });

const started = Date.now();
const serveUrl = await bundle({
  entryPoint: path.join(root, "src", "index.ts"),
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: { ...(config.resolve?.alias ?? {}), "@ui": path.resolve(root, "../../packages/ui/src") },
    },
  }),
});
console.log(`bundled in ${((Date.now() - started) / 1000).toFixed(1)} s`);

const composition = await selectComposition({ serveUrl, id: compositionId, inputProps: {} });

for (const frame of frames) {
  const t = Date.now();
  const output = path.join(outDir, `${compositionId}-${String(frame).padStart(4, "0")}.png`);
  await renderStill({
    composition,
    serveUrl,
    frame,
    output,
    scale,
    imageFormat: "png",
    chromiumOptions: { gl: "angle" },
  });
  console.log(`${path.relative(root, output)} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
process.exit(0);
