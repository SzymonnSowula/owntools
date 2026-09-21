/**
 * Measures each blog post and writes the reading time back into
 * `web/lib/blog.ts`, so the "N min read" on a post is a measurement rather
 * than a guess that ages badly as the post is edited.
 *
 *   pnpm blog:minutes          # update web/lib/blog.ts
 *   pnpm blog:minutes --check  # fail if any figure is stale (for CI)
 *
 * How it counts: prose at 220 words a minute, and code blocks separately at 25
 * lines a minute, because nobody reads a Rust snippet at talking speed. The
 * result is rounded up and never below one.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const POSTS_DIR = join(ROOT, "web", "app", "blog", "posts");
const INDEX = join(ROOT, "web", "lib", "blog.ts");

const WORDS_PER_MINUTE = 220;
const CODE_LINES_PER_MINUTE = 25;

/** Strips the JSX down to what a reader actually reads. */
function measure(source: string): { words: number; codeLines: number; minutes: number } {
  // the body starts after the component's opening line; imports are not prose
  const body = source.slice(source.indexOf("return ("));

  let codeLines = 0;
  const withoutCode = body.replace(/<pre>[\s\S]*?<\/pre>/g, (block) => {
    codeLines += block.split("\n").length;
    return " ";
  });

  const text = withoutCode
    // JSX expressions that are props or logic, not words on the page
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{["'`][^}]*["'`]\}/g, (m) => m.slice(2, -2))
    .replace(/[{}]/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");

  const words = text.split(" ").filter((w) => /[a-zA-Z0-9]/.test(w)).length;
  const minutes = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE + codeLines / CODE_LINES_PER_MINUTE));
  return { words, codeLines, minutes };
}

/** Replaces the `minutes:` belonging to one slug, leaving the rest untouched. */
function writeMinutes(index: string, slug: string, minutes: number): string {
  const at = index.indexOf(`slug: "${slug}"`);
  if (at < 0) throw new Error(`no entry for ${slug} in web/lib/blog.ts`);
  const field = index.indexOf("minutes:", at);
  if (field < 0) throw new Error(`no minutes field for ${slug}`);
  const end = index.indexOf(",", field);
  return `${index.slice(0, field)}minutes: ${minutes}${index.slice(end)}`;
}

function main() {
  const check = process.argv.includes("--check");
  let index = readFileSync(INDEX, "utf8");
  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".tsx")).sort();
  const stale: string[] = [];

  for (const file of files) {
    const slug = file.replace(/\.tsx$/, "");
    const { words, codeLines, minutes } = measure(readFileSync(join(POSTS_DIR, file), "utf8"));
    const current = Number(/minutes:\s*(\d+)/.exec(index.slice(index.indexOf(`slug: "${slug}"`)))?.[1]);
    const mark = current === minutes ? " " : "*";
    console.log(
      `${mark} ${slug.padEnd(52)} ${String(words).padStart(5)} words` +
        `${codeLines ? ` + ${String(codeLines).padStart(3)} code lines` : ""}` +
        `  ->  ${minutes} min${current === minutes ? "" : ` (was ${current})`}`,
    );
    if (current !== minutes) {
      stale.push(slug);
      index = writeMinutes(index, slug, minutes);
    }
  }

  if (!stale.length) {
    console.log("\nEvery reading time is current.");
    return;
  }
  if (check) {
    console.error(`\n${stale.length} reading time(s) are stale: ${stale.join(", ")}`);
    console.error("Run `pnpm blog:minutes` to update them.");
    process.exit(1);
  }
  writeFileSync(INDEX, index);
  console.log(`\nUpdated ${stale.length} reading time(s) in web/lib/blog.ts.`);
}

main();
