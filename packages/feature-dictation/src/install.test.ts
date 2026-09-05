import { beforeEach, describe, expect, it, vi } from "vitest";

type Progress = { step: "engine" | "model"; loaded: number; total: number };

const engine = vi.hoisted(() => ({
  installDictation: vi.fn<(onProgress: (p: Progress) => void, model?: string) => Promise<void>>(),
  cancelInstall: vi.fn(async () => undefined),
  settings: { model: "" },
}));

vi.mock("./engine", () => ({
  DEFAULT_MODEL_FILE: "ggml-large-v3-turbo-q5_0.bin",
  installDictation: engine.installDictation,
  cancelInstall: engine.cancelInstall,
  isInstallCancelled: (err: unknown) => err instanceof Error && err.name === "InstallCancelled",
  getDictationSettings: () => ({ ...engine.settings }),
  saveDictationSettings: (patch: { model?: string }) => {
    Object.assign(engine.settings, patch);
    return { ...engine.settings };
  },
}));

import {
  getInstallSession,
  installPercent,
  PAUSED_NOTICE,
  pauseInstall,
  resetInstallSessionForTests,
  startInstall,
  subscribeInstall,
} from "./install";

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetInstallSessionForTests();
  engine.installDictation.mockReset();
  engine.cancelInstall.mockClear();
  engine.settings.model = "";
});

describe("startInstall", () => {
  it("forwards progress, resolves true and adopts the first model", async () => {
    const d = deferred();
    let report: ((p: Progress) => void) | null = null;
    engine.installDictation.mockImplementation((onProgress) => {
      report = onProgress;
      return d.promise;
    });
    const seen: number[] = [];
    const unsubscribe = subscribeInstall(() => seen.push(getInstallSession().progress?.loaded ?? -1));

    const done = startInstall("ggml-base.bin");
    expect(getInstallSession().installing).toBe("ggml-base.bin");
    report!({ step: "model", loaded: 50, total: 100 });
    expect(getInstallSession().progress).toEqual({ step: "model", loaded: 50, total: 100 });
    d.resolve();
    await expect(done).resolves.toBe(true);

    const s = getInstallSession();
    expect(s.installing).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.error).toBeNull();
    expect(s.notice).toBeNull();
    expect(s.generation).toBe(1);
    expect(engine.settings.model).toBe("ggml-base.bin");
    expect(seen).toContain(50);
    unsubscribe();
  });

  it("keeps a model the user already chose", async () => {
    engine.settings.model = "ggml-small.bin";
    engine.installDictation.mockResolvedValue(undefined);
    await startInstall("ggml-base.bin");
    expect(engine.settings.model).toBe("ggml-small.bin");
  });

  it("joins a running install instead of starting a second download", async () => {
    const d = deferred();
    engine.installDictation.mockReturnValue(d.promise);
    const first = startInstall("ggml-base.bin");
    const second = startInstall("ggml-small.bin");
    expect(second).toBe(first);
    expect(engine.installDictation).toHaveBeenCalledTimes(1);
    expect(getInstallSession().installing).toBe("ggml-base.bin");
    d.resolve();
    await first;
    expect(getInstallSession().installing).toBeNull();
  });

  it("reports a pause as a notice, not an error", async () => {
    const d = deferred();
    engine.installDictation.mockReturnValue(d.promise);
    const done = startInstall();
    await pauseInstall();
    expect(getInstallSession().cancelling).toBe(true);
    expect(engine.cancelInstall).toHaveBeenCalledTimes(1);
    const cancelled = new Error("Download paused.");
    cancelled.name = "InstallCancelled";
    d.reject(cancelled);
    await expect(done).resolves.toBe(false);
    const s = getInstallSession();
    expect(s.notice).toBe(PAUSED_NOTICE);
    expect(s.error).toBeNull();
    expect(s.installing).toBeNull();
    expect(s.cancelling).toBe(false);
  });

  it("surfaces any other failure and clears it on the next start", async () => {
    engine.installDictation.mockRejectedValueOnce(new Error("checksum mismatch"));
    await expect(startInstall()).resolves.toBe(false);
    expect(getInstallSession().error).toBe("checksum mismatch");
    engine.installDictation.mockResolvedValueOnce(undefined);
    await expect(startInstall()).resolves.toBe(true);
    expect(getInstallSession().error).toBeNull();
    expect(getInstallSession().generation).toBe(2);
  });
});

describe("pauseInstall", () => {
  it("is a no-op while idle", async () => {
    await pauseInstall();
    expect(engine.cancelInstall).not.toHaveBeenCalled();
    expect(getInstallSession().cancelling).toBe(false);
  });
});

describe("installPercent", () => {
  it("rounds and caps at 100", () => {
    expect(installPercent(null)).toBeNull();
    expect(installPercent({ step: "engine", loaded: 1, total: 0 })).toBeNull();
    expect(installPercent({ step: "model", loaded: 333, total: 1000 })).toBe(33);
    expect(installPercent({ step: "model", loaded: 1200, total: 1000 })).toBe(100);
  });
});
