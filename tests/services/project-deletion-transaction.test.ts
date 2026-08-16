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
  upsertDAVESyncTombstones: jest.fn(),
}));

import {
  buildProjectDeletionCascade,
  buildProjectDeletionOperations,
  createProjectDeletionTransactionRepository,
  PROJECT_DELETION_TRANSACTION_JOURNAL_KEY,
  referenceDocumentMatchesProject,
  scheduleItemMatchesProject,
  selectProjectDeletionFallback,
  type ProjectDeletionStorageKeys,
} from '../../services/ProjectDeletionTransaction';
import {
  createProjectDeletionRuntime,
  ProjectDeletionIntentRecoveryRequiredError,
  ProjectDeletionRecoveryRequiredError,
} from '../../services/ProjectDeletionRuntime';

const NOW = '2026-07-18T12:00:00.000Z';
const TARGET_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const PREVIOUS_PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SELECTED_PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const SIBLING_PROJECT_ID = '55555555-5555-4555-8555-555555555555';

const keys: ProjectDeletionStorageKeys = {
  projects: 'projects',
  deletedProjects: 'deleted-projects',
  archivedProjects: 'archives',
  updates: 'updates',
  deletedUpdates: 'deleted-updates',
  updateDeletionJournal: 'update-deletion-journal',
  projectDocuments: 'project-documents',
  referenceDocuments: 'reference-documents',
  projectAreas: 'project-areas',
  scheduleItems: 'schedule-items',
  daveSyncTombstones: 'dave-tombstones',
  activeDraft: 'draft',
  captureMemories: 'capture-memories',
  projectWalkSession: 'project-walk-session',
  cloudIntents: 'cloud-intents',
  fileCleanupIntents: 'file-cleanup-intents',
};

