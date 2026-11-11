// In-process concurrency cap and time budget for CPU-heavy work (PDF rendering, image decoding):
// at most `max` tasks run at once, the rest wait in order (docs/06-backend-api.md 10.1, 10.3).

export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLimiter(max: number): Limiter {
  let running = 0;
  const waiting: (() => void)[] = [];
  async function acquire(): Promise<void> {
    if (running < max) {
      running += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

/** Rejects when the promise does not settle within `ms` (the work itself is not cancelled). */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timed out"));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}
