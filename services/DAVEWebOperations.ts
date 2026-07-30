import type { ReferenceDocument, ScheduleItem } from '../types';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from './DAVEWebReadOnlyRepository';
import {
  buildDAVEProjectTruth,
  type DAVEProjectTruth,
} from './DAVEProjectTruth';
import {
  buildDAVEReportBriefing,
  buildDAVEReportSourceFingerprint,
  type DAVEReportBriefing,
} from './DAVEReportIntelligence';
import {
  bindPIEScheduleImportBatchProvenance,
  dedupeScheduleImportItems,
  type PIEScheduleImportBatch,
} from './PIEScheduleImportBatch';
import { normalizeScheduleImport } from './PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike } from './PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from './ReportAuthorityScope';
import { scheduleTaskIsComplete } from './dave-project-schedule-rollup';

export const DAVE_WEB_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export const DAVE_WEB_DOCUMENT_CATEGORIES = Object.freeze([
  'Schedules',
  'Permit Card',
  'Drawing',
  'Scope',
  'Contract',
  'Inspection',
  'Safety',
  'Compliance',
  'RFI / Field Decision',
  'Vendor Document',
  'Report',
  'Other',
] as const);

export type DAVEWebReportAuditEvent = Readonly<{
  id: string;
  action: 'created' | 'edited' | 'approved';
  actor: string;
  at: string;
}>;

export type DAVEWebReportRecord = Readonly<{
  status: 'draft' | 'approved';
  title: string;
  body: string;
  generatedAt: string;
  sourceRefreshedAt: string;
  sourceFingerprint?: string | null;
  sourceScopeKey?: string | null;
  sourceTaskIds: readonly string[];
  sourceUpdateIds: readonly string[];
  sourceDocumentIds?: readonly string[];
  audit: readonly DAVEWebReportAuditEvent[];
}>;

export type DAVEWebReportSource = Readonly<{
  version: 'dave-web-report-source/1.0';
  scopeKey: string;
  refreshedAt: string;
  fingerprint: string;
  taskIds: readonly string[];
  updateIds: readonly string[];
  documentIds: readonly string[];
}>;

export type DAVEWebDocumentExtension = Readonly<{
  storagePath?: string | null;
  sizeBytes?: number | null;
  webFileFingerprint?: string | null;
  webVersionGroupId?: string | null;
  webContentReview?: string | null;
  webReport?: DAVEWebReportRecord | null;
}>;

export type DAVEWebPreparedUpload = Readonly<{
  document: ReferenceDocument & DAVEWebDocumentExtension;
  scheduleItems: readonly ScheduleItem[];
  reviewMessage: string;
  extractionStatus: 'not_applicable' | 'ready' | 'needs_manual_review';
}>;

export type DAVEWebTruthDiagnostics = Readonly<{
  projectCount: number;
  taskCount: number;
  completedTaskCount: number;
  openTaskCount: number;
  currentScheduleCount: number;
  duplicateTaskGroups: readonly Readonly<{ key: string; taskIds: readonly string[] }>[];
  conflicts: readonly string[];
}>;

export type DAVEWebBackup = Readonly<{
  schemaVersion: 'vitruvius-web-backup/1.0';
  exportedAt: string;
  sourceRefreshedAt: string;
  projects: DAVEWebReadOnlySnapshot['projects'];
  scheduleItems: DAVEWebReadOnlySnapshot['scheduleItems'];
  projectUpdates: DAVEWebReadOnlySnapshot['projectUpdates'];
  referenceDocuments: DAVEWebReadOnlySnapshot['referenceDocuments'];
}>;

export function createDAVEWebId(prefix: string, now = Date.now()): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${now}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

