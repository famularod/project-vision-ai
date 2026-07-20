import type {
  DAVESyncTombstone,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import type { CloudProject, CloudProjectUpdate, JsonValue } from './SupabaseService';
import {
  isDAVESafeCloudScheduleRecord,
  reconcileDAVEScheduleRecords,
} from './DAVEScheduleRecovery';
import { scheduleOverviewProjectNames } from './PIEScheduleImportBatch';
import {
  reconcileCurrentScheduleDocuments,
  selectAuthoritativeScheduleItems,
} from './PIEScheduleReconciliation';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';
import { daveWebSupabaseGateway } from './DAVEWebSupabaseClient';

export type DAVEWebReadOnlySnapshot = Readonly<{
  projects: readonly CloudProject[];
  scheduleItems: readonly ScheduleItem[];
  projectUpdates: readonly CloudProjectUpdate<ProjectUpdate>[];
  referenceDocuments: readonly ReferenceDocument[];
  refreshedAt: string;
}>;

export async function loadDAVEWebReadOnlySnapshot(): Promise<DAVEWebReadOnlySnapshot> {
  const rows = await daveWebSupabaseGateway.loadAuthorizedRows();
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
  const scheduleItems = selectAuthoritativeScheduleItems({
    scheduleItems: reconciledScheduleItems,
    scheduleDocuments: reconciledDocuments,
  });
  const projects = portfolioProjects(rawProjects, scheduleItems);

  return Object.freeze({
    projects: Object.freeze(projects),
    scheduleItems: Object.freeze(scheduleItems),
    projectUpdates: Object.freeze(rows.projectUpdates.map(normalizeProjectUpdate).filter(isPresent)),
    referenceDocuments: Object.freeze(reconciledDocuments),
    refreshedAt: new Date().toISOString(),
  });
}

function portfolioProjects(
  projects: readonly CloudProject[],
  scheduleItems: readonly ScheduleItem[],
): CloudProject[] {
  const projectByName = new Map(
    projects.map(project => [normalized(project.name), project]),
  );
  return scheduleOverviewProjectNames(
    projects.map(project => project.name),
    [...scheduleItems],
  ).map(name => projectByName.get(normalized(name)) ?? {
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
}

function normalizeProject(value: unknown): CloudProject | null {
  const row = toRecord(value);
  const name = readString(row.name);
  if (!name) return null;
  return {
    id: readString(row.id),
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

function normalizeScheduleItem(value: unknown): ScheduleItem | null {
  const row = toRecord(value);
  const data = toRecord(row.item_data);
  if (!isDAVESafeCloudScheduleRecord(data)) return null;
  const progress = reconcileScheduleProgress(data.status, data.percentComplete);
  const projectName = readString(data.projectName) ?? readString(data.scheduleProjectName) ?? '';

  return {
    ...(data as Partial<ScheduleItem>),
    id: data.id.trim(),
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
    percentComplete: progress.percentComplete,
    progressSource: data.progressSource === 'project_manager' || data.progressSource === 'schedule_import'
      ? data.progressSource
      : null,
    progressConfirmedAt: readString(data.progressConfirmedAt),
    progressConfirmedBy: readString(data.progressConfirmedBy),
    priority: data.priority === 'Low' || data.priority === 'High' ? data.priority : 'Medium',
    status: progress.status,
    notes: readString(data.notes) ?? '',
    importedFrom: readString(data.importedFrom),
    importedAt: readString(data.importedAt),
    importBatchId: readString(data.importBatchId),
    sourceDocumentId: readString(data.sourceDocumentId),
    createdAt: readString(data.createdAt) ?? readString(row.created_at) ?? '',
    updatedAt: readString(data.updatedAt) ?? readString(row.updated_at),
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
  const id = readString(row.id) ?? readString(data.id);
  const projectName = readString(row.project_name) ?? readString(data.projectName);
  if (!id || !projectName) return null;
  if (data.isArchived === true) return null;

  const photos = Array.isArray(data.photos)
    ? data.photos.map(normalizePhoto).filter(isPresent)
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
      projectName,
      date: readString(data.date) ?? readString(row.updated_at) ?? readString(row.created_at) ?? '',
      photos,
      notes: readString(data.notes) ?? '',
      recipients: isRecord(data.recipients) && Array.isArray(data.recipients.contactIds)
        ? { contactIds: data.recipients.contactIds.filter((item): item is string => typeof item === 'string') }
        : { contactIds: [] },
    },
  };
}

function normalizePhoto(value: unknown): UpdatePhoto | null {
  const photo = toRecord(value);
  const id = readString(photo.id);
  if (!id) return null;
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
    selectedAreaId: readString(photo.selectedAreaId),
    selectedAreaName: readString(photo.selectedAreaName),
    locationCapturedAt: readString(photo.locationCapturedAt),
  };
}

function normalizeDocument(value: unknown): ReferenceDocument | null {
  const row = toRecord(value);
  const data = toRecord(row.document_data);
  const id = readString(data.id) ?? readString(row.id);
  const name = readString(data.name) ?? readString(row.name);
  if (!id || !name) return null;

  return {
    ...(data as Partial<ReferenceDocument>),
    id,
    name,
    originalFileName: readString(data.originalFileName) ?? name,
    uri: '',
    mimeType: readString(data.mimeType),
    category: readString(data.category) ?? readString(row.category) ?? 'Other',
    notes: readString(data.notes) ?? '',
    isCurrent: data.isCurrent !== false,
    importedAt: readString(data.importedAt) ?? readString(row.updated_at) ?? '',
    projectId: readString(data.projectId),
    projectName: readString(data.projectName),
    importBatchId: readString(data.importBatchId),
  };
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
