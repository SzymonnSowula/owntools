import type { MetadataRoute } from "next";
import { CHANGELOG } from "@/lib/changelog";
import { postModified, postPath, postsByDate } from "@/lib/blog";
import { POLICIES_UPDATED, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const policies = new Date(POLICIES_UPDATED);
  const latestRelease = new Date(CHANGELOG[0]?.date ?? POLICIES_UPDATED);
  const posts = postsByDate();

  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/blog`,
      lastModified: new Date(postModified(posts[0])),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    // One entry per post. `lastModified` is the post's own date, never today's:
    // a sitemap that claims everything changed on every deploy is ignored.
    ...posts.map((post) => ({
      url: `${siteUrl}${postPath(post.slug)}`,
      lastModified: new Date(postModified(post)),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    {
      url: `${siteUrl}/changelog`,
      lastModified: latestRelease,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: policies,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: policies,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/refunds`,
      lastModified: policies,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
