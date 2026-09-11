import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_EVENT, LLM_SETTINGS_KEY, llmSettings } from "@core/llm";

type Progress = { step: "runtime" | "model"; loaded: number; total: number };

const installer = vi.hoisted(() => ({
  installLlm: vi.fn<(onProgress: (p: Progress) => void, model?: string) => Promise<void>>(),
  cancelInstall: vi.fn(async () => undefined),
}));

vi.mock("./installer", () => ({
  installLlm: installer.installLlm,
  cancelInstall: installer.cancelInstall,
  isInstallCancelled: (err: unknown) => err instanceof Error && err.name === "InstallCancelled",
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
  installer.installLlm.mockReset();
  installer.cancelInstall.mockClear();
  localStorage.clear();
});

describe("startInstall", () => {
  it("forwards progress, resolves true, adopts the first model and announces the change", async () => {
    const d = deferred();
    let report: ((p: Progress) => void) | null = null;
    installer.installLlm.mockImplementation((onProgress) => {
      report = onProgress;
      return d.promise;
    });
    const seen: number[] = [];
    const unsubscribe = subscribeInstall(() => seen.push(getInstallSession().progress?.loaded ?? -1));
    let events = 0;
    const onChange = () => events++;
    window.addEventListener(LLM_EVENT, onChange);

    const done = startInstall("qwen3-1.7b-q8_0");
    expect(getInstallSession().installing).toBe("qwen3-1.7b-q8_0");
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
    expect(llmSettings().local.model).toBe("qwen3-1.7b-q8_0");
    expect(seen).toContain(50);
    // installing → true, settings write, installing → false, notify: the exact
    // count is not the contract, that other windows hear about it is.
    expect(events).toBeGreaterThanOrEqual(2);
    window.removeEventListener(LLM_EVENT, onChange);
    unsubscribe();
  });

  it("keeps a model the user already chose", async () => {
    localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ local: { model: "qwen3-4b-q4_k_m" } }));
    installer.installLlm.mockResolvedValue(undefined);
    await startInstall("qwen3-1.7b-q8_0");
    expect(llmSettings().local.model).toBe("qwen3-4b-q4_k_m");
  });

  it("joins a running install instead of starting a second download", async () => {
    const d = deferred();
    installer.installLlm.mockReturnValue(d.promise);
    const first = startInstall("qwen3-4b-q4_k_m");
    const second = startInstall("qwen3-1.7b-q8_0");
    expect(second).toBe(first);
    expect(installer.installLlm).toHaveBeenCalledTimes(1);
    expect(getInstallSession().installing).toBe("qwen3-4b-q4_k_m");
    d.resolve();
    await first;
    expect(getInstallSession().installing).toBeNull();
  });

  it("reports a pause as a notice, not an error", async () => {
    const d = deferred();
    installer.installLlm.mockReturnValue(d.promise);
    const done = startInstall();
    await pauseInstall();
    expect(getInstallSession().cancelling).toBe(true);
    expect(installer.cancelInstall).toHaveBeenCalledTimes(1);
    const cancelled = new Error("Download paused.");
    cancelled.name = "InstallCancelled";
    d.reject(cancelled);
    await expect(done).resolves.toBe(false);
    const s = getInstallSession();
    expect(s.notice).toBe(PAUSED_NOTICE);
    expect(s.error).toBeNull();
    expect(s.installing).toBeNull();
    expect(s.cancelling).toBe(false);
    // A paused install did not make the model the chosen one.
    expect(llmSettings().local.model).toBe("");
  });

  it("surfaces any other failure and clears it on the next start", async () => {
    installer.installLlm.mockRejectedValueOnce(new Error("Checksum mismatch"));
    await expect(startInstall()).resolves.toBe(false);
    expect(getInstallSession().error).toBe("Checksum mismatch");
    installer.installLlm.mockResolvedValueOnce(undefined);
    const again = startInstall();
    expect(getInstallSession().error).toBeNull();
    await again;
    expect(getInstallSession().generation).toBe(2);
  });

  it("pausing when nothing runs is a no-op", async () => {
    await pauseInstall();
    expect(installer.cancelInstall).not.toHaveBeenCalled();
  });
});

describe("installPercent", () => {
  it("is null before the total is known and capped at 100", () => {
    expect(installPercent(null)).toBeNull();
    expect(installPercent({ step: "model", loaded: 10, total: 0 })).toBeNull();
    expect(installPercent({ step: "model", loaded: 25, total: 100 })).toBe(25);
    expect(installPercent({ step: "runtime", loaded: 120, total: 100 })).toBe(100);
  });
});
