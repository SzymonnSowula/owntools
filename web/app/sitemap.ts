import type { MetadataRoute } from "next";
import { CHANGELOG } from "@/lib/changelog";
import { POLICIES_UPDATED, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const policies = new Date(POLICIES_UPDATED);
  const latestRelease = new Date(CHANGELOG[0]?.date ?? POLICIES_UPDATED);

  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
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
