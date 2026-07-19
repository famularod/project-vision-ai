import type {
  DAVESyncTombstone,
  DAVESyncTombstoneEntity,
} from '../types';
import {
  createDurableLocalTransactionRepository,
  type DurableLocalTransactionOperation,
  type DurableLocalTransactionRepository,
  type DurableLocalTransactionStorage,
} from './DurableLocalTransaction';
import { mergeDAVESyncTombstones } from './DAVESyncTombstones';
import type { ProjectUpdateDeletionIntent } from './ProjectUpdateDeletionJournal';

export const PROJECT_DELETION_TRANSACTION_JOURNAL_KEY =
  'projectPhotoUpdate.projectDeletionTransaction.v1';
export const PROJECT_DELETION_CLOUD_INTENTS_STORAGE_KEY =
  'projectPhotoUpdate.projectDeletionCloudIntents.v1';
export const PROJECT_DELETION_FILE_CLEANUP_INTENTS_STORAGE_KEY =
  'projectPhotoUpdate.projectDeletionFileCleanupIntents.v1';

export type ProjectDeletionCloudIntent = Readonly<{
  projectName: string;
  requestedAt: string;
}>;

export type ProjectDeletionFileCleanupIntent =
  | Readonly<{
      id: string;
      kind: 'project_document';
      projectName: string;
      localUri: string;
      ownedFileId: string;
      ownedFileManifest: unknown;
    }>
  | Readonly<{
      id: string;
      kind: 'reference_document';
      projectName: string;
      uri: string;
    }>;

export type ProjectDeletionStorageKeys = Readonly<{
  projects: string;
  deletedProjects: string;
  archivedProjects: string;
  updates: string;
  deletedUpdates: string;
  updateDeletionJournal: string;
  projectDocuments: string;
  referenceDocuments: string;
  scheduleItems: string;
  daveSyncTombstones: string;
  activeDraft: string;
  cloudIntents: string;
  fileCleanupIntents: string;
}>;

type ProjectRecordLike = Readonly<{ name: string }>;
type ProjectUpdateLike = Readonly<{ id: string; projectName: string }>;
type UpdateTombstoneLike = Readonly<{ updateId: string }>;
type ProjectDocumentLike = Readonly<{ projectId: string }>;
type ReferenceDocumentLike = Readonly<{
  id: string;
  projectId?: string | null;
  projectName?: string | null;
}>;
type ScheduleItemLike = Readonly<{
  id: string;
  projectName: string;
  scheduleProjectName?: string | null;
}>;

export type ProjectDeletionCascade<
  TProjectRecord,
  TUpdate,
  TUpdateTombstone,
  TProjectDocument,
  TReferenceDocument,
  TScheduleItem,
  TDraft,
> = Readonly<{
  projectName: string;
  deletedAt: string;
  remainingProjectRecords: TProjectRecord[];
  nextDeletedProjectNames: string[];
  remainingArchivedProjects: string[];
  remainingUpdates: TUpdate[];
  removedUpdates: TUpdate[];
  nextUpdateTombstones: TUpdateTombstone[];
  nextUpdateDeletionIntents: ProjectUpdateDeletionIntent[];
  remainingProjectDocuments: TProjectDocument[];
  removedProjectDocuments: TProjectDocument[];
  remainingReferenceDocuments: TReferenceDocument[];
  removedReferenceDocuments: TReferenceDocument[];
  remainingScheduleItems: TScheduleItem[];
  removedScheduleItems: TScheduleItem[];
  nextDAVESyncTombstones: DAVESyncTombstone[];
  draftReplaced: boolean;
  nextDraft: TDraft;
  nextCloudIntents: ProjectDeletionCloudIntent[];
  nextFileCleanupIntents: ProjectDeletionFileCleanupIntent[];
}>;

export function createProjectDeletionTransactionRepository({
  storage,
  createTransactionId,
  now,
}: Readonly<{
  storage: DurableLocalTransactionStorage;
  createTransactionId: () => string;
  now: () => string;
}>): DurableLocalTransactionRepository {
  return createDurableLocalTransactionRepository({
    storage,
    journalKey: PROJECT_DELETION_TRANSACTION_JOURNAL_KEY,
    createTransactionId,
    now,
  });
}

