import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // /checkout opens a Polar session per visit and /thanks reads one - nothing to index
    rules: { userAgent: "*", allow: "/", disallow: ["/checkout", "/thanks", "/api/"] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
