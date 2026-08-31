export interface GradientBlob {
  x: number;
  y: number;
  r: number;
  color: string;
  blend?: GlobalCompositeOperation;
}

export interface GradientPreset {
  id: string;
  name: string;
  base: string;
  blobs: GradientBlob[];
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: "aurora",
    name: "Aurora",
    base: "#1b1448",
    blobs: [
      { x: 0.18, y: 0.18, r: 0.62, color: "#7b6cff" },
      { x: 0.78, y: 0.22, r: 0.55, color: "#2ad4c4" },
      { x: 0.48, y: 0.82, r: 0.58, color: "#8b5cf6" },
      { x: 0.9, y: 0.72, r: 0.34, color: "#67e8f9" },
    ],
  },
  {
    id: "citrus",
    name: "Błękit i słońce",
    base: "#12324a",
    blobs: [
      { x: 0.2, y: 0.28, r: 0.58, color: "#38bdf8" },
      { x: 0.8, y: 0.22, r: 0.5, color: "#fb923c" },
      { x: 0.55, y: 0.78, r: 0.52, color: "#22d3ee" },
      { x: 0.12, y: 0.78, r: 0.36, color: "#f97316" },
    ],
  },
  {
    id: "sky",
    name: "Jasny błękit",
    base: "#dbeafe",
    blobs: [
      { x: 0.2, y: 0.15, r: 0.55, color: "#bfdbfe", blend: "source-over" },
      { x: 0.75, y: 0.25, r: 0.5, color: "#a5f3fc", blend: "source-over" },
      { x: 0.5, y: 0.85, r: 0.55, color: "#c4b5fd", blend: "source-over" },
      { x: 0.9, y: 0.7, r: 0.32, color: "#fecaca", blend: "source-over" },
    ],
  },
  {
    id: "noir",
    name: "Ciemna elegancja",
    base: "#0c0b12",
    blobs: [
      { x: 0.22, y: 0.2, r: 0.5, color: "#312e81" },
      { x: 0.78, y: 0.3, r: 0.48, color: "#4c1d95" },
      { x: 0.5, y: 0.85, r: 0.5, color: "#0f766e" },
      { x: 0.88, y: 0.78, r: 0.28, color: "#9f1239" },
    ],
  },
  {
    id: "mint",
    name: "Mięta",
    base: "#ecfdf5",
    blobs: [
      { x: 0.18, y: 0.22, r: 0.52, color: "#a7f3d0", blend: "source-over" },
      { x: 0.78, y: 0.18, r: 0.48, color: "#99f6e4", blend: "source-over" },
      { x: 0.55, y: 0.8, r: 0.5, color: "#c4b5fd", blend: "source-over" },
      { x: 0.12, y: 0.75, r: 0.32, color: "#fde68a", blend: "source-over" },
    ],
  },
  {
    id: "sunset",
    name: "Zachód",
    base: "#3b1020",
    blobs: [
      { x: 0.22, y: 0.25, r: 0.55, color: "#fb7185" },
      { x: 0.75, y: 0.2, r: 0.5, color: "#fb923c" },
      { x: 0.55, y: 0.78, r: 0.52, color: "#c084fc" },
      { x: 0.9, y: 0.7, r: 0.3, color: "#fde047" },
    ],
  },
];

export function getPreset(id: string): GradientPreset {
  return GRADIENT_PRESETS.find((p) => p.id === id) ?? GRADIENT_PRESETS[0];
}

export function drawMeshBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: GradientPreset,
): void {
  ctx.save();
  ctx.fillStyle = preset.base;
  ctx.fillRect(0, 0, width, height);
  for (const blob of preset.blobs) {
    const x = blob.x * width;
    const y = blob.y * height;
    const r = blob.r * Math.max(width, height);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, blob.color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = blob.blend ?? "screen";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}
