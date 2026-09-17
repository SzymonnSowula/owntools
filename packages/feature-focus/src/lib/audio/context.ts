let ctx: AudioContext | null = null;
let unlocked = false;

/**
 * Silence for this long suspends the context. A running AudioContext keeps an
 * output device open and its render thread waking about a hundred times a
 * second whether anything plays or not — and this one is created by the first
 * click anywhere in the window (App.tsx) and used to run until owntools quit.
 * Every play path goes through `unlockAudio`, which resumes it; no new click
 * is needed for that, the page already has user activation.
 */
const IDLE_SUSPEND_MS = 20_000;
const soundingProbes: Array<() => boolean> = [];
let lastSound = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A module that makes sound registers how to tell whether it still is (a
 * record on the platter, a mixer running, a key held) — the context is only
 * suspended once none of them has been for `IDLE_SUSPEND_MS`.
 */
export function registerAudioActivity(isSounding: () => boolean): void {
  soundingProbes.push(isSounding);
}

function watchForSilence(): void {
  if (idleTimer !== null) return;
  idleTimer = setTimeout(checkSilence, IDLE_SUSPEND_MS / 2);
}

function checkSilence(): void {
  idleTimer = null;
  const audio = ctx;
  if (!audio || audio.state !== "running") return;
  if (soundingProbes.some((isSounding) => isSounding())) lastSound = Date.now();
  if (Date.now() - lastSound >= IDLE_SUSPEND_MS) {
    void audio.suspend().catch(() => undefined);
    return;
  }
  watchForSilence();
}

export function getAudioContext(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new Ctor();
    lastSound = Date.now();
    watchForSilence();
  }
  return ctx;
}

export async function unlockAudio(): Promise<void> {
  const audio = getAudioContext();
  lastSound = Date.now();
  if (audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      /* gesture required */
    }
  }
  unlocked = audio.state === "running";
  if (unlocked) watchForSilence();
}

export function isAudioUnlocked(): boolean {
  return unlocked && !!ctx && ctx.state === "running";
}

export function now(): number {
  return getAudioContext().currentTime;
}
