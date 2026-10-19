import type { NextConfig } from "next";

/**
 * Headers every answer carries. Nothing here changes how the site works; they
 * close the cheap ways a page can be turned against the person reading it:
 * guessing a response's type, framing it inside somebody else's page, or
 * carrying the full address of a share into whatever it links to.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  images: {
    /* screenshots in public/shots are served through the optimizer: AVIF where
       the browser takes it (a fraction of a PNG's bytes), WebP otherwise */
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // A share link is unlisted, and the page already says so in its
        // metadata; this repeats it in a header, which is what a crawler
        // fetching the video or the poster directly actually sees.
        source: "/v/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;