/**
 * Computes the complete local cascade before any bytes are changed. Only
 * records with explicit project ownership are removed; ambiguous reference
 * documents remain available instead of being guessed from display text.
 */
export function buildProjectDeletionCascade<
  TProjectRecord extends ProjectRecordLike,
  TUpdate extends ProjectUpdateLike,
  TUpdateTombstone extends UpdateTombstoneLike,
  TProjectDocument extends ProjectDocumentLike,
  TReferenceDocument extends ReferenceDocumentLike,
  TScheduleItem extends ScheduleItemLike,
  TDraft,
>({
  projectName,
  authorityProjectId,
  deletedAt,
  projectRecords,
  deletedProjectNames,
  archivedProjects,
  updates,
  updateTombstones,
  updateDeletionIntents,
  projectDocuments,
  referenceDocuments,
  scheduleItems,
  daveSyncTombstones,
  draft,
  draftBelongsToProject,
  replacementDraft,
  cloudIntents,
  fileCleanupIntents,
  newFileCleanupIntents,
  buildUpdateTombstone,
}: Readonly<{
  projectName: string;
  authorityProjectId: string;
  deletedAt: string;
  projectRecords: readonly TProjectRecord[];
  deletedProjectNames: readonly string[];
  archivedProjects: readonly string[];
  updates: readonly TUpdate[];
  updateTombstones: readonly TUpdateTombstone[];
  updateDeletionIntents: readonly ProjectUpdateDeletionIntent[];
  projectDocuments: readonly TProjectDocument[];
  referenceDocuments: readonly TReferenceDocument[];
  scheduleItems: readonly TScheduleItem[];
  daveSyncTombstones: readonly DAVESyncTombstone[];
  draft: TDraft;
  draftBelongsToProject: boolean;
  replacementDraft: TDraft;
  cloudIntents: readonly ProjectDeletionCloudIntent[];
  fileCleanupIntents: readonly ProjectDeletionFileCleanupIntent[];
  newFileCleanupIntents: readonly ProjectDeletionFileCleanupIntent[];
  buildUpdateTombstone: (
    update: TUpdate,
    deletedAt: string,
  ) => TUpdateTombstone;
}>): ProjectDeletionCascade<
  TProjectRecord,
  TUpdate,
  TUpdateTombstone,
  TProjectDocument,
  TReferenceDocument,
  TScheduleItem,
  TDraft
