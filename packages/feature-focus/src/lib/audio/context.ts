let ctx: AudioContext | null = null;
let unlocked = false;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

export async function unlockAudio(): Promise<void> {
  const audio = getAudioContext();
  if (audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      /* gesture required */
    }
  }
  unlocked = audio.state === "running";
}

export function isAudioUnlocked(): boolean {
  return unlocked && !!ctx && ctx.state === "running";
}

export function now(): number {
  return getAudioContext().currentTime;
}
