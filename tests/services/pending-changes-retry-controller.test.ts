import {
  createPendingChangesRetryController,
  pendingChangesUploadNeedsRetry,
  type PendingChangesUploadResult,
  type PendingChangesRetryState,
} from '../../services/PendingChangesRetryController';

type ScheduledAttempt = {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
};

function controlledScheduler() {
  const attempts: ScheduledAttempt[] = [];
  return {
    attempts,
    schedule(callback: () => void, delayMs: number): ScheduledAttempt {
      const attempt = { callback, delayMs, cancelled: false };
      attempts.push(attempt);
      return attempt;
    },
    cancel(timer: unknown) {
      (timer as ScheduledAttempt).cancelled = true;
    },
    runNext() {
      const next = attempts.find(attempt => !attempt.cancelled);
      if (!next) throw new Error('No scheduled attempt is available.');
      next.cancelled = true;
      next.callback();
    },
    activeDelays() {
      return attempts
        .filter(attempt => !attempt.cancelled)
        .map(attempt => attempt.delayMs);
    },
  };
}

function uploadResult(
  overrides: Partial<PendingChangesUploadResult> = {},
): PendingChangesUploadResult {
  return {
    configured: true,
    uploaded: 0,
    queued: 0,
    conflicts: 0,
    errors: [],
    ...overrides,
  };
}

async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('pending changes retry controller', () => {
  it('retries a resolved upload result that reports queued errors', async () => {
    const scheduler = controlledScheduler();
    const states: PendingChangesRetryState[] = [];
    const upload = jest
      .fn<Promise<PendingChangesUploadResult>, []>()
      .mockResolvedValueOnce(uploadResult({
        queued: 1,
        errors: ['network unavailable'],
        itemOutcomes: { 'schedule-1': 'failed' },
      }))
      .mockResolvedValueOnce(uploadResult({
        uploaded: 1,
        queued: 0,
        itemOutcomes: { 'schedule-1': 'uploaded' },
      }));
    const controller = createPendingChangesRetryController({
      upload,
      getPendingChangeCount: async () => 1,
      retryDelaysMs: [10, 20],
      idleCheckIntervalMs: 100,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      onStateChange: state => states.push(state),
    });

    controller.start();
    await flushAsyncWork();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({
      status: 'waiting_retry',
      queued: 1,
      consecutiveRetryCount: 1,
      nextAttemptInMs: 10,
      lastError: 'network unavailable',
    });
    expect(scheduler.activeDelays()).toEqual([10]);

    scheduler.runNext();
    await flushAsyncWork();

    expect(upload).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({
      status: 'idle',
      queued: 0,
      consecutiveRetryCount: 0,
      nextAttemptInMs: 100,
    });
    expect(scheduler.activeDelays()).toEqual([100]);
    controller.stop();
  });

  it('runs immediately on foreground or reconnect instead of waiting for backoff', async () => {
    const scheduler = controlledScheduler();
    const triggers: string[] = [];
    const upload = jest
      .fn<Promise<PendingChangesUploadResult>, []>()
      .mockResolvedValue(uploadResult({
        queued: 1,
        errors: ['still offline'],
        itemOutcomes: { 'area-1': 'failed' },
      }));
    const controller = createPendingChangesRetryController({
      upload,
      getPendingChangeCount: async () => 1,
      retryDelaysMs: [5_000, 15_000],
      idleCheckIntervalMs: 30_000,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      onStateChange: state => {
        if (state.status === 'syncing') triggers.push(String(state.trigger));
      },
    });

    controller.start();
    await flushAsyncWork();
    expect(scheduler.activeDelays()).toEqual([5_000]);

    await controller.request('foreground');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(scheduler.activeDelays()).toEqual([15_000]);

    await controller.request('reconnect');
    expect(upload).toHaveBeenCalledTimes(3);
    expect(scheduler.activeDelays()).toEqual([15_000]);
    expect(triggers).toEqual(['initial', 'foreground', 'reconnect']);
    controller.stop();
  });

  it('coalesces overlapping triggers into one bounded follow-up', async () => {
    const scheduler = controlledScheduler();
    let resolveFirst: (result: PendingChangesUploadResult) => void = () => {
      throw new Error('The first upload promise was not initialized.');
    };
    const firstResult = new Promise<PendingChangesUploadResult>(resolve => {
      resolveFirst = resolve;
    });
    const upload = jest
      .fn<Promise<PendingChangesUploadResult>, []>()
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce(uploadResult({ uploaded: 1 }));
    const controller = createPendingChangesRetryController({
      upload,
      getPendingChangeCount: async () => 1,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    controller.start();
    await flushAsyncWork();
    expect(upload).toHaveBeenCalledTimes(1);

    await Promise.all([
      controller.request('foreground'),
      controller.request('reconnect'),
      controller.request('queue_item_enqueued'),
    ]);
    expect(upload).toHaveBeenCalledTimes(1);

    resolveFirst(uploadResult({
      queued: 1,
      errors: ['temporary failure'],
      itemOutcomes: { 'document-1': 'failed' },
    }));
    await flushAsyncWork();

    expect(upload).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('does not tight-loop a photo-blocked item', () => {
    expect(pendingChangesUploadNeedsRetry(uploadResult({
      queued: 1,
      itemOutcomes: { 'update-1': 'blocked' },
    }))).toBe(false);
    expect(pendingChangesUploadNeedsRetry(uploadResult({
      queued: 2,
      errors: ['task upload failed'],
      itemOutcomes: {
        'update-1': 'blocked',
        'task-1': 'failed',
      },
    }))).toBe(true);
  });
});
