import { describe, expect, it } from "vitest";
import { createQueue } from "./queue";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("createQueue", () => {
  it("runs jobs one at a time in arrival order, whatever their own speed", async () => {
    const done: string[] = [];
    const q = createQueue<{ id: string; ms: number }>(async (job) => {
      await sleep(job.ms);
      done.push(job.id);
    });
    q.push({ id: "slow", ms: 25 });
    q.push({ id: "fast", ms: 1 });
    q.push({ id: "mid", ms: 10 });
    expect(q.active).toBe(true);
    expect(q.pending).toBe(2);
    await q.idle();
    expect(done).toEqual(["slow", "fast", "mid"]);
    expect(q.pending).toBe(0);
    expect(q.active).toBe(false);
  });

  it("keeps going after a failed job and reports counts", async () => {
    const seen: [number, boolean][] = [];
    const done: number[] = [];
    const q = createQueue<number>(
      async (n) => {
        await tick();
        if (n === 2) throw new Error("engine hiccup");
        done.push(n);
      },
      (pending, active) => seen.push([pending, active]),
    );
    q.push(1);
    q.push(2);
    q.push(3);
    await q.idle();
    expect(done).toEqual([1, 3]);
    expect(seen[0]).toEqual([1, false]);
    expect(seen.some(([p, a]) => p === 2 && a)).toBe(true);
    expect(seen[seen.length - 1]).toEqual([0, false]);
  });

  it("idle resolves immediately on an empty queue and clear drops the rest", async () => {
    const done: number[] = [];
    const q = createQueue<number>(async (n) => {
      await sleep(5);
      done.push(n);
    });
    await q.idle();
    q.push(1);
    q.push(2);
    q.push(3);
    q.clear();
    expect(q.pending).toBe(0);
    await q.idle();
    expect(done).toEqual([1]);
  });
});
