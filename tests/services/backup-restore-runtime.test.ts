import {
  APP_BACKUP_VERSION,
  BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY,
  BackupRestoreRecoveryRequiredError,
  buildDeletionSafeRestoreState,
  createBackupRestoreRuntime,
  preflightAppBackup,
  type BackupRestoreBarrierKeys,
  type BackupRestoreTargetKeys,
} from '../../services/BackupRestoreRuntime';
import fs from 'fs';
import path from 'path';

const NOW = '2026-07-18T12:00:00.000Z';
const DELETED_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CLOUD_DELETE_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const QUEUED_PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const KEEP_PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_A_ID = '55555555-5555-4555-8555-555555555555';
const PROJECT_B_ID = '66666666-6666-4666-8666-666666666666';

const targetKeys: BackupRestoreTargetKeys = {
  updates: 'updates',
  projects: 'projects',
  archivedProjects: 'archived-projects',
  contacts: 'contacts',
  projectAreas: 'areas',
  referenceDocuments: 'reference-documents',
  projectDocuments: 'project-documents',
  scheduleItems: 'schedule-items',
  captureMemories: 'capture-memories',
  activeDraft: 'draft',
  projectWalkSession: 'project-walk-session',
};

const barrierKeys: BackupRestoreBarrierKeys = {
  deletedProjects: 'deleted-projects',
  deletedUpdates: 'deleted-updates',
  updateDeletionJournal: 'update-deletion-journal',
  projectDeletionCloudIntents: 'project-cloud-deletion-intents',
  projectDeletionFileCleanupIntents: 'project-file-cleanup-intents',
  daveSyncTombstones: 'dave-tombstones',
  fieldUpdateTransactionJournal: 'field-journal',
  projectDeletionTransactionJournal: 'project-journal',
};

const validators = {
  savedUpdate: (value: unknown) => Boolean(record(value)?.id),
  projectName: (value: unknown) => typeof value === 'string' && Boolean(value.trim()),
  projectRecord: (value: unknown) => Boolean(record(value)?.id && record(value)?.name),
  contactBook: (value: unknown) => Array.isArray(record(value)?.contacts),
  projectArea: (value: unknown) => Boolean(record(value)?.name),
  referenceDocument: (value: unknown) => Boolean(record(value)?.id),
  projectDocument: (value: unknown) => Boolean(record(value)?.id),
  scheduleItem: (value: unknown) => Boolean(record(value)?.id),
  captureMemory: (value: unknown) => Boolean(record(value)?.id),
  draftEnvelope: (value: unknown) => Boolean(record(value)?.draft),
};

function validBackup() {
  return {
    version: APP_BACKUP_VERSION,
    exportedAt: NOW,
    savedUpdates: [{ id: 'update-1' }],
    projects: ['Keep Project'],
    projectRecords: [{ id: KEEP_PROJECT_ID, name: 'Keep Project' }],
    archivedProjects: [],
    contacts: { contacts: [] },
    projectAreas: [{ name: 'Area' }],
    referenceDocuments: [{ id: 'reference-1' }],
    projectDocuments: [{ id: 'document-1' }],
    scheduleItems: [{ id: 'schedule-1' }],
    captureMemories: [{ id: 'memory-1', projectId: KEEP_PROJECT_ID }],
    activeDraft: null,
  };
}

function initialValues() {
  return new Map<string, string>([
    [barrierKeys.deletedProjects, '[]'],
    [barrierKeys.deletedUpdates, JSON.stringify([{ updateId: 'deleted-update' }])],
    [barrierKeys.updateDeletionJournal, JSON.stringify([{ updateId: 'pending-update' }])],
    [barrierKeys.projectDeletionCloudIntents, JSON.stringify([{
      projectId: CLOUD_DELETE_PROJECT_ID,
      projectName: 'Cloud Delete Project',
      requestedAt: NOW,
    }])],
    [barrierKeys.projectDeletionFileCleanupIntents, '[]'],
    [barrierKeys.daveSyncTombstones, JSON.stringify([{
      entityType: 'project',
      recordId: DELETED_PROJECT_ID,
      deletedAt: NOW,
    }])],
    [targetKeys.projects, JSON.stringify([{ name: 'Old Project' }])],
    [targetKeys.updates, JSON.stringify([{ id: 'old-update' }])],
    [targetKeys.activeDraft, JSON.stringify({ draft: { id: 'old-draft' } })],
    [targetKeys.projectWalkSession, JSON.stringify({ id: 'stale-walk' })],
  ]);
}

