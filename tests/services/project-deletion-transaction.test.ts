jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('../../services/SupabaseService', () => ({
  listDAVESyncTombstones: jest.fn(),
  upsertDAVESyncTombstone: jest.fn(),
}));

import {
  buildProjectDeletionCascade,
  buildProjectDeletionOperations,
  createProjectDeletionTransactionRepository,
  PROJECT_DELETION_TRANSACTION_JOURNAL_KEY,
  selectProjectDeletionFallback,
  type ProjectDeletionStorageKeys,
} from '../../services/ProjectDeletionTransaction';
import {
  createProjectDeletionRuntime,
  ProjectDeletionIntentRecoveryRequiredError,
  ProjectDeletionRecoveryRequiredError,
} from '../../services/ProjectDeletionRuntime';

const NOW = '2026-07-18T12:00:00.000Z';

const keys: ProjectDeletionStorageKeys = {
  projects: 'projects',
  deletedProjects: 'deleted-projects',
  archivedProjects: 'archives',
  updates: 'updates',
  deletedUpdates: 'deleted-updates',
  updateDeletionJournal: 'update-deletion-journal',
  projectDocuments: 'project-documents',
  referenceDocuments: 'reference-documents',
  scheduleItems: 'schedule-items',
  daveSyncTombstones: 'dave-tombstones',
  activeDraft: 'draft',
  cloudIntents: 'cloud-intents',
  fileCleanupIntents: 'file-cleanup-intents',
};

function fullCascade() {
  return buildProjectDeletionCascade({
    projectName: 'Target Project',
    authorityProjectId: 'project-target-project',
    deletedAt: NOW,
    projectRecords: [
      { name: 'Target Project', marker: 'remove' },
      { name: 'Other Project', marker: 'keep' },
    ],
    deletedProjectNames: ['Previously Deleted'],
    archivedProjects: ['Target Project', 'Other Project'],
    updates: [
      { id: 'update-target', projectName: 'Target Project', marker: 'remove' },
      { id: 'update-other', projectName: 'Other Project', marker: 'keep' },
    ],
    updateTombstones: [{
      updateId: 'already-deleted',
      marker: 'keep',
      deletedAt: '2026-07-17T12:00:00.000Z',
    }],
    updateDeletionIntents: [{
      updateId: 'already-deleted',
      projectName: 'Other Project',
      requestedAt: '2026-07-17T12:00:00.000Z',
      cloudDeleteConfirmedAt: null,
    }],
    projectDocuments: [
      { id: 'project-doc-target', projectId: 'project-target-project' },
      { id: 'project-doc-other', projectId: 'project-other-project' },
    ],
    referenceDocuments: [
      { id: 'reference-by-name', projectName: 'target project' },
      { id: 'reference-by-id', projectId: 'project-target-project' },
      { id: 'reference-unscoped' },
      { id: 'reference-other', projectName: 'Other Project' },
    ],
    scheduleItems: [
      { id: 'schedule-target', projectName: 'Target Project' },
      {
        id: 'schedule-target-parent',
        projectName: 'Container',
        scheduleProjectName: 'Target Project',
      },
      { id: 'schedule-other', projectName: 'Other Project' },
    ],
    daveSyncTombstones: [{
      entityType: 'schedule_item' as const,
      recordId: 'previous-schedule-delete',
      deletedAt: '2026-07-17T12:00:00.000Z',
    }],
    draft: { draft: { projectName: 'Target Project' }, savedAt: 'old' },
    draftBelongsToProject: true,
    replacementDraft: { draft: { projectName: 'Other Project' }, savedAt: NOW },
    cloudIntents: [{ projectName: 'Previously Deleted', requestedAt: NOW }],
    fileCleanupIntents: [{
      id: 'reference_document:previous',
      kind: 'reference_document' as const,
      projectName: 'Previously Deleted',
      uri: 'file:///owned/previous.pdf',
    }],
    newFileCleanupIntents: [
      {
        id: 'project_document:project-doc-target',
        kind: 'project_document' as const,
        projectName: 'Target Project',
        localUri: 'file:///owned/project-doc.pdf',
        ownedFileId: '550e8400-e29b-41d4-a716-446655440000',
        ownedFileManifest: { version: 1, files: {} },
      },
      {
        id: 'reference_document:reference-by-name',
        kind: 'reference_document' as const,
        projectName: 'Target Project',
        uri: 'file:///owned/reference.pdf',
      },
    ],
    buildUpdateTombstone: (update, deletedAt) => ({
      updateId: update.id,
      marker: 'new',
      deletedAt,
    }),
  });
}

