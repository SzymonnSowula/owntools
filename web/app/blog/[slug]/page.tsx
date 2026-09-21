import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BODIES } from "../bodies";
import { BlogHeader, PostCard, formatDate } from "../components/Chrome";
import { POSTS, findPost, postModified, postPath, relatedPosts } from "@/lib/blog";
import { siteUrl } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

/** Every post is known at build time, so the whole blog is static HTML. */
export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) return { title: "Not found", robots: { index: false } };
  const url = `${siteUrl}${postPath(post.slug)}`;
  return {
    title: post.title,
    description: post.description,
    keywords: post.tags,
    alternates: { canonical: postPath(post.slug) },
    openGraph: {
      type: "article",
      url,
      siteName: "owntools",
      title: post.title,
      description: post.description,
      publishedTime: post.published,
      modifiedTime: postModified(post),
      tags: post.tags,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = findPost(slug);
  const Body = BODIES[slug];
  if (!post || !Body) notFound();

  const url = `${siteUrl}${postPath(post.slug)}`;
  const related = relatedPosts(post.slug);

  /* One <script> carrying every graph this page has: the article itself, the
     trail up to the blog, and the questions it answers. The FAQ entries are
     rendered on the page as well - structured data that describes content a
     reader cannot see is a guideline violation, not a shortcut. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": post.schema,
        "@id": `${url}#article`,
        headline: post.title,
        description: post.description,
        abstract: post.answer,
        datePublished: post.published,
        dateModified: postModified(post),
        inLanguage: "en",
        keywords: post.tags.join(", "),
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        author: { "@type": "Organization", name: "owntools", url: siteUrl },
        publisher: { "@type": "Organization", name: "owntools", url: siteUrl },
        isAccessibleForFree: true,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "owntools", item: siteUrl },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${siteUrl}/blog` },
          { "@type": "ListItem", position: 3, name: post.title, item: url },
        ],
      },
      ...(post.faq?.length
        ? [
            {
              "@type": "FAQPage",
              "@id": `${url}#faq`,
              mainEntity: post.faq.map((item) => ({
                "@type": "Question",
                name: item.q,
                acceptedAnswer: { "@type": "Answer", text: item.a },
              })),
            },
          ]
        : []),
    ],
  };

  return (
    <div id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BlogHeader />

      <main className="dotted">
        <article className="mx-auto max-w-2xl px-5 pb-24 pt-12 md:pt-16">
          <nav aria-label="Breadcrumb" className="text-sm text-muted">
            <Link href="/blog" className="transition hover:text-ink">
              ← blog
            </Link>
          </nav>

          <p className="kicker mt-6">{post.tags[0]}</p>
          <h1 className="display mt-3 text-[34px] leading-[1.1] md:text-[44px]">{post.title}</h1>

          {/* The answer, before the article. Someone who only reads this line
              should already have what they came for. */}
          <p className="mt-5 text-[17px] font-medium leading-8">{post.answer}</p>

          <p className="mt-5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            <time dateTime={post.published}>{formatDate(post.published)}</time>
            <span aria-hidden> · </span>
            {post.minutes} min read
            {post.updated ? (
              <>
                <span aria-hidden> · </span>
                updated {formatDate(post.updated)}
              </>
            ) : null}
          </p>

          <div className="doc mt-10">
            <Body />
          </div>

          {post.faq?.length ? (
            <section className="mt-14">
              <h2 className="display text-[22px]">questions people ask</h2>
              <div className="doc mt-4">
                {post.faq.map((item) => (
                  <div key={item.q}>
                    <h3>{item.q}</h3>
                    <p>{item.a}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {related.length ? (
            <section className="mt-16">
              <h2 className="display text-[22px]">read next</h2>
              <div className="mt-4 grid gap-4">
                {related.map((p) => (
                  <PostCard key={p.slug} post={p} />
                ))}
              </div>
            </section>
          ) : null}

          <footer className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6 text-sm text-muted">
            <Link href="/blog" className="transition hover:text-ink">
              all posts
            </Link>
            <Link href="/" className="transition hover:text-ink">
              owntools
            </Link>
            <Link href="/changelog" className="transition hover:text-ink">
              changelog
            </Link>
            <a href="/blog/rss.xml" className="transition hover:text-ink">
              rss
            </a>
          </footer>
        </article>
      </main>
    </div>
  );
}