> {
  const normalizedProjectName = normalizedScope(projectName);
  if (!normalizedProjectName) throw new Error('Project deletion requires a project name.');
  if (!normalizedScope(authorityProjectId)) {
    throw new Error('Project deletion requires an authoritative project id.');
  }
  const normalizedDeletedAt = normalizedTimestamp(deletedAt);
  if (!normalizedDeletedAt) throw new Error('Project deletion requires a valid timestamp.');

  const projectMatches = (value: string | null | undefined) =>
    normalizedScope(value) === normalizedProjectName;
  const remainingUpdates = updates.filter(update => !projectMatches(update.projectName));
  const removedUpdates = updates.filter(update => projectMatches(update.projectName));
  const remainingProjectDocuments = projectDocuments.filter(document =>
    !projectDocumentMatchesProject(document, projectName, authorityProjectId),
  );
  const removedProjectDocuments = projectDocuments.filter(document =>
    projectDocumentMatchesProject(document, projectName, authorityProjectId),
  );
  const remainingReferenceDocuments = referenceDocuments.filter(document =>
    !referenceDocumentMatchesProject(document, projectName, authorityProjectId),
  );
  const removedReferenceDocuments = referenceDocuments.filter(document =>
    referenceDocumentMatchesProject(document, projectName, authorityProjectId),
  );
  const remainingScheduleItems = scheduleItems.filter(item =>
    !scheduleItemMatchesProject(item, projectName),
  );
  const removedScheduleItems = scheduleItems.filter(item =>
    scheduleItemMatchesProject(item, projectName),
  );

  const newUpdateTombstones = removedUpdates.map(update =>
    buildUpdateTombstone(update, normalizedDeletedAt),
  );
  const nextUpdateTombstones = uniqueBy(
    [...newUpdateTombstones, ...updateTombstones],
    tombstone => normalizedScope(tombstone.updateId),
  );
  const newUpdateDeletionIntents = removedUpdates.map(update => ({
    updateId: update.id,
    projectName,
    requestedAt: normalizedDeletedAt,
    cloudDeleteConfirmedAt: null,
  } satisfies ProjectUpdateDeletionIntent));
  const nextUpdateDeletionIntents = uniqueBy(
    [...newUpdateDeletionIntents, ...updateDeletionIntents],
    intent => normalizedScope(intent.updateId),
  );

  const deletionTombstones: DAVESyncTombstone[] = [
    ...removedScheduleItems.map(item => ({
      entityType: 'schedule_item' as const,
      recordId: item.id,
      deletedAt: normalizedDeletedAt,
    })),
    ...removedReferenceDocuments.map(document => ({
      entityType: 'reference_document' as const,
      recordId: document.id,
      deletedAt: normalizedDeletedAt,
    })),
  ];

  return Object.freeze({
    projectName,
    deletedAt: normalizedDeletedAt,
    remainingProjectRecords: projectRecords.filter(record => !projectMatches(record.name)),
    nextDeletedProjectNames: mergeProjectNames(deletedProjectNames, [projectName]),
    remainingArchivedProjects: archivedProjects.filter(name => !projectMatches(name)),
    remainingUpdates,
    removedUpdates,
    nextUpdateTombstones,
    nextUpdateDeletionIntents,
    remainingProjectDocuments,
    removedProjectDocuments,
    remainingReferenceDocuments,
    removedReferenceDocuments,
    remainingScheduleItems,
    removedScheduleItems,
    nextDAVESyncTombstones: mergeDAVESyncTombstones(
      daveSyncTombstones,
      deletionTombstones,
    ),
    draftReplaced: draftBelongsToProject,
    nextDraft: draftBelongsToProject ? replacementDraft : draft,
    nextCloudIntents: mergeProjectDeletionCloudIntents(
      [{ projectName, requestedAt: normalizedDeletedAt }],
      cloudIntents,
    ),
    nextFileCleanupIntents: mergeProjectDeletionFileCleanupIntents(
      newFileCleanupIntents,
      fileCleanupIntents,
    ),
  });
}

export function buildProjectDeletionOperations<
  TProjectRecord,
  TUpdate,
  TUpdateTombstone,
  TProjectDocument,
  TReferenceDocument,
  TScheduleItem,
  TDraft,
>(
  cascade: ProjectDeletionCascade<
    TProjectRecord,
    TUpdate,
    TUpdateTombstone,
    TProjectDocument,
    TReferenceDocument,
    TScheduleItem,
    TDraft
  >,
  keys: ProjectDeletionStorageKeys,
): DurableLocalTransactionOperation[] {
  const operations: DurableLocalTransactionOperation[] = [
    setJson(keys.projects, cascade.remainingProjectRecords),
    setJson(keys.deletedProjects, cascade.nextDeletedProjectNames),
    setJson(keys.archivedProjects, cascade.remainingArchivedProjects),
    setJson(keys.updates, cascade.remainingUpdates),
    setJson(keys.deletedUpdates, cascade.nextUpdateTombstones),
    setJson(keys.updateDeletionJournal, cascade.nextUpdateDeletionIntents),
    setJson(keys.projectDocuments, cascade.remainingProjectDocuments),
    setJson(keys.referenceDocuments, cascade.remainingReferenceDocuments),
    setJson(keys.scheduleItems, cascade.remainingScheduleItems),
    setJson(keys.daveSyncTombstones, cascade.nextDAVESyncTombstones),
    setJson(keys.cloudIntents, cascade.nextCloudIntents),
    setJson(keys.fileCleanupIntents, cascade.nextFileCleanupIntents),
  ];
  if (cascade.draftReplaced) operations.push(setJson(keys.activeDraft, cascade.nextDraft));
  return operations;
}

export function referenceDocumentMatchesProject(
  document: ReferenceDocumentLike,
  projectName: string,
  authorityProjectId: string,
): boolean {
  const projectNames = new Set([
    normalizedScope(projectName),
    normalizedScope(authorityProjectId),
  ]);
  return Boolean(
    (document.projectName && projectNames.has(normalizedScope(document.projectName))) ||
    (document.projectId && projectNames.has(normalizedScope(document.projectId))),
  );
}

