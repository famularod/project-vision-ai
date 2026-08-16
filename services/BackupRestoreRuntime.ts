import type { DurableLocalTransactionOperation } from './DurableLocalTransaction';
import { createDurableLocalTransactionRepository } from './DurableLocalTransaction';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';
import { resolveProjectTombstoneAuthority } from './ProjectTombstoneAuthority';

/**
 * Version 2 is the first portable format with immutable project records.
 * Version 1 remains intentionally incompatible because its name-only project
 * list cannot prove which exact project owns ID-bound evidence.
 */
export const APP_BACKUP_VERSION = 2 as const;
export const BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY =
  'projectPhotoUpdate.backupRestoreTransaction.v1';

type Storage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

export type BackupRestoreTargetKeys = Readonly<{
  updates: string;
  projects: string;
  archivedProjects: string;
  contacts: string;
  projectAreas: string;
  referenceDocuments: string;
  projectDocuments: string;
  scheduleItems: string;
  captureMemories: string;
  activeDraft: string;
  projectWalkSession: string;
}>;

export type BackupRestoreBarrierKeys = Readonly<{
  deletedProjects: string;
  deletedUpdates: string;
  updateDeletionJournal: string;
  projectDeletionCloudIntents: string;
  projectDeletionFileCleanupIntents: string;
  daveSyncTombstones: string;
  fieldUpdateTransactionJournal: string;
  projectDeletionTransactionJournal: string;
}>;

export type BackupRestoreBarrierState = Readonly<{
  deletedProjectIds: readonly string[];
  deletedProjectNames: readonly string[];
  unresolvedLegacyProjectDeletionNames: readonly string[];
  /** Raw legacy/current project tombstones. Their authority needs imported project records. */
  projectTombstoneRecordIds?: readonly string[];
  deletedUpdateIds: readonly string[];
  pendingUpdateDeletionIds: readonly string[];
  pendingProjectDeletionIds: readonly string[];
  pendingProjectDeletionNames: readonly string[];
}>;

export type QueuedProjectDeletionBarrier = Readonly<{
  projectId?: string;
  projectName: string;
}>;

export type BackupRestoreValues = Readonly<{
  updates: unknown;
  projects: unknown;
  archivedProjects: unknown;
  contacts: unknown;
  projectAreas: unknown;
  referenceDocuments: unknown;
  projectDocuments: unknown;
  scheduleItems: unknown;
  captureMemories: unknown;
  activeDraft: unknown | null;
  projectWalkSession: null;
}>;

export function buildDeletionSafeRestoreState<
  TUpdate extends { id: string; projectId?: string | null; projectName: string },
  TProjectRecord extends { id: string; name: string },
  TContactBook,
  TProjectArea extends { projectId?: string | null; projectName?: string | null },
  TReferenceDocument extends { projectId?: string | null },
  TProjectDocument extends { projectId?: string | null },
  TScheduleItem extends { projectId?: string | null },
  TCaptureMemory,
  TDraft extends { id: string; projectId?: string | null; projectName: string },
  TStoredDraft extends { draft: TDraft; savedAt: string },
