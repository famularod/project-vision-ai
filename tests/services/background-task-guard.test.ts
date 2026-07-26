import {
  clearBackgroundTaskDiagnostics,
  getBackgroundTaskDiagnostics,
  reportBackgroundTaskFailure,
  runGuardedBackgroundTask,
  startGuardedBackgroundTask,
} from '../../services/BackgroundTaskGuard';
import { reconcileFieldUpdateSyncResult } from '../../services/FieldUpdateSyncGeneration';

describe('BackgroundTaskGuard', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    clearBackgroundTaskDiagnostics();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('turns a fire-and-forget rejection into a handled diagnostic', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      startGuardedBackgroundTask({
        key: 'rejecting-task',
        label: 'Rejecting task',
        trigger: 'test',
        task: async () => {
          throw new Error('network token https://private.example.test user@example.com');
        },
      });

      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
      expect(getBackgroundTaskDiagnostics()).toEqual([
        expect.objectContaining({
          key: 'rejecting-task',
          message: 'network token [url] [email]',
          repeatCount: 1,
        }),
      ]);
    } finally {
      process.removeListener('unhandledRejection', unhandled);
    }
  });

  it('coalesces overlap into one bounded latest-work follow-up', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];

    const first = runGuardedBackgroundTask({
      key: 'coalesced-task',
      label: 'Coalesced task',
      trigger: 'first',
      maxConsecutiveRuns: 2,
      task: async () => {
        calls.push('first');
        await firstBlocked;
        return 'first-result';
      },
    });
    const second = runGuardedBackgroundTask({
      key: 'coalesced-task',
      label: 'Coalesced task',
      trigger: 'second',
      maxConsecutiveRuns: 2,
      task: async () => {
        calls.push('latest');
        return 'latest-result';
      },
    });

    expect(second).toBe(first);
    releaseFirst();
    await expect(first).resolves.toEqual({
      status: 'completed',
      value: 'latest-result',
      runs: 2,
    });
    expect(calls).toEqual(['first', 'latest']);
  });

  it('coalesces repeated diagnostics instead of creating a log storm', () => {
    reportBackgroundTaskFailure({
      key: 'repeat-task',
      label: 'Repeat task',
      trigger: 'interval',
      error: new Error('offline'),
    });
    reportBackgroundTaskFailure({
      key: 'repeat-task',
      label: 'Repeat task',
      trigger: 'foreground',
      error: new Error('offline'),
    });

    expect(getBackgroundTaskDiagnostics()).toEqual([
      expect.objectContaining({
        key: 'repeat-task',
        trigger: 'foreground',
        message: 'offline',
        repeatCount: 2,
      }),
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does not let a guarded stale completion overwrite a newer edit', async () => {
    type Update = {
      id: string;
      notes: string;
      status: string;
      workflowTimestamps?: Record<string, string>;
    };
    const attempted: Update = { id: 'update-1', notes: 'old', status: 'queued' };
    const current: Update = { ...attempted, notes: 'newer correction' };

    const outcome = await runGuardedBackgroundTask({
      key: 'stale-result-task',
      label: 'Stale result task',
      trigger: 'test',
      task: async () => ({ ...attempted, status: 'sent' }),
    });
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('Expected completion.');

    const reconciled = reconcileFieldUpdateSyncResult(
      [current],
      attempted,
      outcome.value,
    );
    expect(reconciled.applied).toBe(false);
    expect(reconciled.updates).toEqual([current]);
  });
});
