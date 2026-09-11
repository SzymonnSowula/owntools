import { ImageResponse } from "next/og";

/**
 * Social card (Open Graph + Twitter via twitter-image.tsx). Rendered by Next
 * at build time from the bundled default font — no external assets, no font
 * fetches — so it works offline and in CI alike.
 */

export const alt = "owntools - your work. your device.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "#060608",
          color: "#f5f5f7",
        }}
      >
        {/* soft blue glow rising from below */}
        <div
          style={{
            position: "absolute",
            left: 150,
            top: 260,
            width: 900,
            height: 900,
            borderRadius: 450,
            background:
              "radial-gradient(circle, rgba(10,132,255,0.55) 0%, rgba(94,92,230,0.22) 38%, rgba(6,6,8,0) 70%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="76" height="76" viewBox="0 0 12 12">
            <path d="M6 0.8L10.4 7.6H1.6L6 0.8ZM2 9H10L8.6 11.2H3.4L2 9Z" fill="#f5f5f7" />
          </svg>
          <div style={{ fontSize: 108, fontWeight: 700, letterSpacing: -6 }}>owntools</div>
        </div>

        <div style={{ marginTop: 26, fontSize: 46, fontWeight: 600, letterSpacing: -2 }}>
          your work. your device.
        </div>

        <div style={{ marginTop: 40, fontSize: 24, letterSpacing: 0.5, color: "rgba(245,245,247,0.62)" }}>
          dictate · transcribe · record · capture · meet · take notes · sketch · translate
        </div>
      </div>
    ),
    { ...size },
  );
}
