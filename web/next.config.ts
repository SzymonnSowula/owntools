import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /* screenshots in public/shots are served through the optimizer: AVIF where
       the browser takes it (a fraction of a PNG's bytes), WebP otherwise */
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
