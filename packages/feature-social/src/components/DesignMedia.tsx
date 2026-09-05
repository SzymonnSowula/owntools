import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logError } from "@core/errors";
import { fetchBytes, networkAvailable, sfetch } from "../providers/http";
import { useSocialStore } from "../store";
import { Dialog, Field } from "./primitives";

/**
 * "Design media": text over a colour or a photo, rendered with a canvas
 * into a PNG in the library. Unsplash search appears only when an access
 * key is configured in Settings.
 */

const SIZES = [
  { id: "square", label: "1:1", w: 1080, h: 1080 },
  { id: "landscape", label: "16:9", w: 1600, h: 900 },
  { id: "portrait", label: "4:5", w: 1080, h: 1350 },
  { id: "story", label: "9:16", w: 1080, h: 1920 },
];

const BACKGROUNDS = ["#0a84ff", "#5e5ce6", "#32ade6", "#1d1d1f", "#30d158", "#ff9f0a", "#ff375f", "#f5f5f7"];

interface UnsplashPhoto {
  id: string;
  urls: { small: string; regular: string };
  user: { name: string };
  links: { download_location: string };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word;
      if (ctx.measureText(probe).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = probe;
    }
    out.push(line);
  }
  return out;
}

export function DesignMediaDialog({ onClose }: { onClose: () => void }) {
  const settings = useSocialStore((s) => s.settings);
  const addMedia = useSocialStore((s) => s.addMedia);
  const toast = useSocialStore((s) => s.toast);
  const [text, setText] = useState("say it in one line");
  const [size, setSize] = useState(SIZES[0]!);
  const [bg, setBg] = useState(BACKGROUNDS[0]!);
  const [photo, setPhoto] = useState<{ url: string; credit: string } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnsplashPhoto[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);

  const unsplash = Boolean(settings.unsplashKey.trim()) && networkAvailable();

  useEffect(() => {
    if (!photo) {
      image.current = null;
      return;
    }
    let alive = true;
    void fetchBytes(photo.url).then((res) => {
      if (!alive || !res) return;
      const img = new Image();
      img.onload = () => {
        image.current = img;
        draw();
      };
      img.src = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.mime }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const draw = () => {
    const c = canvas.current;
    if (!c) return;
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.w, size.h);
    const img = image.current;
    if (img) {
      const scale = Math.max(size.w / img.width, size.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size.w - w) / 2, (size.h - h) / 2, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, size.w, size.h);
    }
    const light = !img && /^#(f|e)/i.test(bg);
    ctx.fillStyle = light ? "#1d1d1f" : "#ffffff";
    const fontSize = Math.round(Math.min(size.w, size.h) * 0.075);
    ctx.font = `700 ${fontSize}px Outfit, Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const lines = wrapLines(ctx, text, size.w * 0.8);
    const lh = fontSize * 1.18;
    const startY = size.h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => ctx.fillText(l, size.w / 2, startY + i * lh));
    if (photo) {
      ctx.font = `500 ${Math.round(fontSize * 0.32)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(`photo: ${photo.credit} / Unsplash`, size.w - fontSize * 0.6, size.h - fontSize * 0.6);
    }
  };

  useEffect(draw, [text, size, bg, photo]);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await sfetch(`https://api.unsplash.com/search/photos?per_page=12&query=${encodeURIComponent(query.trim())}`, {
        headers: { Authorization: `Client-ID ${settings.unsplashKey.trim()}`, "Accept-Version": "v1" },
      });
      if (!res.ok) throw new Error(`Unsplash answered ${res.status}`);
      const data = (await res.json()) as { results: UnsplashPhoto[] };
      setResults(data.results ?? []);
    } catch (err) {
      logError("social", "unsplash", err);
      toast({ kind: "error", title: "Search failed", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    const c = canvas.current;
    if (!c) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("Could not render the image.");
      await addMedia({ bytes: new Uint8Array(await blob.arrayBuffer()), name: `design-${Date.now()}.png`, mime: "image/png", alt: text });
      toast({ kind: "success", title: "Saved to the library" });
      onClose();
    } catch (err) {
      toast({ kind: "error", title: "Could not save", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      size="medium"
      title="design media"
      description="Text over a colour or a photo."
      footer={
        <button className="sc-btn primary ml-auto" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null} Use this media
        </button>
      }
    >
      <div className="grid h-full grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-4 border-r border-line p-4">
          <Field label="Text">
            <textarea className="sc-field" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div>
            <div className="sc-label">Size</div>
            <div className="flex gap-1.5">
              {SIZES.map((s) => (
                <button key={s.id} className={`sc-chip${size.id === s.id ? " on" : ""}`} onClick={() => setSize(s)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="sc-label">Background</div>
            <div className="flex flex-wrap gap-1.5">
              {BACKGROUNDS.map((c) => (
                <button key={c} className="h-6 w-6 rounded-full border border-line" style={{ background: c, outline: c === bg && !photo ? "2px solid var(--color-accent)" : "none", outlineOffset: 2 }} aria-label={c} onClick={() => { setBg(c); setPhoto(null); }} />
              ))}
            </div>
          </div>
          {unsplash ? (
            <div>
              <div className="sc-label">Photos by Unsplash</div>
              <div className="flex gap-1.5">
                <input className="sc-field !h-8" placeholder="mountains, desk, coffee…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
                <button className="sc-btn sm" onClick={() => void search()} disabled={searching}>
                  {searching ? <Loader2 className="animate-spin" /> : <Search />}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {results.map((p) => (
                  <button key={p.id} className="aspect-square overflow-hidden rounded-md border border-line" onClick={() => setPhoto({ url: p.urls.regular, credit: p.user.name })} title={p.user.name}>
                    <img src={p.urls.small} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] leading-5 text-muted">Add an Unsplash access key in Settings to search photos here{networkAvailable() ? "" : " (desktop app only)"}.</p>
          )}
        </div>
        <div className="grid place-items-center bg-paper p-4">
          <canvas ref={canvas} className="max-h-full max-w-full rounded-[10px] shadow-lg" style={{ aspectRatio: `${size.w} / ${size.h}` }} />
        </div>
      </div>
    </Dialog>
  );
}