describe('project deletion cascade', () => {
  it('removes every explicitly owned local record and creates resurrection barriers', () => {
    const cascade = fullCascade();

    expect(cascade.remainingProjectRecords.map(item => item.name)).toEqual(['Other Project']);
    expect(cascade.nextDeletedProjectNames).toEqual([
      'Target Project',
      'Previously Deleted',
    ]);
    expect(cascade.remainingArchivedProjects).toEqual(['Other Project']);
    expect(cascade.remainingUpdates.map(item => item.id)).toEqual(['update-other']);
    expect(cascade.removedUpdates.map(item => item.id)).toEqual(['update-target']);
    expect(cascade.nextUpdateTombstones.map(item => item.updateId)).toEqual([
      'update-target',
      'already-deleted',
    ]);
    expect(cascade.nextUpdateDeletionIntents.map(item => item.updateId)).toEqual([
      'update-target',
      'already-deleted',
    ]);
    expect(cascade.remainingProjectDocuments.map(item => item.id)).toEqual([
      'project-doc-other',
    ]);
    expect(cascade.remainingReferenceDocuments.map(item => item.id)).toEqual([
      'reference-unscoped',
      'reference-other',
    ]);
    expect(cascade.remainingScheduleItems.map(item => item.id)).toEqual([
      'schedule-other',
    ]);
    expect(cascade.nextDAVESyncTombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'schedule_item', recordId: 'schedule-target' }),
      expect.objectContaining({ entityType: 'schedule_item', recordId: 'schedule-target-parent' }),
      expect.objectContaining({ entityType: 'reference_document', recordId: 'reference-by-name' }),
      expect.objectContaining({ entityType: 'reference_document', recordId: 'reference-by-id' }),
      expect.objectContaining({ entityType: 'schedule_item', recordId: 'previous-schedule-delete' }),
    ]));
    expect(cascade.draftReplaced).toBe(true);
    expect(cascade.nextDraft).toEqual({
      draft: { projectName: 'Other Project' },
      savedAt: NOW,
    });
    expect(cascade.nextCloudIntents.map(intent => intent.projectName)).toEqual([
      'Target Project',
      'Previously Deleted',
    ]);
    expect(cascade.nextFileCleanupIntents.map(intent => intent.id)).toEqual([
      'project_document:project-doc-target',
      'reference_document:reference-by-name',
      'reference_document:previous',
    ]);
  });

  it('writes all deletion domains in one transaction operation set', () => {
    const operations = buildProjectDeletionOperations(fullCascade(), keys);
    expect(operations.map(operation => operation.key)).toEqual([
      keys.projects,
      keys.deletedProjects,
      keys.archivedProjects,
      keys.updates,
      keys.deletedUpdates,
      keys.updateDeletionJournal,
      keys.projectDocuments,
      keys.referenceDocuments,
      keys.scheduleItems,
      keys.daveSyncTombstones,
      keys.cloudIntents,
      keys.fileCleanupIntents,
      keys.activeDraft,
    ]);
  });

  it('never falls back to an archived or already deleted project', () => {
    expect(selectProjectDeletionFallback({
      remainingProjectNames: ['Deleted Default', 'Archived Project', 'Active Project'],
      archivedProjectNames: ['Archived Project'],
      deletedProjectNames: ['Deleted Default'],
    })).toBe('Active Project');
    expect(selectProjectDeletionFallback({
      remainingProjectNames: ['Deleted Default'],
      archivedProjectNames: [],
      deletedProjectNames: ['Deleted Default'],
    })).toBe('');
  });
});