export function prepareDAVEWebDocumentUpload({
  fileName,
  mimeType,
  sizeBytes,
  contents,
  category,
  projectName,
  projectNames,
  projects,
  fingerprint,
  versionGroupId,
  now = new Date().toISOString(),
}: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contents: string | null;
  category: string;
  projectName?: string;
  projectNames?: readonly string[];
  projects: readonly string[];
  fingerprint: string;
  versionGroupId?: string | null;
  now?: string;
}): DAVEWebPreparedUpload {
  const cleanName = fileName.trim();
  const selectedProjectNames = uniqueNames([
    ...(projectNames ?? []),
    projectName ?? '',
  ]);
  if (!cleanName) throw new Error('Choose a named document before continuing.');
  if (selectedProjectNames.length === 0) throw new Error('Choose at least one project for this document.');
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error('The selected document is empty.');
  if (sizeBytes > DAVE_WEB_MAX_DOCUMENT_BYTES) {
    throw new Error('The selected document is larger than 50 MB. Optimize or split it, then retry.');
  }

  const documentId = createDAVEWebId('web-document');
  const scheduleLike = normalized(category) === 'schedules';
  const document: ReferenceDocument & DAVEWebDocumentExtension = {
    id: documentId,
    name: cleanName.replace(/\.[^/.]+$/, ''),
    originalFileName: cleanName,
    uri: '',
    mimeType: mimeType || null,
    category: scheduleLike ? 'Schedules' : category,
    notes: '',
    isCurrent: false,
    importedAt: now,
    projectId: null,
    projectName: selectedProjectNames.length === 1 ? selectedProjectNames[0] : null,
    projectNames: selectedProjectNames,
    importBatchId: scheduleLike ? createDAVEWebId('schedule-batch') : null,
    sizeBytes,
    contentSha256: canonicalSha256(fingerprint),
    webFileFingerprint: fingerprint,
    webVersionGroupId: versionGroupId || documentId,
    webContentReview: scheduleLike ? 'Schedule activities must be reviewed before this file can become current.' : 'Classification reviewed on upload.',
  };

  if (!scheduleLike) {
    return Object.freeze({
      document,
      scheduleItems: Object.freeze([]),
      reviewMessage: 'The document is ready to upload with the selected project and classification.',
      extractionStatus: 'not_applicable',
    });
  }

  const readableContents = contents?.trim() || '';
  if (!readableContents || /pdf/i.test(mimeType) || /\.pdf$/i.test(cleanName)) {
    return Object.freeze({
      document,
      scheduleItems: Object.freeze([]),
      reviewMessage: 'The schedule file can be stored now, but this browser could not extract dated activities. Keep it as a prior version, or use a CSV/text schedule so tasks can be reviewed before making it current.',
      extractionStatus: 'needs_manual_review',
    });
  }

  const normalizedImport = normalizeScheduleImport({
    contents: readableContents,
    sourceName: cleanName,
    mimeType,
    projects: selectedProjectNames.length > 0 ? [...selectedProjectNames] : [...projects],
    projectAreas: [],
    now: new Date(now),
  });
  const items = dedupeScheduleImportItems(
    normalizedImport.items.map(item => ({
      ...item,
      scheduleProjectName: item.scheduleProjectName || item.projectName || selectedProjectNames[0],
      projectName: item.projectName || selectedProjectNames[0],
      importedFrom: cleanName,
    })),
  );
  if (items.length === 0) {
    return Object.freeze({
      document,
      scheduleItems: Object.freeze([]),
      reviewMessage: 'No dated schedule activities were found. Check the column headings or upload a CSV with Task, Project, Location, Start, Finish, Owner, Status, and Percent Complete.',
      extractionStatus: 'needs_manual_review',
    });
  }

  const batch: PIEScheduleImportBatch = bindPIEScheduleImportBatchProvenance({
    id: document.importBatchId!,
    kind: 'schedule_file',
    sourceCount: 1,
    sourceLabel: cleanName,
    message: normalizedImport.message,
    items,
    documents: [document],
  });
  return Object.freeze({
    document: batch.documents[0] as ReferenceDocument & DAVEWebDocumentExtension,
    scheduleItems: Object.freeze(batch.items),
    reviewMessage: `${batch.items.length} schedule ${batch.items.length === 1 ? 'activity' : 'activities'} extracted for ${selectedProjectNames.length} selected project${selectedProjectNames.length === 1 ? '' : 's'}. Review each task's project, dates, area, status, and percent complete before upload.`,
    extractionStatus: 'ready',
  });
}