export function projectDocumentMatchesProject(
  document: ProjectDocumentLike,
  projectName: string,
  authorityProjectId: string,
): boolean {
  const documentProjectId = normalizedScope(document.projectId);
  return documentProjectId === normalizedScope(projectName) ||
    documentProjectId === normalizedScope(authorityProjectId);
}

export function scheduleItemMatchesProject(
  item: ScheduleItemLike,
  projectName: string,
): boolean {
  const projectKey = normalizedScope(projectName);
  return normalizedScope(item.projectName) === projectKey ||
    normalizedScope(item.scheduleProjectName) === projectKey;
}

export function selectProjectDeletionFallback({
  remainingProjectNames,
  archivedProjectNames,
  deletedProjectNames,
}: Readonly<{
  remainingProjectNames: readonly string[];
  archivedProjectNames: readonly string[];
  deletedProjectNames: readonly string[];
}>): string {
  const archived = new Set(archivedProjectNames.map(normalizedScope));
  const deleted = new Set(deletedProjectNames.map(normalizedScope));
  return remainingProjectNames.find(name => {
    const key = normalizedScope(name);
    return Boolean(key && !archived.has(key) && !deleted.has(key));
  }) || '';
}

export function parseProjectDeletionCloudIntents(
  value: unknown,
): ProjectDeletionCloudIntent[] {
  if (!Array.isArray(value)) throw new Error('Project cloud deletion intents are corrupt.');
  const normalized = value.map(normalizeProjectDeletionCloudIntent);
  if (normalized.some(intent => !intent)) {
    throw new Error('Project cloud deletion intents contain an invalid record.');
  }
  return mergeProjectDeletionCloudIntents(
    normalized as ProjectDeletionCloudIntent[],
  );
}

export function salvageProjectDeletionCloudIntents(
  value: unknown,
): ProjectDeletionCloudIntent[] {
  if (!Array.isArray(value)) return [];
  return mergeProjectDeletionCloudIntents(
    value.map(normalizeProjectDeletionCloudIntent).filter(
      (intent): intent is ProjectDeletionCloudIntent => Boolean(intent),
    ),
  );
}

export function mergeProjectDeletionCloudIntents(
  ...groups: readonly (readonly ProjectDeletionCloudIntent[])[]
): ProjectDeletionCloudIntent[] {
  const normalized = groups.flat().map(normalizeProjectDeletionCloudIntent);
  if (normalized.some(intent => !intent)) {
    throw new Error('Project cloud deletion intents contain an invalid record.');
  }
  return uniqueBy(
    normalized as ProjectDeletionCloudIntent[],
    intent => normalizedScope(intent.projectName),
  );
}

export function parseProjectDeletionFileCleanupIntents(
  value: unknown,
): ProjectDeletionFileCleanupIntent[] {
  if (!Array.isArray(value)) throw new Error('Project file cleanup intents are corrupt.');
  const normalized = value.map(normalizeProjectDeletionFileCleanupIntent);
  if (normalized.some(intent => !intent)) {
    throw new Error('Project file cleanup intents contain an invalid record.');
  }
  return mergeProjectDeletionFileCleanupIntents(
    normalized as ProjectDeletionFileCleanupIntent[],
  );
}

export function salvageProjectDeletionFileCleanupIntents(
  value: unknown,
): ProjectDeletionFileCleanupIntent[] {
  if (!Array.isArray(value)) return [];
  return mergeProjectDeletionFileCleanupIntents(
    value.map(normalizeProjectDeletionFileCleanupIntent).filter(
      (intent): intent is ProjectDeletionFileCleanupIntent => Boolean(intent),
    ),
  );
}

export function parseProjectUpdateDeletionIntents(
  value: unknown,
): ProjectUpdateDeletionIntent[] {
  if (!Array.isArray(value)) throw new Error('Update deletion intents are corrupt.');
  const normalized = value.map(normalizeProjectUpdateDeletionIntent);
  if (normalized.some(intent => !intent)) {
    throw new Error('Update deletion intents contain an invalid record.');
  }
  return uniqueBy(
    normalized as ProjectUpdateDeletionIntent[],
    intent => normalizedScope(intent.updateId),
  );
}