>({
  data,
  barriers,
  referenceDocumentBelongsToProject,
  projectDocumentBelongsToProject,
  scheduleItemBelongsToProject,
  captureMemoryProjectId,
  serializeCaptureMemories,
  createEmptyDraft,
}: Readonly<{
  data: Readonly<{
    savedUpdates: TUpdate[];
    projects: string[];
    projectRecords: TProjectRecord[];
    archivedProjects: string[];
    contactBook: TContactBook;
    projectAreas: TProjectArea[];
    referenceDocuments: TReferenceDocument[];
    projectDocuments: TProjectDocument[];
    scheduleItems: TScheduleItem[];
    captureMemories: TCaptureMemory[];
    storedDraft: TStoredDraft | null;
  }>;
  barriers: BackupRestoreBarrierState;
  referenceDocumentBelongsToProject: (document: TReferenceDocument, projectName: string) => boolean;
  projectDocumentBelongsToProject: (document: TProjectDocument, projectName: string) => boolean;
  scheduleItemBelongsToProject: (item: TScheduleItem, projectName: string) => boolean;
  captureMemoryProjectId: (memory: TCaptureMemory) => string;
  serializeCaptureMemories: (memories: readonly TCaptureMemory[]) => unknown;
  createEmptyDraft: (projectName: string) => TDraft;
}>) {
  const tombstoneAuthorities = resolveImportedProjectTombstones(
    barriers.projectTombstoneRecordIds || [],
    data.projectRecords,
  );
  const unresolvedLegacyProjectDeletionNames = uniqueStrings([
    ...barriers.unresolvedLegacyProjectDeletionNames,
    ...tombstoneAuthorities.unresolvedNames,
    ...tombstoneAuthorities.ambiguousRecordIds,
  ]);
  if (unresolvedLegacyProjectDeletionNames.length > 0) {
    throw new Error(
      'Data import is blocked until legacy project deletion history is reconciled to immutable project IDs.',
    );
  }
  const deletedProjectIds = new Set([
    ...barriers.deletedProjectIds,
    ...tombstoneAuthorities.exactIds,
  ].map(normalizedKey));
  const deletedProjectKeys = new Set(barriers.deletedProjectNames.map(normalizedKey));
  const deletedUpdateIds = new Set([
    ...barriers.deletedUpdateIds,
    ...barriers.pendingUpdateDeletionIds,
  ]);
  const projectNameIsDeleted = (name: string | null | undefined) =>
    Boolean(name && deletedProjectKeys.has(normalizedKey(name)));
  const projectRecordIsDeleted = (record: TProjectRecord) =>
    deletedProjectIds.has(normalizedKey(record.id)) ||
    projectNameIsDeleted(record.name);
  assertImportedProjectRecordAuthority(data.projects, data.projectRecords);
  const allImportedProjectIds = new Set(data.projectRecords.map(record => record.id));
  data.captureMemories.forEach(memory => {
    const projectId = captureMemoryProjectId(memory);
    if (!allImportedProjectIds.has(projectId)) {
      throw new Error(`A restored capture memory references unknown project id "${projectId}".`);
    }
  });
  const rejectedProjectIds = new Set(
    data.projectRecords.filter(projectRecordIsDeleted).map(record => normalizedKey(record.id)),
  );
  const recordHasRejectedProjectId = (record: { projectId?: string | null }) => {
    const projectId = exactStableId(record.projectId);
    return Boolean(projectId && (
      deletedProjectIds.has(normalizedKey(projectId)) ||
      rejectedProjectIds.has(normalizedKey(projectId))
    ));
  };
  const projectRecords = data.projectRecords.filter(record => !projectRecordIsDeleted(record));
  const survivingProjectIds = new Set(projectRecords.map(record => record.id));
  const projects = uniqueStrings(projectRecords.map(record => record.name));
  const projectKeys = new Set(projects.map(normalizedKey));
  const archivedProjects = uniqueStrings(data.archivedProjects).filter(name =>
    !projectNameIsDeleted(name) && projectKeys.has(normalizedKey(name)),
  );
  const savedUpdates = data.savedUpdates.filter(update =>
    !deletedUpdateIds.has(update.id) &&
    !recordHasRejectedProjectId(update) &&
    !projectNameIsDeleted(update.projectName),
  );
  const projectAreas = data.projectAreas.filter(area =>
    !recordHasRejectedProjectId(area) && !projectNameIsDeleted(area.projectName),
  );
  const referenceDocuments = data.referenceDocuments.filter(document =>
    !recordHasRejectedProjectId(document) &&
    !barriers.deletedProjectNames.some(name => referenceDocumentBelongsToProject(document, name)),
  );
  const projectDocuments = data.projectDocuments.filter(document =>
    !recordHasRejectedProjectId(document) &&
    !barriers.deletedProjectNames.some(name => projectDocumentBelongsToProject(document, name)),
  );
  const scheduleItems = data.scheduleItems.filter(item =>
    !recordHasRejectedProjectId(item) &&
    !barriers.deletedProjectNames.some(name => scheduleItemBelongsToProject(item, name)),
  );
  const captureMemories = data.captureMemories.filter(memory =>
    survivingProjectIds.has(captureMemoryProjectId(memory)),
  );
  const storedDraft = data.storedDraft &&
    !deletedUpdateIds.has(data.storedDraft.draft.id) &&
    !recordHasRejectedProjectId(data.storedDraft.draft) &&
    !projectNameIsDeleted(data.storedDraft.draft.projectName) &&
    projectKeys.has(normalizedKey(data.storedDraft.draft.projectName))
    ? data.storedDraft
    : null;
  const activeProject = projects.find(name =>
    !archivedProjects.some(archived => normalizedKey(archived) === normalizedKey(name)),
  ) || projects[0] || '';
  const draft = storedDraft?.draft || createEmptyDraft(activeProject);
  return {
    projects,
    projectRecords,
    archivedProjects,
    savedUpdates,
    contactBook: data.contactBook,
    projectAreas,
    referenceDocuments,
    projectDocuments,
    scheduleItems,
    captureMemories,
    storedDraft,
    draft,
    activeProject,
    values: {
      updates: savedUpdates,
      projects: projectRecords,
      archivedProjects,
      contacts: data.contactBook,
      projectAreas,
      referenceDocuments,
      projectDocuments,
      scheduleItems,
      captureMemories: serializeCaptureMemories(captureMemories),
      activeDraft: storedDraft,
      projectWalkSession: null,
    } satisfies BackupRestoreValues,
  };
}