describe('project deletion crash boundary', () => {
  it('quarantines exact mixed cloud-intent bytes and salvages valid cleanup work', async () => {
    const raw = JSON.stringify([
      { projectName: 'Target Project', requestedAt: NOW },
      { projectName: '', requestedAt: 'not-a-date' },
    ]);
    const values = new Map<string, string>([
      [keys.cloudIntents, raw],
      [keys.fileCleanupIntents, '[]'],
      [keys.daveSyncTombstones, '[]'],
    ]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const runtime = createProjectDeletionRuntime({
      storage,
      storageKeys: keys,
      createTransactionId: () => 'mixed-intent-recovery',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete: async () => undefined,
      cleanupLocalFile: async () => undefined,
    });

    await expect(runtime.recoverPendingIntentStores()).rejects.toBeInstanceOf(
      ProjectDeletionIntentRecoveryRequiredError,
    );
    expect(JSON.parse(values.get(keys.cloudIntents) || '[]')).toEqual([
      { projectName: 'Target Project', requestedAt: NOW },
    ]);
    expect([...values.entries()].some(([key, value]) =>
      key.startsWith(`${keys.cloudIntents}.quarantine.v1/`) && value === raw,
    )).toBe(true);
    await expect(runtime.recoverPendingIntentStores()).resolves.toBeUndefined();
  });

  it('quarantines an all-invalid file cleanup store and retries from empty safely', async () => {
    const raw = JSON.stringify([{ id: '', kind: 'unknown' }]);
    const values = new Map<string, string>([
      [keys.cloudIntents, '[]'],
      [keys.fileCleanupIntents, raw],
      [keys.daveSyncTombstones, '[]'],
    ]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const runtime = createProjectDeletionRuntime({
      storage,
      storageKeys: keys,
      createTransactionId: () => 'invalid-intent-recovery',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete: async () => undefined,
      cleanupLocalFile: async () => undefined,
    });

    await expect(runtime.recoverPendingIntentStores()).rejects.toBeInstanceOf(
      ProjectDeletionIntentRecoveryRequiredError,
    );
    expect(values.get(keys.fileCleanupIntents)).toBe('[]');
    expect([...values.entries()].some(([key, value]) =>
      key.startsWith(`${keys.fileCleanupIntents}.quarantine.v1/`) && value === raw,
    )).toBe(true);
    await expect(runtime.recoverPendingIntentStores()).resolves.toBeUndefined();
  });

  it('finishes a one-time partial write before returning the committed UI result', async () => {
    const values = new Map<string, string>([[keys.daveSyncTombstones, '[]']]);
    let failArchiveWriteOnce = true;
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (key === keys.archivedProjects && failArchiveWriteOnce) {
          failArchiveWriteOnce = false;
          throw new Error('one-time partial write');
        }
        values.set(key, value);
      },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const runtime = createProjectDeletionRuntime({
      storage,
      storageKeys: keys,
      createTransactionId: () => 'immediate-recovery',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete: async () => undefined,
      cleanupLocalFile: async () => undefined,
    });

    await expect(runtime.commit(() => ({
      operations: [
        { kind: 'set' as const, key: keys.projects, value: '["Other Project"]' },
        { kind: 'set' as const, key: keys.archivedProjects, value: '[]' },
      ],
      result: 'publish-deleted-state',
    }))).resolves.toBe('publish-deleted-state');

    expect(values.get(keys.projects)).toBe('["Other Project"]');
    expect(values.get(keys.archivedProjects)).toBe('[]');
    expect(values.has(PROJECT_DELETION_TRANSACTION_JOURNAL_KEY)).toBe(false);
  });

  it('blocks when a partial write cannot be recovered and preserves the journal', async () => {
    const values = new Map<string, string>([[keys.daveSyncTombstones, '[]']]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (key === keys.archivedProjects) throw new Error('persistent storage failure');
        values.set(key, value);
      },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const runtime = createProjectDeletionRuntime({
      storage,
      storageKeys: keys,
      createTransactionId: () => 'blocked-recovery',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete: async () => undefined,
      cleanupLocalFile: async () => undefined,
    });

    await expect(runtime.commit(() => ({
      operations: [
        { kind: 'set' as const, key: keys.projects, value: '["Other Project"]' },
        { kind: 'set' as const, key: keys.archivedProjects, value: '[]' },
      ],
      result: 'must-not-publish',
    }))).rejects.toBeInstanceOf(ProjectDeletionRecoveryRequiredError);

    expect(values.has(PROJECT_DELETION_TRANSACTION_JOURNAL_KEY)).toBe(true);
    await expect(runtime.recoverBeforeStartupReads()).rejects.toThrow(
      'journal remains available for retry',
    );
  });

  it('does not deadlock while reading DAVE tombstones under the transaction lock', async () => {
    const values = new Map<string, string>([[keys.daveSyncTombstones, '[]']]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const runtime = createProjectDeletionRuntime({
      storage,
      storageKeys: keys,
      createTransactionId: () => 'no-deadlock',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete: async () => undefined,
      cleanupLocalFile: async () => undefined,
    });

    const commit = runtime.commit(() => ({
      operations: [{ kind: 'set' as const, key: keys.projects, value: '[]' }],
      result: 'committed',
    }));
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('project deletion transaction deadlocked')), 500);
    });

    await expect(Promise.race([commit, timeout])).resolves.toBe('committed');
  });

  it('runs scoped file cleanup only after deleted metadata is durably committed', async () => {
    const values = new Map<string, string>([[keys.daveSyncTombstones, '[]']]);
    const cleanupLocalFile = jest.fn(async () => undefined);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const runtime = createProjectDeletionRuntime({
      storage,
      storageKeys: keys,
      createTransactionId: () => 'cleanup-order',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete: async () => undefined,
      cleanupLocalFile,
    });
    const cleanupIntent = {
      id: 'project_document:owned-file',
      kind: 'project_document' as const,
      projectName: 'Target Project',
      localUri: 'file:///owned/document.pdf',
      ownedFileId: 'owned-file',
      ownedFileManifest: { version: 1 },
    };

    await runtime.commit(() => ({
      operations: [
        { kind: 'set' as const, key: keys.projectDocuments, value: '[]' },
        {
          kind: 'set' as const,
          key: keys.fileCleanupIntents,
          value: JSON.stringify([cleanupIntent]),
        },
      ],
      result: undefined,
    }));

    expect(cleanupLocalFile).not.toHaveBeenCalled();
    expect(values.get(keys.projectDocuments)).toBe('[]');
    await expect(runtime.processPendingFileCleanupIntents()).resolves.toBe(0);
    expect(cleanupLocalFile).toHaveBeenCalledWith(cleanupIntent);
    expect(values.get(keys.fileCleanupIntents)).toBe('[]');
  });

  it('recovers all local domains before a cloud delete can be queued', async () => {
    const values = new Map<string, string>();
    let failArchiveWrite = true;
    const storage = {
      getItem: jest.fn(async (key: string) => values.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        if (key === keys.archivedProjects && failArchiveWrite) {
          throw new Error('simulated process interruption');
        }
        values.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };
    const repository = createProjectDeletionTransactionRepository({
      storage,
      createTransactionId: () => 'project-delete-transaction',
      now: () => NOW,
    });
    const operations = buildProjectDeletionOperations(fullCascade(), keys);
    const queueCloudDelete = jest.fn(async () => undefined);

    await expect(repository.commit(operations)).rejects.toThrow(
      'journal remains available for retry',
    );
    expect(queueCloudDelete).not.toHaveBeenCalled();
    expect(values.has(PROJECT_DELETION_TRANSACTION_JOURNAL_KEY)).toBe(true);

    failArchiveWrite = false;
    await repository.recover();
    await queueCloudDelete();

    expect(queueCloudDelete).toHaveBeenCalledTimes(1);
    expect(values.has(PROJECT_DELETION_TRANSACTION_JOURNAL_KEY)).toBe(false);
    operations.forEach(operation => {
      expect(values.get(operation.key)).toBe(operation.kind === 'set'
        ? operation.value
        : undefined);
    });
  });
});
