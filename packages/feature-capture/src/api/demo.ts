import type { CaptureBackend } from "./backend";
import type { CaptureFrame, CaptureItem, FinishMeta, FinishResult, OcrLine, Rect } from "./types";

/**
 * The browser stand-in for the Rust side, so `/capture.html` and the library
 * page work under `pnpm dev`: a painted desktop (two windows with real text)
 * stands in for the screenshot, the text that was painted stands in for OCR
 * (a "recognised" line is one whose box intersects the selection), and the
 * library is a list of data URLs in localStorage — the overlay page and the
 * main page are different documents, and localStorage is what they share.
 */

const STORE_KEY = "owntools-capture-demo";
const MAX_ITEMS = 24;

interface StoredItem extends CaptureItem {
  dataUrl: string;
}

interface Store {
  items: StoredItem[];
  seeded?: boolean;
}

type Listener<T> = (payload: T) => void;

class Emitter<T> {
  private set = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.set.add(cb);
    return () => {
      this.set.delete(cb);
    };
  }
  emit(payload: T): void {
    for (const cb of Array.from(this.set)) cb(payload);
  }
}

const shown = new Emitter<CaptureFrame>();
const changed = new Emitter<void>();

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { items: [] };
    const data = JSON.parse(raw) as Partial<Store>;
    return { items: Array.isArray(data.items) ? data.items : [], seeded: data.seeded };
  } catch {
    return { items: [] };
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Quota: drop the oldest half and try once more.
    store.items = store.items.slice(0, Math.max(1, Math.floor(store.items.length / 2)));
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* give up quietly — this is the demo */
    }
  }
  changed.emit();
}

function strip(item: StoredItem): CaptureItem {
  const { dataUrl: _dataUrl, ...rest } = item;
  return rest;
}

/* ------------------------------------------------------------------ */
/* A painted desktop                                                   */
/* ------------------------------------------------------------------ */

interface PaintedText extends OcrLine {}

interface DemoScreen {
  canvas: HTMLCanvasElement;
  lines: PaintedText[];
}

