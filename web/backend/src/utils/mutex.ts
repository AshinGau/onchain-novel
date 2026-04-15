/**
 * Minimal async mutex. Ensures sequential execution of wrapped callbacks across concurrent callers.
 */
export class Mutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    while (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}
