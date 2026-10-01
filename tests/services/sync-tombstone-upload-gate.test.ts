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
const mockListProjects = jest.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    configured: true,
    stubbed: false,
    data: [
      {
        id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
        name: '2321 Compliance Project',
      },
      {
        id: '72e941d8-8114-4082-a976-ae5b2b5daba9',
        name: '2375 Compliance Project',
      },
    ],
  }),
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
const mockGetProjectUpdateSyncMetadata = jest.fn((id: string) =>
  Promise.resolve({
    ok: true,
    configured: true,
    stubbed: false,
    data: {
      id,
      projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
      updatedAt: '2026-08-15T08:00:00.000Z',
      projectName: '2375 Compliance Project',
      areaName: 'Canopy A',
      updateData: { id, note: `Cloud receipt ${id}` },
    } as {
      id: string;
      projectId: string;
      updatedAt: string;
      projectName: string;
      areaName: string;
      updateData: { id: string; note: string };
    } | null,
  }),
);
const mockListArchivedProjects = jest.fn((..._args: unknown[]): Promise<{
  ok: boolean; configured: boolean; stubbed: boolean; data?: Array<{ id: string; name: string }>; error?: string;
}> => Promise.resolve({ ok: true, configured: true, stubbed: false, data: [] }));
const mockSaveProjectUpdate = jest.fn((..._args: unknown[]) =>
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
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  // A field update whose project is not active is looked up among closed
  // projects (audit A7 M2); none are closed unless a test says so.
  listArchivedProjects: (...args: unknown[]) => mockListArchivedProjects(...args),
  listDAVESyncTombstones: (...args: unknown[]) =>
    mockListDAVESyncTombstones(...args),
  upsertDAVESyncTombstone: (...args: unknown[]) =>
    mockUpsertDAVESyncTombstone(...args),
  upsertDAVESyncTombstones: (tombstones: unknown[]) =>
    Promise.resolve({ ok: true, configured: true, stubbed: false, data: tombstones }),
  listScheduleItems: (...args: unknown[]) => mockListScheduleItems(...args),
  // A conflict choice reads the task's row by its id (whole-app audit A7
  // pass 15 L-2), here the row the cloud list gives: each read takes the
  // list's next answer, as the list read it replaced did.
  getScheduleItem: async (id: string) => {
    const cloud = await mockListScheduleItems();
    return cloud.ok ? { ...cloud, data: cloud.data.find(item => item.id === id) ?? null } : cloud;
  },
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
  getProjectUpdateSyncMetadata: (id: string) =>
    mockGetProjectUpdateSyncMetadata(id),
  saveProjectUpdate: (...args: unknown[]) => mockSaveProjectUpdate(...args),
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueuePendingChange,
  getOfflineQueue,
  getSyncConflicts,
  projectUpdateUploadedSince,
  queueScheduleItemRecord,
  resolveProjectUpdateSyncConflict,
  resolveScheduleItemSyncConflict,
  runScheduleImportCloudSync,
  runScheduleItemCloudSync,
  uploadPendingChanges,
} from '../../services/SyncService';

