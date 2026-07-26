import {
  runAutomaticSyncQueue,
  shouldPersistAutomaticSyncOutcome,
} from '../../services/AutomaticSyncState';

const current = {
  id: 'update-1',
  status: 'queued',
  syncDiagnostics: {
    lastSyncAttemptAt: '2026-07-18T10:00:00.000Z',
    retryAttemptNumber: 1,
    queuedUpdateCount: 3,
    lastSyncResult: 'failed',
    lastSyncFailureCategory: 'offline',
    storageUploadResult: 'skipped',
  },
  workflowTimestamps: { sendResolvedAt: '2026-07-18T10:00:01.000Z' },
};

describe('automatic sync persistence state', () => {
  it('does not persist repeated equivalent failure bookkeeping', () => {
    expect(shouldPersistAutomaticSyncOutcome(current, {
      ...current,
      syncDiagnostics: {
        ...current.syncDiagnostics,
        lastSyncAttemptAt: '2026-07-18T10:00:30.000Z',
        retryAttemptNumber: 2,
        queuedUpdateCount: 4,
      },
    })).toBe(false);
  });

  it('persists actionable state changes and the first resolved timestamp', () => {
    expect(shouldPersistAutomaticSyncOutcome(current, {
      ...current,
      status: 'sent',
      syncDiagnostics: {
        ...current.syncDiagnostics,
        lastSyncResult: 'success',
        lastSyncFailureCategory: null,
      },
    })).toBe(true);
    expect(shouldPersistAutomaticSyncOutcome(
      { ...current, workflowTimestamps: {} },
      current,
    )).toBe(true);
  });

  it('keeps a rejected item retryable and continues later items', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const attempted: string[] = [];
    try {
      await expect(runAutomaticSyncQueue(['first', 'second'], async item => {
        attempted.push(item);
        if (item === 'first') throw new Error('temporary failure');
      })).resolves.toBeUndefined();
      expect(attempted).toEqual(['first', 'second']);
    } finally {
      warn.mockRestore();
    }
  });
});
