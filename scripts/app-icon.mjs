#!/usr/bin/env node
/**
 * app-icon.mjs
 *
 * Regenerates apps/desktop/src-tauri/icons/ from the app icon sources:
 *
 *   app-icon.svg            the drawing (1024, full bleed) → every PNG, the Store
 *                           logos and the 48 / 64 / 256 frames of icon.ico
 *   app-icon-{16,24,32}.svg the same drawing redrawn on each small pixel grid →
 *                           the 16 / 24 / 32 frames of icon.ico and 32x32.png.
 *                           Scaled down, the 1024 drawing smears at these sizes,
 *                           and they are the sizes Windows actually shows: 24 on
 *                           the taskbar, 16 in the tray, and the 32 frame comes
 *                           first in the file, which makes it Tauri's
 *                           default_window_icon (window + tray icon)
 *   macOS                   icon.icns is rendered from app-icon.svg placed on
 *                           Apple's icon grid (824 px tile, 100 px margin, soft
 *                           shadow). macOS draws an icon exactly as given, so a
 *                           full-bleed tile would sit ~20 % larger than every
 *                           other icon in the Dock.
 *
 * All rasterising goes through `tauri icon` (resvg), so the pixels are the ones
 * the CLI would have produced. Run it instead of `tauri icon app-icon.svg`,
 * which would silently put the scaled-down small frames back.
 *
 *   node scripts/app-icon.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps/desktop");
const tauriDir = join(desktop, "src-tauri");
const iconsDir = join(tauriDir, "icons");

const SMALL = [16, 24, 32];

/** What icons/ holds: tauri.conf.json's bundle.icon plus the Windows Store logos. */
const OUTPUTS = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
];

/** Apple's macOS icon grid on a 1024 canvas. */
const MAC_TILE = 824;
const MAC_MARGIN = (1024 - MAC_TILE) / 2;

const cli = createRequire(join(desktop, "package.json")).resolve("@tauri-apps/cli/tauri.js");

function tauriIcon(input, output, sizes) {
  const args = [cli, "icon", input, "--output", output];
  if (sizes) args.push("--png", sizes.join(","));
  try {
    execFileSync(process.execPath, args, { cwd: desktop, stdio: "pipe" });
  } catch (err) {
    process.stderr.write(err.stdout ?? "");
    process.stderr.write(err.stderr ?? "");
    throw new Error(`tauri icon ${input} failed`);
  }
}

/** The frames of an .ico in file order; `entry` is the 8-byte head of its directory record. */
function readIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error("icon.ico is not an icon file");
  const frames = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const at = 6 + i * 16;
    const size = buf.readUInt32LE(at + 8);
    const offset = buf.readUInt32LE(at + 12);
    frames.push({
      width: buf[at] || 256,
      entry: Buffer.from(buf.subarray(at, at + 8)),
      data: buf.subarray(offset, offset + size),
    });
  }
  return frames;
}

function writeIco(frames) {
  const head = Buffer.alloc(6 + frames.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach((frame, i) => {
    const at = 6 + i * 16;
    frame.entry.copy(head, at);
    head.writeUInt32LE(frame.data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += frame.data.length;
  });
  return Buffer.concat([head, ...frames.map((frame) => frame.data)]);
}

/**
 * `tauri icon` writes the .icns chunks in hash-map order, so every run produced
 * different bytes for the same pictures. Readers look chunks up by type (there
 * is no TOC here), so a fixed order is safe and keeps the file stable in git.
 */
const ICNS_ORDER = ["is32", "s8mk", "il32", "l8mk", "ic11", "ic12", "ic07", "ic13", "ic08", "ic14", "ic09", "ic10"];

function stableIcns(buf) {
  if (buf.toString("latin1", 0, 4) !== "icns") throw new Error("icon.icns is not an icns file");
  const chunks = [];
  for (let at = 8; at < buf.readUInt32BE(4); ) {
    const length = buf.readUInt32BE(at + 4);
    if (length < 8) throw new Error(`icon.icns: broken chunk at byte ${at}`);
    chunks.push({ type: buf.toString("latin1", at, at + 4), bytes: buf.subarray(at, at + length) });
    at += length;
  }
  const rank = (type) => (ICNS_ORDER.includes(type) ? ICNS_ORDER.indexOf(type) : ICNS_ORDER.length);
  chunks.sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type));
  const body = Buffer.concat(chunks.map((chunk) => chunk.bytes));
  const head = Buffer.alloc(8);
  head.write("icns", 0, "latin1");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

function pngSize(png) {
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

const work = mkdtempSync(join(tmpdir(), "owntools-app-icon-"));
try {
  const source = join(tauriDir, "app-icon.svg");
  const full = join(work, "full");
  tauriIcon(source, full);

  const small = new Map();
  for (const size of SMALL) {
    const out = join(work, `small-${size}`);
    tauriIcon(join(tauriDir, `app-icon-${size}.svg`), out, [size]);
    const png = readFileSync(join(out, `${size}x${size}.png`));
    const [w, h] = pngSize(png);
    if (w !== size || h !== size) throw new Error(`app-icon-${size}.svg rendered at ${w}x${h}`);
    small.set(size, png);
  }

  const svg = readFileSync(source, "utf8");
  const body = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
  const radius = (230 * MAC_TILE) / 1024;
  const macSource = join(work, "app-icon-macos.svg");
  writeFileSync(
    macSource,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="macos-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <rect x="${MAC_MARGIN}" y="${MAC_MARGIN + 10}" width="${MAC_TILE}" height="${MAC_TILE}" rx="${radius}" fill="#000" opacity=".28" filter="url(#macos-shadow)"/>
  <g transform="translate(${MAC_MARGIN} ${MAC_MARGIN}) scale(${MAC_TILE / 1024})">${body}</g>
</svg>
`,
  );
  const mac = join(work, "macos");
  tauriIcon(macSource, mac);

  const frames = readIco(readFileSync(join(full, "icon.ico")));
  for (const size of SMALL) {
    const frame = frames.find((f) => f.width === size);
    if (!frame) throw new Error(`tauri icon no longer writes a ${size} px frame into icon.ico`);
    frame.data = small.get(size);
  }

  const bytes = {
    "icon.ico": writeIco(frames),
    "icon.icns": stableIcns(readFileSync(join(mac, "icon.icns"))),
    "32x32.png": small.get(32),
  };
  for (const name of OUTPUTS) {
    const data = bytes[name] ?? readFileSync(join(full, name));
    writeFileSync(join(iconsDir, name), data);
  }

  console.log(`icons/ regenerated (${OUTPUTS.length} files)`);
  console.log(`  icon.ico   frames ${frames.map((f) => f.width).join(" / ")}, ${SMALL.join(" / ")} from app-icon-<size>.svg`);
  console.log(`  icon.icns  Apple grid: ${MAC_TILE} px tile, ${MAC_MARGIN} px margin`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
