import {
  createBoundedTaskRunner,
  mapWithBoundedConcurrency,
} from '../../services/BoundedConcurrency';

describe('bounded network concurrency', () => {
  it('preserves result order while limiting parallel work', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithBoundedConcurrency(
      [30, 10, 20, 5, 15],
      2,
      async value => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, value));
        active -= 1;
        return value / 5;
      },
    );

    expect(peak).toBe(2);
    expect(results).toEqual([6, 2, 4, 1, 3]);
  });

  it('shares one concurrency limit across independent callers', async () => {
    const runner = createBoundedTaskRunner(2);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 8 }, () => runner.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
    })));

    expect(peak).toBe(2);
  });

  it('rejects invalid limits instead of silently running unbounded', () => {
    expect(() => createBoundedTaskRunner(0)).toThrow(/positive integer/i);
  });
});
