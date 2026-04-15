/**
 * Keeper work queue.
 *
 * Design:
 * - Both event-triggered (indexer) and periodic polling push novelIds via `enqueue()`.
 * - A bounded pool of async workers consumes the queue, calling `checkNovel(id)`.
 * - Built-in dedup: the same novelId enqueued while pending is merged.
 * - Recheck flag: if a novelId is enqueued while already in-flight, it's re-queued after processing.
 * - simulateContract inside checkNovel handles any residual race (revert → silent skip).
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("keeper:queue");

type CheckFn = (novelId: bigint) => Promise<void>;

export class KeeperQueue {
  private pending = new Set<string>(); // novelIds waiting for a worker
  private inFlight = new Set<string>(); // novelIds currently being processed
  private needsRecheck = new Set<string>(); // in-flight + got new signal → recheck after
  private waiters: Array<() => void> = []; // workers blocked on empty queue
  private stopped = false;

  constructor(
    private check: CheckFn,
    private concurrency: number = 5,
  ) {}

  enqueue(novelId: bigint): void {
    const id = novelId.toString();
    if (this.inFlight.has(id)) {
      this.needsRecheck.add(id);
      return;
    }
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.notifyOne();
  }

  start(): void {
    for (let i = 0; i < this.concurrency; i++) {
      this.workerLoop(i).catch((err) => log.error({ err, workerIdx: i }, "worker crash"));
    }
  }

  stop(): void {
    this.stopped = true;
    // Wake up all waiting workers so they can exit.
    for (const w of this.waiters) w();
    this.waiters = [];
  }

  size(): number {
    return this.pending.size + this.inFlight.size;
  }

  private notifyOne(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  private async take(): Promise<string | null> {
    while (!this.stopped) {
      const next = this.pending.values().next();
      if (!next.done) {
        const id = next.value;
        this.pending.delete(id);
        return id;
      }
      // Queue empty — wait for a signal
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    return null;
  }

  private async workerLoop(workerIdx: number): Promise<void> {
    while (!this.stopped) {
      const id = await this.take();
      if (id === null) return;

      this.inFlight.add(id);
      try {
        await this.check(BigInt(id));
      } catch (err) {
        log.error({ err, workerIdx, novelId: id }, "check error");
      } finally {
        this.inFlight.delete(id);
        if (this.needsRecheck.has(id)) {
          this.needsRecheck.delete(id);
          this.enqueue(BigInt(id));
        }
      }
    }
  }
}