const QUEUE_KEY = 'projectVisionAI.syncQueue.v1';
const TOMBSTONE_KEY = '@dave/sync-tombstones/v1';
const DELETED_PROJECTS_KEY = 'projectPhotoUpdate.deletedProjects.v1';

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
  (AsyncStorage.getItem as jest.Mock).mockClear();
  mockCloudTombstonesResult = {
    ok: true,
    configured: true,
    stubbed: false,
    data: [],
  };
  mockListDAVESyncTombstones.mockClear();
  mockListProjects.mockClear();
  mockListArchivedProjects.mockReset();
  mockListArchivedProjects.mockResolvedValue({ ok: true, configured: true, stubbed: false, data: [] });
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
  mockGetProjectUpdateSyncMetadata.mockReset();
  mockGetProjectUpdateSyncMetadata.mockImplementation((id: string) =>
    Promise.resolve({
      ok: true,
      configured: true,
      stubbed: false,
      data: {
        id,
        projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
        updatedAt: '2026-08-15T08:00:00.000Z',
        projectName: '2375 Compliance Project',
        areaName: 'Canopy A',
        updateData: { id, note: `Cloud receipt ${id}` },
      },
    }),
  );
  mockSaveProjectUpdate.mockReset();
  mockSaveProjectUpdate.mockResolvedValue({
    ok: true,
    configured: true,
    stubbed: false,
  });
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
    expect(mockListProjects).toHaveBeenCalledTimes(1);
    expect(mockUpsertDAVESyncTombstone).not.toHaveBeenCalled();
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
      }),
    );
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

    // Pin changed on purpose (whole-app audit A7 pass 16 L-5): the task list
    // is still read once for the batch, but neither task is in it, so each
    // field edit's row is then read by its id before anything is written.
    // This file's mock answers a by-id read from the list, so it counts here:
    // 1 list read + 2 by-id reads.
    expect(mockListScheduleItems).toHaveBeenCalledTimes(3);
    expect(
      mockUpsertScheduleItem.mock.calls.map(([item]) => (item as ScheduleItem).id),
    ).toEqual([newestTask.id, olderTask.id]);
  });

  it('reads document authority once for multiple queued documents', async () => {
    const documents: ReferenceDocument[] = ['one', 'two'].map((suffix, index) => ({
      id: `document-batch-${suffix}`,
      name: `Drawing ${suffix}`,
      originalFileName: `drawing-${suffix}.pdf`,
      uri: '',
      mimeType: 'application/pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: false,
      importedAt: `2026-07-27T10:0${index}:00.000Z`,
      updatedAt: `2026-07-27T10:0${index}:00.000Z`,
      storagePath: `mobile/document-batch-${suffix}/drawing-${suffix}.pdf`,
    }));
    for (const document of documents) {
      await enqueuePendingChange({
        id: `reference-document-${document.id}`,
        entity: 'reference_document',
        operation: 'update',
        payload: { id: document.id, documentData: document },
        changedAt: document.updatedAt || document.importedAt,
        autoUpload: false,
      });
    }

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 2,
      queued: 0,
      errors: [],
    });
    expect(mockListReferenceDocuments).toHaveBeenCalledTimes(1);
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(2);
  });

  it('clears a large stale field-update queue from exact cloud receipts with bounded concurrency', async () => {
    let activeReads = 0;
    let maximumActiveReads = 0;
    mockGetProjectUpdateSyncMetadata.mockImplementation(async (id: string) => {
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeReads -= 1;
      return {
        ok: true,
        configured: true,
        stubbed: false,
        data: {
          id,
          projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
          updatedAt: '2026-08-15T08:00:00.000Z',
          projectName: '2375 Compliance Project',
          areaName: 'Canopy A',
          updateData: { id, note: `Cloud receipt ${id}` },
        },
      };
    });
    const queue = Array.from({ length: 24 }, (_value, index) => {
      const id = `already-cloud-synced-${index}`;
      return {
        id: `project-update-${id}`,
        entity: 'project_update' as const,
        operation: 'update' as const,
        payload: {
          id,
          projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
          projectName: '2375 Compliance Project',
          selectedAreaName: 'Canopy A',
          updateData: { id, note: `Cloud receipt ${id}` },
          pendingPhotoAssetIds: [],
        },
        createdAt: '2026-08-15T08:00:00.000Z',
        changedAt: '2026-08-15T08:00:00.000Z',
        retryCount: 0,
        lastError: null,
        autoUpload: false,
      };
    });
    mockStorage.set(QUEUE_KEY, JSON.stringify(queue));

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 24,
      queued: 0,
      conflicts: 0,
      errors: [],
    });
    expect(mockGetProjectUpdateSyncMetadata).toHaveBeenCalledTimes(24);
    expect(maximumActiveReads).toBe(8);
    expect(mockListDAVESyncTombstones).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('supersedes an id-less legacy field update only when its project is locally deleted and absent from cloud authority', async () => {
    mockStorage.set(DELETED_PROJECTS_KEY, JSON.stringify(['Fire Pump House']));
    mockGetProjectUpdateSyncMetadata.mockResolvedValue({
      ok: true,
      configured: true,
      stubbed: false,
      data: null,
    });
    const updateId = 'legacy-fire-pump-update';
    await enqueuePendingChange({
      id: `project-update-${updateId}`,
      entity: 'project_update',
      operation: 'update',
      payload: {
        id: updateId,
        projectId: null,
        projectName: 'Fire Pump House',
        selectedAreaName: 'Pump House',
        updateData: {
          id: updateId,
          projectName: 'Fire Pump House',
          notes: 'Preserved local field evidence.',
        },
        pendingPhotoAssetIds: [],
      },
      changedAt: '2026-08-15T21:06:08.482Z',
      autoUpload: false,
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 0,
      errors: [],
      itemOutcomes: {
        [`project-update-${updateId}`]: 'superseded',
      },
    });
    expect(mockSaveProjectUpdate).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('does not let a legacy deletion name suppress a recreated cloud project', async () => {
    mockStorage.set(DELETED_PROJECTS_KEY, JSON.stringify(['Fire Pump House']));
    mockListProjects.mockResolvedValueOnce({
      ok: true,
      configured: true,
      stubbed: false,
      data: [{
        id: '8a17078f-05bb-4ed3-9e07-39ce71d5989d',
        name: 'Fire Pump House',
      }],
    });
    mockGetProjectUpdateSyncMetadata.mockResolvedValue({
      ok: true,
      configured: true,
      stubbed: false,
      data: null,
    });
    const updateId = 'recreated-fire-pump-update';
    await enqueuePendingChange({
      id: `project-update-${updateId}`,
      entity: 'project_update',
      operation: 'update',
      payload: {
        id: updateId,
        projectId: null,
        projectName: 'Fire Pump House',
        updateData: {
          id: updateId,
          projectName: 'Fire Pump House',
          notes: 'Current project evidence.',
        },
        pendingPhotoAssetIds: [],
      },
      changedAt: '2026-08-15T21:10:00.000Z',
      autoUpload: false,
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      errors: [],
      itemOutcomes: {
        [`project-update-${updateId}`]: 'uploaded',
      },
    });
    expect(AsyncStorage.getItem).not.toHaveBeenCalledWith(
      DELETED_PROJECTS_KEY,
    );
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
    // A record the cloud does not have yet is inserted; one it has is
    // updated (whole-app audit A8 pass 1 F3, 30 Sep 2026).
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: document.id }),
      { existing: false },
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
      { existing: false }, // not in the cloud yet: inserted (A8 pass 1 F3)
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
      { existing: false }, // not in the cloud yet: inserted (A8 pass 1 F3)
    );
  });

  it('uploads the exact shared 2321 and 2375 schedule without inventing one primary project', async () => {
    const document: ReferenceDocument = {
      id: 'mrv3pyi1-9o6xn6mt',
      name: 'PLZ 2321 & 2375 MASTER CONSTRUCTION SCHEDULE UPDATE 3-WEEK LOOKAHEAD 7202026',
      originalFileName: 'PLZ-2321-2375-MASTER-CONSTRUCTION-SCHEDULE.pdf',
      uri: 'file:///owned/project-documents/shared-master-schedule.pdf',
      mimeType: 'application/pdf',
      category: 'Schedules',
      notes: 'Schedule uploaded for task extraction and project manager review.',
      isCurrent: true,
      importedAt: '2026-07-21T20:23:54.601Z',
      updatedAt: '2026-07-21T20:23:54.601Z',
      projectId: null,
      projectName: null,
      projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      storagePath: null,
    };
    mockPrepareReferenceDocumentForCloud.mockResolvedValueOnce({
      ...document,
      storagePath: 'mobile/mrv3pyi1-9o6xn6mt/shared-master-schedule.pdf',
      contentSha256: 'b'.repeat(64),
      sizeBytes: 160_768,
    });

    const result = await runScheduleImportCloudSync({
      scheduleItems: [],
      referenceDocuments: [document],
    });

    expect(result).toMatchObject({
      fullySynced: true,
      uploaded: 1,
      queued: 0,
      errors: [],
    });
    expect(mockPrepareReferenceDocumentForCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        id: document.id,
        projectId: null,
        projectName: null,
        projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      }),
    );
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: document.id,
        projectId: null,
        projectName: null,
        projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
        storagePath: 'mobile/mrv3pyi1-9o6xn6mt/shared-master-schedule.pdf',
      }),
      { existing: false }, // not in the cloud yet: inserted (A8 pass 1 F3)
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
    // Not in the cloud yet: inserted (whole-app audit A8 pass 1 F3).
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(document, { existing: false });
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
    // The sync that finds the conflict; Keep Phone's own read of the row
    // (A7 pass 15 L-3); its upload's.
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
    ).resolves.toEqual({
      ...localTask,
      projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    });
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

  // Whole-app audit A5 pass 3 F6 (30 Sep 2026): Keep Phone uploaded the phone's
  // copy verbatim, so a revision another device had re-homed the task into lost
  // it, and the task disappeared everywhere while that revision was current.
  describe('Keep Phone keeps the revisions another device re-homed the task into', () => {
    const phoneTask: ScheduleItem = {
      id: 'task-keep-phone-rehomed',
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
      importBatchId: 'batch-rev-1',
      createdAt: '2026-07-21T22:31:36.387Z',
      updatedAt: '2026-07-26T22:47:59.197Z',
    };
    const cloudList = (data: ScheduleItem[]) => ({ ok: true, configured: true, stubbed: false, data });

    async function conflictWithRehomedCloudCopy() {
      mockListScheduleItems.mockResolvedValueOnce(cloudList([{
        ...phoneTask,
        percentComplete: 100,
        status: 'Complete',
        notes: '',
        alsoImportedInBatchIds: ['batch-rev-2'],
        updatedAt: '2026-07-26T22:48:30.000Z',
      }]));
      await runScheduleItemCloudSync(phoneTask);
      const [conflict] = await getSyncConflicts();
      return conflict;
    }

    it('uploads the phone copy with every revision either copy names, and keeps it on the phone', async () => {
      const conflict = await conflictWithRehomedCloudCopy();
      // Meanwhile a third revision also took the task in. Keep Phone reads the
      // task's row first, then its upload reads the list (A7 pass 15 L-3).
      const current = cloudList([{
        ...(conflict.remotePayload as ScheduleItem),
        alsoImportedInBatchIds: ['batch-rev-2', 'batch-rev-3'],
      }]);
      mockListScheduleItems.mockResolvedValueOnce(current).mockResolvedValueOnce(current);

      // The phone keeps every revision the cloud's row names now (A7 pass 15
      // L-3): it kept only those of the copy saved with the conflict, ['batch-rev-2'].
      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_local')).resolves.toMatchObject({
        notes: phoneTask.notes,
        status: phoneTask.status,
        alsoImportedInBatchIds: ['batch-rev-2', 'batch-rev-3'],
      });
      expect(mockUpsertScheduleItem).toHaveBeenLastCalledWith(expect.objectContaining({
        notes: phoneTask.notes,
        status: phoneTask.status,
        importBatchId: 'batch-rev-1',
        alsoImportedInBatchIds: ['batch-rev-2', 'batch-rev-3'],
      }));
      await expect(getSyncConflicts()).resolves.toEqual([]);
      await expect(getOfflineQueue()).resolves.toEqual([]);
    });

    // Whole-app audit A5 pass 20 P3 (1 Oct 2026): a Microsoft Project
    // revision also records the row it gave the task (alsoImportedSourceRow),
    // which Keep Phone keeps from the copy that knows that import. Changed on
    // the cloud's row alone, it made Keep Phone ask David to review again.
    it('a revision that re-homed the task with its row number is no change of David\'s: Keep Phone goes ahead and keeps the row', async () => {
      const conflict = await conflictWithRehomedCloudCopy();
      const current = cloudList([{
        ...(conflict.remotePayload as ScheduleItem),
        alsoImportedInBatchIds: ['batch-rev-2', 'batch-rev-3'],
        alsoImportedSourceRow: { importBatchId: 'batch-rev-3', sourceRowNumber: 7 },
      }]);
      mockListScheduleItems.mockResolvedValueOnce(current).mockResolvedValueOnce(current);

      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_local')).resolves.toMatchObject({
        notes: phoneTask.notes,
        alsoImportedSourceRow: { importBatchId: 'batch-rev-3', sourceRowNumber: 7 },
      });
      expect(mockUpsertScheduleItem).toHaveBeenLastCalledWith(expect.objectContaining({
        notes: phoneTask.notes,
        alsoImportedSourceRow: { importBatchId: 'batch-rev-3', sourceRowNumber: 7 },
      }));
      await expect(getSyncConflicts()).resolves.toEqual([]);
    });

    it('settles without a new conflict when the cloud differs only by a newer revision', async () => {
      const conflict = await conflictWithRehomedCloudCopy();
      const phoneCopy = (conflict.localPayload as { itemData: ScheduleItem }).itemData;
      // Keep Phone's own read of the row, then its upload's (A7 pass 15 L-3).
      const current = cloudList([
        { ...phoneCopy, alsoImportedInBatchIds: ['batch-rev-2', 'batch-rev-3'] },
      ]);
      mockListScheduleItems.mockResolvedValueOnce(current).mockResolvedValueOnce(current);

      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_local')).resolves.toMatchObject({
        notes: phoneTask.notes,
      });
      expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
      await expect(getSyncConflicts()).resolves.toEqual([]);
      await expect(getOfflineQueue()).resolves.toEqual([]);
    });
  });

  // Whole-app audit A8 pass 10 L2 (1 Oct 2026): "Delete PDF + Items" on the
  // web (or on another phone) writes the removed row's id onto the row shown
  // (revisedFromTaskIds). Keep Phone on that row's conflict uploaded the
  // phone's copy, which lacked the id, so the field update linked to the
  // removed row became "Historical evidence — linked task was deleted." on
  // every device. Keep Phone keeps every earlier id either copy knows, as the
  // recovery merge does.
  describe('Keep Phone keeps the earlier task ids another device wrote', () => {
    const phoneTask: ScheduleItem = {
      id: 'task-keep-phone-earlier-ids',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'Pour slab',
      startDate: '2026-10-03',
      finishDate: '2026-10-07',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Keep this phone note.',
      nextAction: '',
      activity: [],
      importedFrom: 'master-n.csv',
      importBatchId: 'batch-n',
      revisedFromTaskIds: ['row-a'],
      createdAt: '2026-09-28T08:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
    };
    const cloudList = (data: ScheduleItem[]) => ({ ok: true, configured: true, stubbed: false, data });

    async function conflictWithWebDelete() {
      // The web deleted master M: its row X now answers to this task.
      mockListScheduleItems.mockResolvedValueOnce(cloudList([{
        ...phoneTask,
        notes: '',
        revisedFromTaskIds: ['row-x', 'row-a'],
        updatedAt: '2026-09-29T12:00:00.000Z',
      }]));
      await runScheduleItemCloudSync(phoneTask);
      const [conflict] = await getSyncConflicts();
      return conflict;
    }

    it('uploads the phone copy with every earlier id either copy names, and keeps them on the phone', async () => {
      const conflict = await conflictWithWebDelete();
      expect(conflict).toBeDefined();
      // Meanwhile another delete handed it one more. Keep Phone reads the
      // task's row first, then its upload reads the list (A7 pass 15 L-3).
      const current = cloudList([{
        ...(conflict.remotePayload as ScheduleItem),
        revisedFromTaskIds: ['row-w', 'row-x', 'row-a'],
      }]);
      mockListScheduleItems.mockResolvedValueOnce(current).mockResolvedValueOnce(current);

      const kept = await resolveScheduleItemSyncConflict(conflict.id, 'keep_local');
      expect(kept).toMatchObject({ notes: phoneTask.notes });
      // The phone answers to row W too (A7 pass 15 L-3): it kept only the ids
      // of the copy saved with the conflict, ['row-a', 'row-x'].
      expect([...(kept.revisedFromTaskIds || [])].sort()).toEqual(['row-a', 'row-w', 'row-x']);
      const uploaded = mockUpsertScheduleItem.mock.calls[mockUpsertScheduleItem.mock.calls.length - 1][0] as ScheduleItem;
      expect(uploaded).toMatchObject({ notes: phoneTask.notes, importBatchId: 'batch-n' });
      expect([...(uploaded.revisedFromTaskIds || [])].sort()).toEqual(['row-a', 'row-w', 'row-x']);
      await expect(getSyncConflicts()).resolves.toEqual([]);
      await expect(getOfflineQueue()).resolves.toEqual([]);
    });

    it('settles without a new conflict when the cloud differs only by an earlier id', async () => {
      const conflict = await conflictWithWebDelete();
      const phoneCopy = (conflict.localPayload as { itemData: ScheduleItem }).itemData;
      // Keep Phone's own read of the row, then its upload's (A7 pass 15 L-3).
      const current = cloudList([{ ...phoneCopy, revisedFromTaskIds: ['row-a', 'row-x'] }]);
      mockListScheduleItems.mockResolvedValueOnce(current).mockResolvedValueOnce(current);

      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_local')).resolves.toMatchObject({ notes: phoneTask.notes });
      expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
      await expect(getSyncConflicts()).resolves.toEqual([]);
      await expect(getOfflineQueue()).resolves.toEqual([]);
    });
  });

  // Whole-app audit A8 pass 12 L2 (1 Oct 2026): Keep Cloud on a task wrote
  // back the cloud's copy saved when the conflict was found. An earlier task
  // id a web delete handed the task since (row W), and the 50% David entered
  // on the web, were lost. Keep Cloud now keeps the cloud's row as it is now,
  // and writes nothing back unless this phone's own upload put a discarded
  // edit there while the choice ran.
  describe('Keep Cloud keeps the cloud copy as it is now', () => {
    const phoneTask: ScheduleItem = {
      id: 'task-keep-cloud-current',
      itemType: 'Task',
      projectName: '2321 Compliance Project',
      locationName: '2321 North Lot',
      taskName: 'Pour slab',
      startDate: '2026-10-03',
      finishDate: '2026-10-07',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium',
      status: 'Not Started',
      notes: 'Phone note.',
      nextAction: '',
      activity: [],
      importedFrom: 'master-n.csv',
      importBatchId: 'batch-n',
      revisedFromTaskIds: ['row-a'],
      createdAt: '2026-09-28T08:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
    };
    const cloudList = (data: ScheduleItem[]) => ({ ok: true, configured: true, stubbed: false, data });
    /** The cloud's task rows; null: the cloud cannot be read. */
    let cloudRows: ScheduleItem[] | null = [];

    beforeEach(() => {
      cloudRows = [];
      mockListScheduleItems.mockImplementation(() => Promise.resolve(cloudRows
        ? cloudList(cloudRows)
        : { ok: false, configured: true, stubbed: false, data: [] }));
    });
    afterEach(() => {
      mockListScheduleItems.mockImplementation(() => Promise.resolve(cloudList([])));
    });

    async function conflictWithWebDelete() {
      // The web deleted master M: its row X now answers to this task.
      cloudRows = [{ ...phoneTask, notes: '', revisedFromTaskIds: ['row-x', 'row-a'], updatedAt: '2026-09-29T12:00:00.000Z' }];
      await runScheduleItemCloudSync(phoneTask);
      const [conflict] = await getSyncConflicts();
      expect(conflict).toBeDefined();
      return conflict;
    }

    /** Meanwhile another web delete handed the task row W, and David entered 50% on the web. */
    function cloudCopyNow(conflict: { remotePayload?: unknown }): ScheduleItem {
      return {
        ...(conflict.remotePayload as ScheduleItem),
        revisedFromTaskIds: ['row-w', 'row-x', 'row-a'],
        percentComplete: 50,
        status: 'In Progress',
        updatedAt: '2026-09-30T09:00:00.000Z',
      };
    }

    it('keeps the earlier id and the 50% the web wrote since, and writes nothing back', async () => {
      const conflict = await conflictWithWebDelete();
      const current = cloudCopyNow(conflict);
      cloudRows = [current];

      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud')).resolves.toEqual(current);
      expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
      await expect(getSyncConflicts()).resolves.toEqual([]);
      await expect(getOfflineQueue()).resolves.toEqual([]);
    });

    it('changes nothing when the cloud copy cannot be read', async () => {
      const conflict = await conflictWithWebDelete();
      await queueScheduleItemRecord(
        { ...phoneTask, notes: 'A newer phone edit.', updatedAt: '2026-09-30T10:00:00.000Z' },
        false,
        ['notes', 'updatedAt'],
      );
      const queued = await getOfflineQueue();
      cloudRows = null;

      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'))
        .rejects.toThrow('sync_conflict_cloud_copy_unreadable');
      expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
      await expect(getSyncConflicts()).resolves.toEqual([conflict]);
      await expect(getOfflineQueue()).resolves.toEqual(queued);
    });

    it('closes the conflict, writing nothing, when the cloud no longer has the task', async () => {
      const conflict = await conflictWithWebDelete();
      cloudRows = [];

      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'))
        .rejects.toThrow('sync_conflict_record_deleted');
      expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
      await expect(getSyncConflicts()).resolves.toEqual([]);
    });

    it('puts the cloud copy back when an upload already under way lands a discarded phone edit during the choice', async () => {
      const conflict = await conflictWithWebDelete();
      const current = cloudCopyNow(conflict);
      cloudRows = [current];
      // A newer phone edit, which Keep Cloud discards, is on its way up when David chooses.
      await queueScheduleItemRecord(
        { ...phoneTask, notes: 'A newer phone edit.', updatedAt: '2026-09-30T10:00:00.000Z' },
        false,
        ['notes', 'updatedAt'],
      );
      let landEdit: () => void = () => undefined;
      const landing = new Promise<void>(resolve => { landEdit = resolve; });
      let editSending: () => void = () => undefined;
      const sending = new Promise<void>(resolve => { editSending = resolve; });
      mockUpsertScheduleItem.mockImplementationOnce(async (...args: unknown[]) => {
        editSending();
        await landing;
        cloudRows = [args[0] as ScheduleItem];
        return { ok: true, configured: true, stubbed: false };
      });
      const inFlight = uploadPendingChanges();
      await sending;
      // Keep Cloud reads the cloud before the edit lands; it lands, and that
      // upload finishes, before Keep Cloud goes on.
      mockListScheduleItems.mockImplementationOnce(async () => {
        const answer = cloudList([current]);
        landEdit();
        await inFlight;
        return answer;
      });

      await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud')).resolves.toEqual(current);
      expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(2);
      expect(mockUpsertScheduleItem.mock.calls[0][0]).toMatchObject({ notes: 'A newer phone edit.' });
      expect(mockUpsertScheduleItem).toHaveBeenLastCalledWith(current);
      await expect(getSyncConflicts()).resolves.toEqual([]);
      await expect(getOfflineQueue()).resolves.toEqual([]);
    });
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
    // Keep Cloud reads the cloud's row now, and again after withdrawing the
    // phone's edits (A8 pass 12 L2).
    mockListScheduleItems
      .mockResolvedValueOnce({ ok: true, configured: true, stubbed: false, data: [cloudTask] })
      .mockResolvedValueOnce({ ok: true, configured: true, stubbed: false, data: [cloudTask] });

    await expect(
      resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'),
    ).resolves.toEqual(cloudTask);
    await expect(getOfflineQueue()).resolves.toEqual([]);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    // Was: the conflict-time cloud copy written back. The cloud already holds
    // its own copy, so Keep Cloud writes nothing (A8 pass 12 L2).
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
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

// Whole-app audit, A3 pass 2 and A4 pass 5 (30 Sep 2026).
describe('project and field-update queue rules from the audit', () => {
  const CONFLICTS_KEY = 'projectVisionAI.syncConflicts.v1';
  const deletionJournal = jest.requireMock('../../services/ProjectUpdateDeletionJournal') as {
    hasProjectUpdateDeletionIntent: jest.Mock;
  };
  const updateItem = (id: string, note: string, changedAt: string) => ({
    id: `project-update-${id}`,
    entity: 'project_update' as const,
    operation: 'update' as const,
    payload: {
      id,
      projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
      projectName: '2375 Compliance Project',
      selectedAreaName: 'Canopy A',
      updateData: { id, note },
      pendingPhotoAssetIds: [],
    },
    changedAt,
    autoUpload: false,
  });
  const cloudCopy = (id: string) => ({
    id,
    projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
    projectName: '2375 Compliance Project',
    selectedAreaName: 'Canopy A',
    note: 'The copy the owner chose',
  });
  const storeConflict = (id: string) => mockStorage.set(CONFLICTS_KEY, JSON.stringify([{
    id: `project_update_conflict-${id}`,
    entity: 'project_update',
    localId: id,
    localChangedAt: '2026-08-14T08:00:00.000Z',
    remoteChangedAt: '2026-08-15T08:00:00.000Z',
    reason: 'Remote update changed after the local pending change.',
    detectedAt: '2026-08-15T09:00:00.000Z',
    localPayload: updateItem(id, 'Phone copy', '2026-08-14T08:00:00.000Z').payload,
    remotePayload: cloudCopy(id),
  }]));

  /**
   * The cloud still holds the copy the conflict recorded. Keep Cloud reads
   * the cloud's copy again before writing it (whole-app audit A4 pass 11 O1:
   * an iPad edit made after the conflict was found was overwritten); the
   * default receipt here is another copy, which it would now take.
   */
  const cloudUnchangedSinceConflict = () => mockGetProjectUpdateSyncMetadata.mockImplementation((id: string) =>
    Promise.resolve({
      ok: true, configured: true, stubbed: false,
      data: {
        id, projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9', updatedAt: '2026-08-15T08:00:00.000Z',
        projectName: '2375 Compliance Project', areaName: 'Canopy A', updateData: cloudCopy(id),
      },
    }));

  beforeEach(() => {
    deletionJournal.hasProjectUpdateDeletionIntent.mockResolvedValue(false);
  });
  afterAll(() => {
    deletionJournal.hasProjectUpdateDeletionIntent.mockResolvedValue(true);
  });

  it('retires a deleted project’s cover, archive and reopen items that carry only its previous name', async () => {
    mockCloudTombstonesResult = {
      ok: true, configured: true, stubbed: false,
      data: [{ entityType: 'project' as never, recordId: 'roof 2400', deletedAt: '2026-09-30T12:00:00.000Z' }],
    };
    await enqueuePendingChange({
      id: 'project-cover-roof',
      entity: 'project',
      operation: 'update',
      payload: { previousName: 'Roof 2400', data: { coverPhotoMode: 'manual' } },
      changedAt: '2026-09-30T11:00:00.000Z',
      autoUpload: false,
    });
    await expect(uploadPendingChanges()).resolves.toMatchObject({
      queued: 0,
      itemOutcomes: { 'project-cover-roof': 'superseded' },
    });
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('Keep Cloud withdraws the phone’s queued copies and keeps the chosen copy in the cloud', async () => {
    storeConflict('u-keep-cloud');
    cloudUnchangedSinceConflict();
    await enqueuePendingChange(updateItem('u-keep-cloud', 'A newer phone edit', '2026-08-16T08:00:00.000Z'));
    const [conflict] = await getSyncConflicts();

    await expect(resolveProjectUpdateSyncConflict(conflict.id, 'keep_cloud')).resolves.toEqual(cloudCopy('u-keep-cloud'));
    await expect(getOfflineQueue()).resolves.toEqual([]);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    // Pin changed in A4 pass 11 O1: Keep Cloud reads the cloud's copy again
    // and writes that one, which the cloud already holds, so nothing is
    // saved. Before, it wrote the copy recorded with the conflict over the
    // receipt this mock returns by default (an iPad edit made since).
    expect(mockSaveProjectUpdate).not.toHaveBeenCalled();
  });

  it('Keep Cloud judges its own item: another update still waiting on photos does not fail it (A7 pass 3)', async () => {
    storeConflict('u-own-item');
    cloudUnchangedSinceConflict();
    await enqueuePendingChange({
      ...updateItem('u-waiting-on-photos', 'Unrelated, photos not uploaded yet', '2026-08-16T09:00:00.000Z'),
      payload: {
        ...updateItem('u-waiting-on-photos', 'Unrelated, photos not uploaded yet', '2026-08-16T09:00:00.000Z').payload,
        pendingPhotoAssetIds: ['photo-not-uploaded'],
      },
    });
    const [conflict] = await getSyncConflicts();
    await expect(resolveProjectUpdateSyncConflict(conflict.id, 'keep_cloud')).resolves.toEqual(cloudCopy('u-own-item'));
    await expect(getSyncConflicts()).resolves.toEqual([]);
    const queue = await getOfflineQueue();
    expect(queue.map(item => item.id)).toEqual(['project-update-u-waiting-on-photos']);
  });

  it('Keep Cloud never writes back an update deleted on any device', async () => {
    storeConflict('u-deleted');
    mockCloudTombstonesResult = {
      ok: true, configured: true, stubbed: false,
      data: [{ entityType: 'project_update' as never, recordId: 'u-deleted', deletedAt: '2026-08-16T08:00:00.000Z' }],
    };
    const [conflict] = await getSyncConflicts();
    await expect(resolveProjectUpdateSyncConflict(conflict.id, 'keep_cloud')).rejects.toThrow('sync_conflict_record_deleted');
    expect(mockSaveProjectUpdate).not.toHaveBeenCalled();
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  // Pin changed in A4 pass 15 H1: nothing automatic sends an update in
  // conflict. A copy David chose to send over the conflict (a Retry he
  // confirmed; Keep Phone) carries that conflict's id and settles it; any
  // other copy waits in the queue, untouched, with no retry owed.
  it('an upload of the phone’s copy David chose to send over a conflict settles that conflict', async () => {
    storeConflict('u-retried');
    const chosen = updateItem('u-retried', 'Phone copy, retried', '2026-08-16T08:00:00.000Z');
    await enqueuePendingChange({ ...chosen, payload: { ...chosen.payload, overConflict: 'project_update_conflict-u-retried' } });
    await expect(uploadPendingChanges()).resolves.toMatchObject({
      itemOutcomes: { 'project-update-u-retried': 'uploaded' },
    });
    expect(mockSaveProjectUpdate).toHaveBeenCalledTimes(1);
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('any other copy of an update in conflict waits for review: not sent, still queued, the conflict open (A4 pass 15 H1)', async () => {
    storeConflict('u-retried');
    await enqueuePendingChange(updateItem('u-retried', 'Phone copy, retried', '2026-08-16T08:00:00.000Z'));
    const before = await getOfflineQueue();
    await expect(uploadPendingChanges()).resolves.toMatchObject({
      itemOutcomes: { 'project-update-u-retried': 'blocked' }, errors: [],
    });
    expect(mockSaveProjectUpdate).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual(before);
    await expect(getSyncConflicts()).resolves.toHaveLength(1);
  });
});

describe('work queued for a project that was then closed (audit A7 M2)', () => {
  const deletionJournal = jest.requireMock('../../services/ProjectUpdateDeletionJournal') as {
    hasProjectUpdateDeletionIntent: jest.Mock;
  };
  const CLOSED_ID = '0f3b6a51-2d9c-4c55-9b7e-51c1d0a7c2e4';
  const closed = () => mockListArchivedProjects.mockResolvedValue({
    ok: true, configured: true, stubbed: false,
    data: [{ id: CLOSED_ID, name: 'Fire Pump House' }],
  });
  const queueUpdate = (updateId: string, projectId: string | null = null) => enqueuePendingChange({
    id: `project-update-${updateId}`,
    entity: 'project_update',
    operation: 'update',
    payload: {
      id: updateId,
      projectId,
      projectName: 'Fire Pump House',
      updateData: { id: updateId, projectName: 'Fire Pump House', notes: 'Last walk before closeout.' },
      pendingPhotoAssetIds: [],
    },
    changedAt: '2026-09-30T09:00:00.000Z',
    autoUpload: false,
  });

  beforeEach(() => {
    mockGetProjectUpdateSyncMetadata.mockResolvedValue({ ok: true, configured: true, stubbed: false, data: null });
    // These updates were never deleted, so the upload reaches the save.
    deletionJournal.hasProjectUpdateDeletionIntent.mockResolvedValue(false);
  });
  afterAll(() => {
    deletionJournal.hasProjectUpdateDeletionIntent.mockResolvedValue(true);
  });

  it('uploads a field update saved before its project was closed, under the closed project', async () => {
    closed();
    await queueUpdate('closeout-update');
    await queueUpdate('closeout-update-by-id', CLOSED_ID);

    await expect(uploadPendingChanges()).resolves.toMatchObject({ uploaded: 2, queued: 0, errors: [] });
    expect(mockSaveProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'closeout-update', projectId: CLOSED_ID, projectName: 'Fire Pump House',
    }));
    expect(mockSaveProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'closeout-update-by-id', projectId: CLOSED_ID,
    }));
    expect(mockListArchivedProjects).toHaveBeenCalledTimes(1);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('remembers when this device put an update in the cloud, for the refresh (audit A7 M5)', async () => {
    closed();
    const before = Date.now();
    await queueUpdate('remembered-update');
    expect(projectUpdateUploadedSince('remembered-update', before)).toBe(false);
    await uploadPendingChanges();
    expect(projectUpdateUploadedSince('remembered-update', before)).toBe(true);
    expect(projectUpdateUploadedSince('remembered-update', Date.now() + 1)).toBe(false);

    mockSaveProjectUpdate.mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'offline' } as never);
    await queueUpdate('failed-update');
    await uploadPendingChanges();
    expect(projectUpdateUploadedSince('failed-update', before)).toBe(false);
  });

  it('keeps a task for a closed project waiting until it is reopened', async () => {
    closed();
    const task = scheduleQueueItem('closeout-task');
    await enqueuePendingChange({
      ...task,
      payload: { ...task.payload, itemData: { ...task.payload.itemData, projectName: 'Fire Pump House' } },
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({ uploaded: 0, queued: 1 });
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
  });

  it('keeps the update, with the original reason, when closed projects cannot be read', async () => {
    mockListArchivedProjects.mockResolvedValue({
      ok: false, configured: true, stubbed: false, error: 'Network request failed',
    });
    await queueUpdate('closeout-update');

    const result = await uploadPendingChanges();
    expect(result).toMatchObject({ uploaded: 0, queued: 1 });
    expect(result.errors.join(' ')).toContain('could not be found');
    expect(mockSaveProjectUpdate).not.toHaveBeenCalled();
  });
});
