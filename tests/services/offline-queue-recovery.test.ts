const mockStorageValues = new Map<string, string>();
let mockCorruptQuarantineWrites = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) =>
    Promise.resolve(mockStorageValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorageValues.set(
      key,
      mockCorruptQuarantineWrites && key.includes('.quarantine.')
        ? `${value}-changed`
        : value,
    );
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorageValues.delete(key);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStorageValues.keys()])),
}));

const mockCreateProject = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);

jest.mock('../../services/SupabaseService', () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args),
  getSupabaseConfigurationStatus: () => ({
    configured: true,
    message: 'Configured.',
  }),
}));

import {
  SYNC_QUEUE_QUARANTINE_KEY_PREFIX,
  cleanupStoredSyncStatusMessages,
  enqueuePendingChange,
  exportOfflineQueueQuarantine,
  getOfflineQueue,
  getOfflineQueueRecoveryState,
  listOfflineQueueQuarantines,
  retryOfflineQueueRecovery,
  uploadPendingChanges,
  type SyncQueueItem,
} from '../../services/SyncService';

const ACTIVE_QUEUE_KEY = 'projectVisionAI.syncQueue.v1';

function queueItem(id: string): SyncQueueItem {
  return {
    id,
    entity: 'project',
    operation: 'create',
    payload: { name: `Recovered ${id}` },
    createdAt: '2026-07-18T12:00:00.000Z',
    changedAt: '2026-07-18T12:00:00.000Z',
    retryCount: 0,
    lastError: null,
  };
}

describe('offline queue corruption recovery', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockCorruptQuarantineWrites = false;
    mockCreateProject.mockClear();
  });

  it('quarantines malformed bytes unchanged before initializing an empty queue', async () => {
    const corruptRawValue = '{"id":"unfinished"\n\u0000forensic-bytes';
    mockStorageValues.set(ACTIVE_QUEUE_KEY, corruptRawValue);

    await expect(cleanupStoredSyncStatusMessages()).resolves.toMatchObject({
      cleaned: true,
    });
    await expect(getOfflineQueue()).resolves.toEqual([]);
    expect(mockStorageValues.get(ACTIVE_QUEUE_KEY)).toBe('[]');

    const quarantineKeys = await listOfflineQueueQuarantines();
    expect(quarantineKeys).toHaveLength(1);
    expect(quarantineKeys[0]).toMatch(
      new RegExp(`^${SYNC_QUEUE_QUARANTINE_KEY_PREFIX.replaceAll('.', '\\.')}`),
    );
    await expect(exportOfflineQueueQuarantine(quarantineKeys[0])).resolves.toEqual({
      storageKey: quarantineKeys[0],
      rawValue: corruptRawValue,
    });
    await expect(getOfflineQueueRecoveryState()).resolves.toEqual({
      activeItems: 0,
      quarantineKeys,
      recoveryAvailable: true,
    });

    await cleanupStoredSyncStatusMessages();
    expect(mockStorageValues.get(quarantineKeys[0])).toBe(corruptRawValue);
    expect(mockStorageValues.get(ACTIVE_QUEUE_KEY)).toBe('[]');
  });

  it.each([
    '{}',
    '[{"id":"missing-required-fields"}]',
    '[{"id":"bad-retry","entity":"project","operation":"create","payload":{},"createdAt":"now","changedAt":"now","retryCount":-1}]',
  ])('quarantines parseable data that is not a valid queue: %s', async rawValue => {
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);

    await expect(getOfflineQueue()).resolves.toEqual([]);
    const [quarantineKey] = await listOfflineQueueQuarantines();
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);
    expect(mockStorageValues.get(ACTIVE_QUEUE_KEY)).toBe('[]');
  });

  it('exports, retries, restores repaired queue data, and uploads it normally', async () => {
    const corruptRawValue = 'not-json-at-all';
    mockStorageValues.set(ACTIVE_QUEUE_KEY, corruptRawValue);
    await getOfflineQueue();
    const [quarantineKey] = await listOfflineQueueQuarantines();

    await expect(retryOfflineQueueRecovery(quarantineKey)).resolves.toEqual({
      status: 'still_corrupt',
      quarantineKey,
      restoredItems: 0,
      activeItems: 0,
    });
    expect(mockStorageValues.get(quarantineKey)).toBe(corruptRawValue);
    expect(mockStorageValues.get(ACTIVE_QUEUE_KEY)).toBe('[]');

    const repairedRawValue = JSON.stringify([queueItem('recovered-project')]);
    await expect(
      retryOfflineQueueRecovery(quarantineKey, repairedRawValue),
    ).resolves.toEqual({
      status: 'recovered',
      quarantineKey,
      restoredItems: 1,
      activeItems: 1,
    });
    expect(mockStorageValues.get(quarantineKey)).toBe(corruptRawValue);
    await expect(getOfflineQueue()).resolves.toEqual([
      queueItem('recovered-project'),
    ]);

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      errors: [],
    });
    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockStorageValues.get(ACTIVE_QUEUE_KEY)).toBe('[]');
  });

  it('never overwrites new active work during a recovery retry', async () => {
    const corruptRawValue = '{broken';
    mockStorageValues.set(ACTIVE_QUEUE_KEY, corruptRawValue);
    await getOfflineQueue();
    const [quarantineKey] = await listOfflineQueueQuarantines();

    await enqueuePendingChange({
      ...queueItem('new-live-work'),
      autoUpload: false,
    });

    await expect(
      retryOfflineQueueRecovery(
        quarantineKey,
        JSON.stringify([queueItem('older-recovered-work')]),
      ),
    ).resolves.toEqual({
      status: 'active_queue_not_empty',
      quarantineKey,
      restoredItems: 0,
      activeItems: 1,
    });
    expect((await getOfflineQueue()).map(item => item.id)).toEqual([
      'new-live-work',
    ]);
    expect(mockStorageValues.get(quarantineKey)).toBe(corruptRawValue);
  });

  it('does not replace the active bytes unless the forensic copy verifies exactly', async () => {
    const corruptRawValue = '{must-survive';
    mockStorageValues.set(ACTIVE_QUEUE_KEY, corruptRawValue);
    mockCorruptQuarantineWrites = true;

    await expect(getOfflineQueue()).rejects.toThrow(
      'Offline queue quarantine could not be verified.',
    );
    expect(mockStorageValues.get(ACTIVE_QUEUE_KEY)).toBe(corruptRawValue);
  });
});
