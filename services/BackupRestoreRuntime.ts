import type { DurableLocalTransactionOperation } from './DurableLocalTransaction';
import { createDurableLocalTransactionRepository } from './DurableLocalTransaction';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

export const APP_BACKUP_VERSION = 1 as const;
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
  activeDraft: string;
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
  deletedProjectNames: readonly string[];
  deletedUpdateIds: readonly string[];
  pendingUpdateDeletionIds: readonly string[];
  pendingProjectDeletionNames: readonly string[];
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
  activeDraft: unknown | null;
}>;

export function buildDeletionSafeRestoreState<
  TUpdate extends { id: string; projectName: string },
  TProjectRecord,
  TContactBook,
  TProjectArea,
  TReferenceDocument,
  TProjectDocument,
  TScheduleItem,
  TDraft extends { id: string; projectName: string },
  TStoredDraft extends { draft: TDraft; savedAt: string },
>({
  data,
  barriers,
  currentProjectRecords,
  rebuildProjectRecords,
  referenceDocumentBelongsToProject,
  projectDocumentBelongsToProject,
  scheduleItemBelongsToProject,
  createEmptyDraft,
}: Readonly<{
  data: Readonly<{
    savedUpdates: TUpdate[];
    projects: string[];
    archivedProjects: string[];
    contactBook: TContactBook;
    projectAreas: TProjectArea[];
    referenceDocuments: TReferenceDocument[];
    projectDocuments: TProjectDocument[];
    scheduleItems: TScheduleItem[];
    storedDraft: TStoredDraft | null;
  }>;
  barriers: BackupRestoreBarrierState;
  currentProjectRecords: readonly TProjectRecord[];
  rebuildProjectRecords: (
    current: readonly TProjectRecord[],
    names: readonly string[],
  ) => TProjectRecord[];
  referenceDocumentBelongsToProject: (document: TReferenceDocument, projectName: string) => boolean;
  projectDocumentBelongsToProject: (document: TProjectDocument, projectName: string) => boolean;
  scheduleItemBelongsToProject: (item: TScheduleItem, projectName: string) => boolean;
  createEmptyDraft: (projectName: string) => TDraft;
}>) {
  const deletedProjectKeys = new Set(barriers.deletedProjectNames.map(normalizedKey));
  const deletedUpdateIds = new Set([
    ...barriers.deletedUpdateIds,
    ...barriers.pendingUpdateDeletionIds,
  ]);
  const projectIsDeleted = (name: string | null | undefined) =>
    Boolean(name && deletedProjectKeys.has(normalizedKey(name)));
  const projects = uniqueStrings(data.projects).filter(name => !projectIsDeleted(name));
  const projectKeys = new Set(projects.map(normalizedKey));
  const archivedProjects = uniqueStrings(data.archivedProjects).filter(name =>
    !projectIsDeleted(name) && projectKeys.has(normalizedKey(name)),
  );
  const savedUpdates = data.savedUpdates.filter(update =>
    !deletedUpdateIds.has(update.id) && !projectIsDeleted(update.projectName),
  );
  const referenceDocuments = data.referenceDocuments.filter(document =>
    !barriers.deletedProjectNames.some(name => referenceDocumentBelongsToProject(document, name)),
  );
  const projectDocuments = data.projectDocuments.filter(document =>
    !barriers.deletedProjectNames.some(name => projectDocumentBelongsToProject(document, name)),
  );
  const scheduleItems = data.scheduleItems.filter(item =>
    !barriers.deletedProjectNames.some(name => scheduleItemBelongsToProject(item, name)),
  );
  const storedDraft = data.storedDraft &&
    !deletedUpdateIds.has(data.storedDraft.draft.id) &&
    !projectIsDeleted(data.storedDraft.draft.projectName) &&
    projectKeys.has(normalizedKey(data.storedDraft.draft.projectName))
    ? data.storedDraft
    : null;
  const activeProject = projects.find(name =>
    !archivedProjects.some(archived => normalizedKey(archived) === normalizedKey(name)),
  ) || projects[0] || '';
  const draft = storedDraft?.draft || createEmptyDraft(activeProject);
  const projectRecords = rebuildProjectRecords(currentProjectRecords, projects);
  return {
    projects,
    projectRecords,
    archivedProjects,
    savedUpdates,
    contactBook: data.contactBook,
    projectAreas: data.projectAreas,
    referenceDocuments,
    projectDocuments,
    scheduleItems,
    storedDraft,
    draft,
    activeProject,
    values: {
      updates: savedUpdates,
      projects: projectRecords,
      archivedProjects,
      contacts: data.contactBook,
      projectAreas: data.projectAreas,
      referenceDocuments,
      projectDocuments,
      scheduleItems,
      activeDraft: storedDraft,
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
  contactBook: (value: unknown) => boolean;
  projectArea: (value: unknown) => boolean;
  referenceDocument: (value: unknown) => boolean;
  projectDocument: (value: unknown) => boolean;
  scheduleItem: (value: unknown) => boolean;
  draftEnvelope: (value: unknown) => boolean;
}>;

export type StrictAppBackupPayload = Readonly<{
  version: typeof APP_BACKUP_VERSION;
  exportedAt: string;
  savedUpdates: unknown[];
  projects: unknown[];
  archivedProjects: unknown[];
  contacts: unknown;
  projectAreas: unknown[];
  referenceDocuments: unknown[];
  projectDocuments: unknown[];
  scheduleItems: unknown[];
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
    ['archivedProjects', value.archivedProjects, validators.projectName],
    ['projectAreas', value.projectAreas, validators.projectArea],
    ['referenceDocuments', value.referenceDocuments, validators.referenceDocument],
    ['projectDocuments', value.projectDocuments, validators.projectDocument],
    ['scheduleItems', value.scheduleItems, validators.scheduleItem],
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
    'referenceDocuments',
    'projectDocuments',
    'scheduleItems',
  ] as const) {
    const duplicateOrMissing = duplicateOrMissingStableId(value[field] as unknown[]);
    if (duplicateOrMissing) {
      return invalid(field, duplicateOrMissing === 'missing'
        ? `${field} contains a record without a stable id.`
        : `${field} contains the duplicate id "${duplicateOrMissing}".`);
    }
  }
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
      archivedProjects: value.archivedProjects as unknown[],
      contacts: value.contacts,
      projectAreas: value.projectAreas as unknown[],
      referenceDocuments: value.referenceDocuments as unknown[],
      projectDocuments: value.projectDocuments as unknown[],
      scheduleItems: value.scheduleItems as unknown[],
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
  loadQueuedProjectDeletionNames,
}: Readonly<{
  storage: Storage;
  targetKeys: BackupRestoreTargetKeys;
  barrierKeys: BackupRestoreBarrierKeys;
  createTransactionId: () => string;
  now: () => string;
  recoverProjectDeletion: () => Promise<void>;
  recoverFieldUpdate: () => Promise<void>;
  loadQueuedProjectDeletionNames: () => Promise<readonly string[]>;
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
    const queuedProjectDeletionNames = await loadQueuedProjectDeletionNames();
    return runExclusiveLocalStorageMutation(mutationKeys, async () => {
      await assertNoForeignPendingJournal(storage, barrierKeys);
      await transaction.recover();
      const barrierRaw = new Map<string, string | null>();
      for (const key of immutableBarrierKeys) barrierRaw.set(key, await storage.getItem(key));
      const barriers = readBarrierState(barrierRaw, barrierKeys, queuedProjectDeletionNames);
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
    ['activeDraft', 'activeDraft'],
  ];
  const operations: DurableLocalTransactionOperation[] = [];
  for (const [keyName, valueName] of pairs) {
    const key = keys[keyName];
    const value = values[valueName];
    if (valueName === 'activeDraft' && value === null) {
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
    const expected = keyName === 'activeDraft' && values.activeDraft === null
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
  queuedProjectDeletionNames: readonly string[],
): BackupRestoreBarrierState {
  const deletedProjectNames = parseStringArray(raw.get(keys.deletedProjects), 'deleted projects');
  const deletedUpdateIds = parseUpdateIds(raw.get(keys.deletedUpdates), 'deleted updates');
  const pendingUpdateDeletionIds = parseUpdateIds(
    raw.get(keys.updateDeletionJournal),
    'pending update deletions',
  );
  const cloudProjectNames = parseProjectNamesFromIntents(
    raw.get(keys.projectDeletionCloudIntents),
    'pending project cloud deletions',
  );
  // File cleanup and DAVE tombstone bytes are protected and must be valid JSON.
  parseJsonArray(raw.get(keys.projectDeletionFileCleanupIntents), 'pending project file cleanup');
  parseJsonArray(raw.get(keys.daveSyncTombstones), 'DAVE sync tombstones');
  return Object.freeze({
    deletedProjectNames: uniqueStrings([
      ...deletedProjectNames,
      ...cloudProjectNames,
      ...queuedProjectDeletionNames,
    ]),
    deletedUpdateIds,
    pendingUpdateDeletionIds,
    pendingProjectDeletionNames: uniqueStrings([
      ...cloudProjectNames,
      ...queuedProjectDeletionNames,
    ]),
  });
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

function parseProjectNamesFromIntents(
  raw: string | null | undefined,
  label: string,
): string[] {
  const values = parseJsonArray(raw, label);
  const names = values.map(value =>
    isRecord(value) && typeof value.projectName === 'string'
      ? value.projectName.trim()
      : '',
  );
  if (names.some(name => !name)) throw new Error(`${label} contains an invalid record.`);
  return uniqueStrings(names);
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

function invalid(field: string, message: string): BackupPreflightResult {
  return { ok: false, reason: 'invalid_backup', field, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
