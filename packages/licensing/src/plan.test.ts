import { describe, expect, it } from "vitest";
import {
  PRO_INCLUDES,
  PRO_PITCH,
  PRO_TOOLS,
  PRO_TOOL_NAME,
  isProTool,
  quickToolHome,
  quickToolLocked,
  toolLocked,
} from "./plan";

describe("the free / Pro split", () => {
  it("keeps dictate free and puts every other tool behind the key", () => {
    expect([...PRO_TOOLS].sort()).toEqual(
      ["board", "capture", "create", "disk", "focus", "launch", "meet", "social"],
    );
    // dictate is the free tool; the hub and Settings are not tools to lock -
    // Settings holds the License page, so locking it would lock the way in.
    for (const tool of ["dictate", "hub", "settings"]) {
      expect(isProTool(tool), tool).toBe(false);
    }
    for (const tool of PRO_TOOLS) expect(isProTool(tool)).toBe(true);
  });

  it("has a name and a pitch for every Pro tool and lists what the key buys", () => {
    for (const tool of PRO_TOOLS) {
      expect(PRO_PITCH[tool].length).toBeGreaterThan(20);
      expect(PRO_TOOL_NAME[tool].length).toBeGreaterThan(0);
    }
    // the shell's id for the recorder is not the name anyone knows it by
    expect(PRO_TOOL_NAME.create).toBe("screeni");
    expect(PRO_INCLUDES[0]).toContain("screeni");
    expect(PRO_INCLUDES.join(" ")).toContain("dictate");
  });

  it("locks only Pro tools, and only while there is no key", () => {
    // jsdom starts with no licence in localStorage
    for (const tool of PRO_TOOLS) expect(toolLocked(tool), tool).toBe(true);
    expect(toolLocked("dictate")).toBe(false);
    expect(toolLocked("settings")).toBe(false);
  });

  it("keeps the quick file tools free; the voice note goes where focus goes", () => {
    expect(quickToolHome("voicenote")).toBe("focus");
    expect(quickToolLocked("voicenote")).toBe(true);
    for (const key of ["transcribe", "translate", "youtube", "subtitles", "pdf", "makepdf", "images", "extract", "audio", "video", "gif"]) {
      expect(quickToolHome(key), key).toBeNull();
      expect(quickToolLocked(key), key).toBe(false);
    }
  });
});
