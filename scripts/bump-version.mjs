#!/usr/bin/env node
/**
 * bump-version.mjs <x.y.z>
 *
 * Writes one version into every file that carries it:
 *   package.json (root) · apps/desktop/package.json · web/package.json ·
 *   packages/feature-launch/package.json · apps/desktop/src-tauri/tauri.conf.json ·
 *   apps/desktop/src-tauri/Cargo.toml ([package] version only)
 *
 * All files are checked first and nothing is written unless every one of them
 * can be updated. Cargo.lock is not touched — `cargo check` refreshes it (see the
 * reminder printed at the end). The version in tauri.conf.json is what the
 * release workflow turns into the tag name (v__VERSION__), so it must match the
 * git tag you push afterwards.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

const JSON_FILES = [
  "package.json",
  "apps/desktop/package.json",
  "web/package.json",
  "packages/feature-launch/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
];
const CARGO_TOML = "apps/desktop/src-tauri/Cargo.toml";
const CHANGELOG = "web/lib/changelog.ts";

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error("Usage: node scripts/bump-version.mjs <x.y.z>");
  console.error("  e.g. node scripts/bump-version.mjs 0.2.0");
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) usage("missing version argument");
if (/^v/i.test(arg)) usage(`drop the "v" prefix — pass ${arg.slice(1)}; the git tag gets the v`);
if (!SEMVER.test(arg)) usage(`"${arg}" is not a semver version (expected x.y.z, optionally x.y.z-prerelease)`);
const next = arg;

/** Replaces the top-level "version" of a JSON file in place, keeping its formatting. */
function bumpJson(relPath) {
  const path = resolve(root, relPath);
  const source = readFileSync(path, "utf8");
  const current = JSON.parse(source).version;
  if (typeof current !== "string") throw new Error(`${relPath}: no top-level "version"`);
  const match = /^(\s*"version"\s*:\s*")([^"]*)(")/m.exec(source);
  if (!match || match[2] !== current) {
    throw new Error(`${relPath}: could not locate the top-level version line`);
  }
  const updated =
    source.slice(0, match.index) +
    match[1] +
    next +
    match[3] +
    source.slice(match.index + match[0].length);
  if (JSON.parse(updated).version !== next) {
    throw new Error(`${relPath}: replacement did not verify`);
  }
  return { relPath, path, current, updated };
}

/** Replaces `version = "..."` inside [package] only — dependency versions stay. */
function bumpCargo(relPath) {
  const path = resolve(root, relPath);
  const source = readFileSync(path, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let section = "";
  let current = null;
  let replaced = 0;
  const lines = source.split(eol).map((line) => {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1];
      return line;
    }
    if (section !== "package") return line;
    const m = /^(version\s*=\s*")([^"]*)(".*)$/.exec(line);
    if (!m) return line;
    current = m[2];
    replaced++;
    return `${m[1]}${next}${m[3]}`;
  });
  if (replaced !== 1) {
    throw new Error(`${relPath}: expected exactly one version line in [package], found ${replaced}`);
  }
  return { relPath, path, current, updated: lines.join(eol) };
}

let changes;
try {
  changes = [...JSON_FILES.map(bumpJson), bumpCargo(CARGO_TOML)];
} catch (err) {
  console.error(`error: ${err.message}`);
  console.error("Nothing was written.");
  process.exit(1);
}

for (const change of changes) {
  writeFileSync(change.path, change.updated);
  console.log(`${change.relPath}: ${change.current} -> ${next}`);
}

console.log(`
Next steps:
  1. (cd apps/desktop/src-tauri && cargo check)   # refreshes Cargo.lock with ${next}
  2. add a ${next} entry to ${CHANGELOG}
  3. git add -A && git commit -m "v${next}"
  4. git tag v${next} && git push && git push --tags   # the tag triggers .github/workflows/release.yml
`);
