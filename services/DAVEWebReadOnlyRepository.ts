import type {
  DAVESyncTombstone,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import { normalizeProjectItemActivity, normalizeProjectItemType } from './ProjectItemWorkflow';
import type { CloudProject, CloudProjectUpdate, JsonValue } from './SupabaseService';
import {
  isDAVESafeCloudScheduleRecord,
  reconcileDAVEScheduleRecords,
} from './DAVEScheduleRecovery';
import {
  scheduleItemsForExactImportBatch,
  scheduleOverviewProjectNames,
} from './PIEScheduleImportBatch';
import {
  reconcileCurrentScheduleDocuments,
  selectAuthoritativeScheduleItems,
} from './PIEScheduleReconciliation';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';
import { daveWebSupabaseGateway } from './DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from './DAVEWebTaskEditing';
import type {
  DAVEWebDocumentExtension,
  DAVEWebReportMediaSource,
  DAVEWebReportRecord,
} from './DAVEWebOperations';
import { daveWebReportPhotoSha256 } from './DAVEWebOperations';
import { partitionProjectUpdatesByDeletedTask } from './DAVEDeletedTaskEvidence';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';
import { normalizeProjectControls } from './VitruviusProjectControls';
import type { DAVEOperationalCollectionName } from './DAVEOperationalRefresh';
import { isGoogleDriveLinkedSource } from './GoogleDriveWebProvider';

export type DAVEWebReadOnlySnapshot = Readonly<{
  projects: readonly CloudProject[];
  scheduleItems: readonly DAVEWebScheduleItem[];
  projectUpdates: readonly CloudProjectUpdate<ProjectUpdate>[];
  referenceDocuments: readonly DAVEWebReferenceDocument[];
  refreshedAt: string;
}>;

export type DAVEWebReferenceDocument = ReferenceDocument & DAVEWebDocumentExtension & Readonly<{
  cloudUpdatedAt: string | null;
  linkedScheduleItems: readonly Readonly<{
    id: string;
    cloudUpdatedAt: string | null;
  }>[];
}>;

export async function loadDAVEWebReadOnlySnapshot(
  collections?: readonly DAVEOperationalCollectionName[],
): Promise<DAVEWebReadOnlySnapshot> {
  const rows = await daveWebSupabaseGateway.loadAuthorizedRows(collections);
  const rawProjects = rows.projects.map(normalizeProject).filter(isPresent);
  const tombstones = rows.syncTombstones.map(normalizeTombstone).filter(isPresent);
  const reconciledDocuments = reconcileCurrentScheduleDocuments(
    removeTombstonedRecords(
      rows.referenceDocuments.map(normalizeDocument).filter(isPresent),
      tombstones,
      'reference_document',
    ),
  );
  const reconciledScheduleItems = reconcileDAVEScheduleRecords(
    removeTombstonedRecords(
      rows.scheduleItems.map(normalizeScheduleItem).filter(isPresent),
      tombstones,
      'schedule_item',
    ),
  );
  const referenceDocuments = reconciledDocuments.map(document => ({
    ...document,
    linkedScheduleItems: Object.freeze(
      scheduleItemsForExactImportBatch(reconciledScheduleItems, document).map(item => ({
        id: item.id,
        cloudUpdatedAt: (item as DAVEWebScheduleItem).cloudUpdatedAt,
      })),
    ),
  }));
  const scheduleItems = selectAuthoritativeScheduleItems({
    scheduleItems: reconciledScheduleItems,
    scheduleDocuments: referenceDocuments,
  }) as DAVEWebScheduleItem[];
  const projects = portfolioProjects(rawProjects, scheduleItems);
  const projectUpdates = partitionProjectUpdatesByDeletedTask(
    rows.projectUpdates.map(normalizeProjectUpdate).filter(isPresent),
    tombstones,
    update => update.updateData,
  ).active;

  return Object.freeze({
    projects: Object.freeze(projects),
    scheduleItems: Object.freeze(scheduleItems),
    projectUpdates: Object.freeze(projectUpdates),
    referenceDocuments: Object.freeze(referenceDocuments),
    refreshedAt: new Date().toISOString(),
  });
}

function portfolioProjects(
  projects: readonly CloudProject[],
  scheduleItems: readonly ScheduleItem[],
): CloudProject[] {
  const durableProjects: CloudProject[] = [];
  const durableIds = new Set<string>();
  const durableNames = new Set<string>();
  projects.forEach(project => {
    const id = project.id || '';
    if (!id || durableIds.has(id)) return;
    durableIds.add(id);
    durableNames.add(normalized(project.name));
    durableProjects.push(project);
  });

  const shellsByName = new Map<string, CloudProject>();
  projects.forEach(project => {
    const key = normalized(project.name);
    if (project.id?.trim() || !key || durableNames.has(key) || shellsByName.has(key)) return;
    shellsByName.set(key, project);
  });
  scheduleOverviewProjectNames(
    [],
    [...scheduleItems],
  ).forEach(name => {
    const key = normalized(name);
    if (!key || durableNames.has(key) || shellsByName.has(key)) return;
    shellsByName.set(key, {
      id: null,
      name,
      status: 'Active',
      archived: false,
      isFavorite: false,
      createdAt: null,
      updatedAt: null,
      ownerId: null,
      data: null,
    });
  });
  return [...durableProjects, ...shellsByName.values()];
}

function normalizeProject(value: unknown): CloudProject | null {
  const row = toRecord(value);
  const name = readString(row.name);
  if (!name) return null;
  return {
    id: readExactIdentifier(row.id),
    name,
    status: readString(row.status),
    archived: typeof row.archived === 'boolean' ? row.archived : false,
    isFavorite: typeof row.is_favorite === 'boolean' ? row.is_favorite : false,
    createdAt: readString(row.created_at),
    updatedAt: readString(row.updated_at),
    ownerId: readString(row.owner_id),
    data: isJsonValue(row.project_data) ? row.project_data : null,
  };
}

function normalizeScheduleItem(value: unknown): DAVEWebScheduleItem | null {
  const row = toRecord(value);
  const data = toRecord(row.item_data);
  if (!isDAVESafeCloudScheduleRecord(data)) return null;
  const projectId = readConsistentExactIdentifier(row.project_id, data.projectId);
  const id = readConsistentExactIdentifier(row.id, data.id);
  if (projectId === undefined || !id) return null;
  const progress = reconcileScheduleProgress(data.status, data.percentComplete);
  const projectName = readString(data.projectName) ?? readString(data.scheduleProjectName) ?? '';

  return {
    ...(data as Partial<ScheduleItem>),
    id,
    itemType: normalizeProjectItemType(data.itemType),
    projectId,
    scheduleProjectName: readString(data.scheduleProjectName),
    projectTimeZone: readString(data.projectTimeZone),
    projectName,
    taskName: data.taskName.trim(),
    locationName: readString(data.locationName) ?? '',
    startDate: readString(data.startDate) ?? '',
    finishDate: readString(data.finishDate) ?? '',
    milestone: readString(data.milestone) ?? '',
    owner: readString(data.owner) ?? '',
    contractor: readString(data.contractor) ?? '',
    durationDays: typeof data.durationDays === 'number' && Number.isFinite(data.durationDays)
      ? Math.max(0, data.durationDays)
      : null,
    wbsCode: readString(data.wbsCode),
    parentItemId: readString(data.parentItemId),
    sortOrder: typeof data.sortOrder === 'number' && Number.isFinite(data.sortOrder)
      ? Math.max(0, Math.trunc(data.sortOrder))
      : null,
    dependencies: normalizeScheduleDependencies(data.dependencies),
    isSummary: data.isSummary === true,
    isMilestone: data.isMilestone === true,
    baselineStartDate: readString(data.baselineStartDate),
    baselineFinishDate: readString(data.baselineFinishDate),
    percentComplete: progress.percentComplete,
    progressSource: data.progressSource === 'project_manager' || data.progressSource === 'schedule_import'
      ? data.progressSource
      : null,
    progressConfirmedAt: readString(data.progressConfirmedAt),
    progressConfirmedBy: readString(data.progressConfirmedBy),
    priority: data.priority === 'Low' || data.priority === 'High' ? data.priority : 'Medium',
    status: progress.status,
    notes: readString(data.notes) ?? '',
    nextAction: readString(data.nextAction) ?? '',
    activity: normalizeProjectItemActivity(data.activity),
    projectControls: normalizeProjectControls(data.projectControls),
    importedFrom: readString(data.importedFrom),
    importedAt: readString(data.importedAt),
    importBatchId: readString(data.importBatchId),
    sourceDocumentId: readString(data.sourceDocumentId),
    createdAt: readString(data.createdAt) ?? readString(row.created_at) ?? '',
    updatedAt: readString(data.updatedAt) ?? readString(row.updated_at),
    cloudUpdatedAt: readString(row.updated_at),
  };
}

function normalizeTombstone(value: unknown): DAVESyncTombstone | null {
  const row = toRecord(value);
  const entityType = readString(row.entity_type);
  const recordId = readString(row.record_id);
  const deletedAt = readString(row.deleted_at);
  if (
    !recordId ||
    !deletedAt ||
    (entityType !== 'project_area' && entityType !== 'schedule_item' && entityType !== 'reference_document')
  ) return null;
  return { entityType, recordId, deletedAt };
}

function removeTombstonedRecords<T extends { id: string }>(
  records: readonly T[],
  tombstones: readonly DAVESyncTombstone[],
  entityType: DAVESyncTombstone['entityType'],
): T[] {
  const deletedIds = new Set(
    tombstones
      .filter(tombstone => tombstone.entityType === entityType)
      .map(tombstone => normalized(tombstone.recordId)),
  );
  return records.filter(record => !deletedIds.has(normalized(record.id)));
}

function normalizeProjectUpdate(value: unknown): CloudProjectUpdate<ProjectUpdate> | null {
  const row = toRecord(value);
  const data = toRecord(row.update_data);
  const projectId = readConsistentExactIdentifier(row.project_id, data.projectId);
  if (projectId === undefined) return null;
  const id = readConsistentExactIdentifier(row.id, data.id);
  const projectName = readString(row.project_name) ?? readString(data.projectName);
  if (!id || !projectName) return null;
  if (data.isArchived === true) return null;

  const photos = Array.isArray(data.photos)
    ? data.photos.map(normalizeWebPhoto).filter(isPresent)
    : [];

  return {
    id,
    projectName,
    areaName: readString(row.area_name) ?? readString(data.selectedAreaName) ?? '',
    idempotencyKey: readString(row.idempotency_key),
    createdAt: readString(row.created_at),
    updatedAt: readString(row.updated_at),
    ownerId: readString(row.owner_id),
    updateData: {
      ...(data as Partial<ProjectUpdate>),
      id,
      projectId,
      projectName,
      date: readString(data.date) ?? readString(row.updated_at) ?? readString(row.created_at) ?? '',
      photos,
      notes: readString(data.notes) ?? '',
      scheduleItemId: readString(data.scheduleItemId),
      scheduleTaskName: readString(data.scheduleTaskName),
      scheduleProjectName: readString(data.scheduleProjectName),
      selectedAreaId: readString(data.selectedAreaId),
      selectedAreaName: readString(data.selectedAreaName) ?? readString(row.area_name),
      gpsLatitude: readFiniteNumber(data.gpsLatitude),
      gpsLongitude: readFiniteNumber(data.gpsLongitude),
      gpsAccuracy: readFiniteNumber(data.gpsAccuracy),
      distanceFromSelectedAreaFeet: readFiniteNumber(data.distanceFromSelectedAreaFeet),
      locationCapturedAt: readString(data.locationCapturedAt),
      recipients: isRecord(data.recipients) && Array.isArray(data.recipients.contactIds)
        ? { contactIds: data.recipients.contactIds.filter((item): item is string => typeof item === 'string') }
        : { contactIds: [] },
    },
  };
}

export function normalizeWebPhoto(value: unknown): UpdatePhoto | null {
  const photo = toRecord(value);
  const id = readString(photo.id);
  if (!id) return null;
  const photoIntelligence = isRecord(photo.photoIntelligence)
    ? photo.photoIntelligence as UpdatePhoto['photoIntelligence']
    : null;
  return {
    id,
    uri: '',
    caption: readString(photo.caption) ?? '',
    category: photo.category === 'Open Issue' || photo.category === 'Safety Concern'
      ? photo.category
      : 'Update',
    actionRequired: readString(photo.actionRequired) ?? '',
    actionOwner: readString(photo.actionOwner) ?? '',
    actionDueDate: readString(photo.actionDueDate) ?? '',
    actionStatus: photo.actionStatus === 'In Progress' || photo.actionStatus === 'Waiting' || photo.actionStatus === 'Closed'
      ? photo.actionStatus
      : 'Open',
    fileName: readString(photo.fileName),
    mimeType: readString(photo.mimeType),
    cloudStoragePath: readString(photo.cloudStoragePath),
    contentSha256: daveWebReportPhotoSha256(photo as UpdatePhoto),
    selectedAreaId: readString(photo.selectedAreaId),
    selectedAreaName: readString(photo.selectedAreaName),
    gpsLatitude: readFiniteNumber(photo.gpsLatitude),
    gpsLongitude: readFiniteNumber(photo.gpsLongitude),
    gpsAccuracy: readFiniteNumber(photo.gpsAccuracy),
    distanceFromSelectedAreaFeet: readFiniteNumber(photo.distanceFromSelectedAreaFeet),
    locationCapturedAt: readString(photo.locationCapturedAt),
    photoIntelligence,
  };
}

function normalizeDocument(value: unknown): DAVEWebReferenceDocument | null {
  const row = toRecord(value);
  const data = toRecord(row.document_data);
  const id = readExactIdentifier(row.id);
  const embeddedIdSupplied = data.id !== null && data.id !== undefined && data.id !== '';
  const name = readString(data.name) ?? readString(row.name);
  if (!id || (embeddedIdSupplied && readExactIdentifier(data.id) !== id) || !name) return null;

  return {
    ...(data as Partial<ReferenceDocument>),
    id,
    name,
    originalFileName: readString(data.originalFileName) ?? name,
    uri: '',
    mimeType: readString(data.mimeType),
    category: readString(data.category) ?? readString(row.category) ?? 'Other',
    notes: readString(data.notes) ?? '',
    isCurrent: data.isCurrent === true,
    importedAt: readString(data.importedAt) ?? readString(row.updated_at) ?? '',
    projectId: readString(data.projectId),
    projectName: readString(data.projectName),
    projectNames: readStringArray(data.projectNames),
    importBatchId: readString(data.importBatchId),
    storagePath: readString(data.storagePath),
    sourceProvider: data.sourceProvider === 'google_drive'
      ? 'google_drive'
      : data.sourceProvider === 'supabase_storage' ? 'supabase_storage' : null,
    externalSource: isGoogleDriveLinkedSource(data.externalSource)
      ? data.externalSource
      : null,
    sizeBytes: typeof data.sizeBytes === 'number' && Number.isFinite(data.sizeBytes)
      ? Math.max(0, data.sizeBytes)
      : null,
    contentSha256: readString(data.contentSha256),
    webFileFingerprint: readString(data.webFileFingerprint),
    webVersionGroupId: readString(data.webVersionGroupId),
    webContentReview: readString(data.webContentReview),
    webReport: normalizeWebReport(data.webReport),
    cloudUpdatedAt: readString(row.updated_at),
    linkedScheduleItems: Object.freeze([]),
  };
}

export function normalizeWebReport(value: unknown): DAVEWebReportRecord | null {
  const report = toRecord(value);
  const title = readString(report.title);
  const body = readString(report.body);
  const generatedAt = readString(report.generatedAt);
  const sourceRefreshedAt = readString(report.sourceRefreshedAt);
  if (!title || !body || !generatedAt || !sourceRefreshedAt) return null;
  const sourceTaskIds = readExactIdentifierList(report.sourceTaskIds);
  const sourceUpdateIds = readExactIdentifierList(report.sourceUpdateIds);
  const sourceDocumentIds = readExactIdentifierList(report.sourceDocumentIds);
  const sourceMedia = readExactReportMediaSources(report.sourceMedia);
  if (!sourceTaskIds || !sourceUpdateIds || !sourceDocumentIds || !sourceMedia) return null;
  const audit = Array.isArray(report.audit)
    ? report.audit.map(event => {
        const row = toRecord(event);
        const action = row.action === 'created' || row.action === 'edited' || row.action === 'approved'
          ? row.action
          : null;
        const id = readString(row.id);
        const actor = readString(row.actor);
        const at = readString(row.at);
        return action && id && actor && at ? { id, action, actor, at } : null;
      }).filter(isPresent)
    : [];
  return {
    status: report.status === 'approved' ? 'approved' : 'draft',
    audience: report.audience === 'executive'
      ? 'executive'
      : report.audience === 'project_manager'
        ? 'project_manager'
        : undefined,
    title,
    body,
    generatedAt,
    sourceRefreshedAt,
    sourceFingerprint: readString(report.sourceFingerprint),
    sourceScopeKey: readString(report.sourceScopeKey),
    sourceTaskIds,
    sourceUpdateIds,
    sourceDocumentIds,
    sourceMedia,
    audit,
  };
}

function readExactReportMediaSources(value: unknown): DAVEWebReportMediaSource[] | null {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const sources: DAVEWebReportMediaSource[] = [];
  const identities = new Set<string>();
  for (const item of value) {
    const row = toRecord(item);
    const projectId = readExactIdentifier(row.projectId);
    const updateId = readExactIdentifier(row.updateId);
    const photoId = readExactIdentifier(row.photoId);
    const storagePath = row.storagePath === null
      ? null
      : readExactIdentifier(row.storagePath);
    const contentSha256 = row.contentSha256 === null
      ? null
      : typeof row.contentSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.contentSha256)
        ? row.contentSha256
        : undefined;
    if (
      row.bucket !== 'project-photos' ||
      !projectId ||
      !updateId ||
      !photoId ||
      storagePath === null && row.storagePath !== null ||
      contentSha256 === undefined
    ) return null;
    const identity = [projectId, updateId, photoId].join('\u0000');
    if (identities.has(identity)) return null;
    identities.add(identity);
    sources.push({
      bucket: 'project-photos',
      projectId,
      updateId,
      photoId,
      storagePath,
      contentSha256,
    });
  }
  return sources.sort((left, right) => {
    const leftKey = [left.projectId, left.updateId, left.photoId, left.storagePath || '', left.contentSha256 || '']
      .join('\u0000');
    const rightKey = [right.projectId, right.updateId, right.photoId, right.storagePath || '', right.contentSha256 || '']
      .join('\u0000');
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function toRecord(value: unknown): Record<string, any> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readExactIdentifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : null;
}

function readExactIdentifierList(value: unknown): string[] | null {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const identifiers: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const identifier = readExactIdentifier(item);
    if (!identifier || seen.has(identifier)) return null;
    seen.add(identifier);
    identifiers.push(identifier);
  }
  return identifiers;
}

function readConsistentExactIdentifier(
  primary: unknown,
  embedded: unknown,
): string | null | undefined {
  const supplied = [primary, embedded].filter(value => value !== null && value !== undefined && value !== '');
  const exact = supplied.map(readExactIdentifier);
  if (exact.some(value => value === null)) return undefined;
  const values = exact.filter((value): value is string => value !== null);
  return values.length === 0 || new Set(values).size === 1
    ? values[0] ?? null
    : undefined;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values = new Map<string, string>();
  value.forEach(item => {
    const display = readString(item)?.trim();
    if (!display) return;
    const key = normalized(display);
    if (!values.has(key)) values.set(key, display);
  });
  return [...values.values()];
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
