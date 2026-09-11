/**
 * One-at-a-time FIFO for transcription jobs.
 *
 * Segments arrive faster than an engine answers during a lively call, and
 * two whisper processes at once only make both slower, so jobs wait their
 * turn. Order is arrival order — a "them" line that closed before a "you"
 * line is transcribed first, whatever their timestamps — and one failed job
 * never blocks the next.
 */
export interface Queue<T> {
  push(item: T): void;
  /** Items waiting, not counting the one in flight. */
  readonly pending: number;
  /** Something is being worked on. */
  readonly active: boolean;
  /** Resolves when nothing is queued or in flight. */
  idle(): Promise<void>;
  /** Drops everything waiting; the job in flight finishes. */
  clear(): void;
}

export function createQueue<T>(
  worker: (item: T) => Promise<void>,
  onChange?: (pending: number, active: boolean) => void,
): Queue<T> {
  const waiting: T[] = [];
  let active = false;
  let idleWaiters: (() => void)[] = [];

  const notify = () => onChange?.(waiting.length, active);

  const settleIdle = () => {
    if (!active && waiting.length === 0) {
      const ws = idleWaiters;
      idleWaiters = [];
      for (const w of ws) w();
    }
  };

  const pump = async () => {
    if (active) return;
    const next = waiting.shift();
    if (next === undefined) {
      settleIdle();
      return;
    }
    active = true;
    notify();
    try {
      await worker(next);
    } catch {
      // The worker reports its own failure; the queue only keeps moving.
    }
    active = false;
    notify();
    void pump();
  };

  return {
    push(item) {
      waiting.push(item);
      notify();
      void pump();
    },
    get pending() {
      return waiting.length;
    },
    get active() {
      return active;
    },
    idle() {
      if (!active && waiting.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    clear() {
      waiting.length = 0;
      notify();
      settleIdle();
    },
  };
}
