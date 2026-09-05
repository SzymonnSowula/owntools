import { describe, expect, it } from "vitest";
import {
  applyUnicodeStyle,
  detectUnicodeStyle,
  stripUnicodeStyle,
  toggleUnicodeStyle,
} from "./unicode";

describe("unicode styling", () => {
  it("maps letters and digits to the sans-serif bold run and back", () => {
    const bold = applyUnicodeStyle("Ship 42!", "bold");
    expect(bold).not.toBe("Ship 42!");
    expect([...bold].length).toBe([..."Ship 42!"].length);
    expect(bold.endsWith("!")).toBe(true);
    expect(stripUnicodeStyle(bold)).toBe("Ship 42!");
    expect(detectUnicodeStyle(bold)).toBe("bold");
  });

  it("leaves digits plain in italic (no italic digit run exists)", () => {
    const italic = applyUnicodeStyle("v2", "italic");
    expect(italic.endsWith("2")).toBe(true);
    expect(stripUnicodeStyle(italic)).toBe("v2");
    expect(detectUnicodeStyle(italic)).toBe("italic");
  });

  it("passes accents and emoji through untouched", () => {
    const text = "żółć 🚀 déjà";
    expect(applyUnicodeStyle(text, "bold")).toBe(applyUnicodeStyle(text, "bold"));
    expect(stripUnicodeStyle(applyUnicodeStyle(text, "bold"))).toBe(text);
  });

  it("toggles like a toolbar: bold twice is plain, bold then italic is both", () => {
    const once = toggleUnicodeStyle("hello", "bold");
    expect(detectUnicodeStyle(once)).toBe("bold");
    expect(toggleUnicodeStyle(once, "bold")).toBe("hello");
    const both = toggleUnicodeStyle(once, "italic");
    expect(detectUnicodeStyle(both)).toBe("boldItalic");
    expect(detectUnicodeStyle(toggleUnicodeStyle(both, "bold"))).toBe("italic");
  });

  it("reports mixed text as unstyled", () => {
    const mixed = applyUnicodeStyle("ab", "bold") + "cd";
    expect(detectUnicodeStyle(mixed)).toBeNull();
    expect(detectUnicodeStyle("plain")).toBeNull();
  });
});