export type BackupRestoreRuntime = Readonly<{
  recoverBeforeStartupReads: () => Promise<void>;
  commit<TResult>(
    prepare: (
      barriers: BackupRestoreBarrierState,
    ) => Promise<Readonly<{ values: BackupRestoreValues; result: TResult }>> |
      Readonly<{ values: BackupRestoreValues; result: TResult }>,
  ): Promise<TResult>;
}>;

export class BackupRestoreRecoveryRequiredError extends Error {
  readonly commitCause: unknown;
  readonly recoveryCause: unknown;

  constructor(commitCause: unknown, recoveryCause: unknown) {
    super('Data import was partially written and automatic recovery could not finish.');
    this.name = 'BackupRestoreRecoveryRequiredError';
    this.commitCause = commitCause;
    this.recoveryCause = recoveryCause;
  }
}

export type BackupPreflightValidators = Readonly<{
  savedUpdate: (value: unknown) => boolean;
  projectName: (value: unknown) => boolean;
  projectRecord: (value: unknown) => boolean;
  contactBook: (value: unknown) => boolean;
  projectArea: (value: unknown) => boolean;
  referenceDocument: (value: unknown) => boolean;
  projectDocument: (value: unknown) => boolean;
  scheduleItem: (value: unknown) => boolean;
  captureMemory: (value: unknown) => boolean;
  draftEnvelope: (value: unknown) => boolean;
}>;

export type StrictAppBackupPayload = Readonly<{
  version: typeof APP_BACKUP_VERSION;
  exportedAt: string;
  savedUpdates: unknown[];
  projects: unknown[];
  projectRecords: unknown[];
  archivedProjects: unknown[];
  contacts: unknown;
  projectAreas: unknown[];
  referenceDocuments: unknown[];
  projectDocuments: unknown[];
  scheduleItems: unknown[];
  captureMemories: unknown[];
  activeDraft: unknown | null;
}>;

export type BackupPreflightResult =
  | Readonly<{ ok: true; data: StrictAppBackupPayload }>
  | Readonly<{
      ok: false;
      reason: 'incompatible_version' | 'invalid_backup';
      field: string;
      message: string;
    }>;

/**
 * Data-export import is intentionally stricter than ordinary legacy hydration.
 * A malformed row aborts the whole preflight instead of being normalized away.
 */
