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

const NOW = '2026-07-18T12:00:00.000Z';

const targetKeys: BackupRestoreTargetKeys = {
  updates: 'updates',
  projects: 'projects',
  archivedProjects: 'archived-projects',
  contacts: 'contacts',
  projectAreas: 'areas',
  referenceDocuments: 'reference-documents',
  projectDocuments: 'project-documents',
  scheduleItems: 'schedule-items',
  activeDraft: 'draft',
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
  contactBook: (value: unknown) => Array.isArray(record(value)?.contacts),
  projectArea: (value: unknown) => Boolean(record(value)?.name),
  referenceDocument: (value: unknown) => Boolean(record(value)?.id),
  projectDocument: (value: unknown) => Boolean(record(value)?.id),
  scheduleItem: (value: unknown) => Boolean(record(value)?.id),
  draftEnvelope: (value: unknown) => Boolean(record(value)?.draft),
};

function validBackup() {
  return {
    version: APP_BACKUP_VERSION,
    exportedAt: NOW,
    savedUpdates: [{ id: 'update-1' }],
    projects: ['Keep Project'],
    archivedProjects: [],
    contacts: { contacts: [] },
    projectAreas: [{ name: 'Area' }],
    referenceDocuments: [{ id: 'reference-1' }],
    projectDocuments: [{ id: 'document-1' }],
    scheduleItems: [{ id: 'schedule-1' }],
    activeDraft: null,
  };
}

function initialValues() {
  return new Map<string, string>([
    [barrierKeys.deletedProjects, JSON.stringify(['Deleted Project'])],
    [barrierKeys.deletedUpdates, JSON.stringify([{ updateId: 'deleted-update' }])],
    [barrierKeys.updateDeletionJournal, JSON.stringify([{ updateId: 'pending-update' }])],
    [barrierKeys.projectDeletionCloudIntents, JSON.stringify([{
      projectName: 'Cloud Delete Project',
      requestedAt: NOW,
    }])],
    [barrierKeys.projectDeletionFileCleanupIntents, '[]'],
    [barrierKeys.daveSyncTombstones, '[]'],
    [targetKeys.projects, JSON.stringify([{ name: 'Old Project' }])],
    [targetKeys.updates, JSON.stringify([{ id: 'old-update' }])],
    [targetKeys.activeDraft, JSON.stringify({ draft: { id: 'old-draft' } })],
  ]);
}

function runtimeFor(
  values: Map<string, string>,
  setItem?: (key: string, value: string) => Promise<void>,
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
    loadQueuedProjectDeletionNames: async () => ['Queued Delete Project'],
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
    activeDraft: null,
  };
}

describe('strict backup preflight', () => {
  it('rejects an incompatible version before any normalization', () => {
    const result = preflightAppBackup({ ...validBackup(), version: 2 }, validators);
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
      expect(barriers.deletedProjectNames).toEqual([
        'Deleted Project',
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
          archivedProjects: [],
          contactBook: { contacts: [] },
          projectAreas: [],
          referenceDocuments: [],
          projectDocuments: [],
          scheduleItems: [],
          storedDraft: null,
        },
        barriers,
        currentProjectRecords: [] as Array<{ name: string }>,
        rebuildProjectRecords: (_current, names) => names.map(name => ({ name })),
        referenceDocumentBelongsToProject: () => false,
        projectDocumentBelongsToProject: () => false,
        scheduleItemBelongsToProject: () => false,
        createEmptyDraft: projectName => ({ id: 'draft', projectName }),
      });
      return {
        values: result.values,
        result: undefined,
      };
    });

    expect(JSON.parse(values.get(targetKeys.projects) || '[]')).toEqual([{ name: 'Keep Project' }]);
    expect(JSON.parse(values.get(targetKeys.updates) || '[]')).toEqual([
      { id: 'keep-update', projectName: 'Keep Project' },
    ]);
    expect(JSON.parse(values.get(barrierKeys.deletedProjects) || '[]')).toEqual(['Deleted Project']);
  });
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
