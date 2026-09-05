import { useEffect, useState } from "react";

/** Decodes the object URLs of image overlays into elements the compositor can draw. */
export function useOverlayImages(urls: Record<string, string> | undefined): Record<string, HTMLImageElement> {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const key = urls ? Object.entries(urls).map(([k, v]) => `${k}=${v}`).sort().join("&") : "";

  useEffect(() => {
    let alive = true;
    if (!urls) {
      setImages({});
      return;
    }
    const next: Record<string, HTMLImageElement> = {};
    let pending = 0;
    for (const [src, url] of Object.entries(urls)) {
      const img = new Image();
      pending += 1;
      img.onload = img.onerror = () => {
        pending -= 1;
        if (alive && pending === 0) setImages({ ...next });
      };
      img.src = url;
      next[src] = img;
    }
    if (pending === 0) setImages({});
    return () => {
      alive = false;
    };
    // `key` captures the map's contents; `urls` itself changes identity on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return images;
}
