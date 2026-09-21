import type { Metadata } from "next";
import Link from "next/link";
import { BlogHeader, PostCard } from "./components/Chrome";
import { postsByDate, postPath } from "@/lib/blog";
import { siteUrl } from "@/lib/site";

const DESCRIPTION =
  "Notes from building desktop software that runs on your own machine: Windows internals, on-device speech recognition, and what we measured along the way.";

export const metadata: Metadata = {
  title: "Blog",
  description: DESCRIPTION,
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": `${siteUrl}/blog/rss.xml` },
  },
  openGraph: { type: "website", url: `${siteUrl}/blog`, title: "owntools blog", description: DESCRIPTION },
};

export default function BlogIndexPage() {
  const posts = postsByDate();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${siteUrl}/blog#blog`,
    name: "owntools blog",
    description: DESCRIPTION,
    url: `${siteUrl}/blog`,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "owntools", url: siteUrl },
    blogPost: posts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.published,
      url: `${siteUrl}${postPath(post.slug)}`,
    })),
  };

  return (
    <div id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BlogHeader />

      <main className="dotted">
        <div className="mx-auto max-w-2xl px-5 pb-24 pt-14 md:pt-20">
          <p className="kicker">writing</p>
          <h1 className="display mt-3 text-4xl md:text-5xl">blog</h1>
          <p className="mt-4 text-[16px] leading-7 text-muted">
            One question per post, answered in the first paragraph. Mostly Windows internals and
            on-device speech recognition - the things we had to find out to build{" "}
            <Link href="/" className="text-accent underline underline-offset-[3px]">
              owntools
            </Link>
            , with the numbers we measured rather than the ones we expected.
          </p>

          <div className="mt-10 grid gap-5">
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>

          <footer className="mt-16 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6 text-sm text-muted">
            <Link href="/" className="transition hover:text-ink">
              ← owntools
            </Link>
            <Link href="/changelog" className="transition hover:text-ink">
              changelog
            </Link>
            <a href="/blog/rss.xml" className="transition hover:text-ink">
              rss
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}