export function preflightAppBackup(
  value: unknown,
  validators: BackupPreflightValidators,
): BackupPreflightResult {
  if (!isRecord(value)) return invalid('root', 'The data export must be a JSON object.');
  if (value.version !== APP_BACKUP_VERSION) {
    return {
      ok: false,
      reason: 'incompatible_version',
      field: 'version',
      message: `This data export uses version ${String(value.version)}; this app requires version ${APP_BACKUP_VERSION}.`,
    };
  }
  if (!validTimestamp(value.exportedAt)) {
    return invalid('exportedAt', 'The data export timestamp is missing or invalid.');
  }

  const collectionChecks: readonly [string, unknown, (item: unknown) => boolean][] = [
    ['savedUpdates', value.savedUpdates, validators.savedUpdate],
    ['projects', value.projects, validators.projectName],
    ['projectRecords', value.projectRecords, validators.projectRecord],
    ['archivedProjects', value.archivedProjects, validators.projectName],
    ['projectAreas', value.projectAreas, validators.projectArea],
    ['referenceDocuments', value.referenceDocuments, validators.referenceDocument],
    ['projectDocuments', value.projectDocuments, validators.projectDocument],
    ['scheduleItems', value.scheduleItems, validators.scheduleItem],
    ['captureMemories', value.captureMemories ?? [], validators.captureMemory],
  ];
  for (const [field, candidate, validator] of collectionChecks) {
    if (!Array.isArray(candidate)) return invalid(field, `${field} must be an array.`);
    const badIndex = candidate.findIndex(item => !validator(item));
    if (badIndex >= 0) {
      return invalid(`${field}[${badIndex}]`, `${field} contains an invalid record at position ${badIndex + 1}.`);
    }
  }
  for (const field of ['projects', 'archivedProjects'] as const) {
    const duplicate = duplicateString(value[field] as unknown[]);
    if (duplicate) return invalid(field, `${field} contains the duplicate project name "${duplicate}".`);
  }
  for (const field of [
    'savedUpdates',
    'projectRecords',
    'referenceDocuments',
    'projectDocuments',
    'scheduleItems',
    'captureMemories',
  ] as const) {
    const duplicateOrMissing = duplicateOrMissingStableId(value[field] as unknown[]);
    if (duplicateOrMissing) {
      return invalid(field, duplicateOrMissing === 'missing'
        ? `${field} contains a record without a stable id.`
        : `${field} contains the duplicate id "${duplicateOrMissing}".`);
    }
  }
  const projectAuthorityError = validateBackupProjectRecordAuthority(
    value.projects as unknown[],
    value.projectRecords as unknown[],
    value.archivedProjects as unknown[],
    (value.captureMemories ?? []) as unknown[],
  );
  if (projectAuthorityError) return projectAuthorityError;
  if (!validators.contactBook(value.contacts)) {
    return invalid('contacts', 'The data-export contacts are malformed.');
  }
  if (value.activeDraft !== null && !validators.draftEnvelope(value.activeDraft)) {
    return invalid('activeDraft', 'The active draft is malformed.');
  }

  return {
    ok: true,
    data: {
      version: APP_BACKUP_VERSION,
      exportedAt: value.exportedAt as string,
      savedUpdates: value.savedUpdates as unknown[],
      projects: value.projects as unknown[],
      projectRecords: value.projectRecords as unknown[],
      archivedProjects: value.archivedProjects as unknown[],
      contacts: value.contacts,
      projectAreas: value.projectAreas as unknown[],
      referenceDocuments: value.referenceDocuments as unknown[],
      projectDocuments: value.projectDocuments as unknown[],
      scheduleItems: value.scheduleItems as unknown[],
      captureMemories: (value.captureMemories ?? []) as unknown[],
      activeDraft: value.activeDraft ?? null,
    },
  };
}

