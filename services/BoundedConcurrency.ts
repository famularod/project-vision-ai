export type BoundedTaskRunner = Readonly<{
  run: <T>(task: () => Promise<T>) => Promise<T>;
}>;

export function createBoundedTaskRunner(limit: number): BoundedTaskRunner {
  const concurrency = positiveConcurrency(limit);
  let active = 0;
  const waiting: Array<() => void> = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>(resolve => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  }

  return Object.freeze({ run });
}

export async function mapWithBoundedConcurrency<T, TResult>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(values.length, positiveConcurrency(limit));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

function positiveConcurrency(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }
  return value;
}
