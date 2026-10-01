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
  scheduleItemsOnlyInImportBatch,
  scheduleOverviewProjectNames,
} from './PIEScheduleImportBatch';
import {
  reconcileCurrentScheduleDocuments,
  selectAuthoritativeScheduleItems,
  scheduleDocumentIsScheduleLike,
} from './PIEScheduleReconciliation';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';
import { daveWebSupabaseGateway } from './DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from './DAVEWebTaskEditing';
import type {
  DAVEWebDocumentExtension,
  DAVEWebReportRecord,
} from './DAVEWebOperations';
import { partitionProjectUpdatesByDeletedTask } from './DAVEDeletedTaskEvidence';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';
import { normalizeProjectControls } from './VitruviusProjectControls';
import type { DAVEOperationalCollectionName } from './DAVEOperationalRefresh';
import { isGoogleDriveLinkedSource } from './GoogleDriveWebProvider';
import { ecosClosedProjectNames } from './ECOSProjectQuestion';

export type DAVEWebReadOnlySnapshot = Readonly<{
  projects: readonly CloudProject[];
  scheduleItems: readonly DAVEWebScheduleItem[];
  projectUpdates: readonly CloudProjectUpdate<ProjectUpdate>[];
  referenceDocuments: readonly DAVEWebReferenceDocument[];
  /**
   * Closed (archived, not deleted) project names, kept out of `projects` but
   * checked by Ask ECOS so a question naming one is refused (audit A9 pass 3 L1).
   */
  closedProjectNames?: readonly string[];
  refreshedAt: string;
}>;

export type DAVEWebReferenceDocument = ReferenceDocument & DAVEWebDocumentExtension & Readonly<{
  cloudUpdatedAt: string | null;
  linkedScheduleItems: readonly Readonly<{
    id: string;
    cloudUpdatedAt: string | null;
  }>[];
  /**
   * Every task the schedule's import contains, unchanged tasks it shares
   * with an earlier revision included; Make Current needs at least one.
   */
  importedScheduleItemCount: number;
}>;

export async function loadDAVEWebReadOnlySnapshot(
  collections?: readonly DAVEOperationalCollectionName[],
): Promise<DAVEWebReadOnlySnapshot> {
  const rows = await daveWebSupabaseGateway.loadAuthorizedRows(collections);
  const tombstones = rows.syncTombstones.map(normalizeTombstone).filter(isPresent);
  // A deleted project's row can come back (a create queued offline landed
  // after its delete); the phone hides it by its deletion record, and so does
  // the desktop now (whole-app audit A3 pass 4). The record is keyed by name.
  const rawProjects = removeTombstonedRecords(
    rows.projects.map(normalizeProject).filter(isPresent),
    tombstones,
    'project',
    project => project.name,
  );
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
      // The tasks "Delete Document + N Tasks" takes: those no other schedule contains (audit A5 pass 2).
      scheduleItemsOnlyInImportBatch(reconciledScheduleItems, document, reconciledDocuments.filter(scheduleDocumentIsScheduleLike)).map(item => ({
        id: item.id,
        cloudUpdatedAt: (item as DAVEWebScheduleItem).cloudUpdatedAt,
      })),
    ),
    // Make Current counts the tasks the import contains: a revision whose
    // every task is unchanged has no task of its own (audit A5 pass 3 F5).
    importedScheduleItemCount: scheduleItemsForExactImportBatch(reconciledScheduleItems, document).length,
  }));
  const scheduleItems = selectAuthoritativeScheduleItems({
    scheduleItems: reconciledScheduleItems,
    scheduleDocuments: referenceDocuments,
  }) as DAVEWebScheduleItem[];
  const projects = portfolioProjects(rawProjects, scheduleItems, tombstones);
  const closedProjectNames = ecosClosedProjectNames({ // deleted rows are already out of rawProjects
    archived: rawProjects.filter(project => project.archived).map(project => project.name),
    open: projects.map(project => project.name),
  });
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
    closedProjectNames: Object.freeze(closedProjectNames),
    refreshedAt: new Date().toISOString(),
  });
}