function canonicalSha256(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function buildDAVEWebReportDraft(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: string | null,
): DAVEReportBriefing {
  const truths = buildDAVEWebProjectTruths(snapshot, selectedProject);
  return buildDAVEReportBriefing({
    truths,
    selectedProjectNames: truths.map(truth => truth.projectName),
  });
}

/**
 * Captures the exact semantic project facts used to prepare a web report.
 * Refresh timestamps and collection ordering do not create false changes,
 * while any meaningful task, update, document, or conclusion change does.
 */
export function buildDAVEWebReportSource(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: string | null,
): DAVEWebReportSource {
  const truths = buildDAVEWebProjectTruths(snapshot, selectedProject);
  const evidenceRecords = truths.flatMap(truth => truth.evidence.records);
  const scopeNames = truths.map(truth => normalized(truth.projectName)).sort();
  const scopeKey = scopeNames.length > 0 ? scopeNames.join('|') : 'empty-scope';
  const truthFingerprint = buildDAVEReportSourceFingerprint(truths);
  const mediaFingerprint = stableWebReportSourceHash(
    canonicalWebReportSourceValue(
      snapshot.projectUpdates
        .map(record => record.updateData)
        .filter(update => scopeNames.includes(normalized(update.projectName)))
        .map(update => ({
          id: update.id,
          gpsLatitude: update.gpsLatitude ?? null,
          gpsLongitude: update.gpsLongitude ?? null,
          gpsAccuracy: update.gpsAccuracy ?? null,
          distanceFromSelectedAreaFeet: update.distanceFromSelectedAreaFeet ?? null,
          locationCapturedAt: update.locationCapturedAt ?? null,
          photos: update.photos.map(photo => ({
            id: photo.id,
            gpsLatitude: photo.gpsLatitude ?? null,
            gpsLongitude: photo.gpsLongitude ?? null,
            gpsAccuracy: photo.gpsAccuracy ?? null,
            distanceFromSelectedAreaFeet: photo.distanceFromSelectedAreaFeet ?? null,
            locationCapturedAt: photo.locationCapturedAt ?? null,
            photoIntelligence: photo.photoIntelligence ?? null,
          })),
        })),
    ),
  );

  return Object.freeze({
    version: 'dave-web-report-source/1.0',
    scopeKey,
    refreshedAt: snapshot.refreshedAt,
    fingerprint: `${truthFingerprint}:media-${mediaFingerprint}`,
    taskIds: Object.freeze(uniqueSorted(truths.flatMap(truth =>
      truth.schedule.map(task => task.taskId),
    ))),
    updateIds: Object.freeze(uniqueSorted(evidenceRecords
      .filter(record => record.kind === 'update')
      .map(record => record.sourceRecordId))),
    documentIds: Object.freeze(uniqueSorted(evidenceRecords
      .filter(record => record.kind === 'document')
      .map(record => record.sourceRecordId))),
  });
}

export function daveWebReportSourceIsCurrent(
  sourceFingerprint: string | null | undefined,
  currentSource: DAVEWebReportSource,
): boolean {
  return Boolean(sourceFingerprint && sourceFingerprint === currentSource.fingerprint);
}

function buildDAVEWebProjectTruths(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: string | null,
): DAVEProjectTruth[] {
  const projects = snapshot.projects.filter(project =>
    !selectedProject || normalized(project.name) === normalized(selectedProject),
  );
  const projectRecords = snapshot.projects.map(project => ({
    id: project.id,
    name: project.name,
  }));
  const updates = snapshot.projectUpdates.map(update => update.updateData);
  return projects.map(project => {
    const projectId = project.id || normalized(project.name);
    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: project.name,
      selectedProjectNames: [project.name],
      projectRecords,
      updates,
      scheduleItems: snapshot.scheduleItems,
      referenceDocuments: snapshot.referenceDocuments,
    });
    return buildDAVEProjectTruth({
      projectId,
      projectName: project.name,
      updates: scope.updates.map(update => ({ ...update, projectName: project.name })),
      scheduleItems: scope.scheduleItems,
      projectAreas: scope.projectAreas,
      referenceDocuments: scope.referenceDocuments.map(document => ({
        ...document,
        projectId,
        projectName: project.name,
      })),
      now: snapshot.refreshedAt,
    });
  });
}

export function formatDAVEWebReport(briefing: DAVEReportBriefing): string {
  const lines = [
    `# ${briefing.scopeLabel} Project Report`,
    '',
    `Generated: ${new Date(briefing.generatedAt).toLocaleString()}`,
    `Overall condition: ${briefing.conditionLabel}`,
    '',
    '## Executive Summary',
    briefing.executiveSnapshot,
    '',
    '## Project Status',
    ...briefing.projectConditions.map(item => `- ${item.projectName}: ${item.currentReality} ${item.schedule}`),
    '',
    '## Current Work',
    ...(briefing.currentWork.length ? briefing.currentWork.map(item => `- ${item}`) : ['- No current work is recorded.']),
    '',
    '## Recent Changes',
    ...(briefing.whatChanged.length ? briefing.whatChanged.map(item => `- ${item}`) : ['- No recent material changes are recorded.']),
    '',
    '## Schedule Position',
    ...briefing.schedulePosition.map(item => `- ${item}`),
    '',
    '## Risks and Decisions',
    ...(briefing.criticalRisks.length ? briefing.criticalRisks.map(item => `- ${item}`) : ['- No current critical risks are recorded.']),
    ...briefing.decisionsRequired.map(item => `- Decision: ${item}`),
    '',
    '## Next Actions',
    ...(briefing.nextActions.length
      ? briefing.nextActions.map(item => `- ${item.projectName} — ${item.taskName}: ${item.action} Owner: ${item.owner}. Timing: ${item.timing}.`)
      : ['- Continue planned work and record the next material change.']),
  ];
  return lines.join('\n');
}

