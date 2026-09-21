import { postModified, postPath, postsByDate } from "@/lib/blog";
import { siteUrl } from "@/lib/site";

/**
 * RSS 2.0 for the blog. Worth the forty lines: it is how the handful of people
 * who still run a reader find new posts, and how aggregators (and a couple of
 * crawlers) notice one without waiting for a sitemap sweep.
 */

const escape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** RFC 822, which is what RSS wants - not ISO 8601. */
const rfc822 = (iso: string): string => new Date(`${iso}T12:00:00Z`).toUTCString();

export const dynamic = "force-static";

export function GET(): Response {
  const posts = postsByDate();
  const self = `${siteUrl}/blog/rss.xml`;

  const items = posts
    .map((post) => {
      const url = `${siteUrl}${postPath(post.slug)}`;
      return `    <item>
      <title>${escape(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(post.published)}</pubDate>
      <description>${escape(post.answer)}</description>
${post.tags.map((tag) => `      <category>${escape(tag)}</category>`).join("\n")}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>owntools blog</title>
    <link>${siteUrl}/blog</link>
    <description>Windows internals, on-device speech recognition, and the numbers we measured building owntools.</description>
    <language>en</language>
    <lastBuildDate>${rfc822(postModified(posts[0]))}</lastBuildDate>
    <atom:link href="${self}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
