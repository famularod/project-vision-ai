const mockStorage = new Map<string, string>();
let mockCloudTombstonesResult: {
  ok: boolean;
  configured: boolean;
  stubbed: boolean;
  data?: Array<{
    entityType: 'project_area' | 'schedule_item' | 'reference_document';
    recordId: string;
    deletedAt: string;
  }>;
  error?: string;
  message?: string;
};

const mockListDAVESyncTombstones = jest.fn((..._args: unknown[]) =>
  Promise.resolve(mockCloudTombstonesResult),
);
const mockUpsertDAVESyncTombstone = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);
const mockListScheduleItems = jest.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    configured: true,
    stubbed: false,
    data: [],
  }),
);
const mockUpsertScheduleItem = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);
const mockListReferenceDocuments = jest.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    configured: true,
    stubbed: false,
    data: [],
  }),
);
const mockUpsertReferenceDocument = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);
const mockDeleteProjectUpdate = jest.fn((..._args: unknown[]): Promise<{
  ok: boolean;
  configured: boolean;
  stubbed: boolean;
  error?: string;
}> =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);
const mockConfirmProjectUpdateCloudDeletion = jest.fn((..._args: unknown[]) =>
  Promise.resolve(),
);
const mockListDAVEStorageCleanupIntents = jest.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    configured: true,
    stubbed: false,
    data: [],
  }),
);
const mockRemoveProtectedStorageObject = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);
const mockRecordDAVEStorageCleanupAttempt = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  },
}));

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseConfigurationStatus: () => ({
    configured: true,
    message: 'Configured.',
  }),
  listDAVESyncTombstones: (...args: unknown[]) =>
    mockListDAVESyncTombstones(...args),
  upsertDAVESyncTombstone: (...args: unknown[]) =>
    mockUpsertDAVESyncTombstone(...args),
  listScheduleItems: (...args: unknown[]) => mockListScheduleItems(...args),
  upsertScheduleItem: (...args: unknown[]) => mockUpsertScheduleItem(...args),
  listReferenceDocuments: (...args: unknown[]) =>
    mockListReferenceDocuments(...args),
  upsertReferenceDocument: (...args: unknown[]) =>
    mockUpsertReferenceDocument(...args),
  deleteProjectUpdate: (...args: unknown[]) =>
    mockDeleteProjectUpdate(...args),
  listDAVEStorageCleanupIntents: (...args: unknown[]) =>
    mockListDAVEStorageCleanupIntents(...args),
  removeProtectedStorageObject: (...args: unknown[]) =>
    mockRemoveProtectedStorageObject(...args),
  recordDAVEStorageCleanupAttempt: (...args: unknown[]) =>
    mockRecordDAVEStorageCleanupAttempt(...args),
}));

jest.mock('../../services/ProjectUpdateDeletionJournal', () => ({
  confirmProjectUpdateCloudDeletion: (...args: unknown[]) =>
    mockConfirmProjectUpdateCloudDeletion(...args),
  hasProjectUpdateDeletionIntent: jest.fn(async () => true),
  recordProjectUpdateDeletionIntent: jest.fn(async (update: { id: string }) => ({
    updateId: update.id,
    requestedAt: '2026-07-22T08:00:00.000Z',
    cloudDeleteConfirmedAt: null,
  })),
}));

import {
  enqueuePendingChange,
  getOfflineQueue,
  uploadPendingChanges,
} from '../../services/SyncService';

const QUEUE_KEY = 'projectVisionAI.syncQueue.v1';
const TOMBSTONE_KEY = '@dave/sync-tombstones/v1';

function scheduleQueueItem(id: string) {
  return {
    id: `schedule-item-${id}`,
    entity: 'schedule_item' as const,
    operation: 'update' as const,
    payload: {
      id,
      itemData: {
        id,
        projectName: '2375 Compliance Project',
        taskName: 'Install hand rails',
        status: 'In Progress',
        percentComplete: 25,
      },
    },
    changedAt: '2026-07-22T08:00:00.000Z',
    autoUpload: false,
  };
}

beforeEach(() => {
  mockStorage.clear();
  mockCloudTombstonesResult = {
    ok: true,
    configured: true,
    stubbed: false,
    data: [],
  };
  mockListDAVESyncTombstones.mockClear();
  mockUpsertDAVESyncTombstone.mockClear();
  mockListScheduleItems.mockClear();
  mockUpsertScheduleItem.mockClear();
  mockListReferenceDocuments.mockClear();
  mockUpsertReferenceDocument.mockClear();
  mockDeleteProjectUpdate.mockClear();
  mockConfirmProjectUpdateCloudDeletion.mockReset();
  mockConfirmProjectUpdateCloudDeletion.mockResolvedValue(undefined);
});