let pending: { frame: CaptureFrame; screen: DemoScreen } | null = null;
let counter = 0;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws a desktop with two windows; every string drawn is recorded for the fake OCR. */
export function paintDemoScreen(width: number, height: number, scale: number): DemoScreen {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  const lines: PaintedText[] = [];
  if (!ctx) return { canvas, lines };
  const s = scale;

  const text = (str: string, x: number, y: number, font: string, color: string) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(str, x, y);
    const m = ctx.measureText(str);
    const asc = m.actualBoundingBoxAscent || 10 * s;
    const desc = m.actualBoundingBoxDescent || 3 * s;
    lines.push({ text: str, x, y: y - asc, w: m.width, h: asc + desc });
  };

  // Desktop: the suite's dotted ground over a quiet gradient.
  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, "#dfe9f7");
  bg.addColorStop(1, "#c7d4ea");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(29,29,31,0.16)";
  const step = 24 * s;
  for (let y = step / 2; y < canvas.height; y += step) {
    for (let x = step / 2; x < canvas.width; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const win = (x: number, y: number, w: number, h: number, dark: boolean, title: string) => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 24 * s;
    ctx.shadowOffsetY = 10 * s;
    ctx.fillStyle = dark ? "#1b1c22" : "#ffffff";
    roundRect(ctx, x, y, w, h, 12 * s);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = dark ? "#26272f" : "#f5f5f7";
    roundRect(ctx, x, y, w, 34 * s, 12 * s);
    ctx.fill();
    ctx.fillRect(x, y + 20 * s, w, 14 * s);
    for (const [i, c] of ["#ff5f57", "#febc2e", "#28c840"].entries()) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + (14 + i * 18) * s, y + 17 * s, 5.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    text(title, x + 76 * s, y + 22 * s, `600 ${12 * s}px Inter, system-ui, sans-serif`, dark ? "#c8c9cf" : "#6e6e73");
  };

  const W = canvas.width;
  const H = canvas.height;
  // Window 1: notes.
  const w1 = { x: W * 0.08, y: H * 0.12, w: W * 0.5, h: H * 0.6 };
  win(w1.x, w1.y, w1.w, w1.h, false, "launch-plan.md — owntools board");
  const body = [
    ["Launch plan, week 37", `700 ${22 * s}px Outfit, Inter, sans-serif`, "#1d1d1f"],
    ["Ship the installer on Tuesday, post the demo on Wednesday.", `400 ${14 * s}px Inter, system-ui, sans-serif`, "#1d1d1f"],
    ["Price stays at 149 zl until the first hundred keys are sold.", `400 ${14 * s}px Inter, system-ui, sans-serif`, "#1d1d1f"],
    ["Every screenshot in the docs comes from capture, not from Snipping Tool.", `400 ${14 * s}px Inter, system-ui, sans-serif`, "#1d1d1f"],
    ["Open: refund policy wording, Apple developer account, changelog for 0.3.0.", `400 ${14 * s}px Inter, system-ui, sans-serif`, "#6e6e73"],
  ] as const;
  let ty = w1.y + 74 * s;
  for (const [str, font, color] of body) {
    text(str, w1.x + 28 * s, ty, font, color);
    ty += (font.startsWith("700") ? 40 : 28) * s;
  }
  // A little "chart" card inside the notes window.
  ctx.fillStyle = "#f5f5f7";
  roundRect(ctx, w1.x + 28 * s, ty + 4 * s, w1.w - 56 * s, 96 * s, 10 * s);
  ctx.fill();
  const bars = [0.3, 0.55, 0.4, 0.7, 0.85, 0.6, 0.95];
  bars.forEach((v, i) => {
    ctx.fillStyle = i === bars.length - 1 ? "#0a84ff" : "rgba(10,132,255,0.35)";
    const bw = (w1.w - 56 * s - 24 * s) / bars.length - 8 * s;
    const bx = w1.x + 40 * s + i * (bw + 8 * s);
    const bh = 60 * s * v;
    roundRect(ctx, bx, ty + 86 * s - bh, bw, bh, 3 * s);
    ctx.fill();
  });
  text("keys sold per day", w1.x + 40 * s, ty + 22 * s, `600 ${11 * s}px Inter, system-ui, sans-serif`, "#6e6e73");

  // Window 2: a terminal.
  const w2 = { x: W * 0.52, y: H * 0.3, w: W * 0.42, h: H * 0.52 };
  win(w2.x, w2.y, w2.w, w2.h, true, "pwsh — owntools");
  const term = [
    ["$ pnpm check", "#e6e6e6"],
    ["tsc --noEmit -p apps/desktop/tsconfig.json", "#9a9ba3"],
    ["vitest run", "#9a9ba3"],
    ["  Test Files  44 passed (44)", "#4ade80"],
    ["       Tests  431 passed (431)", "#4ade80"],
    ["    Duration  6.12s", "#9a9ba3"],
    ["$ cargo test -p owntools", "#e6e6e6"],
    ["test result: ok. 41 passed; 0 failed", "#4ade80"],
    ["$ _", "#e6e6e6"],
  ] as const;
  let tty = w2.y + 62 * s;
  for (const [str, color] of term) {
    text(str, w2.x + 22 * s, tty, `500 ${13 * s}px ui-monospace, Consolas, monospace`, color);
    tty += 24 * s;
  }

  // Taskbar.
  ctx.fillStyle = "rgba(245,245,247,0.82)";
  ctx.fillRect(0, H - 44 * s, W, 44 * s);
  text("11:42", W - 70 * s, H - 17 * s, `500 ${12 * s}px Inter, system-ui, sans-serif`, "#1d1d1f");

  return { canvas, lines };
}

/** Lines whose boxes intersect `rect`, moved into the crop's own coordinates. */
export function linesWithin(lines: readonly OcrLine[], rect: Rect): OcrLine[] {
  return lines
    .filter((l) => l.x < rect.x + rect.w && l.x + l.w > rect.x && l.y < rect.y + rect.h && l.y + l.h > rect.y)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((l) => ({ ...l, x: l.x - rect.x, y: l.y - rect.y }));
}

function bytesToDataUrl(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: "image/png" }));
  });
}

