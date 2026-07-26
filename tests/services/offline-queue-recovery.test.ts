const mockStorageValues = new Map<string, string>();
let mockCorruptQuarantineWrites = false;
let mockCorruptActiveQueueWrites = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) =>
    Promise.resolve(mockStorageValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorageValues.set(
      key,
      mockCorruptQuarantineWrites && key.includes('.quarantine.')
        ? `${value}-changed`
        : mockCorruptActiveQueueWrites && key === 'projectVisionAI.syncQueue.v1'
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
const mockArchiveProjectUpdate = jest.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    configured: true,
    stubbed: false,
    error: undefined as string | undefined,
  }),
);
const mockListReferenceDocuments = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false, data: [] }),
);
const mockUpsertReferenceDocument = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);
const mockListDAVESyncTombstones = jest.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    configured: true,
    stubbed: false,
    data: [],
  }),
);
const mockUpsertDAVESyncTombstone = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
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

jest.mock('../../services/SupabaseService', () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args),
  archiveProjectUpdate: (...args: unknown[]) => mockArchiveProjectUpdate(...args),
  listReferenceDocuments: (...args: unknown[]) => mockListReferenceDocuments(...args),
  upsertReferenceDocument: (...args: unknown[]) => mockUpsertReferenceDocument(...args),
  listDAVESyncTombstones: (...args: unknown[]) => mockListDAVESyncTombstones(...args),
  upsertDAVESyncTombstone: (...args: unknown[]) => mockUpsertDAVESyncTombstone(...args),
  listDAVEStorageCleanupIntents: (...args: unknown[]) =>
    mockListDAVEStorageCleanupIntents(...args),
  removeProtectedStorageObject: (...args: unknown[]) =>
    mockRemoveProtectedStorageObject(...args),
  recordDAVEStorageCleanupAttempt: (...args: unknown[]) =>
    mockRecordDAVEStorageCleanupAttempt(...args),
  getSupabaseConfigurationStatus: () => ({
    configured: true,
    message: 'Configured.',
  }),
}));