export function createBackupRestoreRuntime({
  storage,
  targetKeys,
  barrierKeys,
  createTransactionId,
  now,
  recoverProjectDeletion,
  recoverFieldUpdate,
  loadQueuedProjectDeletions,
}: Readonly<{
  storage: Storage;
  targetKeys: BackupRestoreTargetKeys;
  barrierKeys: BackupRestoreBarrierKeys;
  createTransactionId: () => string;
  now: () => string;
  recoverProjectDeletion: () => Promise<void>;
  recoverFieldUpdate: () => Promise<void>;
  loadQueuedProjectDeletions: () => Promise<readonly QueuedProjectDeletionBarrier[]>;
}>): BackupRestoreRuntime {
  const transaction = createDurableLocalTransactionRepository({
    storage,
    journalKey: BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY,
    createTransactionId,
    now,
  });
  const mutationKeys = [
    BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY,
    ...Object.values(targetKeys),
    ...Object.values(barrierKeys),
  ];
  const immutableBarrierKeys = [
    barrierKeys.deletedProjects,
    barrierKeys.deletedUpdates,
    barrierKeys.updateDeletionJournal,
    barrierKeys.projectDeletionCloudIntents,
    barrierKeys.projectDeletionFileCleanupIntents,
    barrierKeys.daveSyncTombstones,
  ];
  let recoveryPromise: Promise<void> | null = null;

  const recoverBeforeStartupReads = (): Promise<void> => {
    if (recoveryPromise) return recoveryPromise;
    const recovery = (async () => {
      await recoverProjectDeletion();
      await recoverFieldUpdate();
      await runExclusiveLocalStorageMutation(mutationKeys, async () => {
        await assertNoForeignPendingJournal(storage, barrierKeys);
        await transaction.recover();
      });
    })();
    recoveryPromise = recovery.finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  };

  const commit = async <TResult>(
    prepare: (
      barriers: BackupRestoreBarrierState,
    ) => Promise<Readonly<{ values: BackupRestoreValues; result: TResult }>> |
      Readonly<{ values: BackupRestoreValues; result: TResult }>,
  ): Promise<TResult> => {
    await recoverBeforeStartupReads();
    const queuedProjectDeletions = await loadQueuedProjectDeletions();
    return runExclusiveLocalStorageMutation(mutationKeys, async () => {
      await assertNoForeignPendingJournal(storage, barrierKeys);
      await transaction.recover();
      const barrierRaw = new Map<string, string | null>();
      for (const key of immutableBarrierKeys) barrierRaw.set(key, await storage.getItem(key));
      const barriers = readBarrierState(barrierRaw, barrierKeys, queuedProjectDeletions);
      const prepared = await prepare(barriers);
      const operations = await restoreOperations(storage, targetKeys, prepared.values);
      try {
        await transaction.commit(operations);
      } catch (commitCause) {
        let recovered;
        try {
          recovered = await transaction.recover();
        } catch (recoveryCause) {
          throw new BackupRestoreRecoveryRequiredError(commitCause, recoveryCause);
        }
        if (!recovered) throw commitCause;
      }
      await verifyRestore(storage, targetKeys, prepared.values);
      for (const [key, before] of barrierRaw) {
        if (await storage.getItem(key) !== before) {
          throw new Error(`Data import changed protected deletion state at ${key}.`);
        }
      }
      return prepared.result;
    });
  };

  return Object.freeze({ recoverBeforeStartupReads, commit });
}

async function assertNoForeignPendingJournal(
  storage: Storage,
  keys: BackupRestoreBarrierKeys,
) {
  if (await storage.getItem(keys.projectDeletionTransactionJournal) !== null) {
    throw new Error('Project deletion recovery must finish before data import.');
  }
  if (await storage.getItem(keys.fieldUpdateTransactionJournal) !== null) {
    throw new Error('Field update recovery must finish before data import.');
  }
}