function dataUrlToBytes(url: string): Uint8Array {
  const comma = url.indexOf(",");
  const bin = atob(url.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* Seeds: three captures so the library and the search have something  */
/* ------------------------------------------------------------------ */

async function cropToDataUrl(screen: DemoScreen, rect: Rect): Promise<string> {
  const c = document.createElement("canvas");
  c.width = Math.round(rect.w);
  c.height = Math.round(rect.h);
  c.getContext("2d")?.drawImage(screen.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

async function seed(store: Store): Promise<Store> {
  if (store.seeded || typeof document === "undefined") return store;
  const screen = paintDemoScreen(1600, 1000, 1);
  const now = Date.now();
  const picks: { rect: Rect; title?: string; ago: number }[] = [
    { rect: { x: 1600 * 0.08, y: 1000 * 0.12, w: 1600 * 0.5, h: 1000 * 0.6 }, title: "launch plan", ago: 2 * 3_600_000 },
    { rect: { x: 1600 * 0.52, y: 1000 * 0.3, w: 1600 * 0.42, h: 1000 * 0.52 }, ago: 26 * 3_600_000 },
    { rect: { x: 1600 * 0.1, y: 1000 * 0.42, w: 1600 * 0.46, h: 1000 * 0.24 }, title: "keys per day", ago: 6 * 86_400_000 },
  ];
  const items: StoredItem[] = [];
  for (const [i, p] of picks.entries()) {
    const id = `demo-${String(i + 1).padStart(3, "0")}`;
    items.push({
      id,
      path: `demo:/captures/${id}.png`,
      width: Math.round(p.rect.w),
      height: Math.round(p.rect.h),
      createdAt: now - p.ago,
      title: p.title,
      ocrText: linesWithin(screen.lines, p.rect)
        .map((l) => l.text)
        .join("\n"),
      dataUrl: await cropToDataUrl(screen, p.rect),
    });
  }
  return { items: [...items, ...store.items], seeded: true };
}

let seeding: Promise<void> | null = null;
function ensureSeeded(): Promise<void> {
  if (!seeding) {
    seeding = (async () => {
      const store = readStore();
      if (store.seeded) return;
      writeStore(await seed(store));
    })();
  }
  return seeding;
}

/* ------------------------------------------------------------------ */

async function clipboardWrite(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* the preview may not have focus; nothing to do */
  }
}

export const demoBackend: CaptureBackend = {
  kind: "demo",

  list: async () => {
    await ensureSeeded();
    return readStore().items.map(strip);
  },
  remove: async (id) => {
    const store = readStore();
    store.items = store.items.filter((i) => i.id !== id);
    writeStore(store);
  },
  setTitle: async (id, title) => {
    const store = readStore();
    store.items = store.items.map((i) => (i.id === id ? { ...i, title: title.trim() || undefined } : i));
    writeStore(store);
  },
  ocr: async (path, id) => {
    const item = readStore().items.find((i) => i.path === path || i.id === id);
    const text = item?.ocrText ?? "";
    return { text, lines: text ? text.split("\n").map((t, i) => ({ text: t, x: 0, y: i * 20, w: 200, h: 18 })) : [] };
  },
  copyImage: async (path) => {
    const item = readStore().items.find((i) => i.path === path);
    if (!item || typeof ClipboardItem === "undefined") return;
    try {
      const blob = new Blob([dataUrlToBytes(item.dataUrl) as BlobPart], { type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      /* not granted in the preview */
    }
  },
  copyText: clipboardWrite,
  openFolder: async () => {},
  reveal: async () => {},
  imageUrl: (path) => readStore().items.find((i) => i.path === path)?.dataUrl ?? "",
  readBytes: async (path) => {
    const item = readStore().items.find((i) => i.path === path);
    if (!item) throw new Error(`no demo capture at ${path}`);
    return dataUrlToBytes(item.dataUrl);
  },
  onChanged: (cb) => {
    const off = changed.on(cb);
    // Another document (the overlay page) saving → the native storage event.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      off();
      window.removeEventListener("storage", onStorage);
    };
  },

  onShown: (cb) => shown.on(cb),
  current: async () => pending?.frame ?? null,
  pixels: async (frame) => {
    if (!pending || pending.frame.id !== frame.id) throw new Error("demo: no frame on show");
    return createImageBitmap(pending.screen.canvas);
  },
  finish: async (png, meta) => {
    const dataUrl = await bytesToDataUrl(png);
    const now = Date.now();
    const result: FinishResult = { id: meta.id, path: `demo:/captures/${meta.id}.png`, width: meta.width, height: meta.height };
    let ocrText: string | undefined;
    if (meta.ocr) {
      const lines = pending && pending.frame.id === meta.id ? linesWithin(pending.screen.lines, meta.rect) : [];
      ocrText = lines.map((l) => l.text).join("\n");
      result.ocrText = ocrText;
      if (!ocrText) result.ocrError = "No text was found in this capture.";
    }
    if (meta.save.library) {
      const store = readStore();
      store.items = [
        {
          id: meta.id,
          path: result.path,
          width: meta.width,
          height: meta.height,
          createdAt: now,
          title: meta.title,
          ocrText,
          dataUrl,
        },
        ...store.items.filter((i) => i.id !== meta.id),
      ].slice(0, MAX_ITEMS);
      writeStore(store);
    }
    if (meta.hide) pending = null;
    return result;
  },
  cancel: async () => {
    pending = null;
  },
  hide: async () => {
    pending = null;
  },
  grab: async () => {
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * scale);
    const height = Math.round(window.innerHeight * scale);
    const screen = paintDemoScreen(width, height, scale);
    counter += 1;
    const frame: CaptureFrame = {
      id: `demo-${Date.now().toString(36)}-${counter}`,
      path: "demo:/tmp",
      width,
      height,
      scale,
      x: 0,
      y: 0,
    };
    pending = { frame, screen };
    shown.emit(frame);
  },

  toBoard: async () => {},
  toSocial: async () => {},
  hotkeyRegistered: async () => null,
};

export type { StoredItem, FinishMeta };