describe('offline upload deletion barriers', () => {
  it('drops a stale queued task that matches a durable local tombstone without deleting the tombstone', async () => {
    const tombstone = {
      entityType: 'schedule_item' as const,
      recordId: 'task-deleted-locally',
      deletedAt: '2026-07-22T08:05:00.000Z',
    };
    mockStorage.set(TOMBSTONE_KEY, JSON.stringify([tombstone]));
    mockCloudTombstonesResult = {
      ok: false,
      configured: true,
      stubbed: false,
      error: 'Cloud deletion history unavailable.',
    };
    await enqueuePendingChange(scheduleQueueItem(tombstone.recordId));

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 0,
      itemOutcomes: {
        [`schedule-item-${tombstone.recordId}`]: 'superseded',
      },
    });

    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    expect(JSON.parse(mockStorage.get(TOMBSTONE_KEY) || '[]')).toEqual([
      tombstone,
    ]);
  });

  it('rejects a stale queued document that matches a cloud tombstone', async () => {
    const tombstone = {
      entityType: 'reference_document' as const,
      recordId: 'document-deleted-remotely',
      deletedAt: '2026-07-22T08:10:00.000Z',
    };
    mockCloudTombstonesResult = {
      ok: true,
      configured: true,
      stubbed: false,
      data: [tombstone],
    };
    await enqueuePendingChange({
      id: `reference-document-${tombstone.recordId}`,
      entity: 'reference_document',
      operation: 'update',
      payload: {
        id: tombstone.recordId,
        documentData: {
          id: tombstone.recordId,
          name: 'Obsolete schedule',
        },
      },
      changedAt: '2026-07-22T08:00:00.000Z',
      autoUpload: false,
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 0,
      itemOutcomes: {
        [`reference-document-${tombstone.recordId}`]: 'superseded',
      },
    });
    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
    expect(JSON.parse(mockStorage.get(TOMBSTONE_KEY) || '[]')).toEqual([
      tombstone,
    ]);
  });

  it('keeps unmatched operational work queued when cloud deletion history cannot be verified', async () => {
    mockCloudTombstonesResult = {
      ok: false,
      configured: true,
      stubbed: false,
      error: 'Cloud deletion history unavailable.',
    };
    await enqueuePendingChange(scheduleQueueItem('task-wait-for-authority'));

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 1,
      itemOutcomes: {
        'schedule-item-task-wait-for-authority': 'failed',
      },
      errors: [expect.stringMatching(/could not sync/i)],
    });

    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'schedule-item-task-wait-for-authority',
        retryCount: 1,
      }),
    ]);
  });

  it('attempts a queued cloud delete and preserves it for retry when the request fails', async () => {
    mockDeleteProjectUpdate.mockResolvedValueOnce({
      ok: false,
      configured: true,
      stubbed: false,
      error: 'Network request failed',
    });
    await enqueuePendingChange({
      id: 'project-update-delete-retry',
      entity: 'project_update',
      operation: 'delete',
      payload: {
        id: 'delete-retry',
        projectName: '2375 Compliance Project',
      },
      changedAt: '2026-07-22T08:00:00.000Z',
      autoUpload: false,
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 1,
      itemOutcomes: {
        'project-update-delete-retry': 'failed',
      },
    });
    expect(mockDeleteProjectUpdate).toHaveBeenCalledTimes(1);
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'project-update-delete-retry',
        operation: 'delete',
        retryCount: 1,
      }),
    ]);
  });

  it('retries only journal confirmation after the destructive cloud delete succeeds', async () => {
    mockConfirmProjectUpdateCloudDeletion
      .mockRejectedValueOnce(new Error('journal storage unavailable'))
      .mockResolvedValueOnce(undefined);
    await enqueuePendingChange({
      id: 'project-update-delete-once',
      entity: 'project_update',
      operation: 'delete',
      payload: {
        id: 'delete-once',
        projectName: '2375 Compliance Project',
      },
      changedAt: '2026-07-22T08:00:00.000Z',
      autoUpload: false,
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 1,
      itemOutcomes: {
        'project-update-delete-once': 'failed',
      },
    });
    expect(mockDeleteProjectUpdate).toHaveBeenCalledTimes(1);
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'project-update-delete-once',
        payload: expect.objectContaining({
          id: 'delete-once',
          cloudDeleteSucceededAt: expect.any(String),
        }),
      }),
    ]);

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      itemOutcomes: {
        'project-update-delete-once': 'uploaded',
      },
    });
    expect(mockDeleteProjectUpdate).toHaveBeenCalledTimes(1);
    expect(mockConfirmProjectUpdateCloudDeletion).toHaveBeenCalledTimes(2);
    expect(mockStorage.get(QUEUE_KEY)).toBe('[]');
  });
});
