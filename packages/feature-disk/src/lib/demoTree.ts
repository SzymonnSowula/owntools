import type { Spec } from "./arena";

/**
 * A believable Windows user profile, generated deterministically: caches,
 * Downloads full of video and installers, a few projects with node_modules
 * and build output, photos, recordings, package caches, an Android AVD, a
 * WSL disk — and a handful of planted duplicates. ~35k nodes, ~117 GB.
 * Only the demo backend uses it (browser preview / `pnpm dev`).
 */

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const DAY = 86400;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoOptions {
  seed?: number;
  now?: number;
}

export function buildDemoSpec(options: DemoOptions = {}): Spec {
  const rnd = mulberry32(options.seed ?? 7);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  let contentKey = 1000;

  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)];
  const age = (minDays: number, maxDays: number) => now - Math.floor(between(minDays, maxDays)) * DAY - int(0, DAY);
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");

  const file = (name: string, size: number, mtime: number, content?: number): Spec => ({ name, size: Math.floor(size), mtime, content });
  const dir = (name: string, kids: Spec[], mtime?: number): Spec => ({ name, kids, mtime: mtime ?? age(0, 30) });
  const files = (count: number, make: (i: number) => Spec): Spec[] => Array.from({ length: count }, (_, i) => make(i));

  const cacheFiles = (count: number, lo: number, hi: number, minDays = 0, maxDays = 60) =>
    files(count, () => file(`f_${hex(12)}`, between(lo, hi), age(minDays, maxDays)));

  const words = ["invoice", "report", "notes", "plan", "brief", "contract", "deck", "summary", "draft", "spec", "roadmap", "budget", "offer", "agenda"];
  const docFiles = (count: number, exts: string[], lo: number, hi: number) =>
    files(count, () => file(`${pick(words)}-${int(2021, 2026)}-${int(1, 12)}.${pick(exts)}`, between(lo, hi), age(1, 900)));

  const jpgs = (count: number, lo: number, hi: number, prefix = "IMG_") =>
    files(count, (i) => file(`${prefix}${String(2000 + i * 3).padStart(4, "0")}.${pick(["jpg", "jpg", "heic", "png"])}`, between(lo, hi), age(2, 720)));

  const codeFiles = (count: number) =>
    files(count, () => file(`${pick(["index", "utils", "store", "view", "api", "model", "types", "helpers", "hooks", "router"])}.${pick(["ts", "tsx", "js", "json", "css", "md", "d.ts", "map"])}`, between(1 * KB, 90 * KB), age(0, 400)));

  const nodeModules = (packages: number, share = 1) =>
    dir(
      "node_modules",
      files(packages, (i) => {
        const name = `${pick(["react", "vite", "lodash", "esbuild", "rollup", "typescript", "zod", "date-fns", "@types", "postcss", "tailwind", "remotion", "mediabunny", "sharp", "playwright", "prettier", "eslint", "webpack", "next", "swc"])}-${i}`;
        const shared = share && i % 7 === 0 ? 5000 + (i % 40) : undefined; // identical across projects
        return dir(name, [
          ...files(int(4, 30), (j) => file(`${pick(["index", "lib", "dist", "cjs", "esm"])}${j}.js`, between(1 * KB, 120 * KB), age(10, 300), shared !== undefined ? shared * 100 + j : undefined)),
          file("package.json", between(600, 4000), age(10, 300)),
          file("README.md", between(1 * KB, 20 * KB), age(10, 300)),
        ]);
      }),
    );

  const bigVideo = (name: string, size: number, mtime: number, content?: number) => file(name, size, mtime, content);

  // Planted duplicates: same content key, same size.
  const dupTalk = contentKey++;
  const dupTalkSize = 3.4 * GB;
  const dupInstaller = contentKey++;
  const dupInstallerSize = 612 * MB;
  const dupPhoto = contentKey++;
  const dupPhotoSize = 8.2 * MB;
  const dupIso = contentKey++;
  const dupIsoSize = 5.5 * GB;

  const chrome = dir("Chrome", [
    dir("User Data", [
      dir("Default", [
        dir("Cache", [dir("Cache_Data", cacheFiles(700, 20 * KB, 4 * MB))]),
        dir("Code Cache", [dir("js", cacheFiles(300, 8 * KB, 800 * KB)), dir("wasm", cacheFiles(40, 100 * KB, 6 * MB))]),
        dir("Service Worker", [dir("CacheStorage", files(30, () => dir(hex(32), cacheFiles(int(5, 40), 4 * KB, 900 * KB))))]),
        dir("IndexedDB", files(25, () => dir(`https_${pick(["app.notion.so", "web.whatsapp.com", "figma.com", "youtube.com", "github.com"])}_0.indexeddb.leveldb`, cacheFiles(int(3, 20), 30 * KB, 12 * MB)))),
        dir("GPUCache", cacheFiles(12, 60 * KB, 4 * MB)),
        dir("Session Storage", cacheFiles(9, 4 * KB, 200 * KB)),
        file("History", 140 * MB, age(0, 1)),
        file("Favicons", 32 * MB, age(0, 3)),
      ]),
      dir("Profile 1", [dir("Cache", [dir("Cache_Data", cacheFiles(200, 20 * KB, 3 * MB))]), dir("Code Cache", [dir("js", cacheFiles(100, 8 * KB, 500 * KB))])]),
      dir("ShaderCache", cacheFiles(30, 100 * KB, 9 * MB)),
      dir("GrShaderCache", cacheFiles(14, 100 * KB, 9 * MB)),
    ]),
  ]);

  const local = dir("Local", [
    dir("Google", [chrome]),
    dir("Microsoft", [
      dir("Edge", [dir("User Data", [dir("Default", [dir("Cache", [dir("Cache_Data", cacheFiles(220, 20 * KB, 3 * MB))]), dir("Code Cache", [dir("js", cacheFiles(80, 8 * KB, 400 * KB))])])])]),
      dir("Windows", [dir("INetCache", cacheFiles(150, 4 * KB, 800 * KB)), dir("Explorer", cacheFiles(40, 100 * KB, 24 * MB)), dir("WebCache", [file("WebCacheV01.dat", 96 * MB, age(0, 1))])]),
      dir("Teams", [dir("Cache", cacheFiles(90, 20 * KB, 3 * MB))]),
      dir("OneDrive", [dir("logs", cacheFiles(60, 100 * KB, 12 * MB))]),
    ]),
    dir("Docker", [dir("wsl", [dir("data", [file("ext4.vhdx", 9.6 * GB, age(0, 2))]), dir("distro", [file("ext4.vhdx", 1.2 * GB, age(0, 30))])])]),
    dir("Temp", [
      ...cacheFiles(600, 2 * KB, 3 * MB, 0, 200),
      ...files(12, (i) => file(`msi${hex(4)}.LOG`, between(200 * KB, 3 * MB), age(0, 90 + i))),
      dir("chrome_Unpacker_BeginUnzipping", cacheFiles(20, 100 * KB, 8 * MB)),
      file("Setup Log 2026-08-30.txt", 2.1 * MB, age(8, 9)),
    ]),
    dir("npm-cache", [dir("_cacache", [dir("content-v2", [dir("sha512", files(240, () => dir(hex(2), cacheFiles(int(3, 30), 3 * KB, 1.1 * MB, 5, 200))))]), dir("index-v5", files(120, () => dir(hex(2), cacheFiles(int(3, 12), 1 * KB, 60 * KB, 5, 200))))]), dir("_logs", cacheFiles(80, 10 * KB, 900 * KB))]),
    dir("pip", [dir("cache", [dir("wheels", files(60, () => dir(hex(2), cacheFiles(int(1, 6), 200 * KB, 14 * MB, 10, 300)))), dir("http", files(80, () => dir(hex(2), cacheFiles(int(1, 8), 10 * KB, 6 * MB, 10, 300))))])]),
    dir("pnpm", [dir("store", [dir("v3", [dir("files", files(200, () => dir(hex(2), cacheFiles(int(3, 20), 2 * KB, 900 * KB, 5, 200))))])])]),
    dir("Programs", [
      dir("Python", [dir("Python312", [...files(40, () => file(`python3${int(0, 9)}${pick(["", "_d"])}.dll`, between(200 * KB, 6 * MB), age(200, 400))), dir("Lib", [dir("site-packages", files(120, () => dir(pick(["numpy", "pandas", "torch", "scipy", "sklearn", "requests", "matplotlib"]) + "_" + hex(3), cacheFiles(int(5, 40), 5 * KB, 1.2 * MB, 60, 400))))]), file("python.exe", 104 * KB, age(300, 400))])]),
      dir("cursor", [...files(30, () => file(`${pick(["ffmpeg", "libEGL", "d3dcompiler_47", "vk_swiftshader", "resources"])}.${pick(["dll", "pak", "bin"])}`, between(1 * MB, 80 * MB), age(5, 40))), dir("resources", [dir("app", [dir("node_modules", cacheFiles(400, 4 * KB, 3 * MB, 5, 40))])]), file("Cursor.exe", 168 * MB, age(5, 6))]),
      dir("Ollama", [file("ollama.exe", 1.9 * GB, age(20, 21)), dir("lib", cacheFiles(12, 20 * MB, 400 * MB, 20, 21))]),
      dir("Microsoft VS Code", cacheFiles(60, 1 * MB, 30 * MB, 3, 30)),
    ]),
    dir("ms-playwright", [dir("chromium-1148", [dir("chrome-win", cacheFiles(60, 1 * MB, 22 * MB, 40, 90))]), dir("firefox-1465", cacheFiles(40, 1 * MB, 14 * MB, 40, 90)), dir("webkit-2083", cacheFiles(50, 1 * MB, 10 * MB, 40, 90))]),
    dir("Packages", files(30, () => dir(`${pick(["Microsoft.WindowsTerminal", "Microsoft.Todos", "SpotifyAB.SpotifyMusic", "Microsoft.YourPhone", "CanonicalGroupLimited.Ubuntu"])}_${hex(13)}`, [dir("LocalCache", cacheFiles(int(5, 40), 4 * KB, 2 * MB)), dir("LocalState", cacheFiles(int(2, 12), 4 * KB, 9 * MB))]))),
    dir("CrashDumps", files(5, () => file(`${pick(["Cursor", "chrome", "Notion", "Discord"])}.exe.${int(1000, 99999)}.dmp`, between(120 * MB, 600 * MB), age(3, 120)))),
    dir("D3DSCache", cacheFiles(14, 200 * KB, 30 * MB)),
    dir("NVIDIA", [dir("DXCache", cacheFiles(80, 100 * KB, 12 * MB)), dir("GLCache", cacheFiles(40, 100 * KB, 8 * MB))]),
    dir("Yarn", [dir("Berry", [dir("cache", cacheFiles(180, 20 * KB, 9 * MB, 10, 200))])]),
    dir("owntools", [dir("recordings", files(6, (i) => dir(`take-${hex(6)}`, [file("screen.webm", between(200 * MB, 1.4 * GB), age(i, i + 10)), file("project.json", 4 * KB, age(i, i + 10))]))), dir("whisper", [file("ggml-large-v3-turbo-q5_0.bin", 574 * MB, age(6, 7)), file("whisper-cli.exe", 8 * MB, age(6, 7))])]),
  ]);

  const roaming = dir("Roaming", [
    dir("Code", [dir("Cache", [dir("Cache_Data", cacheFiles(180, 20 * KB, 3 * MB))]), dir("CachedData", files(6, () => dir(hex(40), cacheFiles(int(20, 60), 100 * KB, 6 * MB)))), dir("CachedExtensionVSIXs", cacheFiles(14, 2 * MB, 90 * MB, 20, 200)), dir("User", [dir("workspaceStorage", files(40, () => dir(hex(32), cacheFiles(int(2, 12), 4 * KB, 8 * MB)))), dir("globalStorage", cacheFiles(30, 4 * KB, 20 * MB)), dir("History", files(60, () => dir(hex(8), cacheFiles(int(2, 30), 1 * KB, 200 * KB))))]), dir("logs", files(30, () => dir(`2026${int(1, 9)}${int(10, 28)}T${int(10, 23)}`, cacheFiles(int(3, 9), 5 * KB, 4 * MB))))]),
    dir("Notion", [dir("Partitions", [dir("notion", [dir("CacheStorage", files(12, () => dir(hex(32), cacheFiles(int(20, 80), 10 * KB, 4 * MB)))), dir("Cache", [dir("Cache_Data", cacheFiles(300, 20 * KB, 2 * MB))]), dir("IndexedDB", cacheFiles(20, 1 * MB, 90 * MB))])]), file("notion.log", 38 * MB, age(0, 1))]),
    dir("discord", [dir("Cache", [dir("Cache_Data", cacheFiles(400, 20 * KB, 3 * MB))]), dir("Code Cache", [dir("js", cacheFiles(80, 8 * KB, 900 * KB))])]),
    dir("Slack", [dir("Cache", [dir("Cache_Data", cacheFiles(220, 20 * KB, 2 * MB))]), dir("logs", cacheFiles(40, 200 * KB, 9 * MB))]),
    dir("Spotify", [dir("Storage", files(80, () => dir(hex(2), cacheFiles(int(10, 30), 200 * KB, 1.5 * MB, 0, 60))))]),
    dir("Figma", [dir("Cache", cacheFiles(120, 40 * KB, 8 * MB)), dir("Desktop", cacheFiles(20, 1 * MB, 60 * MB))]),
    dir("Zoom", [dir("logs", cacheFiles(90, 100 * KB, 6 * MB)), dir("data", cacheFiles(12, 2 * MB, 80 * MB))]),
    dir("Obsidian", [file("obsidian.log", 4 * MB, age(0, 2)), dir("Cache", cacheFiles(30, 20 * KB, 3 * MB))]),
    dir("npm", [dir("node_modules", cacheFiles(300, 4 * KB, 800 * KB, 30, 300))]),
    dir("Postman", [dir("logs", cacheFiles(50, 200 * KB, 8 * MB)), dir("Partitions", cacheFiles(60, 100 * KB, 12 * MB))]),
  ]);

  const downloads = dir("Downloads", [
    bigVideo("Keynote 2026 — full talk (4K).mkv", dupTalkSize, age(40, 41), dupTalk),
    bigVideo("Screen recording 2026-08-21 walkthrough.mp4", 2.9 * GB, age(17, 18)),
    bigVideo("Family_trip_July_2026.mov", 6.1 * GB, age(33, 34)),
    bigVideo("Tutorial - Remotion deep dive.mp4", 1.7 * GB, age(70, 71)),
    bigVideo("Podcast raw take 03.wav", 890 * MB, age(12, 13)),
    file("Win11_24H2_English_x64.iso", dupIsoSize, age(120, 121), dupIso),
    file("ubuntu-24.04.2-desktop-amd64.iso", 5.8 * GB, age(200, 201)),
    file("cursor-setup-x64-1.6.2.exe", dupInstallerSize, age(9, 10), dupInstaller),
    file("cursor-setup-x64-1.5.9.exe", 604 * MB, age(48, 49)),
    file("Docker Desktop Installer.exe", 648 * MB, age(85, 86)),
    file("OllamaSetup.exe", 1.1 * GB, age(21, 22)),
    file("VSCodeUserSetup-x64-1.104.0.exe", 98 * MB, age(6, 7)),
    file("node-v22.19.0-x64.msi", 31 * MB, age(30, 31)),
    file("rustup-init.exe", 12 * MB, age(300, 301)),
    file("python-3.12.6-amd64.exe", 26 * MB, age(140, 141)),
    file("obs-studio-31.0.exe", 142 * MB, age(60, 61)),
    file("dataset-export-2026-06.zip", 1.4 * GB, age(90, 91)),
    file("brand-assets.zip", 384 * MB, age(50, 51)),
    file("owntools_0.2.0_x64-setup.exe", 108 * MB, age(2, 3)),
    ...docFiles(60, ["pdf", "pdf", "docx", "xlsx", "pptx"], 40 * KB, 24 * MB),
    ...jpgs(70, 300 * KB, 9 * MB, "photo_"),
    file("DSC_0412.jpg", dupPhotoSize, age(35, 36), dupPhoto),
    dir("Screenshots", files(80, (i) => file(`Screenshot 2026-0${int(5, 9)}-${int(10, 28)} ${int(10, 23)}${int(10, 59)}${int(10, 59)}.png`, between(200 * KB, 4 * MB), age(i % 60, i % 60 + 1)))),
    dir("apps", files(6, () => file(`${pick(["figma", "notion", "slack", "spotify", "zoom", "discord"])}-installer.exe`, between(80 * MB, 260 * MB), age(100, 400)))),
    dir("mobile", [file("app-release.apk", 92 * MB, age(20, 21)), file("app-debug.apk", 118 * MB, age(20, 21)), ...cacheFiles(8, 1 * MB, 30 * MB)]),
    dir("node_modules", cacheFiles(120, 4 * KB, 600 * KB, 100, 400)),
  ]);

  const project = (name: string, opts: { modules: number; build?: Spec[]; extra?: Spec[]; share?: number }) =>
    dir(name, [
      nodeModules(opts.modules, opts.share ?? 1),
      dir("src", [...codeFiles(60), dir("components", codeFiles(40)), dir("lib", codeFiles(30)), dir("assets", jpgs(20, 20 * KB, 900 * KB, "asset_"))]),
      dir(".git", [dir("objects", files(40, () => dir(hex(2), cacheFiles(int(5, 40), 1 * KB, 300 * KB, 0, 200)))), dir("objects_pack", [file(`pack-${hex(40)}.pack`, between(40 * MB, 400 * MB), age(5, 100))])]),
      file("package.json", 2 * KB, age(0, 20)),
      file("pnpm-lock.yaml", 480 * KB, age(0, 20)),
      file("tsconfig.json", 900, age(30, 100)),
      file("README.md", 6 * KB, age(0, 40)),
      ...(opts.build ?? []),
      ...(opts.extra ?? []),
    ]);

  const projects = dir("Projects", [
    project("owntools", {
      modules: 420,
      build: [
        dir("dist", [...cacheFiles(40, 50 * KB, 9 * MB, 0, 3), dir("assets", cacheFiles(60, 100 * KB, 12 * MB, 0, 3))]),
        dir("target", [dir("debug", [...files(14, (i) => file(`owntools_lib${i ? `-${hex(16)}` : ""}.${pick(["rlib", "pdb", "exe", "dll", "rmeta"])}`, between(20 * MB, 400 * MB), age(0, 5))), dir("deps", cacheFiles(500, 100 * KB, 6 * MB, 0, 20)), dir("incremental", files(30, () => dir(`owntools-${hex(16)}`, cacheFiles(int(5, 30), 100 * KB, 5 * MB, 0, 10))))]), dir("release", [...files(6, () => file(`${pick(["owntools", "owntools_lib"])}.${pick(["exe", "pdb", "rlib"])}`, between(20 * MB, 300 * MB), age(1, 6))), dir("deps", cacheFiles(300, 100 * KB, 6 * MB, 1, 20))])]),
      ],
      extra: [file("Cargo.toml", 3 * KB, age(0, 10)), dir("docs", docFiles(20, ["md", "pdf"], 20 * KB, 6 * MB))],
    }),
    project("blog", { modules: 240, build: [dir(".next", [dir("cache", cacheFiles(300, 20 * KB, 6 * MB, 0, 30)), dir("static", cacheFiles(80, 40 * KB, 3 * MB, 0, 30)), dir("server", cacheFiles(120, 20 * KB, 2 * MB, 0, 30))])] }),
    project("api", { modules: 130, build: [dir("target", [dir("release", [file("api.exe", 38 * MB, age(2, 3)), dir("deps", cacheFiles(220, 100 * KB, 8 * MB, 2, 60))])])], extra: [file("Cargo.toml", 1 * KB, age(5, 40))] }),
    dir("ml", [
      dir(".venv", [dir("Lib", [dir("site-packages", [dir("torch", [dir("lib", [...files(6, () => file(`${pick(["torch_cuda", "cudnn", "cublas", "torch_cpu"])}.dll`, between(200 * MB, 900 * MB), age(60, 61)))])]), ...files(60, () => dir(pick(["numpy", "pandas", "transformers", "scipy", "matplotlib"]) + "_" + hex(3), cacheFiles(int(5, 60), 5 * KB, 1.2 * MB, 60, 200)))])])]),
      dir("data", [file("train.parquet", 2.2 * GB, age(30, 31)), file("val.parquet", 310 * MB, age(30, 31)), dir("raw", cacheFiles(200, 1 * MB, 10 * MB, 60, 200))]),
      dir("checkpoints", files(5, (i) => file(`epoch-${i * 5}.pt`, 780 * MB, age(10 + i, 11 + i)))),
      dir("__pycache__", cacheFiles(40, 4 * KB, 200 * KB)),
      dir("notebooks", docFiles(12, ["ipynb"], 100 * KB, 30 * MB)),
      file("pyproject.toml", 1 * KB, age(20, 40)),
    ]),
    dir("archive", files(9, (i) => file(`client-project-${2019 + (i % 7)}.zip`, between(60 * MB, 700 * MB), age(400, 1400)))),
  ]);

  const pictures = dir("Pictures", [
    dir("Camera Roll", [...jpgs(420, 2 * MB, 12 * MB), file("DSC_0412.jpg", dupPhotoSize, age(35, 36), dupPhoto), file("DSC_0412 (copy).jpg", dupPhotoSize, age(20, 21), dupPhoto)]),
    dir("Screenshots", files(300, (i) => file(`Screenshot ${int(2024, 2026)}-${String(int(1, 12)).padStart(2, "0")}-${int(10, 28)} ${int(10, 23)}${int(10, 59)}${int(10, 59)}.png`, between(300 * KB, 3 * MB), age(i % 400, i % 400 + 1)))),
    dir("Saved Pictures", jpgs(60, 200 * KB, 5 * MB, "saved_")),
    dir("Lightroom", files(40, () => file(`edit_${hex(6)}.dng`, between(20 * MB, 60 * MB), age(60, 600)))),
  ]);

  const videos = dir("Videos", [
    dir("Captures", files(14, (i) => file(`Desktop 2026.0${int(6, 9)}.${int(10, 28)} - ${int(10, 23)}.${int(10, 59)}.${int(10, 59)}.0${i}.mp4`, between(200 * MB, 1.2 * GB), age(i * 4, i * 4 + 2)))),
    dir("owntools exports", files(9, (i) => file(`launch-take-${i + 1}.mp4`, between(40 * MB, 320 * MB), age(i, i + 3)))),
    bigVideo("Keynote 2026 — full talk (4K).mkv", dupTalkSize, age(40, 41), dupTalk),
    bigVideo("wedding-raw.mp4", 4.3 * GB, age(500, 501)),
  ]);

  const music = dir("Music", [dir("Albums", files(12, () => dir(`${pick(["Bonobo", "Tycho", "Khruangbin", "Nils Frahm", "Ólafur Arnalds"])} - ${pick(["Migration", "Dive", "Con Todo", "Spaces", "re:member"])}`, files(int(8, 14), (i) => file(`${String(i + 1).padStart(2, "0")} track.${pick(["flac", "mp3", "m4a"])}`, between(3 * MB, 40 * MB), age(200, 900))))))]);

  const documents = dir("Documents", [
    dir("work", [...docFiles(90, ["pdf", "docx", "xlsx", "pptx"], 60 * KB, 30 * MB), dir("2025", docFiles(60, ["pdf", "docx"], 40 * KB, 12 * MB)), dir("decks", docFiles(14, ["pptx", "key"], 20 * MB, 120 * MB))]),
    dir("Notion export", files(200, () => file(`${pick(words)} ${hex(8)}.md`, between(2 * KB, 300 * KB), age(30, 200)))),
    dir("scans", files(40, () => file(`scan_${hex(6)}.pdf`, between(2 * MB, 40 * MB), age(100, 900)))),
    dir("Zoom", files(6, () => dir(`2026-0${int(5, 8)}-${int(10, 28)} Weekly sync`, [file("video1080p.mp4", between(150 * MB, 500 * MB), age(20, 90)), file("audio_only.m4a", between(20 * MB, 60 * MB), age(20, 90))]))),
    dir("books", files(30, () => file(`${pick(["Designing Data-Intensive Apps", "Refactoring UI", "Shape Up", "The Mom Test", "Rust in Action"])}.${pick(["pdf", "epub"])}`, between(2 * MB, 60 * MB), age(200, 1200)))),
  ]);

  const desktop = dir("Desktop", [
    ...docFiles(12, ["pdf", "docx", "txt"], 10 * KB, 5 * MB),
    file("todo.md", 4 * KB, age(0, 1)),
    file("owntools_0.2.0_x64-setup.exe", 108 * MB, age(2, 3)),
    file("cursor-setup-x64-1.6.2.exe", dupInstallerSize, age(9, 10), dupInstaller),
    dir("old stuff", [...docFiles(30, ["pdf", "docx"], 100 * KB, 20 * MB), file("backup-2023.zip", 2.4 * GB, age(700, 900)), file("Win11_24H2_English_x64.iso", dupIsoSize, age(120, 121), dupIso)]),
  ]);

  const cargo = dir(".cargo", [dir("registry", [dir("cache", [dir("index.crates.io-1949cf8c6b5b557f", files(400, () => file(`${pick(["serde", "tokio", "windows", "syn", "quote", "tauri", "axum", "reqwest", "wry", "tao"])}-${int(0, 3)}.${int(0, 60)}.${int(0, 20)}.crate`, between(10 * KB, 4 * MB), age(5, 300))))]), dir("src", [dir("index.crates.io-1949cf8c6b5b557f", files(200, () => dir(`${pick(["serde", "tokio", "windows", "syn", "quote", "tauri", "axum"])}-${int(0, 3)}.${int(0, 60)}.${int(0, 20)}`, cacheFiles(int(10, 60), 2 * KB, 300 * KB, 5, 300))))])]), dir("bin", files(8, () => file(`${pick(["cargo", "rustc", "rustup", "cargo-clippy", "rust-analyzer"])}.exe`, between(4 * MB, 60 * MB), age(30, 200))))]);
  const rustup = dir(".rustup", [dir("toolchains", [dir("stable-x86_64-pc-windows-msvc", [dir("lib", [dir("rustlib", files(2, () => dir(pick(["x86_64-pc-windows-msvc", "wasm32-unknown-unknown"]), [dir("lib", cacheFiles(120, 1 * MB, 18 * MB, 30, 31))])))]), dir("bin", cacheFiles(12, 4 * MB, 90 * MB, 30, 31))])])]);
  const hf = dir(".cache", [dir("huggingface", [dir("hub", files(3, () => dir(`models--${pick(["openai", "nvidia", "meta-llama", "mistralai"])}--${pick(["whisper-large-v3", "parakeet-tdt-0.6b-v3", "Llama-3.2-3B", "Mistral-7B-Instruct"])}`, [dir("blobs", files(int(2, 3), () => file(hex(64), between(300 * MB, 1.2 * GB), age(20, 120))))])))])]);
  const android = dir(".android", [dir("avd", [dir("Pixel_8_API_35.avd", [file("userdata-qemu.img", 6.2 * GB, age(40, 41)), file("cache.img", 512 * MB, age(40, 41)), file("snapshots.img", 1.1 * GB, age(40, 41))])])]);
  const npm = dir(".npm", [dir("_cacache", [dir("content-v2", files(120, () => dir(hex(2), cacheFiles(int(3, 30), 3 * KB, 2 * MB, 5, 200))))])]);
  const onedrive = dir("OneDrive", [dir("Documents", docFiles(40, ["docx", "xlsx", "pdf"], 20 * KB, 8 * MB)), dir("Pictures", jpgs(90, 1 * MB, 8 * MB, "OD_"))]);

  return dir("demo", [
    dir("AppData", [local, roaming, dir("LocalLow", cacheFiles(20, 10 * KB, 20 * MB))]),
    downloads,
    documents,
    projects,
    pictures,
    videos,
    music,
    desktop,
    cargo,
    rustup,
    hf,
    android,
    npm,
    onedrive,
    dir(".vscode", [dir("extensions", files(24, () => dir(`${pick(["ms-python.python", "rust-lang.rust-analyzer", "esbenp.prettier-vscode", "github.copilot", "dbaeumer.vscode-eslint"])}-${int(0, 9)}.${int(0, 40)}.${int(0, 9)}`, cacheFiles(int(10, 60), 4 * KB, 3 * MB, 10, 200))))]),
    dir(".ollama", [dir("models", [dir("blobs", files(3, () => file(`sha256-${hex(64)}`, between(1.2 * GB, 3.2 * GB), age(15, 60))))])]),
    file("NTUSER.DAT", 24 * MB, age(0, 1)),
    file(".gitconfig", 400, age(100, 400)),
    file(".bash_history", 60 * KB, age(0, 1)),
  ]);
}