async function restoreOperations(
  storage: Storage,
  keys: BackupRestoreTargetKeys,
  values: BackupRestoreValues,
): Promise<DurableLocalTransactionOperation[]> {
  const pairs: readonly [keyof BackupRestoreTargetKeys, keyof BackupRestoreValues][] = [
    ['updates', 'updates'],
    ['projects', 'projects'],
    ['archivedProjects', 'archivedProjects'],
    ['contacts', 'contacts'],
    ['projectAreas', 'projectAreas'],
    ['referenceDocuments', 'referenceDocuments'],
    ['projectDocuments', 'projectDocuments'],
    ['scheduleItems', 'scheduleItems'],
    ['captureMemories', 'captureMemories'],
    ['activeDraft', 'activeDraft'],
    ['projectWalkSession', 'projectWalkSession'],
  ];
  const operations: DurableLocalTransactionOperation[] = [];
  for (const [keyName, valueName] of pairs) {
    const key = keys[keyName];
    const value = values[valueName];
    if ((valueName === 'activeDraft' || valueName === 'projectWalkSession') && value === null) {
      operations.push({
        kind: 'remove_if_unchanged',
        key,
        expectedValue: await storage.getItem(key),
      });
    } else {
      operations.push({ kind: 'set', key, value: requireJson(value, valueName) });
    }
  }
  return operations;
}

async function verifyRestore(
  storage: Storage,
  keys: BackupRestoreTargetKeys,
  values: BackupRestoreValues,
) {
  for (const keyName of Object.keys(keys) as (keyof BackupRestoreTargetKeys)[]) {
    const expected = (keyName === 'activeDraft' || keyName === 'projectWalkSession') &&
      values[keyName] === null
      ? null
      : requireJson(values[keyName], keyName);
    if (await storage.getItem(keys[keyName]) !== expected) {
      throw new Error(`Data import verification failed for ${keys[keyName]}.`);
    }
  }
}

function readBarrierState(
  raw: ReadonlyMap<string, string | null>,
  keys: BackupRestoreBarrierKeys,
  queuedProjectDeletions: readonly QueuedProjectDeletionBarrier[],
): BackupRestoreBarrierState {
  const deletedProjectNames = parseStringArray(raw.get(keys.deletedProjects), 'deleted projects');
  const deletedUpdateIds = parseUpdateIds(raw.get(keys.deletedUpdates), 'deleted updates');
  const pendingUpdateDeletionIds = parseUpdateIds(
    raw.get(keys.updateDeletionJournal),
    'pending update deletions',
  );
  const cloudProjects = parseProjectsFromIntents(
    raw.get(keys.projectDeletionCloudIntents),
    'pending project cloud deletions',
  );
  const cloudProjectNames = cloudProjects.map(record => record.projectName);
  const legacyCloudProjectNames = cloudProjects.flatMap(record =>
    record.projectId ? [] : [record.projectName],
  );
  const cloudProjectIds = cloudProjects.flatMap(record =>
    record.projectId ? [record.projectId] : [],
  );
  const queuedProjectNames = queuedProjectDeletions.map(record => record.projectName);
  const legacyQueuedProjectNames = queuedProjectDeletions.flatMap(record =>
    record.projectId === undefined ? [record.projectName] : [],
  );
  const queuedProjectIds = queuedProjectDeletions.flatMap(record => {
    const projectId = exactStableId(record.projectId);
    if (record.projectId !== undefined && !projectId) {
      throw new Error('pending queued project deletions contains an invalid project id.');
    }
    return projectId ? [projectId] : [];
  });
  if (queuedProjectNames.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('pending queued project deletions contains an invalid project name.');
  }
  // File cleanup and DAVE tombstone bytes are protected and must be valid JSON.
  parseJsonArray(raw.get(keys.projectDeletionFileCleanupIntents), 'pending project file cleanup');
  const projectTombstoneRecordIds = parseProjectTombstoneRecordIds(
    raw.get(keys.daveSyncTombstones),
    'ECOS sync tombstones',
  );
  return Object.freeze({
    deletedProjectIds: uniqueStrings([
      ...cloudProjectIds,
      ...queuedProjectIds,
    ]),
    deletedProjectNames: uniqueStrings([
      ...deletedProjectNames,
      ...legacyCloudProjectNames,
      ...legacyQueuedProjectNames,
    ]),
    unresolvedLegacyProjectDeletionNames: uniqueStrings([
      ...deletedProjectNames,
      ...legacyCloudProjectNames,
      ...legacyQueuedProjectNames,
    ]),
    projectTombstoneRecordIds,
    deletedUpdateIds,
    pendingUpdateDeletionIds,
    pendingProjectDeletionIds: uniqueStrings([
      ...cloudProjectIds,
      ...queuedProjectIds,
    ]),
    pendingProjectDeletionNames: uniqueStrings([
      ...cloudProjectNames,
      ...queuedProjectNames,
    ]),
  });
}

