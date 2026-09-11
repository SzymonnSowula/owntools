import { siQwen } from "simple-icons";
import type { LlmVendor } from "./models";
import { VENDOR_NAMES } from "./models";

/**
 * The maker's mark next to a model, so the picker reads at a glance — the
 * same idea as dictation's NVIDIA / OpenAI tiles. Qwen's mark from
 * simple-icons (CC0), drawn in the vendor's colour on a neutral tile; it
 * identifies whose model it is, nothing more.
 */
const MARKS: Record<LlmVendor, { path: string; color: string }> = {
  qwen: { path: siQwen.path, color: `#${siQwen.hex}` },
};

export function VendorMark({
  vendor,
  size = 30,
  className,
}: {
  vendor: LlmVendor;
  /** Tile size in px; the glyph takes ~58% of it. */
  size?: number;
  className?: string;
}) {
  const mark = MARKS[vendor];
  const glyph = Math.round(size * 0.58);
  return (
    <span
      className={`llm-vendor${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, color: mark.color }}
      title={VENDOR_NAMES[vendor]}
      role="img"
      aria-label={VENDOR_NAMES[vendor]}
    >
      <svg viewBox="0 0 24 24" width={glyph} height={glyph} aria-hidden>
        <path d={mark.path} fill="currentColor" />
      </svg>
    </span>
  );
}