export function mergeProjectDeletionFileCleanupIntents(
  ...groups: readonly (readonly ProjectDeletionFileCleanupIntent[])[]
): ProjectDeletionFileCleanupIntent[] {
  const normalized = groups.flat().map(normalizeProjectDeletionFileCleanupIntent);
  if (normalized.some(intent => !intent)) {
    throw new Error('Project file cleanup intents contain an invalid record.');
  }
  return uniqueBy(
    normalized as ProjectDeletionFileCleanupIntent[],
    intent => intent.id,
  );
}

export function withoutProjectDeletionCloudIntent(
  intents: readonly ProjectDeletionCloudIntent[],
  projectName: string,
): ProjectDeletionCloudIntent[] {
  const projectKey = normalizedScope(projectName);
  return intents.filter(intent => normalizedScope(intent.projectName) !== projectKey);
}

export function withoutProjectDeletionFileCleanupIntent(
  intents: readonly ProjectDeletionFileCleanupIntent[],
  intentId: string,
): ProjectDeletionFileCleanupIntent[] {
  return intents.filter(intent => intent.id !== intentId);
}

function normalizeProjectDeletionCloudIntent(
  value: unknown,
): ProjectDeletionCloudIntent | null {
  if (!isRecord(value)) return null;
  const projectName = typeof value.projectName === 'string'
    ? value.projectName.trim()
    : '';
  const requestedAt = normalizedTimestamp(value.requestedAt);
  if (!projectName || !requestedAt) return null;
  return Object.freeze({ projectName, requestedAt });
}

function normalizeProjectUpdateDeletionIntent(
  value: unknown,
): ProjectUpdateDeletionIntent | null {
  if (!isRecord(value)) return null;
  const updateId = typeof value.updateId === 'string' ? value.updateId.trim() : '';
  const requestedAt = normalizedTimestamp(value.requestedAt);
  const cloudDeleteConfirmedAt = value.cloudDeleteConfirmedAt === null
    ? null
    : normalizedTimestamp(value.cloudDeleteConfirmedAt);
  if (!updateId || !requestedAt ||
      (value.cloudDeleteConfirmedAt !== null && !cloudDeleteConfirmedAt)) return null;
  return {
    updateId,
    projectName: typeof value.projectName === 'string'
      ? value.projectName
      : undefined,
    requestedAt,
    cloudDeleteConfirmedAt,
  };
}

function normalizeProjectDeletionFileCleanupIntent(
  value: unknown,
): ProjectDeletionFileCleanupIntent | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const projectName = typeof value.projectName === 'string'
    ? value.projectName.trim()
    : '';
  if (!id || !projectName) return null;

  if (value.kind === 'reference_document') {
    const uri = typeof value.uri === 'string' ? value.uri.trim() : '';
    return uri ? Object.freeze({ id, kind: value.kind, projectName, uri }) : null;
  }
  if (value.kind !== 'project_document') return null;
  const localUri = typeof value.localUri === 'string' ? value.localUri.trim() : '';
  const ownedFileId = typeof value.ownedFileId === 'string'
    ? value.ownedFileId.trim()
    : '';
  if (!localUri || !ownedFileId || !value.ownedFileManifest) return null;
  return Object.freeze({
    id,
    kind: value.kind,
    projectName,
    localUri,
    ownedFileId,
    ownedFileManifest: value.ownedFileManifest,
  });
}

function mergeProjectNames(
  existing: readonly string[],
  additions: readonly string[],
): string[] {
  return uniqueBy(
    [...additions, ...existing]
      .map(name => name.trim())
      .filter(Boolean),
    normalizedScope,
  );
}

function uniqueBy<T>(
  items: readonly T[],
  keyFor: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = keyFor(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function setJson(key: string, value: unknown): DurableLocalTransactionOperation {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new Error(`Project deletion could not serialize ${key}.`);
  }
  return { kind: 'set', key, value: serialized };
}

function normalizedScope(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// Keep the entity union checked here so adding a new deletion target cannot
// silently bypass the DAVE tombstone contract.
const _supportedDeletionTombstoneEntities: readonly DAVESyncTombstoneEntity[] = [
  'schedule_item',
  'reference_document',
];
void _supportedDeletionTombstoneEntities;
