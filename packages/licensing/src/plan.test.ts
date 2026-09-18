import { describe, expect, it } from "vitest";
import { PRO_INCLUDES, PRO_PITCH, PRO_TOOLS, isProTool, toolLocked } from "./plan";

describe("the free / Pro split", () => {
  it("keeps the everyday desk free and puts four tools behind the key", () => {
    expect([...PRO_TOOLS]).toEqual(["meet", "social", "disk", "launch"]);
    for (const tool of ["dictate", "create", "focus", "board", "capture", "hub", "settings"]) {
      expect(isProTool(tool), tool).toBe(false);
    }
    for (const tool of PRO_TOOLS) expect(isProTool(tool)).toBe(true);
  });

  it("has a pitch for every Pro tool and lists what the key buys", () => {
    for (const tool of PRO_TOOLS) expect(PRO_PITCH[tool].length).toBeGreaterThan(20);
    expect(PRO_INCLUDES[0]).toContain("meet");
  });

  it("locks only Pro tools, and only while there is no key", () => {
    // jsdom starts with no licence in localStorage
    expect(toolLocked("meet")).toBe(true);
    expect(toolLocked("social")).toBe(true);
    expect(toolLocked("dictate")).toBe(false);
    expect(toolLocked("focus")).toBe(false);
  });
});