function portfolioProjects(
  allProjects: readonly CloudProject[],
  scheduleItems: readonly ScheduleItem[],
  tombstones: readonly DAVESyncTombstone[],
): CloudProject[] {
  // Archived projects are read only so their names stay out: a task that
  // still names an archived parent must not bring it back (native parity,
  // PR #73; code review 27 Sep 2026).
  const projects = allProjects.filter(project => !project.archived);
  const projectByName = new Map(
    projects.map(project => [normalized(project.name), project]),
  );
  return scheduleOverviewProjectNames(
    projects.map(project => project.name),
    [...scheduleItems],
    [
      ...allProjects.filter(project => project.archived).map(project => project.name),
      ...tombstones.filter(tombstone => tombstone.entityType === 'project').map(tombstone => tombstone.recordId),
    ],
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

function normalizeScheduleItem(value: unknown): DAVEWebScheduleItem | null {
  const row = toRecord(value);
  const data = toRecord(row.item_data);
  if (!isDAVESafeCloudScheduleRecord(data)) return null;
  const progress = reconcileScheduleProgress(data.status, data.percentComplete);
  const projectName = readString(data.projectName) ?? readString(data.scheduleProjectName) ?? '';

  return {
    ...(data as Partial<ScheduleItem>),
    id: data.id.trim(),
    itemType: normalizeProjectItemType(data.itemType),
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
    (entityType !== 'project' && entityType !== 'project_area' &&
      entityType !== 'schedule_item' && entityType !== 'reference_document')
  ) return null;
  return { entityType, recordId, deletedAt };
}

function removeTombstonedRecords<T>(
  records: readonly T[],
  tombstones: readonly DAVESyncTombstone[],
  entityType: DAVESyncTombstone['entityType'],
  recordIdOf: (record: T) => string = record => (record as { id: string }).id,
): T[] {
  const deletedIds = new Set(
    tombstones
      .filter(tombstone => tombstone.entityType === entityType)
      .map(tombstone => normalized(tombstone.recordId)),
  );
  return records.filter(record => !deletedIds.has(normalized(recordIdOf(record))));
}

function normalizeProjectUpdate(value: unknown): CloudProjectUpdate<ProjectUpdate> | null {
  const row = toRecord(value);
  const data = toRecord(row.update_data);
  const id = readString(row.id) ?? readString(data.id);
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
    // GPS review pass 11: without it the desktop placed library photos at
    // the update's GPS, unlike the phone.
    ...(photo.pickedFromLibrary === true ? { pickedFromLibrary: true } : {}),
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
  const id = readString(data.id) ?? readString(row.id);
  const name = readString(data.name) ?? readString(row.name);
  if (!id || !name) return null;
  const { retiredForProjectNames: _retired, ...shared } = data as Partial<ReferenceDocument>;
  const retiredForProjectNames = readStringArray(data.retiredForProjectNames);

  return {
    ...shared,
    // A combined schedule retired for some of its projects (owner answer Q15, 30 Sep 2026).
    ...(retiredForProjectNames.length ? { retiredForProjectNames } : {}),
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
    importedScheduleItemCount: 0,
  };
}

export function normalizeWebReport(value: unknown): DAVEWebReportRecord | null {
  const report = toRecord(value);
  const title = readString(report.title);
  const body = readString(report.body);
  const generatedAt = readString(report.generatedAt);
  const sourceRefreshedAt = readString(report.sourceRefreshedAt);
  if (!title || !body || !generatedAt || !sourceRefreshedAt) return null;
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
    sourceTaskIds: Array.isArray(report.sourceTaskIds)
      ? report.sourceTaskIds.filter((item): item is string => typeof item === 'string')
      : [],
    sourceUpdateIds: Array.isArray(report.sourceUpdateIds)
      ? report.sourceUpdateIds.filter((item): item is string => typeof item === 'string')
      : [],
    sourceDocumentIds: Array.isArray(report.sourceDocumentIds)
      ? report.sourceDocumentIds.filter((item): item is string => typeof item === 'string')
      : [],
    audit,
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
