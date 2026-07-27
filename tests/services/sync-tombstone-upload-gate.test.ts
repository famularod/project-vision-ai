import type { ScheduleItem } from '../../types';

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
const mockListScheduleItems = jest.fn((..._args: unknown[]): Promise<{
  ok: boolean;
  configured: boolean;
  stubbed: boolean;
  data: ScheduleItem[];
}> =>
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
  getSyncConflicts,
  queueScheduleItemRecord,
  resolveScheduleItemSyncConflict,
  runScheduleItemCloudSync,
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

  it('preserves an edited task note after a handled failure and uploads it on retry without restarting', async () => {
    const updatedAt = '2026-07-26T22:47:59.197Z';
    const task: ScheduleItem = {
      id: 'task-note-live-sync',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Build 114 task note sync test',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt,
    };
    mockUpsertScheduleItem.mockResolvedValueOnce({
      ok: false,
      configured: true,
      stubbed: false,
    });

    await expect(runScheduleItemCloudSync(task)).resolves.toMatchObject({
      configured: true,
      uploaded: 0,
      queued: 1,
      conflicts: 0,
      errors: [expect.stringMatching(/could not sync/i)],
      itemOutcomes: {
        'schedule-item-task-note-live-sync': 'failed',
      },
    });

    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'schedule-item-task-note-live-sync',
        retryCount: 1,
        payload: expect.objectContaining({
          itemData: expect.objectContaining({
            id: task.id,
            notes: task.notes,
            updatedAt,
          }),
        }),
      }),
    ]);

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      configured: true,
      uploaded: 1,
      uploadedByEntity: { schedule_item: 1 },
      queued: 0,
      itemOutcomes: {
        'schedule-item-task-note-live-sync': 'uploaded',
      },
      errors: [],
    });

    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(2);
    expect(mockUpsertScheduleItem).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: task.id,
        notes: task.notes,
        updatedAt,
      }),
    );
    await expect(getOfflineQueue()).resolves.toEqual([]);
    expect(mockStorage.get(QUEUE_KEY)).toBe('[]');
  });

  it('merges an explicitly edited task note into a newer cloud task without overwriting unrelated fields', async () => {
    const localTask: ScheduleItem = {
      id: 'task-note-merge',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Asphalt placement moved to Monday morning.',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };
    const newerCloudTask: ScheduleItem = {
      ...localTask,
      percentComplete: 50,
      status: 'In Progress',
      notes: '',
      updatedAt: '2026-07-26T22:48:30.000Z',
    };
    mockListScheduleItems.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [newerCloudTask],
    });

    await expect(
      runScheduleItemCloudSync(localTask, ['notes', 'updatedAt']),
    ).resolves.toMatchObject({
      configured: true,
      uploaded: 1,
      queued: 0,
      conflicts: 0,
      errors: [],
    });

    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: localTask.id,
        notes: localTask.notes,
        status: newerCloudTask.status,
        percentComplete: newerCloudTask.percentComplete,
        updatedAt: expect.any(String),
      }),
    );
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('retains every unsynced task field while successive edits replace the same durable queue row', async () => {
    const task: ScheduleItem = {
      id: 'task-field-scope',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Monday morning.',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };

    await queueScheduleItemRecord(task, false, ['notes', 'updatedAt']);
    await queueScheduleItemRecord(
      {
        ...task,
        owner: 'David',
        updatedAt: '2026-07-26T22:48:00.000Z',
      },
      false,
      ['owner', 'updatedAt'],
    );

    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'schedule-item-task-field-scope',
        payload: expect.objectContaining({
          itemData: expect.objectContaining({
            notes: task.notes,
            owner: 'David',
          }),
          changedFields: expect.arrayContaining(['notes', 'owner', 'updatedAt']),
        }),
      }),
    ]);
  });

  it('records a full-task remote-wins conflict instead of falsely reporting the local revision as uploaded', async () => {
    const localTask: ScheduleItem = {
      id: 'task-full-conflict',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Local note that must not be silently discarded.',
      nextAction: '',
      activity: [],
      importedFrom: 'schedule.pdf',
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };
    const newerCloudTask: ScheduleItem = {
      ...localTask,
      percentComplete: 100,
      progressSource: 'project_manager',
      progressConfirmedAt: '2026-07-26T22:48:30.000Z',
      status: 'Complete',
      notes: '',
      updatedAt: '2026-07-26T22:48:30.000Z',
    };
    mockListScheduleItems.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [newerCloudTask],
    });

    await expect(runScheduleItemCloudSync(localTask)).resolves.toMatchObject({
      configured: true,
      uploaded: 0,
      queued: 0,
      conflicts: 1,
      itemOutcomes: {
        'schedule-item-task-full-conflict': 'conflict',
      },
    });

    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getSyncConflicts()).resolves.toEqual([
      expect.objectContaining({
        entity: 'schedule_item',
        localId: localTask.id,
        localPayload: expect.objectContaining({
          itemData: expect.objectContaining({
            notes: localTask.notes,
          }),
        }),
        remotePayload: expect.objectContaining({
          status: newerCloudTask.status,
        }),
      }),
    ]);
  });

  it('lets the project manager resolve a task conflict by keeping the phone copy', async () => {
    const localTask: ScheduleItem = {
      id: 'task-resolve-local',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Keep this phone note.',
      nextAction: '',
      activity: [],
      importedFrom: 'schedule.pdf',
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };
    const newerCloudTask: ScheduleItem = {
      ...localTask,
      percentComplete: 100,
      status: 'Complete',
      notes: '',
      updatedAt: '2026-07-26T22:48:30.000Z',
    };
    mockListScheduleItems
      .mockResolvedValueOnce({
        ok: true,
        configured: true,
        stubbed: false,
        data: [newerCloudTask],
      })
      .mockResolvedValueOnce({
        ok: true,
        configured: true,
        stubbed: false,
        data: [newerCloudTask],
      });

    await runScheduleItemCloudSync(localTask);
    const [conflict] = await getSyncConflicts();

    await expect(
      resolveScheduleItemSyncConflict(conflict.id, 'keep_local'),
    ).resolves.toEqual(localTask);
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: localTask.id,
        notes: localTask.notes,
        status: localTask.status,
      }),
    );
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('removes newer queued phone edits when the project manager keeps the cloud task copy', async () => {
    const localTask: ScheduleItem = {
      id: 'task-resolve-cloud',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Conflict-era phone note.',
      nextAction: '',
      activity: [],
      importedFrom: 'schedule.pdf',
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };
    const cloudTask: ScheduleItem = {
      ...localTask,
      percentComplete: 100,
      status: 'Complete',
      notes: 'Authoritative cloud note.',
      updatedAt: '2026-07-26T22:48:30.000Z',
    };
    mockListScheduleItems.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [cloudTask],
    });

    await runScheduleItemCloudSync(localTask);
    const [conflict] = await getSyncConflicts();
    await queueScheduleItemRecord(
      {
        ...localTask,
        notes: 'A newer phone edit that must be discarded.',
        updatedAt: '2026-07-26T22:49:00.000Z',
      },
      false,
      ['notes', 'updatedAt'],
    );

    await expect(
      resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'),
    ).resolves.toEqual(cloudTask);
    await expect(getOfflineQueue()).resolves.toEqual([]);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    expect(mockUpsertScheduleItem).toHaveBeenLastCalledWith(cloudTask);
  });

  it('clears a stale task conflict instead of restoring a deleted task', async () => {
    const localTask: ScheduleItem = {
      id: 'task-deleted-after-conflict',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'A local note.',
      nextAction: '',
      activity: [],
      importedFrom: 'schedule.pdf',
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };
    const newerCloudTask: ScheduleItem = {
      ...localTask,
      status: 'Complete',
      percentComplete: 100,
      notes: '',
      updatedAt: '2026-07-26T22:48:30.000Z',
    };
    mockListScheduleItems.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [newerCloudTask],
    });

    await runScheduleItemCloudSync(localTask);
    const [conflict] = await getSyncConflicts();
    mockStorage.set(TOMBSTONE_KEY, JSON.stringify([{
      entityType: 'schedule_item',
      recordId: localTask.id,
      deletedAt: '2026-07-26T22:49:00.000Z',
    }]));

    await expect(
      resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'),
    ).rejects.toThrow('sync_conflict_record_deleted');
    await expect(getSyncConflicts()).resolves.toEqual([]);
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
  });

  it('does not resolve a task conflict when cross-device deletion history cannot be verified', async () => {
    const localTask: ScheduleItem = {
      id: 'task-conflict-with-unavailable-deletions',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Local note.',
      nextAction: '',
      activity: [],
      importedFrom: 'schedule.pdf',
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };
    const newerCloudTask: ScheduleItem = {
      ...localTask,
      status: 'Complete',
      percentComplete: 100,
      notes: '',
      updatedAt: '2026-07-26T22:48:30.000Z',
    };
    mockListScheduleItems.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [newerCloudTask],
    });

    await runScheduleItemCloudSync(localTask);
    const [conflict] = await getSyncConflicts();
    mockCloudTombstonesResult = {
      ok: false,
      configured: true,
      stubbed: false,
      error: 'Deletion history unavailable.',
    };

    await expect(
      resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'),
    ).rejects.toThrow('sync_conflict_deletion_history_unavailable');
    await expect(getSyncConflicts()).resolves.toHaveLength(1);
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
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
