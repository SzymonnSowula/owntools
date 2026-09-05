import type { PDFDocumentProxy } from "pdfjs-dist";
import { documentOptions, loadPdfjs } from "./pdfjs";
import { groupTextItems, type PdfPageText, type PdfTextItem } from "./pdfText";
import { loadImageSource } from "./image";

export interface PdfHandle {
  doc: PDFDocumentProxy;
  pageCount: number;
  name: string;
  /** Tears down the worker side of the document. */
  close(): Promise<void>;
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export async function openPdf(file: File): Promise<PdfHandle> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(documentOptions(await file.arrayBuffer()));
  const doc = await task.promise;
  return {
    doc,
    pageCount: doc.numPages,
    name: file.name,
    close: () => task.destroy().catch(() => undefined),
  };
}

interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

function isTextItem(item: unknown): item is RawTextItem {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

/** Reads the given pages (1-based) into paragraphs; progress is 0..1. */
export async function extractPdfText(
  handle: PdfHandle,
  pages: number[],
  onProgress: (p: number) => void,
): Promise<PdfPageText[]> {
  const out: PdfPageText[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = await handle.doc.getPage(pages[i]);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const raw of content.items) {
      if (!isTextItem(raw)) continue;
      items.push({
        str: raw.str,
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width,
        height: raw.height,
        eol: raw.hasEOL,
      });
    }
    out.push({ number: pages[i], paragraphs: groupTextItems(items) });
    page.cleanup();
    onProgress((i + 1) / pages.length);
  }
  return out;
}

export type PageImageFormat = "png" | "jpeg" | "webp";

export const PAGE_IMAGE_MIME: Record<PageImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export interface RenderPageOptions {
  /** Output width in pixels; height follows the page's aspect. */
  width: number;
  format: PageImageFormat;
  /** 0..1, JPEG and WebP only. */
  quality: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the image."))),
      type,
      quality,
    );
  });
}

export async function renderPdfPage(
  handle: PdfHandle,
  pageNumber: number,
  options: RenderPageOptions,
): Promise<{ blob: Blob; width: number; height: number }> {
  const page = await handle.doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: options.width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas available.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // "print" intent: pdf.js paces a "display" render with requestAnimationFrame,
  // which never fires while the window is hidden or minimised — a 200-page
  // export would stall the moment the user switched away.
  await page.render({ canvasContext: ctx, canvas, viewport, intent: "print" }).promise;
  page.cleanup();
  const blob = await canvasToBlob(canvas, PAGE_IMAGE_MIME[options.format], options.quality);
  const { width, height } = canvas;
  canvas.width = canvas.height = 0;
  return { blob, width, height };
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

export async function pagesToDocx(
  pages: PdfPageText[],
  options: { title: string; pageBreaks: boolean },
): Promise<Blob> {
  const { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [];
  pages.forEach((page, i) => {
    if (i > 0 && options.pageBreaks) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const p of page.paragraphs) {
      children.push(
        p.heading
          ? new Paragraph({ text: p.text, heading: HeadingLevel.HEADING_2 })
          : new Paragraph({ children: [new TextRun(p.text)] }),
      );
    }
  });
  if (!children.length) children.push(new Paragraph({ children: [new TextRun("")] }));
  const doc = new Document({ title: options.title, sections: [{ children }] });
  return Packer.toBlob(doc);
}

// ---------------------------------------------------------------------------
// Combine images and PDFs into one PDF
// ---------------------------------------------------------------------------

export type CombinePageSize = "fit" | "a4" | "letter";

export interface CombineOptions {
  pageSize: CombinePageSize;
  /** Points around an image on a fixed page size. */
  margin: number;
}

const PAGE_POINTS: Record<Exclude<CombinePageSize, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

async function imageBytes(file: File): Promise<{ kind: "jpg" | "png"; bytes: Uint8Array }> {
  if (file.type === "image/jpeg") return { kind: "jpg", bytes: new Uint8Array(await file.arrayBuffer()) };
  if (file.type === "image/png") return { kind: "png", bytes: new Uint8Array(await file.arrayBuffer()) };
  // WebP, GIF, BMP, AVIF, SVG: draw once and hand pdf-lib a PNG.
  const source = await loadImageSource(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas available.");
    ctx.drawImage(source.source, 0, 0, source.width, source.height);
    const blob = await canvasToBlob(canvas, "image/png", 1);
    canvas.width = canvas.height = 0;
    return { kind: "png", bytes: new Uint8Array(await blob.arrayBuffer()) };
  } finally {
    source.close();
  }
}

export async function combineToPdf(
  files: File[],
  options: CombineOptions,
  onProgress: (p: number) => void,
): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isPdfFile(file)) {
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const page of pages) out.addPage(page);
    } else {
      const { kind, bytes } = await imageBytes(file);
      const image = kind === "jpg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
      if (options.pageSize === "fit") {
        // Pixels at 96 dpi → points, so the page is the picture.
        const page = out.addPage([image.width * 0.75, image.height * 0.75]);
        page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      } else {
        const [a, b] = PAGE_POINTS[options.pageSize];
        const landscape = image.width > image.height;
        const pw = landscape ? Math.max(a, b) : Math.min(a, b);
        const ph = landscape ? Math.min(a, b) : Math.max(a, b);
        const page = out.addPage([pw, ph]);
        const m = options.margin;
        const scale = Math.min((pw - 2 * m) / image.width, (ph - 2 * m) / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      }
    }
    onProgress((i + 1) / files.length);
  }
  if (out.getPageCount() === 0) throw new Error("Nothing to put in the PDF.");
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