function runtimeFor(
  values: Map<string, string>,
  setItem?: (key: string, value: string) => Promise<void>,
  queuedProjectDeletions: ReadonlyArray<Readonly<{
    projectId?: string;
    projectName: string;
  }>> = [{
    projectId: QUEUED_PROJECT_ID,
    projectName: 'Queued Delete Project',
  }],
) {
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: setItem || (async (key: string, value: string) => { values.set(key, value); }),
    removeItem: async (key: string) => { values.delete(key); },
  };
  return createBackupRestoreRuntime({
    storage,
    targetKeys,
    barrierKeys,
    createTransactionId: () => 'backup-restore-test',
    now: () => NOW,
    recoverProjectDeletion: async () => undefined,
    recoverFieldUpdate: async () => undefined,
    loadQueuedProjectDeletions: async () => queuedProjectDeletions,
  });
}

function restoreValues(projects: unknown, updates: unknown) {
  return {
    projects,
    updates,
    archivedProjects: [],
    contacts: { contacts: [] },
    projectAreas: [],
    referenceDocuments: [],
    projectDocuments: [],
    scheduleItems: [],
    captureMemories: [],
    activeDraft: null,
    projectWalkSession: null,
  };
}

describe('strict backup preflight', () => {
  it('rejects an incompatible version before any normalization', () => {
    const result = preflightAppBackup({ ...validBackup(), version: 1 }, validators);
    expect(result).toMatchObject({ ok: false, reason: 'incompatible_version', field: 'version' });
  });

  it('rejects the whole backup when any nested record is malformed', () => {
    const backup = validBackup();
    backup.savedUpdates.push({ id: '' });
    const result = preflightAppBackup(backup, validators);
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid_backup',
      field: 'savedUpdates[1]',
    });
  });

  it('rejects duplicate project names and stable record ids', () => {
    const duplicateProject = validBackup();
    duplicateProject.projects.push(' keep project ');
    expect(preflightAppBackup(duplicateProject, validators)).toMatchObject({
      ok: false,
      field: 'projects',
    });

    const duplicateUpdate = validBackup();
    duplicateUpdate.savedUpdates.push({ id: 'update-1' });
    expect(preflightAppBackup(duplicateUpdate, validators)).toMatchObject({
      ok: false,
      field: 'savedUpdates',
    });
  });

  it('requires stable ids for every restored update, document, and schedule row', () => {
    const missingScheduleId = {
      ...validBackup(),
      scheduleItems: [{ name: 'No stable id' }] as unknown[],
    };
    const permissiveValidators = {
      ...validators,
      scheduleItem: () => true,
    };
    expect(preflightAppBackup(missingScheduleId, permissiveValidators)).toMatchObject({
      ok: false,
      field: 'scheduleItems',
    });
  });

  it('requires portable project records and rejects orphaned memory project IDs', () => {
    expect(preflightAppBackup({
      ...validBackup(),
      projectRecords: undefined,
    }, validators)).toMatchObject({
      ok: false,
      field: 'projectRecords',
    });
    expect(preflightAppBackup({
      ...validBackup(),
      captureMemories: [{ id: 'memory-1', projectId: 'project-other' }],
    }, validators)).toMatchObject({
      ok: false,
      field: 'captureMemories[0].projectId',
    });
  });

  it('wires immutable project records and stale-walk removal into the live backup path', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    expect(app).toContain('projectRecords: backupProjectRecords');
    expect(app).toContain('projectRecords: normalizeBackupProjectRecords(data.projectRecords)');
    expect(app).toContain('captureMemoryProjectId: memory => memory.projectId');
    expect(app).toContain('setActiveProjectWalkSession(restoredProjectWalkSession)');
  });
});