export function buildDAVEWebTruthDiagnostics(
  snapshot: DAVEWebReadOnlySnapshot,
): DAVEWebTruthDiagnostics {
  const groups = new Map<string, string[]>();
  snapshot.scheduleItems.forEach(item => {
    const key = [item.scheduleProjectName || item.projectName, item.locationName, item.taskName, item.finishDate]
      .map(normalized)
      .join('|');
    const ids = groups.get(key) || [];
    ids.push(item.id);
    groups.set(key, ids);
  });
  const duplicateTaskGroups = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, taskIds]) => Object.freeze({ key, taskIds: Object.freeze(taskIds) }));
  const currentSchedules = snapshot.referenceDocuments.filter(document =>
    scheduleDocumentIsScheduleLike(document) && document.isCurrent,
  );
  const completedTaskCount = snapshot.scheduleItems.filter(item =>
    scheduleTaskIsComplete(item),
  ).length;
  const conflicts = [
    ...(duplicateTaskGroups.length ? [`${duplicateTaskGroups.length} duplicate task occurrence group${duplicateTaskGroups.length === 1 ? '' : 's'} need review.`] : []),
    ...(currentSchedules.length > 1 ? ['More than one current schedule is visible after reconciliation.'] : []),
  ];
  return Object.freeze({
    projectCount: snapshot.projects.length,
    taskCount: snapshot.scheduleItems.length,
    completedTaskCount,
    openTaskCount: snapshot.scheduleItems.length - completedTaskCount,
    currentScheduleCount: currentSchedules.length,
    duplicateTaskGroups: Object.freeze(duplicateTaskGroups),
    conflicts: Object.freeze(conflicts),
  });
}

export function createDAVEWebBackup(snapshot: DAVEWebReadOnlySnapshot): DAVEWebBackup {
  return Object.freeze({
    schemaVersion: 'vitruvius-web-backup/1.0',
    exportedAt: new Date().toISOString(),
    sourceRefreshedAt: snapshot.refreshedAt,
    projects: snapshot.projects,
    scheduleItems: snapshot.scheduleItems,
    projectUpdates: snapshot.projectUpdates,
    referenceDocuments: snapshot.referenceDocuments,
  });
}

export function validateDAVEWebBackup(value: unknown): DAVEWebBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The backup file is not valid JSON data.');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 'vitruvius-web-backup/1.0') throw new Error('This backup version is not supported.');
  if (!Array.isArray(record.projects) || !Array.isArray(record.scheduleItems) || !Array.isArray(record.projectUpdates) || !Array.isArray(record.referenceDocuments)) {
    throw new Error('The backup is missing one or more required collections.');
  }
  for (const task of record.scheduleItems) {
    if (!task || typeof task !== 'object' || typeof (task as Record<string, unknown>).id !== 'string' || typeof (task as Record<string, unknown>).taskName !== 'string') {
      throw new Error('The backup contains a malformed task record.');
    }
  }
  return value as DAVEWebBackup;
}

export function reportRecordFromDocument(
  document: DAVEWebReferenceDocument,
): DAVEWebReportRecord | null {
  return document.webReport || null;
}

function normalized(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueNames(values: readonly string[]): string[] {
  const names = new Map<string, string>();
  values.forEach(value => {
    const display = value.trim();
    const key = normalized(display);
    if (key && !names.has(key)) names.set(key, display);
  });
  return [...names.values()];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();
}

function canonicalWebReportSourceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalWebReportSourceValue)
      .sort((left, right) =>
        stableWebReportSourceString(left).localeCompare(stableWebReportSourceString(right)),
      );
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalWebReportSourceValue(child)]),
    );
  }
  return value;
}

function stableWebReportSourceString(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

function stableWebReportSourceHash(value: unknown): string {
  const serialized = stableWebReportSourceString(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