function resolveImportedProjectTombstones(
  recordIds: readonly string[],
  projectRecords: readonly Readonly<{ id: string; name: string }>[],
) {
  const exactIds: string[] = [];
  const unresolvedNames: string[] = [];
  const ambiguousRecordIds: string[] = [];
  recordIds.forEach(recordId => {
    const authority = resolveProjectTombstoneAuthority(recordId, projectRecords);
    if (authority === 'exact_id') exactIds.push(recordId);
    else if (authority === 'ambiguous') ambiguousRecordIds.push(recordId);
    else if (projectRecords.some(record =>
      normalizedKey(record.name) === normalizedKey(recordId)
    )) unresolvedNames.push(recordId);
  });
  return {
    exactIds: uniqueStrings(exactIds),
    unresolvedNames: uniqueStrings(unresolvedNames),
    ambiguousRecordIds: uniqueStrings(ambiguousRecordIds),
  };
}

function parseStringArray(raw: string | null | undefined, label: string): string[] {
  const values = parseJsonArray(raw, label);
  if (!values.every(item => typeof item === 'string' && item.trim())) {
    throw new Error(`${label} contains an invalid record.`);
  }
  return uniqueStrings(values as string[]);
}

function parseUpdateIds(raw: string | null | undefined, label: string): string[] {
  const values = parseJsonArray(raw, label);
  const ids = values.map(value => {
    if (!isRecord(value)) return '';
    const id = typeof value.updateId === 'string' && value.updateId.trim()
      ? value.updateId
      : typeof value.localId === 'string' && value.localId.trim()
        ? value.localId
        : '';
    return id.trim();
  });
  if (ids.some(id => !id)) throw new Error(`${label} contains an invalid record.`);
  return uniqueStrings(ids);
}

function parseProjectsFromIntents(
  raw: string | null | undefined,
  label: string,
): QueuedProjectDeletionBarrier[] {
  const values = parseJsonArray(raw, label);
  return values.map(value => {
    const projectName = isRecord(value) && typeof value.projectName === 'string'
      ? value.projectName.trim()
      : '';
    const projectId = isRecord(value) && value.projectId !== undefined
      ? exactStableId(value.projectId)
      : null;
    if (!projectName || isRecord(value) && value.projectId !== undefined && !projectId) {
      throw new Error(`${label} contains an invalid record.`);
    }
    return projectId ? { projectId, projectName } : { projectName };
  });
}

function parseProjectTombstoneRecordIds(
  raw: string | null | undefined,
  label: string,
): string[] {
  const values = parseJsonArray(raw, label);
  const ids: string[] = [];
  for (const value of values) {
    if (!isRecord(value)) throw new Error(`${label} contains an invalid record.`);
    const entityType = value.entityType;
    const recordId = typeof value.recordId === 'string' ? value.recordId.trim() : '';
    const deletedAt = typeof value.deletedAt === 'string' ? value.deletedAt : '';
    if (
      !['project', 'project_update', 'project_area', 'schedule_item', 'reference_document']
        .includes(String(entityType)) ||
      !recordId ||
      !validTimestamp(deletedAt)
    ) {
      throw new Error(`${label} contains an invalid record.`);
    }
    if (entityType === 'project') ids.push(recordId);
  }
  return uniqueStrings(ids);
}

