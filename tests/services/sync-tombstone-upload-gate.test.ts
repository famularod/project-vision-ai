import type { ReferenceDocument, ScheduleItem } from '../../types';
import { emptyProjectControls } from '../../services/VitruviusProjectControls';

const mockStorage = new Map<string, string>();
const mockQueueWrites: string[][] = [];
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
const mockUpsertScheduleItem = jest.fn(
  (..._args: unknown[]): Promise<{
    ok: boolean;
    configured: boolean;
    stubbed: boolean;
    error?: string;
  }> => Promise.resolve({ ok: true, configured: true, stubbed: false }),
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
const mockPrepareReferenceDocumentForCloud = jest.fn(
  (document: ReferenceDocument) => Promise.resolve(document),
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
      if (key === 'projectVisionAI.syncQueue.v1') {
        const parsed = JSON.parse(value) as Array<{ id: string }>;
        mockQueueWrites.push(parsed.map(item => item.id));
      }
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

jest.mock('../../services/ReferenceDocumentRepository', () => ({
  prepareReferenceDocumentForCloud: (document: ReferenceDocument) =>
    mockPrepareReferenceDocumentForCloud(document),
}));

import {
  enqueuePendingChange,
  getOfflineQueue,
  getSyncConflicts,
  queueScheduleItemRecord,
  resolveScheduleItemSyncConflict,
  runScheduleImportCloudSync,
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
  mockQueueWrites.length = 0;
  mockCloudTombstonesResult = {
    ok: true,
    configured: true,
    stubbed: false,
    data: [],
  };
  mockListDAVESyncTombstones.mockClear();
  mockUpsertDAVESyncTombstone.mockClear();
  mockListScheduleItems.mockClear();
  mockUpsertScheduleItem.mockReset();
  mockUpsertScheduleItem.mockResolvedValue({
    ok: true,
    configured: true,
    stubbed: false,
  });
  mockListReferenceDocuments.mockClear();
  mockUpsertReferenceDocument.mockReset();
  mockUpsertReferenceDocument.mockResolvedValue({
    ok: true,
    configured: true,
    stubbed: false,
  });
  mockPrepareReferenceDocumentForCloud.mockReset();
  mockPrepareReferenceDocumentForCloud.mockImplementation(
    (document: ReferenceDocument) => Promise.resolve(document),
  );
  mockDeleteProjectUpdate.mockReset();
  mockDeleteProjectUpdate.mockResolvedValue({
    ok: true,
    configured: true,
    stubbed: false,
  });
  mockConfirmProjectUpdateCloudDeletion.mockReset();
  mockConfirmProjectUpdateCloudDeletion.mockResolvedValue(undefined);
});

describe('offline upload deletion barriers', () => {
  it('does not re-upload the full deletion journal before a routine task save', async () => {
    const tombstones = Array.from({ length: 500 }, (_value, index) => ({
      entityType: 'schedule_item' as const,
      recordId: `historically-deleted-task-${index}`,
      deletedAt: `2026-07-20T08:${String(index % 60).padStart(2, '0')}:00.000Z`,
    }));
    mockStorage.set(TOMBSTONE_KEY, JSON.stringify(tombstones));
    mockCloudTombstonesResult = {
      ok: true,
      configured: true,
      stubbed: false,
      data: tombstones,
    };
    await enqueuePendingChange(scheduleQueueItem('current-task-save'));

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      itemOutcomes: {
        'schedule-item-current-task-save': 'uploaded',
      },
    });

    expect(mockListDAVESyncTombstones).toHaveBeenCalledTimes(1);
    expect(mockUpsertDAVESyncTombstone).not.toHaveBeenCalled();
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
  });

  it('uploads the newest task first and reads task authority once for the batch', async () => {
    const olderTask: ScheduleItem = {
      id: 'task-batch-older',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: 'North Lot',
      taskName: 'Older queued task',
      startDate: '',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 10,
      priority: 'Medium',
      status: 'In Progress',
      notes: '',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-27T10:00:00.000Z',
      updatedAt: '2026-07-27T10:01:00.000Z',
    };
    const newestTask: ScheduleItem = {
      ...olderTask,
      id: 'task-batch-newest',
      taskName: 'Newest queued task',
      percentComplete: 15,
      updatedAt: '2026-07-27T10:02:00.000Z',
    };

    await queueScheduleItemRecord(olderTask, false, [
      'percentComplete',
      'status',
      'updatedAt',
    ]);
    await queueScheduleItemRecord(newestTask, false, [
      'percentComplete',
      'status',
      'updatedAt',
    ]);

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 2,
      queued: 0,
      errors: [],
    });

    expect(mockListScheduleItems).toHaveBeenCalledTimes(1);
    expect(
      mockUpsertScheduleItem.mock.calls.map(([item]) => (item as ScheduleItem).id),
    ).toEqual([newestTask.id, olderTask.id]);
  });

  it('confirms a task save without waiting for unrelated field-update retries', async () => {
    mockDeleteProjectUpdate.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    await enqueuePendingChange({
      id: 'project-update-unrelated-retry',
      entity: 'project_update',
      operation: 'delete',
      payload: {
        id: 'unrelated-update',
        projectName: '2321 Compliance Project',
      },
      changedAt: '2026-07-20T08:00:00.000Z',
      autoUpload: false,
    });
    await enqueuePendingChange(scheduleQueueItem('current-task-save'));

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 1,
      itemOutcomes: {
        'schedule-item-current-task-save': 'uploaded',
      },
    });

    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteProjectUpdate).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'project-update-unrelated-retry',
      }),
    ]);
  });

  it('does not let a permanently failing task starve a waiting document', async () => {
    const document: ReferenceDocument = {
      id: 'document-waiting-behind-task',
      name: 'Field drawing',
      originalFileName: 'field-drawing.pdf',
      uri: '',
      mimeType: 'application/pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: false,
      importedAt: '2026-07-30T08:00:00.000Z',
      updatedAt: '2026-07-30T08:00:00.000Z',
      storagePath: 'mobile/document-waiting-behind-task/field-drawing.pdf',
    };
    mockUpsertScheduleItem.mockResolvedValue({
      ok: false,
      configured: true,
      stubbed: false,
      error: 'The task revision was rejected.',
    });
    await enqueuePendingChange({
      ...scheduleQueueItem('permanent-task-failure'),
      autoUpload: false,
    });
    await enqueuePendingChange({
      id: `reference-document-${document.id}`,
      entity: 'reference_document',
      operation: 'update',
      payload: {
        id: document.id,
        documentData: document,
      },
      changedAt: document.updatedAt ?? document.importedAt,
      autoUpload: false,
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 2,
      itemOutcomes: {
        'schedule-item-permanent-task-failure': 'failed',
      },
    });
    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 1,
      uploadedByEntity: {
        reference_document: 1,
      },
      itemOutcomes: {
        'schedule-item-permanent-task-failure': 'failed',
        'reference-document-document-waiting-behind-task': 'uploaded',
      },
    });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: document.id }),
    );
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'schedule-item-permanent-task-failure',
        retryCount: 2,
      }),
    ]);
  });

  it('awaits the exact imported task and document records until both are synced', async () => {
    const task: ScheduleItem = {
      id: 'schedule-import-task-1',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      taskName: 'Place asphalt',
      locationName: '2321 North Lot',
      startDate: '2026-07-27',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: '',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
    };
    const document: ReferenceDocument = {
      id: 'schedule-import-document-1',
      name: 'Current schedule',
      originalFileName: 'schedule.pdf',
      uri: '',
      mimeType: 'application/pdf',
      category: 'Schedules',
      notes: '',
      isCurrent: true,
      importedAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
      storagePath: 'mobile/schedule-import-document-1/schedule.pdf',
    };

    await expect(runScheduleImportCloudSync({
      scheduleItems: [task],
      referenceDocuments: [document],
    })).resolves.toMatchObject({
      configured: true,
      durablyQueued: true,
      fullySynced: true,
      uploaded: 2,
      uploadedByEntity: {
        schedule_item: 1,
        reference_document: 1,
      },
      queued: 0,
      conflicts: 0,
      errors: [],
      itemOutcomes: {
        'schedule-item-schedule-import-task-1': 'uploaded',
        'reference-document-schedule-import-document-1': 'uploaded',
      },
      supersededScheduleItemIds: [],
      supersededReferenceDocumentIds: [],
    });
    expect(mockQueueWrites.find(ids => ids.length > 0)?.sort()).toEqual([
      'reference-document-schedule-import-document-1',
      'schedule-item-schedule-import-task-1',
    ]);
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id }),
    );
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: document.id,
        storagePath: document.storagePath,
      }),
    );
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('prepares local document bytes before uploading document metadata', async () => {
    const document: ReferenceDocument = {
      id: 'schedule-import-document-local',
      name: 'Local schedule',
      originalFileName: 'local-schedule.pdf',
      uri: 'file:///owned/project-documents/local-schedule.pdf',
      mimeType: 'application/pdf',
      category: 'Schedules',
      notes: '',
      isCurrent: true,
      importedAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
      storagePath: null,
    };
    mockPrepareReferenceDocumentForCloud.mockResolvedValueOnce({
      ...document,
      storagePath: 'mobile/schedule-import-document-local/local-schedule.pdf',
      contentSha256: 'a'.repeat(64),
      sizeBytes: 1024,
    });

    const result = await runScheduleImportCloudSync({
      scheduleItems: [],
      referenceDocuments: [document],
    });

    expect(result).toMatchObject({
      durablyQueued: true,
      fullySynced: true,
      uploaded: 1,
      queued: 0,
      conflicts: 0,
      errors: [],
      uploadedReferenceDocuments: [
        expect.objectContaining({
          id: document.id,
          storagePath:
            'mobile/schedule-import-document-local/local-schedule.pdf',
          contentSha256: 'a'.repeat(64),
          sizeBytes: 1024,
        }),
      ],
    });
    expect(mockPrepareReferenceDocumentForCloud).toHaveBeenCalledWith(document);
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath:
          'mobile/schedule-import-document-local/local-schedule.pdf',
        contentSha256: 'a'.repeat(64),
        sizeBytes: 1024,
      }),
    );
  });

  it('uploads an intentional metadata-only document without inventing a file failure', async () => {
    const document: ReferenceDocument = {
      id: 'schedule-import-document-metadata-only',
      name: 'Schedule import record',
      originalFileName: 'schedule.pdf',
      uri: '',
      mimeType: 'application/pdf',
      category: 'Schedules',
      notes: 'Metadata retained after the source was reviewed elsewhere.',
      isCurrent: true,
      importedAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
      storagePath: null,
    };

    await expect(runScheduleImportCloudSync({
      scheduleItems: [],
      referenceDocuments: [document],
    })).resolves.toMatchObject({
      durablyQueued: true,
      fullySynced: true,
      uploaded: 1,
      queued: 0,
      conflicts: 0,
      errors: [],
    });
    expect(mockPrepareReferenceDocumentForCloud).not.toHaveBeenCalled();
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(document);
  });

  it('keeps document metadata queued when protected file upload is incomplete', async () => {
    const document: ReferenceDocument = {
      id: 'schedule-import-document-waiting',
      name: 'Waiting schedule',
      originalFileName: 'waiting-schedule.pdf',
      uri: 'file:///owned/project-documents/waiting-schedule.pdf',
      mimeType: 'application/pdf',
      category: 'Schedules',
      notes: '',
      isCurrent: true,
      importedAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
      storagePath: null,
    };

    await expect(runScheduleImportCloudSync({
      scheduleItems: [],
      referenceDocuments: [document],
    })).resolves.toMatchObject({
      configured: true,
      durablyQueued: true,
      fullySynced: false,
      uploaded: 0,
      queued: 1,
      conflicts: 0,
      errors: [expect.stringMatching(/could not sync|service attention/i)],
      itemOutcomes: {
        'reference-document-schedule-import-document-waiting': 'failed',
      },
    });
    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'reference-document-schedule-import-document-waiting',
        retryCount: 1,
      }),
    ]);
  });

  it('does not resurrect imported records protected by deletion history', async () => {
    const task: ScheduleItem = {
      id: 'schedule-import-task-deleted',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      taskName: 'Deleted schedule task',
      locationName: '2321 North Lot',
      startDate: '2026-07-27',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: '',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
    };
    const tombstone = {
      entityType: 'schedule_item' as const,
      recordId: task.id,
      deletedAt: '2026-07-26T10:05:00.000Z',
    };
    mockStorage.set(TOMBSTONE_KEY, JSON.stringify([tombstone]));
    mockCloudTombstonesResult = {
      ok: true,
      configured: true,
      stubbed: false,
      data: [tombstone],
    };

    await expect(runScheduleImportCloudSync({
      scheduleItems: [task],
      referenceDocuments: [],
    })).resolves.toMatchObject({
      durablyQueued: true,
      fullySynced: false,
      uploaded: 0,
      queued: 0,
      conflicts: 0,
      itemOutcomes: {
        'schedule-item-schedule-import-task-deleted': 'superseded',
      },
      supersededScheduleItemIds: [task.id],
      supersededReferenceDocumentIds: [],
      errors: [expect.stringMatching(/protected deletion marker/i)],
    });
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('reports a deletion marker that arrives after schedule import staging', async () => {
    const task: ScheduleItem = {
      id: 'schedule-import-task-deleted-during-upload',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      taskName: 'Deleted while the approved import was uploading',
      locationName: '2321 North Lot',
      startDate: '2026-07-27',
      finishDate: '2026-07-31',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: '',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
    };
    const tombstone = {
      entityType: 'schedule_item' as const,
      recordId: task.id,
      deletedAt: '2026-07-26T10:05:00.000Z',
    };
    mockListDAVESyncTombstones
      .mockResolvedValueOnce({
        ok: true,
        configured: true,
        stubbed: false,
        data: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        configured: true,
        stubbed: false,
        data: [tombstone],
      });

    await expect(runScheduleImportCloudSync({
      scheduleItems: [task],
      referenceDocuments: [],
    })).resolves.toMatchObject({
      durablyQueued: true,
      fullySynced: false,
      uploaded: 0,
      queued: 0,
      conflicts: 0,
      itemOutcomes: {
        'schedule-item-schedule-import-task-deleted-during-upload':
          'superseded',
      },
      supersededScheduleItemIds: [task.id],
      supersededReferenceDocumentIds: [],
      errors: [expect.stringMatching(/protected deletion marker/i)],
    });
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

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

  it('coalesces offline project-control edits and merges independent cloud edits field by field', async () => {
    const task: ScheduleItem = {
      id: 'task-controls-concurrent-merge',
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
      notes: '',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:00:00.000Z',
      projectControls: emptyProjectControls(),
    };
    const phoneAssigneeEdit: ScheduleItem = {
      ...task,
      updatedAt: '2026-07-26T22:01:00.000Z',
      projectControls: {
        ...emptyProjectControls(),
        assignee: 'David',
        revision: 1,
        updatedAt: '2026-07-26T22:01:00.000Z',
        updatedBy: 'David on iPhone',
        fieldRevisions: {
          assignee: {
            revision: 1,
            updatedAt: '2026-07-26T22:01:00.000Z',
            updatedBy: 'David on iPhone',
          },
        },
      },
    };
    const staleTabletApprovalEdit: ScheduleItem = {
      ...task,
      updatedAt: '2026-07-26T22:02:00.000Z',
      projectControls: {
        ...emptyProjectControls(),
        approvalStatus: 'Pending',
        revision: 1,
        updatedAt: '2026-07-26T22:02:00.000Z',
        updatedBy: 'David on iPad',
        fieldRevisions: {
          approvalStatus: {
            revision: 1,
            updatedAt: '2026-07-26T22:02:00.000Z',
            updatedBy: 'David on iPad',
          },
        },
      },
    };
    const cloudTradeEdit: ScheduleItem = {
      ...task,
      updatedAt: '2026-07-26T22:03:00.000Z',
      projectControls: {
        ...emptyProjectControls(),
        trade: 'Paving',
        revision: 1,
        updatedAt: '2026-07-26T22:03:00.000Z',
        updatedBy: 'David on desktop',
        fieldRevisions: {
          trade: {
            revision: 1,
            updatedAt: '2026-07-26T22:03:00.000Z',
            updatedBy: 'David on desktop',
          },
        },
      },
    };

    await queueScheduleItemRecord(
      phoneAssigneeEdit,
      false,
      ['projectControls', 'updatedAt'],
    );
    await queueScheduleItemRecord(
      staleTabletApprovalEdit,
      false,
      ['projectControls', 'updatedAt'],
    );
    mockListScheduleItems.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [cloudTradeEdit],
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      configured: true,
      uploaded: 1,
      queued: 0,
      conflicts: 0,
    });
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        projectControls: expect.objectContaining({
          assignee: 'David',
          approvalStatus: 'Pending',
          trade: 'Paving',
          fieldRevisions: expect.objectContaining({
            assignee: expect.any(Object),
            approvalStatus: expect.any(Object),
            trade: expect.any(Object),
          }),
        }),
      }),
    );
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('uses the later field stamp despite a lower device revision while preserving another local control edit', async () => {
    const baseTask: ScheduleItem = {
      id: 'task-controls-same-field-race',
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
      notes: '',
      nextAction: '',
      activity: [],
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:00:00.000Z',
    };
    const localTask: ScheduleItem = {
      ...baseTask,
      updatedAt: '2026-07-26T22:02:00.000Z',
      projectControls: {
        ...emptyProjectControls(),
        assignee: 'Phone owner',
        estimatedCostImpact: 5000,
        revision: 8,
        updatedAt: '2026-07-26T22:02:00.000Z',
        updatedBy: 'David on iPhone',
        fieldRevisions: {
          assignee: {
            revision: 8,
            updatedAt: '2026-07-26T22:01:00.000Z',
            updatedBy: 'David on iPhone',
          },
          estimatedCostImpact: {
            revision: 2,
            updatedAt: '2026-07-26T22:02:00.000Z',
            updatedBy: 'David on iPhone',
          },
        },
      },
    };
    const remoteTask: ScheduleItem = {
      ...baseTask,
      updatedAt: '2026-07-26T22:03:00.000Z',
      projectControls: {
        ...emptyProjectControls(),
        assignee: 'Later desktop owner',
        revision: 1,
        updatedAt: '2026-07-26T22:03:00.000Z',
        updatedBy: 'David on desktop',
        fieldRevisions: {
          assignee: {
            revision: 1,
            updatedAt: '2026-07-26T22:03:00.000Z',
            updatedBy: 'David on desktop',
          },
        },
      },
    };
    mockListScheduleItems.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [remoteTask],
    });

    await expect(
      runScheduleItemCloudSync(localTask, ['projectControls', 'updatedAt']),
    ).resolves.toMatchObject({
      configured: true,
      uploaded: 1,
      queued: 0,
      conflicts: 0,
    });
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        projectControls: expect.objectContaining({
          assignee: 'Later desktop owner',
          estimatedCostImpact: 5000,
          revision: 8,
          fieldRevisions: expect.objectContaining({
            assignee: {
              revision: 1,
              updatedAt: '2026-07-26T22:03:00.000Z',
              updatedBy: 'David on desktop',
            },
          }),
        }),
      }),
    );
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
