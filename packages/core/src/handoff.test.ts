import { beforeEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_EVENT, OPEN_TOOL_EVENT, handOff, onHandoff, takeHandoff } from "./handoff";

const file = { bytes: new Uint8Array([1, 2, 3]), name: "cut.mp4", mime: "video/mp4" };

describe("handoff", () => {
  beforeEach(() => {
    takeHandoff("social");
  });

  it("asks the shell to switch and tells the tool something arrived", () => {
    const opened = vi.fn();
    const arrived = vi.fn();
    window.addEventListener(OPEN_TOOL_EVENT, opened);
    window.addEventListener(HANDOFF_EVENT, arrived);
    handOff({ tool: "social", file, from: "screeni" });
    expect((opened.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ tool: "social" });
    expect(arrived).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_TOOL_EVENT, opened);
    window.removeEventListener(HANDOFF_EVENT, arrived);
  });

  it("hands the file over exactly once", () => {
    handOff({ tool: "social", file, text: "new cut" });
    const taken = takeHandoff("social");
    expect(taken?.file?.name).toBe("cut.mp4");
    expect(taken?.text).toBe("new cut");
    expect(takeHandoff("social")).toBeNull();
  });

  it("keeps a handoff meant for another tool", () => {
    handOff({ tool: "social", file });
    expect(takeHandoff("focus" as "social")).toBeNull();
    expect(takeHandoff("social")?.file?.name).toBe("cut.mp4");
  });

  it("notifies a tool that is already open, and unsubscribes cleanly", () => {
    const cb = vi.fn();
    const off = onHandoff("social", cb);
    handOff({ tool: "social", file });
    expect(cb).toHaveBeenCalledOnce();
    off();
    handOff({ tool: "social", file });
    expect(cb).toHaveBeenCalledOnce();
  });
});