import {
  SYNC_QUEUE_QUARANTINE_KEY_PREFIX,
  clearResolvedConflict,
  cleanupStoredSyncStatusMessages,
  enqueuePendingChange,
  exportOfflineQueueQuarantine,
  getOfflineQueue,
  getOfflineQueueRecoveryState,
  getSyncConflicts,
  getSyncStatus,
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

function archiveQueueItem(
  updateId: string,
  changedAt = '2026-07-18T12:10:00.000Z',
): SyncQueueItem {
  return {
    id: `project-update-${updateId}`,
    entity: 'project_update',
    operation: 'update',
    payload: {
      id: updateId,
      archiveOnly: true,
      archivedAt: changedAt,
    },
    createdAt: changedAt,
    changedAt,
    retryCount: 0,
    lastError: null,
  };
}

function addLegacyArchiveQuarantine(
  suffix: string,
  items: SyncQueueItem[],
  salvagedItemIds: string[] = [],
): string {
  const quarantineKey = `${SYNC_QUEUE_QUARANTINE_KEY_PREFIX}${suffix}`;
  const metadataKey = `${ACTIVE_QUEUE_KEY}.quarantine-metadata.${suffix}`;
  mockStorageValues.set(quarantineKey, JSON.stringify(items));
  mockStorageValues.set(metadataKey, JSON.stringify({
    version: 1,
    quarantineKey,
    salvagedItemIds,
    restoredItemIds: [],
    invalidItemCount: items.length,
    resolvedAt: null,
  }));
  return quarantineKey;
}

describe('offline queue corruption recovery', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockCorruptQuarantineWrites = false;
    mockCorruptActiveQueueWrites = false;
    mockCreateProject.mockClear();
    mockArchiveProjectUpdate.mockClear();
    mockListReferenceDocuments.mockClear();
    mockUpsertReferenceDocument.mockClear();
    mockListDAVESyncTombstones.mockClear();
    mockUpsertDAVESyncTombstone.mockClear();
    mockArchiveProjectUpdate.mockImplementation((..._args: unknown[]) =>
      Promise.resolve({
        ok: true,
        configured: true,
        stubbed: false,
        error: undefined as string | undefined,
      }),
    );
  });

  it('queues and uploads a cloud-only reference document', async () => {
    await enqueuePendingChange({
      id: 'reference-document-schedule-cloud-1',
      entity: 'reference_document',
      operation: 'update',
      payload: {
        id: 'schedule-cloud-1',
        documentData: {
          id: 'schedule-cloud-1',
          name: 'Current schedule',
          originalFileName: 'schedule.pdf',
          uri: '',
          storagePath: 'owner/schedules/schedule.pdf',
          category: 'Schedules',
          notes: '',
          isCurrent: true,
          importedAt: '2026-07-20T12:00:00.000Z',
          updatedAt: '2026-07-20T13:00:00.000Z',
        },
      },
      changedAt: '2026-07-20T13:00:00.000Z',
      autoUpload: false,
    });

    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'reference-document-schedule-cloud-1',
        entity: 'reference_document',
        changedAt: '2026-07-20T13:00:00.000Z',
      }),
    ]);
    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      uploadedByEntity: { reference_document: 1 },
    });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'schedule-cloud-1', isCurrent: true }),
    );
  });

  it('accepts and uploads an archive-only project update without quarantining it', async () => {
    const archive = archiveQueueItem('archive-valid');
    mockStorageValues.set(ACTIVE_QUEUE_KEY, JSON.stringify([archive]));

    await expect(getOfflineQueue()).resolves.toEqual([archive]);
    await expect(listOfflineQueueQuarantines()).resolves.toEqual([]);
    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
    });
    expect(mockArchiveProjectUpdate).toHaveBeenCalledTimes(1);
    expect(mockArchiveProjectUpdate).toHaveBeenCalledWith({
      id: 'archive-valid',
      archivedAt: '2026-07-18T12:10:00.000Z',
    });
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('keeps an archive-only row quarantined when its archive time is missing', async () => {
    const archive = archiveQueueItem('archive-missing-time');
    const invalidArchive = {
      ...archive,
      payload: {
        id: 'archive-missing-time',
        archiveOnly: true,
      },
    };
    mockStorageValues.set(ACTIVE_QUEUE_KEY, JSON.stringify([invalidArchive]));

    await expect(getOfflineQueue()).resolves.toEqual([]);
    await expect(getOfflineQueueRecoveryState()).resolves.toMatchObject({
      activeItems: 0,
      recoveryAvailable: true,
      unresolvedQuarantineKeys: [expect.stringContaining(
        SYNC_QUEUE_QUARANTINE_KEY_PREFIX,
      )],
    });
    expect(mockArchiveProjectUpdate).not.toHaveBeenCalled();
  });

  it('deduplicates legacy archive quarantines and resolves them only after cloud success', async () => {
    const archive = archiveQueueItem('archive-recovered');
    const firstKey = addLegacyArchiveQuarantine(
      '2026-07-20T12:00:00.000Z',
      [archive],
    );
    const secondKey = addLegacyArchiveQuarantine(
      '2026-07-20T12:01:00.000Z',
      [archive],
    );
    mockStorageValues.set(ACTIVE_QUEUE_KEY, '[]');

    await expect(getOfflineQueueRecoveryState()).resolves.toMatchObject({
      recoveryAvailable: true,
      unresolvedQuarantineKeys: [secondKey, firstKey],
    });
    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      errors: [],
    });
    expect(mockArchiveProjectUpdate).toHaveBeenCalledTimes(1);
    expect(mockStorageValues.get(firstKey)).toBe(JSON.stringify([archive]));
    expect(mockStorageValues.get(secondKey)).toBe(JSON.stringify([archive]));
    await expect(getOfflineQueueRecoveryState()).resolves.toMatchObject({
      recoveryAvailable: false,
      unresolvedQuarantineKeys: [],
      quarantineKeys: [secondKey, firstKey],
    });
  });

  it('recovers an archive row from a mixed snapshot without replaying salvaged project work', async () => {
    const salvagedProject = {
      ...queueItem('already-salvaged-project'),
      operation: 'update' as const,
      payload: {
        previousName: 'Old Project',
        archived: true,
      },
    };
    const archive = archiveQueueItem('archive-from-mixed-snapshot');
    const quarantineKey = addLegacyArchiveQuarantine(
      '2026-07-20T12:01:30.000Z',
      [salvagedProject, archive],
      [salvagedProject.id],
    );
    mockStorageValues.set(ACTIVE_QUEUE_KEY, '[]');

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      errors: [],
    });
    expect(mockArchiveProjectUpdate).toHaveBeenCalledTimes(1);
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockStorageValues.get(quarantineKey)).toBe(
      JSON.stringify([salvagedProject, archive]),
    );
    await expect(getOfflineQueueRecoveryState()).resolves.toMatchObject({
      recoveryAvailable: false,
      unresolvedQuarantineKeys: [],
    });
  });

  it('preserves legacy archive quarantines and the staged item when cloud archive fails', async () => {
    const archive = archiveQueueItem('archive-retry');
    const quarantineKey = addLegacyArchiveQuarantine(
      '2026-07-20T12:02:00.000Z',
      [archive],
    );
    mockStorageValues.set(ACTIVE_QUEUE_KEY, '[]');
    mockArchiveProjectUpdate.mockResolvedValueOnce({
      ok: false,
      configured: true,
      stubbed: false,
      error: 'temporary archive failure',
    });

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 0,
      queued: 1,
      errors: [expect.stringMatching(/could not sync/i)],
    });
    expect(mockStorageValues.get(quarantineKey)).toBe(JSON.stringify([archive]));
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: archive.id,
        retryCount: 1,
      }),
    ]);
    await expect(getOfflineQueueRecoveryState()).resolves.toMatchObject({
      recoveryAvailable: true,
      unresolvedQuarantineKeys: [quarantineKey],
    });
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
      unresolvedQuarantineKeys: quarantineKeys,
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

  it('salvages every independently valid row and reports the remaining recovery work', async () => {
    const first = queueItem('valid-first');
    const second = queueItem('valid-second');
    const invalid = { id: 'invalid', entity: 'project', payload: { name: 'Bad' } };
    const rawValue = JSON.stringify([first, invalid, second]);
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);

    await expect(getOfflineQueue()).resolves.toEqual([first, second]);
    expect(mockStorageValues.get(ACTIVE_QUEUE_KEY)).toBe(
      JSON.stringify([first, second]),
    );

    const [quarantineKey] = await listOfflineQueueQuarantines();
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);
    await expect(getSyncStatus()).resolves.toMatchObject({
      queuedChanges: 2,
      recoveryAvailable: true,
      recoveryCopies: 1,
      message: expect.stringMatching(/protected recovery copy.*needs review/i),
    });
  });

  it('isolates duplicate IDs and keeps only the last valid queue revision', async () => {
    const older = queueItem('same-id');
    const newer = {
      ...queueItem('same-id'),
      payload: { name: 'Newest intended project name' },
      changedAt: '2026-07-18T12:05:00.000Z',
    };
    const rawValue = JSON.stringify([older, newer]);
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);

    await expect(getOfflineQueue()).resolves.toEqual([newer]);
    const [quarantineKey] = await listOfflineQueueQuarantines();
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);
    await expect(getOfflineQueueRecoveryState()).resolves.toMatchObject({
      activeItems: 1,
      recoveryAvailable: true,
    });
  });

  it('keeps status in attention when every row is invalid and active count is zero', async () => {
    const rawValue = JSON.stringify([
      { id: 'missing-fields' },
      { id: 'negative-retry', retryCount: -1 },
    ]);
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);

    await expect(getSyncStatus()).resolves.toMatchObject({
      queuedChanges: 0,
      recoveryAvailable: true,
      recoveryCopies: 1,
      message: expect.stringMatching(/current changes are synced.*protected copy/i),
    });
    const [quarantineKey] = await listOfflineQueueQuarantines();
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);
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
    await expect(getOfflineQueueRecoveryState()).resolves.toMatchObject({
      recoveryAvailable: false,
      unresolvedQuarantineKeys: [],
    });
  });

  it('does not restore an automatically salvaged row twice during manual recovery', async () => {
    const salvaged = queueItem('salvaged-once');
    const rawValue = JSON.stringify([salvaged, { id: 'repair-me' }]);
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);

    await expect(getOfflineQueue()).resolves.toEqual([salvaged]);
    const [quarantineKey] = await listOfflineQueueQuarantines();
    await expect(uploadPendingChanges()).resolves.toMatchObject({ uploaded: 1, queued: 0 });

    const repaired = queueItem('repaired-only');
    await expect(retryOfflineQueueRecovery(
      quarantineKey,
      JSON.stringify([salvaged, repaired]),
    )).resolves.toEqual({
      status: 'recovered',
      quarantineKey,
      restoredItems: 1,
      activeItems: 1,
    });
    await expect(getOfflineQueue()).resolves.toEqual([repaired]);
    await expect(uploadPendingChanges()).resolves.toMatchObject({ uploaded: 1, queued: 0 });
    expect(mockCreateProject).toHaveBeenCalledTimes(2);

    await expect(retryOfflineQueueRecovery(
      quarantineKey,
      JSON.stringify([salvaged, repaired]),
    )).resolves.toEqual({
      status: 'already_recovered',
      quarantineKey,
      restoredItems: 0,
      activeItems: 0,
    });
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);
  });

  it('blocks manual restore if salvage metadata is damaged', async () => {
    const salvaged = queueItem('salvaged-before-metadata-damage');
    const rawValue = JSON.stringify([salvaged, { id: 'repair-me' }]);
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);
    await getOfflineQueue();
    const [quarantineKey] = await listOfflineQueueQuarantines();
    await uploadPendingChanges();

    const metadataKey = [...mockStorageValues.keys()].find(key =>
      key.includes('.quarantine-metadata.'),
    );
    expect(metadataKey).toBeDefined();
    mockStorageValues.set(metadataKey!, '{damaged-metadata');

    await expect(retryOfflineQueueRecovery(
      quarantineKey,
      JSON.stringify([salvaged, queueItem('repaired-row')]),
    )).rejects.toThrow(/blocked to prevent duplicate or resurrected work/i);
    await expect(getOfflineQueue()).resolves.toEqual([]);
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);
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

  it('fails closed when the salvaged active queue cannot be verified', async () => {
    const valid = queueItem('must-survive-salvage');
    const rawValue = JSON.stringify([valid, { id: 'bad-row' }]);
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);
    mockCorruptActiveQueueWrites = true;

    await expect(getOfflineQueue()).rejects.toThrow(
      /write verification failed.*projectVisionAI\.syncQueue\.v1/i,
    );
    const [quarantineKey] = await listOfflineQueueQuarantines();
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);

    mockCorruptActiveQueueWrites = false;
    await expect(getOfflineQueue()).resolves.toEqual([valid]);
    await expect(getSyncStatus()).resolves.toMatchObject({
      queuedChanges: 1,
      recoveryAvailable: true,
    });
  });

  it('allows new work to enqueue after all invalid rows are isolated without hiding recovery', async () => {
    const rawValue = JSON.stringify([{ id: 'invalid-only' }]);
    mockStorageValues.set(ACTIVE_QUEUE_KEY, rawValue);
    await expect(getOfflineQueue()).resolves.toEqual([]);

    const newWork = queueItem('new-after-recovery');
    await enqueuePendingChange({ ...newWork, autoUpload: false });

    await expect(getOfflineQueue()).resolves.toEqual([newWork]);
    await expect(getSyncStatus()).resolves.toMatchObject({
      queuedChanges: 1,
      recoveryAvailable: true,
      recoveryCopies: 1,
    });
    const [quarantineKey] = await listOfflineQueueQuarantines();
    expect(mockStorageValues.get(quarantineKey)).toBe(rawValue);
  });

  it('preserves deletion journals, identifiers, payloads, and valid sync timestamps during cleanup', async () => {
    const tombstoneRaw = JSON.stringify([{
      entityType: 'schedule_item',
      recordId: 'task-keep-deleted',
      deletedAt: '2026-07-20T12:00:00.000Z',
    }]);
    const quarantineRaw = JSON.stringify({
      quarantinedAt: '2026-07-20T12:01:00.000Z',
      raw: tombstoneRaw,
    });
    const lastSyncRaw = JSON.stringify('2026-07-20T12:02:00.000Z');
    const conflict = {
      id: 'conflict-1',
      entity: 'project_update',
      localId: 'update-1',
      localChangedAt: '2026-07-20T12:03:00.000Z',
      remoteChangedAt: '2026-07-20T12:04:00.000Z',
      reason: 'readAsStringAsync failed for /var/mobile/private-photo.heic',
      detectedAt: '2026-07-20T12:05:00.000Z',
      localPayload: { id: 'update-1', notes: 'Preserve this field record.' },
    };

    mockStorageValues.set('@dave/sync-tombstones/v1', tombstoneRaw);
    mockStorageValues.set('@dave/sync-tombstones/quarantine/v1', quarantineRaw);
    mockStorageValues.set('projectVisionAI.lastSyncAt.v1', lastSyncRaw);
    mockStorageValues.set('projectVisionAI.syncConflicts.v1', JSON.stringify([conflict]));

    await cleanupStoredSyncStatusMessages();

    expect(mockStorageValues.get('@dave/sync-tombstones/v1')).toBe(tombstoneRaw);
    expect(mockStorageValues.get('@dave/sync-tombstones/quarantine/v1')).toBe(quarantineRaw);
    expect(mockStorageValues.get('projectVisionAI.lastSyncAt.v1')).toBe(lastSyncRaw);
    expect(JSON.parse(mockStorageValues.get('projectVisionAI.syncConflicts.v1') || '[]'))
      .toEqual([{
        ...conflict,
        reason: 'Some photos could not be synced because the original files are no longer available. The remaining items will continue syncing.',
      }]);
  });

  it('clears a corrupted last-sync display message without rewriting durable records', async () => {
    mockStorageValues.set(
      'projectVisionAI.lastSyncAt.v1',
      JSON.stringify('Cloud sync could not finish. Your changes remain saved on this phone and will be retried.'),
    );

    await cleanupStoredSyncStatusMessages();

    expect(mockStorageValues.get('projectVisionAI.lastSyncAt.v1')).toBe('null');
  });

  it('serializes overlapping conflict decisions without restoring either conflict', async () => {
    const conflict = (id: string) => ({
      id,
      entity: 'project_update' as const,
      localId: `update-${id}`,
      localChangedAt: '2026-07-18T12:00:00.000Z',
      remoteChangedAt: '2026-07-18T12:01:00.000Z',
      reason: 'Concurrent edit',
      detectedAt: '2026-07-18T12:02:00.000Z',
      localPayload: { updateData: { id: `update-${id}`, notes: 'phone' } },
      remotePayload: { id: `update-${id}`, notes: 'cloud' },
    });
    mockStorageValues.set(
      'projectVisionAI.syncConflicts.v1',
      JSON.stringify([conflict('first'), conflict('second')]),
    );

    await Promise.all([
      clearResolvedConflict('first'),
      clearResolvedConflict('second'),
    ]);

    await expect(getSyncConflicts()).resolves.toEqual([]);
  });
});
