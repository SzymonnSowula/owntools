import { describe, expect, it } from "vitest";
import { TsArena, type Spec } from "./arena";
import { eligibleFiles, fileRule, folderRule } from "./protect";

const MB = 1024 * 1024;
const f = (name: string, size = 2 * MB): Spec => ({ name, size, mtime: 100 });
const d = (name: string, kids: Spec[]): Spec => ({ name, kids, mtime: 100 });

describe("rules", () => {
  it("names app, tool and dependency folders", () => {
    expect(folderRule("AppData")).toBe("apps");
    expect(folderRule("steamapps")).toBe("apps");
    expect(folderRule(".ollama")).toBe("tools");
    expect(folderRule("node_modules")).toBe("tools");
    expect(folderRule("Pictures")).toBeNull();
  });

  it("leaves programs out but not installers", () => {
    expect(fileRule("msalruntime_x86.dll", false, "Feedback")).toBe("programs");
    expect(fileRule("cursor-setup-x64-1.6.2.exe", false, "Desktop")).toBeNull();
    expect(fileRule("tool.exe", false, "Downloads")).toBeNull();
    expect(fileRule("tool.exe", false, "bin")).toBe("programs");
    expect(fileRule("thumbs.db", true, "Pictures")).toBe("tools");
  });
});

describe("eligibleFiles", () => {
  it("offers a person's own copies and counts the rest by reason", () => {
    const tree = d("me", [
      d("Videos", [f("talk.mkv")]),
      d("Downloads", [f("talk.mkv"), f("setup.exe"), d("ffmpeg", [f("avcodec.dll")])]),
      d("AppData", [d("Local", [d("Temp", [f("talk.mkv"), f("x.dll")])])]),
      d("Projects", [d("site", [d(".git", [f("pack.pack")]), d("public", [f("talk.mkv")])]), d("ml", [f("pyvenv.cfg", 100), d("lib", [f("w.bin")])])]),
      d(".cargo", [f("x.crate")]),
      d("tiny", [f("small.mkv", 100)]),
    ]);
    const a = TsArena.fromSpec("C:\\Users\\me", tree);
    const { ids, leftOut } = eligibleFiles(a, 0, MB);
    expect(ids.map((id) => a.pathOf(id)).sort()).toEqual([
      "C:\\Users\\me\\Downloads\\setup.exe",
      "C:\\Users\\me\\Downloads\\talk.mkv",
      "C:\\Users\\me\\Videos\\talk.mkv",
    ]);
    expect(leftOut).toEqual({ apps: 2, tools: 2, projects: 2, programs: 1, links: 0, cloud: 0, changed: 0 });
  });
});