describe('atomic backup restore', () => {
  it('rolls a one-time mid-write failure forward and preserves every deletion barrier', async () => {
    const values = initialValues();
    const barrierBefore = new Map(
      Object.values(barrierKeys)
        .filter(key => values.has(key))
        .map(key => [key, values.get(key)]),
    );
    let failContactsOnce = true;
    const runtime = runtimeFor(values, async (key, value) => {
      if (key === targetKeys.contacts && failContactsOnce) {
        failContactsOnce = false;
        throw new Error('one-time storage interruption');
      }
      values.set(key, value);
    });

    await expect(runtime.commit(barriers => {
      expect(barriers.deletedProjectNames).toEqual([]);
      expect(barriers.unresolvedLegacyProjectDeletionNames).toEqual([]);
      expect(barriers.deletedProjectIds).toEqual([
        CLOUD_DELETE_PROJECT_ID,
        QUEUED_PROJECT_ID,
      ]);
      expect(barriers.projectTombstoneRecordIds).toEqual([DELETED_PROJECT_ID]);
      expect(barriers.pendingProjectDeletionIds).toEqual([
        CLOUD_DELETE_PROJECT_ID,
        QUEUED_PROJECT_ID,
      ]);
      expect(barriers.pendingProjectDeletionNames).toEqual([
        'Cloud Delete Project',
        'Queued Delete Project',
      ]);
      expect(barriers.deletedUpdateIds).toEqual(['deleted-update']);
      expect(barriers.pendingUpdateDeletionIds).toEqual(['pending-update']);
      return {
        values: restoreValues([{ name: 'Keep Project' }], [{ id: 'keep-update' }]),
        result: 'published-after-commit',
      };
    })).resolves.toBe('published-after-commit');

    expect(JSON.parse(values.get(targetKeys.projects) || '[]')).toEqual([{ name: 'Keep Project' }]);
    expect(values.has(targetKeys.activeDraft)).toBe(false);
    expect(values.has(targetKeys.projectWalkSession)).toBe(false);
    expect(values.has(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY)).toBe(false);
    barrierBefore.forEach((raw, key) => expect(values.get(key)).toBe(raw));
  });

  it('finishes an interrupted restore on restart before startup reads', async () => {
    const values = initialValues();
    let storageUnavailable = true;
    const interrupted = runtimeFor(values, async (key, value) => {
      if (key === targetKeys.contacts && storageUnavailable) {
        throw new Error('device stopped during restore');
      }
      values.set(key, value);
    });
    const valuesToRestore = restoreValues(
      [{ name: 'Restart Project' }],
      [{ id: 'restart-update' }],
    );

    await expect(interrupted.commit(() => ({
      values: valuesToRestore,
      result: undefined,
    }))).rejects.toBeInstanceOf(BackupRestoreRecoveryRequiredError);
    expect(values.has(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY)).toBe(true);

    storageUnavailable = false;
    const restarted = runtimeFor(values);
    await expect(restarted.recoverBeforeStartupReads()).resolves.toBeUndefined();
    expect(JSON.parse(values.get(targetKeys.projects) || '[]')).toEqual([{ name: 'Restart Project' }]);
    expect(JSON.parse(values.get(targetKeys.updates) || '[]')).toEqual([{ id: 'restart-update' }]);
    expect(values.has(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY)).toBe(false);
  });

  it('keeps deleted projects and updates excluded when preparing restored values', async () => {
    const values = initialValues();
    const runtime = runtimeFor(values);
    const backupProjects = ['Deleted Project', 'Keep Project', 'Queued Delete Project'];
    const backupUpdates = [
      { id: 'deleted-update', projectName: 'Keep Project' },
      { id: 'pending-update', projectName: 'Keep Project' },
      { id: 'keep-update', projectName: 'Keep Project' },
    ];

    await runtime.commit(barriers => {
      const result = buildDeletionSafeRestoreState({
        data: {
          savedUpdates: backupUpdates,
          projects: backupProjects,
          projectRecords: [
            { id: DELETED_PROJECT_ID, name: 'Deleted Project' },
            { id: KEEP_PROJECT_ID, name: 'Keep Project' },
            { id: QUEUED_PROJECT_ID, name: 'Queued Delete Project' },
          ],
          archivedProjects: [],
          contactBook: { contacts: [] },
          projectAreas: [],
          referenceDocuments: [],
          projectDocuments: [],
          scheduleItems: [],
          captureMemories: [
            { id: 'deleted-memory', projectId: DELETED_PROJECT_ID },
            { id: 'keep-memory', projectId: KEEP_PROJECT_ID },
          ],
          storedDraft: null,
        },
        barriers,
        referenceDocumentBelongsToProject: () => false,
        projectDocumentBelongsToProject: () => false,
        scheduleItemBelongsToProject: () => false,
        captureMemoryProjectId: memory => memory.projectId,
        serializeCaptureMemories: memories => memories,
        createEmptyDraft: projectName => ({ id: 'draft', projectName }),
      });
      return {
        values: result.values,
        result: undefined,
      };
    });

    expect(JSON.parse(values.get(targetKeys.projects) || '[]')).toEqual([
      { id: KEEP_PROJECT_ID, name: 'Keep Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.updates) || '[]')).toEqual([
      { id: 'keep-update', projectName: 'Keep Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.captureMemories) || '[]')).toEqual([
      { id: 'keep-memory', projectId: KEEP_PROJECT_ID },
    ]);
    expect(JSON.parse(values.get(barrierKeys.deletedProjects) || '[]')).toEqual([]);
  });

  it('rejects a deleted immutable project id even when the imported display name changed', async () => {
    const deletedProjectId = '550e8400-e29b-41d4-a716-446655440000';
    const values = initialValues();
    values.set(barrierKeys.daveSyncTombstones, JSON.stringify([{
      entityType: 'project',
      recordId: deletedProjectId,
      deletedAt: NOW,
    }]));
    const runtime = runtimeFor(values);

    await runtime.commit(barriers => {
      expect(barriers.projectTombstoneRecordIds).toContain(deletedProjectId);
      const result = buildDeletionSafeRestoreState({
        data: {
          savedUpdates: [{
            id: 'renamed-update',
            projectId: deletedProjectId,
            projectName: 'Renamed Project',
          }],
          projects: ['Renamed Project', 'Keep Project'],
          projectRecords: [
            { id: deletedProjectId, name: 'Renamed Project' },
            { id: KEEP_PROJECT_ID, name: 'Keep Project' },
          ],
          archivedProjects: [],
          contactBook: { contacts: [] },
          projectAreas: [],
          referenceDocuments: [],
          projectDocuments: [],
          scheduleItems: [],
          captureMemories: [
            { id: 'renamed-memory', projectId: deletedProjectId },
            { id: 'keep-memory', projectId: KEEP_PROJECT_ID },
          ],
          storedDraft: null,
        },
        barriers,
        referenceDocumentBelongsToProject: () => false,
        projectDocumentBelongsToProject: () => false,
        scheduleItemBelongsToProject: () => false,
        captureMemoryProjectId: memory => memory.projectId,
        serializeCaptureMemories: memories => memories,
        createEmptyDraft: projectName => ({ id: 'draft', projectName }),
      });
      return { values: result.values, result };
    });

    expect(JSON.parse(values.get(targetKeys.projects) || '[]')).toEqual([
      { id: KEEP_PROJECT_ID, name: 'Keep Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.updates) || '[]')).toEqual([]);
    expect(JSON.parse(values.get(targetKeys.captureMemories) || '[]')).toEqual([
      { id: 'keep-memory', projectId: KEEP_PROJECT_ID },
    ]);
  });

  it('blocks restore when historical name-only deletion state cannot prove an immutable id', async () => {
    const values = initialValues();
    values.set(barrierKeys.deletedProjects, JSON.stringify(['Historical Project Name']));
    const runtime = runtimeFor(values);

    await expect(runtime.commit(barriers => {
      expect(barriers.unresolvedLegacyProjectDeletionNames).toEqual([
        'Historical Project Name',
      ]);
      const result = buildDeletionSafeRestoreState({
        data: {
          savedUpdates: [{
            id: 'renamed-update',
            projectId: PROJECT_A_ID,
            projectName: 'Renamed Project',
          }],
          projects: ['Renamed Project'],
          projectRecords: [{ id: PROJECT_A_ID, name: 'Renamed Project' }],
          archivedProjects: [],
          contactBook: { contacts: [] },
          projectAreas: [],
          referenceDocuments: [],
          projectDocuments: [],
          scheduleItems: [],
          captureMemories: [{ id: 'renamed-memory', projectId: PROJECT_A_ID }],
          storedDraft: null,
        },
        barriers,
        referenceDocumentBelongsToProject: () => false,
        projectDocumentBelongsToProject: () => false,
        scheduleItemBelongsToProject: () => false,
        captureMemoryProjectId: memory => memory.projectId,
        serializeCaptureMemories: memories => memories,
        createEmptyDraft: projectName => ({ id: 'draft', projectName }),
      });
      return { values: result.values, result };
    })).rejects.toThrow(/legacy project deletion history.*immutable project IDs/i);
  });

  it('blocks a UUID-shaped legacy project name instead of treating syntax as exact authority', async () => {
    const uuidShapedLegacyName = PROJECT_B_ID;
    const values = initialValues();
    values.set(barrierKeys.daveSyncTombstones, JSON.stringify([{
      entityType: 'project',
      recordId: uuidShapedLegacyName,
      deletedAt: NOW,
    }]));
    const runtime = runtimeFor(values, undefined, []);

    await expect(runtime.commit(barriers => {
      const result = buildDeletionSafeRestoreState({
        data: {
          savedUpdates: [],
          projects: [uuidShapedLegacyName],
          projectRecords: [{ id: PROJECT_A_ID, name: uuidShapedLegacyName }],
          archivedProjects: [],
          contactBook: { contacts: [] },
          projectAreas: [],
          referenceDocuments: [],
          projectDocuments: [],
          scheduleItems: [],
          captureMemories: [{ id: 'legacy-name-memory', projectId: PROJECT_A_ID }],
          storedDraft: null,
        },
        barriers,
        referenceDocumentBelongsToProject: () => false,
        projectDocumentBelongsToProject: () => false,
        scheduleItemBelongsToProject: () => false,
        captureMemoryProjectId: memory => memory.projectId,
        serializeCaptureMemories: memories => memories,
        createEmptyDraft: projectName => ({ id: 'draft', projectName }),
      });
      return { values: result.values, result };
    })).rejects.toThrow(/legacy project deletion history.*immutable project IDs/i);
  });

  it('keeps same-name B and exact-B children when only exact A is pending deletion', async () => {
    const values = initialValues();
    const runtime = runtimeFor(values, undefined, [{
      projectId: PROJECT_A_ID,
      projectName: 'Shared Project',
    }]);

    await runtime.commit(barriers => {
      expect(barriers.deletedProjectIds).toContain(PROJECT_A_ID);
      expect(barriers.deletedProjectNames).not.toContain('Shared Project');
      const result = buildDeletionSafeRestoreState({
        data: {
          savedUpdates: [
            { id: 'a-update', projectId: PROJECT_A_ID, projectName: 'Renamed A' },
            { id: 'b-update', projectId: PROJECT_B_ID, projectName: 'Shared Project' },
          ],
          projects: ['Renamed A', 'Shared Project'],
          projectRecords: [
            { id: PROJECT_A_ID, name: 'Renamed A' },
            { id: PROJECT_B_ID, name: 'Shared Project' },
          ],
          archivedProjects: [],
          contactBook: { contacts: [] },
          projectAreas: [
            { projectId: PROJECT_A_ID, projectName: 'Renamed A' },
            { projectId: PROJECT_B_ID, projectName: 'Shared Project' },
          ],
          referenceDocuments: [
            { projectId: PROJECT_A_ID, projectName: 'Renamed A' },
            { projectId: PROJECT_B_ID, projectName: 'Shared Project' },
          ],
          projectDocuments: [
            { projectId: PROJECT_A_ID },
            { projectId: PROJECT_B_ID },
          ],
          scheduleItems: [
            { projectId: PROJECT_A_ID, projectName: 'Renamed A' },
            { projectId: PROJECT_B_ID, projectName: 'Shared Project' },
          ],
          captureMemories: [
            { id: 'a-memory', projectId: PROJECT_A_ID },
            { id: 'b-memory', projectId: PROJECT_B_ID },
          ],
          storedDraft: null,
        },
        barriers,
        referenceDocumentBelongsToProject: () => false,
        projectDocumentBelongsToProject: () => false,
        scheduleItemBelongsToProject: () => false,
        captureMemoryProjectId: memory => memory.projectId,
        serializeCaptureMemories: memories => memories,
        createEmptyDraft: projectName => ({ id: 'draft', projectName }),
      });
      return { values: result.values, result };
    });

    expect(JSON.parse(values.get(targetKeys.projects) || '[]')).toEqual([
      { id: PROJECT_B_ID, name: 'Shared Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.updates) || '[]')).toEqual([
      { id: 'b-update', projectId: PROJECT_B_ID, projectName: 'Shared Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.projectAreas) || '[]')).toEqual([
      { projectId: PROJECT_B_ID, projectName: 'Shared Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.referenceDocuments) || '[]')).toEqual([
      { projectId: PROJECT_B_ID, projectName: 'Shared Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.projectDocuments) || '[]')).toEqual([
      { projectId: PROJECT_B_ID },
    ]);
    expect(JSON.parse(values.get(targetKeys.scheduleItems) || '[]')).toEqual([
      { projectId: PROJECT_B_ID, projectName: 'Shared Project' },
    ]);
    expect(JSON.parse(values.get(targetKeys.captureMemories) || '[]')).toEqual([
      { id: 'b-memory', projectId: PROJECT_B_ID },
    ]);
  });
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