function parseJsonArray(raw: string | null | undefined, label: string): unknown[] {
  if (raw === null || raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array.`);
  return parsed;
}

function requireJson(value: unknown, label: string): string {
  const raw = JSON.stringify(value);
  if (typeof raw !== 'string') throw new Error(`${String(label)} cannot be serialized.`);
  return raw;
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach(value => {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });
  return result;
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase();
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

function duplicateString(values: readonly unknown[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const key = value.trim().toLowerCase();
    if (seen.has(key)) return value.trim();
    seen.add(key);
  }
  return null;
}

function duplicateOrMissingStableId(values: readonly unknown[]): string | 'missing' | null {
  const seen = new Set<string>();
  for (const value of values) {
    const id = isRecord(value) && typeof value.id === 'string' ? value.id.trim() : '';
    if (!id) return 'missing';
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

function validateBackupProjectRecordAuthority(
  projectNames: readonly unknown[],
  projectRecords: readonly unknown[],
  archivedProjects: readonly unknown[],
  captureMemories: readonly unknown[],
): BackupPreflightResult | null {
  const names = projectNames.map(value => typeof value === 'string' ? value.trim() : '');
  const identities = projectRecords.map((value, index) => {
    if (!isRecord(value)) return null;
    const id = exactStableId(value.id);
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    return id && name ? { id, name, index } : null;
  });
  const invalidRecordIndex = identities.findIndex(identity => identity === null);
  if (invalidRecordIndex >= 0) {
    return invalid(
      `projectRecords[${invalidRecordIndex}]`,
      'Every project record must contain an exact immutable id and display name.',
    );
  }
  const records = identities as Array<{ id: string; name: string; index: number }>;
  const duplicateRecordName = duplicateString(records.map(record => record.name));
  if (duplicateRecordName) {
    return invalid(
      'projectRecords',
      `projectRecords contains the ambiguous duplicate project name "${duplicateRecordName}".`,
    );
  }
  const projectNameKeys = new Set(names.map(normalizedKey));
  const recordNameKeys = new Set(records.map(record => normalizedKey(record.name)));
  if (
    projectNameKeys.size !== recordNameKeys.size ||
    [...projectNameKeys].some(key => !recordNameKeys.has(key))
  ) {
    return invalid(
      'projectRecords',
      'The project records must exactly match the exported project list.',
    );
  }
  const archivedName = archivedProjects.find(value =>
    typeof value !== 'string' || !projectNameKeys.has(normalizedKey(value)),
  );
  if (archivedName !== undefined) {
    return invalid(
      'archivedProjects',
      'Every archived project must have one matching immutable project record.',
    );
  }
  const projectIds = new Set(records.map(record => record.id));
  for (let index = 0; index < captureMemories.length; index += 1) {
    const memory = captureMemories[index];
    const projectId = isRecord(memory) ? exactStableId(memory.projectId) : null;
    if (!projectId || !projectIds.has(projectId)) {
      return invalid(
        `captureMemories[${index}].projectId`,
        'Every capture memory must reference one imported immutable project record.',
      );
    }
  }
  return null;
}

function assertImportedProjectRecordAuthority<T extends { id: string; name: string }>(
  projectNames: readonly string[],
  projectRecords: readonly T[],
): void {
  const names = projectNames.map(name => name.trim()).filter(Boolean);
  if (names.length !== projectNames.length || duplicateString(names)) {
    throw new Error('Restored project names are invalid or ambiguous.');
  }
  const ids = new Set<string>();
  const recordNames = new Set<string>();
  projectRecords.forEach(record => {
    const id = exactStableId(record.id);
    const name = record.name.trim();
    const nameKey = normalizedKey(name);
    if (!id || !name || ids.has(id) || recordNames.has(nameKey)) {
      throw new Error('Restored immutable project records are invalid or ambiguous.');
    }
    ids.add(id);
    recordNames.add(nameKey);
  });
  const projectNameKeys = new Set(names.map(normalizedKey));
  if (
    projectNameKeys.size !== recordNames.size ||
    [...projectNameKeys].some(key => !recordNames.has(key))
  ) {
    throw new Error('Restored project records do not match the project list.');
  }
}

function exactStableId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    ? value
    : null;
}

function invalid(field: string, message: string): BackupPreflightResult {
  return { ok: false, reason: 'invalid_backup', field, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