function fullCascade() {
  return buildProjectDeletionCascade({
    projectName: 'Target Project',
    authorityProjectId: TARGET_PROJECT_ID,
    deletedAt: NOW,
    projectRecords: [
      { id: TARGET_PROJECT_ID, name: 'Target Project', marker: 'remove' },
      { id: OTHER_PROJECT_ID, name: 'Other Project', marker: 'keep' },
    ],
    deletedProjectNames: ['Previously Deleted'],
    archivedProjects: ['Target Project', 'Other Project'],
    updates: [
      {
        id: 'update-target',
        projectId: TARGET_PROJECT_ID,
        projectName: 'Target Project',
        marker: 'remove',
      },
      {
        id: 'update-target-task',
        projectId: TARGET_PROJECT_ID,
        projectName: 'Container',
        scheduleProjectName: 'Target Project',
        scheduleItemId: 'schedule-target-parent',
        marker: 'remove',
      },
      {
        id: 'update-other',
        projectId: OTHER_PROJECT_ID,
        projectName: 'Other Project',
        marker: 'keep',
      },
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
      { id: 'project-doc-target', projectId: TARGET_PROJECT_ID },
      { id: 'project-doc-other', projectId: OTHER_PROJECT_ID },
    ],
    referenceDocuments: [
      {
        id: 'reference-by-name',
        projectId: TARGET_PROJECT_ID,
        projectName: 'target project',
      },
      { id: 'reference-by-id', projectId: TARGET_PROJECT_ID },
      { id: 'reference-unscoped' },
      { id: 'reference-other', projectId: OTHER_PROJECT_ID, projectName: 'Other Project' },
    ],
    projectAreas: [
      { id: 'area-target', projectId: TARGET_PROJECT_ID, projectName: 'Target Project' },
      { id: 'area-other', projectId: OTHER_PROJECT_ID, projectName: 'Other Project' },
      { id: 'area-legacy' },
    ],
    scheduleItems: [
      { id: 'schedule-target', projectId: TARGET_PROJECT_ID, projectName: 'Target Project' },
      {
        id: 'schedule-target-parent',
        projectId: TARGET_PROJECT_ID,
        projectName: 'Container',
        scheduleProjectName: 'Target Project',
      },
      { id: 'schedule-other', projectId: OTHER_PROJECT_ID, projectName: 'Other Project' },
    ],
    daveSyncTombstones: [{
      entityType: 'schedule_item' as const,
      recordId: 'previous-schedule-delete',
      deletedAt: '2026-07-17T12:00:00.000Z',
    }],
    draft: {
      draft: { projectId: TARGET_PROJECT_ID, projectName: 'Target Project' },
      savedAt: 'old',
    },
    draftBelongsToProject: true,
    draftHasUnboundProjectScope: false,
    replacementDraft: { draft: { projectName: 'Other Project' }, savedAt: NOW },
    cloudIntents: [{
      projectId: PREVIOUS_PROJECT_ID,
      projectName: 'Previously Deleted',
      requestedAt: NOW,
    }],
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
    expect(cascade.nextDeletedProjectNames).toEqual(['Previously Deleted']);
    expect(cascade.remainingArchivedProjects).toEqual(['Target Project', 'Other Project']);
    expect(cascade.remainingUpdates.map(item => item.id)).toEqual(['update-other']);
    expect(cascade.removedUpdates.map(item => item.id)).toEqual([
      'update-target',
      'update-target-task',
    ]);
    expect(cascade.nextUpdateTombstones.map(item => item.updateId)).toEqual([
      'update-target',
      'update-target-task',
      'already-deleted',
    ]);
    expect(cascade.nextUpdateDeletionIntents.map(item => item.updateId)).toEqual([
      'update-target',
      'update-target-task',
      'already-deleted',
    ]);
    expect(cascade.remainingProjectDocuments.map(item => item.id)).toEqual([
      'project-doc-other',
    ]);
    expect(cascade.remainingReferenceDocuments.map(item => item.id)).toEqual([
      'reference-unscoped',
      'reference-other',
    ]);
    expect(cascade.remainingProjectAreas.map(item => item.id)).toEqual([
      'area-other',
      'area-legacy',
    ]);
    expect(cascade.removedProjectAreas.map(item => item.id)).toEqual([
      'area-target',
    ]);
    expect(cascade.remainingScheduleItems.map(item => item.id)).toEqual([
      'schedule-other',
    ]);
    expect(cascade.nextDAVESyncTombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'project', recordId: TARGET_PROJECT_ID }),
      expect.objectContaining({ entityType: 'project_update', recordId: 'update-target' }),
      expect.objectContaining({ entityType: 'project_update', recordId: 'update-target-task' }),
      expect.objectContaining({ entityType: 'schedule_item', recordId: 'schedule-target' }),
      expect.objectContaining({ entityType: 'schedule_item', recordId: 'schedule-target-parent' }),
      expect.objectContaining({ entityType: 'project_area', recordId: 'area-target' }),
      expect.objectContaining({ entityType: 'reference_document', recordId: 'reference-by-name' }),
      expect.objectContaining({ entityType: 'reference_document', recordId: 'reference-by-id' }),
      expect.objectContaining({ entityType: 'schedule_item', recordId: 'previous-schedule-delete' }),
    ]));
    expect(cascade.draftReplaced).toBe(true);
    expect(cascade.nextDraft).toEqual({
      draft: { projectName: 'Other Project' },
      savedAt: NOW,
    });
    expect(cascade.nextCloudIntents).toEqual([
      { projectId: TARGET_PROJECT_ID, projectName: 'Target Project', requestedAt: NOW },
      {
        projectId: PREVIOUS_PROJECT_ID,
        projectName: 'Previously Deleted',
        requestedAt: NOW,
      },
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
      keys.projectAreas,
      keys.scheduleItems,
      keys.daveSyncTombstones,
      keys.cloudIntents,
      keys.fileCleanupIntents,
      keys.activeDraft,
    ]);
  });

  it('keeps a same-name sibling and binds every destructive barrier to the selected id', () => {
    const cascade = buildProjectDeletionCascade({
      projectName: 'Shared Project',
      authorityProjectId: SELECTED_PROJECT_ID,
      deletedAt: NOW,
      projectRecords: [
        { id: SELECTED_PROJECT_ID, name: 'Shared Project' },
        { id: SIBLING_PROJECT_ID, name: 'Shared Project' },
      ],
      deletedProjectNames: [],
      archivedProjects: ['Shared Project'],
      updates: [
        { id: 'selected-update', projectId: SELECTED_PROJECT_ID, projectName: 'Shared Project' },
        { id: 'sibling-update', projectId: SIBLING_PROJECT_ID, projectName: 'Shared Project' },
      ],
      updateTombstones: [],
      updateDeletionIntents: [],
      projectDocuments: [
        { projectId: SELECTED_PROJECT_ID },
        { projectId: SIBLING_PROJECT_ID },
      ],
      referenceDocuments: [
        { id: 'selected-reference', projectId: SELECTED_PROJECT_ID },
        { id: 'sibling-reference', projectId: SIBLING_PROJECT_ID },
      ],
      projectAreas: [
        { id: 'selected-area', projectId: SELECTED_PROJECT_ID, projectName: 'Shared Project' },
        { id: 'sibling-area', projectId: SIBLING_PROJECT_ID, projectName: 'Shared Project' },
      ],
      scheduleItems: [
        { id: 'selected-task', projectId: SELECTED_PROJECT_ID, projectName: 'Shared Project' },
        { id: 'sibling-task', projectId: SIBLING_PROJECT_ID, projectName: 'Shared Project' },
      ],
      daveSyncTombstones: [],
      draft: null,
      draftBelongsToProject: false,
      draftHasUnboundProjectScope: false,
      replacementDraft: null,
      cloudIntents: [],
      fileCleanupIntents: [],
      newFileCleanupIntents: [],
      buildUpdateTombstone: () => ({ updateId: 'unused' }),
    });

    expect(cascade.remainingProjectRecords.map(record => record.id)).toEqual([
      SIBLING_PROJECT_ID,
    ]);
    expect(cascade.removedUpdates.map(update => update.id)).toEqual([
      'selected-update',
    ]);
    expect(cascade.remainingUpdates.map(update => update.id)).toEqual([
      'sibling-update',
    ]);
    expect(cascade.removedProjectAreas.map(area => area.id)).toEqual(['selected-area']);
    expect(cascade.removedScheduleItems.map(item => item.id)).toEqual(['selected-task']);
    expect(cascade.removedReferenceDocuments.map(document => document.id)).toEqual([
      'selected-reference',
    ]);
    expect(cascade.remainingArchivedProjects).toEqual(['Shared Project']);
    expect(cascade.nextDeletedProjectNames).toEqual([]);
    expect(cascade.nextDAVESyncTombstones).toContainEqual({
      entityType: 'project',
      recordId: SELECTED_PROJECT_ID,
      deletedAt: NOW,
    });
    expect(cascade.nextCloudIntents).toEqual([{
      projectId: SELECTED_PROJECT_ID,
      projectName: 'Shared Project',
      requestedAt: NOW,
    }]);
  });

  it('blocks before preparing operations when target-looking child data has no immutable id', () => {
    expect(() => buildProjectDeletionCascade({
      projectName: 'Target Project',
      authorityProjectId: TARGET_PROJECT_ID,
      deletedAt: NOW,
      projectRecords: [{ id: TARGET_PROJECT_ID, name: 'Target Project' }],
      deletedProjectNames: [],
      archivedProjects: [],
      updates: [{ id: 'legacy-update', projectName: 'Target Project' }],
      updateTombstones: [],
      updateDeletionIntents: [],
      projectDocuments: [],
      referenceDocuments: [{ id: 'legacy-reference', projectName: 'Target Project' }],
      projectAreas: [],
      scheduleItems: [],
      daveSyncTombstones: [],
      draft: null,
      draftBelongsToProject: false,
      draftHasUnboundProjectScope: false,
      replacementDraft: null,
      cloudIntents: [],
      fileCleanupIntents: [],
      newFileCleanupIntents: [],
      buildUpdateTombstone: update => ({ updateId: update.id }),
    })).toThrow(/project_update:legacy-update.*reference_document:legacy-reference/i);
  });

  it('blocks shared legacy reference documents when any projectNames entry names the target', () => {
    expect(() => buildProjectDeletionCascade({
      projectName: 'Target Project',
      authorityProjectId: TARGET_PROJECT_ID,
      deletedAt: NOW,
      projectRecords: [{ id: TARGET_PROJECT_ID, name: 'Target Project' }],
      deletedProjectNames: [],
      archivedProjects: [],
      updates: [],
      updateTombstones: [],
      updateDeletionIntents: [],
      projectDocuments: [],
      referenceDocuments: [{
        id: 'shared-legacy-reference',
        projectNames: ['Other Project', 'Target Project'],
      }],
      projectAreas: [],
      scheduleItems: [],
      daveSyncTombstones: [],
      draft: null,
      draftBelongsToProject: false,
      draftHasUnboundProjectScope: false,
      replacementDraft: null,
      cloudIntents: [],
      fileCleanupIntents: [],
      newFileCleanupIntents: [],
      buildUpdateTombstone: () => ({ updateId: 'unused' }),
    })).toThrow(/reference_document:shared-legacy-reference/i);
  });

  it('uses display-name fallback only when a legacy restore barrier explicitly requests it', () => {
    const legacyReference = { id: 'legacy-reference', projectName: 'Target Project' };
    const siblingReference = {
      id: 'sibling-reference',
      projectId: SIBLING_PROJECT_ID,
      projectName: 'Target Project',
    };
    expect(referenceDocumentMatchesProject(
      legacyReference,
      'Target Project',
      TARGET_PROJECT_ID,
    )).toBe(false);
    expect(referenceDocumentMatchesProject(
      legacyReference,
      'Target Project',
      TARGET_PROJECT_ID,
      true,
    )).toBe(true);
    expect(referenceDocumentMatchesProject(
      siblingReference,
      'Target Project',
      TARGET_PROJECT_ID,
      true,
    )).toBe(false);
    expect(scheduleItemMatchesProject(
      { id: 'sibling-task', projectId: SIBLING_PROJECT_ID, projectName: 'Target Project' },
      'Target Project',
      TARGET_PROJECT_ID,
      true,
    )).toBe(false);
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
  it('queues the selected immutable id even when a same-name sibling delete is already pending', async () => {
    const intent = {
      projectId: SELECTED_PROJECT_ID,
      projectName: 'Shared Project',
      requestedAt: NOW,
    };
    const values = new Map<string, string>([
      [keys.cloudIntents, JSON.stringify([intent])],
      [keys.fileCleanupIntents, '[]'],
      [keys.daveSyncTombstones, '[]'],
    ]);
    const queueCloudProjectDelete = jest.fn(async () => undefined);
    const runtime = createProjectDeletionRuntime({
      storage: {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
        removeItem: async key => { values.delete(key); },
      },
      storageKeys: keys,
      createTransactionId: () => 'exact-cloud-intent',
      now: () => NOW,
      getOfflineQueue: async () => [{
        entity: 'project',
        operation: 'delete',
        payload: { projectId: SIBLING_PROJECT_ID, name: 'Shared Project' },
      }],
      queueCloudProjectDelete,
      cleanupLocalFile: async () => undefined,
    });

    await expect(runtime.processPendingCloudIntents()).resolves.toBeUndefined();
    expect(queueCloudProjectDelete).toHaveBeenCalledWith(
      SELECTED_PROJECT_ID,
      'Shared Project',
    );
    expect(values.get(keys.cloudIntents)).toBe('[]');
  });

  it('keeps a legacy name-only cloud intent pending instead of issuing an unsafe delete', async () => {
    const legacyIntent = { projectName: 'Legacy Project', requestedAt: NOW };
    const values = new Map<string, string>([
      [keys.cloudIntents, JSON.stringify([legacyIntent])],
      [keys.fileCleanupIntents, '[]'],
      [keys.daveSyncTombstones, '[]'],
    ]);
    const queueCloudProjectDelete = jest.fn(async () => undefined);
    const runtime = createProjectDeletionRuntime({
      storage: {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
        removeItem: async key => { values.delete(key); },
      },
      storageKeys: keys,
      createTransactionId: () => 'legacy-cloud-intent',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete,
      cleanupLocalFile: async () => undefined,
    });

    await expect(runtime.processPendingCloudIntents()).rejects.toThrow(
      /missing its immutable project ID/i,
    );
    expect(queueCloudProjectDelete).not.toHaveBeenCalled();
    expect(JSON.parse(values.get(keys.cloudIntents) || '[]')).toEqual([legacyIntent]);
  });

  it('removes only a completed exact intent and retains a same-name legacy intent pending', async () => {
    const exactIntent = {
      projectId: SELECTED_PROJECT_ID,
      projectName: 'Shared Project',
      requestedAt: NOW,
    };
    const legacyIntent = { projectName: 'Shared Project', requestedAt: NOW };
    const values = new Map<string, string>([
      [keys.cloudIntents, JSON.stringify([exactIntent, legacyIntent])],
      [keys.fileCleanupIntents, '[]'],
      [keys.daveSyncTombstones, '[]'],
    ]);
    const queueCloudProjectDelete = jest.fn(async () => undefined);
    const runtime = createProjectDeletionRuntime({
      storage: {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
        removeItem: async key => { values.delete(key); },
      },
      storageKeys: keys,
      createTransactionId: () => 'mixed-exact-legacy-cloud-intent',
      now: () => NOW,
      getOfflineQueue: async () => [],
      queueCloudProjectDelete,
      cleanupLocalFile: async () => undefined,
    });

    await expect(runtime.processPendingCloudIntents()).rejects.toThrow(
      /missing its immutable project ID/i,
    );
    expect(queueCloudProjectDelete).toHaveBeenCalledTimes(1);
    expect(queueCloudProjectDelete).toHaveBeenCalledWith(
      SELECTED_PROJECT_ID,
      'Shared Project',
    );
    expect(JSON.parse(values.get(keys.cloudIntents) || '[]')).toEqual([legacyIntent]);
  });

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
