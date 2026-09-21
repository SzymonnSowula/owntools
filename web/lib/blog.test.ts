import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POSTS, findPost, postModified, postPath, postsByDate, relatedPosts } from "./blog";
import { SUBSCRIPTIONS_TOTAL_CENTS, centsToAmount } from "./comparison";

/**
 * The blog's index, the body files and the slug -> component record are three
 * separate things that have to agree. Nothing here renders a post - the bodies
 * pull in next/link and a client component, which is not what this is for -
 * it checks the wiring and the metadata that search engines read.
 */

const BLOG_DIR = join(import.meta.dirname, "..", "app", "blog");
const bodiesSource = readFileSync(join(BLOG_DIR, "bodies.ts"), "utf8");

describe("the post list", () => {
  it("has posts", () => {
    expect(POSTS.length).toBeGreaterThan(0);
  });

  it("gives every post a unique, url-shaped slug", () => {
    const slugs = POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has a body file and a BODIES entry for every post", () => {
    for (const post of POSTS) {
      expect(existsSync(join(BLOG_DIR, "posts", `${post.slug}.tsx`)), `${post.slug}.tsx`).toBe(true);
      expect(bodiesSource, `BODIES["${post.slug}"]`).toContain(`"${post.slug}"`);
    }
  });

  it("has no BODIES entry without a post", () => {
    // every quoted slug-shaped key in the record is one we know about
    const keys = [...bodiesSource.matchAll(/"([a-z0-9-]+)":/g)].map((m) => m[1]);
    expect(keys.length).toBe(POSTS.length);
    for (const key of keys) expect(findPost(key), key).toBeDefined();
  });
});

describe("what search engines read", () => {
  it("keeps descriptions inside the length a result snippet shows", () => {
    for (const post of POSTS) {
      expect(post.description.length, `${post.slug} description`).toBeGreaterThanOrEqual(80);
      expect(post.description.length, `${post.slug} description`).toBeLessThanOrEqual(165);
    }
  });

  it("keeps titles short enough not to be cut in half", () => {
    for (const post of POSTS) {
      expect(post.title.length, `${post.slug} title`).toBeLessThanOrEqual(95);
      expect(post.title.length, `${post.slug} title`).toBeGreaterThan(20);
    }
  });

  it("answers the question up front, in a paragraph that stands alone", () => {
    for (const post of POSTS) {
      expect(post.answer.length, `${post.slug} answer`).toBeGreaterThan(90);
      expect(post.answer.length, `${post.slug} answer`).toBeLessThanOrEqual(420);
      // an answer that opens with "it depends" or a pronoun needs the title to
      // make sense, and it gets quoted without it
      expect(post.answer.trim(), `${post.slug} answer`).not.toMatch(/^(it|this|that|they)\b/i);
    }
  });

  it("dates every post, and never dates a change before publication", () => {
    for (const post of POSTS) {
      expect(post.published, `${post.slug} published`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(post.published)), post.slug).toBe(false);
      if (post.updated) expect(post.updated >= post.published, `${post.slug} updated`).toBe(true);
      expect(postModified(post)).toBe(post.updated ?? post.published);
    }
  });

  it("tags every post and gives it a reading time", () => {
    for (const post of POSTS) {
      expect(post.tags.length, `${post.slug} tags`).toBeGreaterThan(0);
      expect(post.minutes, `${post.slug} minutes`).toBeGreaterThan(0);
    }
  });

  it("writes FAQ answers that can be quoted on their own", () => {
    for (const post of POSTS) {
      for (const item of post.faq ?? []) {
        expect(item.q.endsWith("?"), `${post.slug}: "${item.q}"`).toBe(true);
        // a one-line answer is a snippet nobody can use; a five-line one is an article
        expect(item.a.length, `${post.slug}: answer to "${item.q}"`).toBeGreaterThan(120);
        expect(item.a.length, `${post.slug}: answer to "${item.q}"`).toBeLessThanOrEqual(900);
      }
    }
  });
});

describe("numbers quoted in metadata", () => {
  /* The subscription post's body renders the table from lib/comparison.ts, but
     its description and answer spell the total out - those are strings, and a
     price correction in the data would leave them quietly wrong in the search
     result and in the feed. */
  it("keeps the subscription total in step with the comparison data", () => {
    const post = findPost("what-your-tools-cost-a-year");
    if (!post) return;
    const total = `$${centsToAmount(SUBSCRIPTIONS_TOTAL_CENTS)}`;
    expect(post.description, "description").toContain(total);
    expect(post.answer, "answer").toContain(total);
    expect(post.faq?.some((item) => item.a.includes(total)), "an FAQ answer").toBe(true);
  });
});

describe("linking", () => {
  it("lists newest first", () => {
    const dates = postsByDate().map((p) => p.published);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("builds a path under /blog", () => {
    expect(postPath("a-post")).toBe("/blog/a-post");
  });

  it("suggests other posts, never the one being read", () => {
    for (const post of POSTS) {
      const related = relatedPosts(post.slug);
      expect(related.length).toBe(Math.min(2, POSTS.length - 1));
      expect(related.map((p) => p.slug)).not.toContain(post.slug);
    }
  });

  it("falls back to the newest posts for an unknown slug", () => {
    expect(relatedPosts("nope").length).toBe(Math.min(2, POSTS.length));
  });
});

describe("the bodies", () => {
  /* Not a rendering test - a rule. A post that names the app without saying who
     wrote it reads as an advert that was hoping you would not notice. */
  it("discloses who wrote it wherever owntools is named", () => {
    for (const post of POSTS) {
      const source = readFileSync(join(BLOG_DIR, "posts", `${post.slug}.tsx`), "utf8");
      if (/owntools/i.test(source)) {
        expect(source, `${post.slug} names owntools without a <Disclosure>`).toContain("<Disclosure>");
      }
    }
  });

  it("uses hyphens rather than em dashes in what the reader sees", () => {
    for (const post of POSTS) {
      const source = readFileSync(join(BLOG_DIR, "posts", `${post.slug}.tsx`), "utf8");
      const prose = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      expect(prose, `${post.slug} has an em dash`).not.toMatch(/[—–]/);
    }
  });
});
