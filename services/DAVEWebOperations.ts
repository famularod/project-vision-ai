import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { ReferenceDocument, ScheduleItem, UpdatePhoto } from '../types';
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
import type { GoogleDriveLinkedSource } from './GoogleDriveWebProvider';
import {
  resolveExactDAVEWebTaskProjectId,
  type DAVEWebTaskProjectRecord,
} from './DAVEWebTaskEditing';

export const DAVE_WEB_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export async function recoverDAVEWebPreparedUploadBytes({
  bytes,
  file,
  expectedSizeBytes,
}: {
  bytes: ArrayBuffer;
  file: Blob;
  expectedSizeBytes: number;
}): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1 ||
      expectedSizeBytes > DAVE_WEB_MAX_DOCUMENT_BYTES ||
      !Number.isSafeInteger(file.size) || file.size < 1 ||
      file.size > DAVE_WEB_MAX_DOCUMENT_BYTES) {
    throw new Error('The selected document is too large for protected in-browser upload.');
  }
  if (bytes.byteLength === expectedSizeBytes && expectedSizeBytes > 0) return bytes;

  const recovered = await file.arrayBuffer();
  if (recovered.byteLength !== expectedSizeBytes || recovered.byteLength <= 0) {
    throw new Error(
      'The selected document changed after review. Choose the file again before uploading.',
    );
  }
  return recovered;
}

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

export type DAVEWebReportAudience = 'project_manager' | 'executive';

export type DAVEWebReportRecord = Readonly<{
  status: 'draft' | 'approved';
  audience?: DAVEWebReportAudience;
  title: string;
  body: string;
  generatedAt: string;
  sourceRefreshedAt: string;
  sourceFingerprint?: string | null;
  sourceScopeKey?: string | null;
  sourceTaskIds: readonly string[];
  sourceUpdateIds: readonly string[];
  sourceDocumentIds?: readonly string[];
  sourceMedia?: readonly DAVEWebReportMediaSource[];
  audit: readonly DAVEWebReportAuditEvent[];
}>;

export type DAVEWebReportMediaSource = Readonly<{
  bucket: 'project-photos';
  projectId: string;
  updateId: string;
  photoId: string;
  storagePath: string | null;
  contentSha256: string | null;
}>;

export type DAVEWebReportSource = Readonly<{
  version: 'dave-web-report-source/1.0';
  scopeKey: string;
  refreshedAt: string;
  fingerprint: string;
  taskIds: readonly string[];
  updateIds: readonly string[];
  documentIds: readonly string[];
  media: readonly DAVEWebReportMediaSource[];
}>;

export type DAVEWebReportProjectSelection = Readonly<{
  projectId: string;
  projectName: string;
}>;

export type DAVEWebDocumentExtension = Readonly<{
  storagePath?: string | null;
  sizeBytes?: number | null;
  sourceProvider?: 'supabase_storage' | 'google_drive' | null;
  externalSource?: GoogleDriveLinkedSource | null;
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

type DAVEWebDocumentPreparationInput = Readonly<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contents: string | null;
  category: string;
  projectId?: string | null;
  projectName?: string;
  projectNames?: readonly string[];
  projectRecords?: readonly DAVEWebTaskProjectRecord[];
  projects: readonly string[];
  fingerprint: string;
  versionGroupId?: string | null;
  now?: string;
  sourceProvider?: 'supabase_storage' | 'google_drive';
  externalSource?: GoogleDriveLinkedSource | null;
  maximumBytes?: number;
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
  projectId,
  projectName,
  projectNames,
  projectRecords = [],
  projects,
  fingerprint,
  versionGroupId,
  now = new Date().toISOString(),
  sourceProvider = 'supabase_storage',
  externalSource = null,
  maximumBytes = DAVE_WEB_MAX_DOCUMENT_BYTES,
}: DAVEWebDocumentPreparationInput): DAVEWebPreparedUpload {
  const cleanName = fileName.trim();
  const selectedProjectNames = uniqueNames([
    ...(projectNames ?? []),
    projectName ?? '',
  ]);
  const exactProjectId = typeof projectId === 'string' && projectId === projectId.trim() &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(projectId)
    ? projectId
    : null;
  if (!cleanName) throw new Error('Choose a named document before continuing.');
  if (selectedProjectNames.length === 0) throw new Error('Choose at least one project for this document.');
  if (projectId != null && !exactProjectId) throw new Error('Choose one exact project record before continuing.');
  if (exactProjectId && selectedProjectNames.length !== 1) {
    throw new Error('An exact project document cannot be assigned to multiple display-name scopes.');
  }
  if (normalized(category) === 'drawing' && !exactProjectId) {
    throw new Error('Choose one exact project before adding a drawing.');
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error('The selected document is empty.');
  if (sizeBytes > maximumBytes) {
    throw new Error(sourceProvider === 'google_drive'
      ? 'The selected Google Drive PDF is larger than the protected browser limit. Optimize or split it, then retry.'
      : 'The selected document is larger than 50 MB. Optimize or split it, then retry.');
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
    projectId: exactProjectId,
    projectName: selectedProjectNames.length === 1 ? selectedProjectNames[0] : null,
    projectNames: selectedProjectNames,
    importBatchId: scheduleLike ? createDAVEWebId('schedule-batch') : null,
    sizeBytes,
    sourceProvider,
    externalSource,
    contentSha256: canonicalSha256(fingerprint),
    webFileFingerprint: fingerprint,
    webVersionGroupId: versionGroupId || documentId,
    webContentReview: scheduleLike ? 'Schedule activities must be reviewed before this file can become current.' : 'Classification reviewed on upload.',
  };

  if (!scheduleLike) {
    return Object.freeze({
      document,
      scheduleItems: Object.freeze([]),
      reviewMessage: sourceProvider === 'google_drive'
        ? 'The document is ready to link. The original PDF will remain in Google Drive; Vitruvius will save its reference and ECOS search index.'
        : 'The document is ready to upload with the selected project and classification.',
      extractionStatus: 'not_applicable',
    });
  }

  const readableContents = contents?.trim() || '';
  if (!readableContents) {
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

  const selectedProjectKeys = new Set(selectedProjectNames.map(normalized));
  const selectedProjectRecords = projectRecords.filter(record =>
    selectedProjectKeys.has(normalized(record.name)),
  );
  const projectRecordsForResolution = selectedProjectRecords.length > 0
    ? selectedProjectRecords
    : exactProjectId && selectedProjectNames.length === 1
      ? [{ id: exactProjectId, name: selectedProjectNames[0] }]
      : [];
  const exactItems = items.map(item => {
    const itemProjectName = item.scheduleProjectName || item.projectName;
    const itemProjectId = resolveExactDAVEWebTaskProjectId({
      projectName: itemProjectName,
      selectedProjectId: exactProjectId,
      projectRecords: projectRecordsForResolution,
    });
    if (!itemProjectId) {
      throw new Error(
        `Schedule activity "${item.taskName}" must resolve to one exact project ID before upload. Choose an exact project and retry.`,
      );
    }
    return {
      ...item,
      projectId: itemProjectId,
    };
  });

  const batch: PIEScheduleImportBatch = bindPIEScheduleImportBatchProvenance({
    id: document.importBatchId!,
    kind: 'schedule_file',
    sourceCount: 1,
    sourceLabel: cleanName,
    message: normalizedImport.message,
    items: exactItems,
    documents: [document],
  });
  return Object.freeze({
    document: batch.documents[0] as ReferenceDocument & DAVEWebDocumentExtension,
    scheduleItems: Object.freeze(batch.items),
    reviewMessage: `${batch.items.length} schedule ${batch.items.length === 1 ? 'activity' : 'activities'} extracted for ${selectedProjectNames.length} selected project${selectedProjectNames.length === 1 ? '' : 's'}. Review each task's project, dates, area, status, and percent complete before upload.`,
    extractionStatus: 'ready',
  });
}

export function prepareDAVEWebLinkedDocument(
  input: Omit<
    DAVEWebDocumentPreparationInput,
    'sourceProvider' | 'externalSource' | 'maximumBytes'
  > & Readonly<{ externalSource: GoogleDriveLinkedSource; maximumBytes: number }>,
): DAVEWebPreparedUpload {
  if (normalized(input.category) === 'schedules') {
    throw new Error('Google Drive linking currently supports drawings and reference documents. Continue using protected upload for schedule imports.');
  }
  return prepareDAVEWebDocumentUpload({
    ...input,
    sourceProvider: 'google_drive',
    externalSource: input.externalSource,
    maximumBytes: input.maximumBytes,
  });
}

function canonicalSha256(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function daveWebReportPhotoSha256(
  photo: Pick<UpdatePhoto, 'contentSha256' | 'photoIntelligence'>,
): string | null {
  return canonicalSha256(photo.contentSha256) || canonicalSha256(
    photo.photoIntelligence?.diagnostics?.currentImageSha256,
  );
}

export function buildDAVEWebReportDraft(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: DAVEWebReportProjectSelection,
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
  selectedProject: DAVEWebReportProjectSelection,
): DAVEWebReportSource {
  const truths = buildDAVEWebProjectTruths(snapshot, selectedProject);
  const evidenceRecords = truths.flatMap(truth => truth.evidence.records);
  const scopeKey = `project-id:${selectedProject.projectId}`;
  const truthFingerprint = buildDAVEReportSourceFingerprint(truths);
  const scopedUpdateIds = new Set(evidenceRecords
    .filter(record => record.kind === 'update')
    .map(record => record.sourceRecordId));
  const scopedUpdates = snapshot.projectUpdates
    .map(record => record.updateData)
    .filter(update => scopedUpdateIds.has(update.id));
  const media = Object.freeze(scopedUpdates
    .flatMap(update => update.photos.map(photo => Object.freeze({
      bucket: 'project-photos' as const,
      projectId: selectedProject.projectId,
      updateId: update.id,
      photoId: photo.id,
      storagePath: photo.cloudStoragePath?.trim() || null,
      contentSha256: daveWebReportPhotoSha256(photo),
    })))
    .sort(compareDAVEWebReportMediaSource));
  const mediaFingerprint = stableWebReportSourceHash(
    canonicalWebReportSourceValue(
      scopedUpdates
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
            storagePath: photo.cloudStoragePath?.trim() || null,
            contentSha256: daveWebReportPhotoSha256(photo),
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
    media,
  });
}

export function daveWebReportSourceIsCurrent(
  sourceFingerprint: string | null | undefined,
  currentSource: DAVEWebReportSource,
): boolean {
  return Boolean(sourceFingerprint && sourceFingerprint === currentSource.fingerprint);
}

/**
 * Treats persisted report provenance as an untrusted claim. A saved report may
 * reuse current project media only when its scope, fingerprint, and every
 * source identifier exactly match the freshly authorized project source.
 */
export function daveWebPersistedReportSourceIsAuthorized(
  report: DAVEWebReportRecord,
  currentSource: DAVEWebReportSource,
): boolean {
  return daveWebReportSourceMatchesAuthorizedSource({
    version: 'dave-web-report-source/1.0',
    scopeKey: report.sourceScopeKey || '',
    refreshedAt: report.sourceRefreshedAt,
    fingerprint: report.sourceFingerprint || '',
    taskIds: report.sourceTaskIds,
    updateIds: report.sourceUpdateIds,
    documentIds: report.sourceDocumentIds ?? [],
    media: report.sourceMedia ?? [],
  }, currentSource);
}

export function daveWebReportSourceMatchesAuthorizedSource(
  candidate: DAVEWebReportSource,
  currentSource: DAVEWebReportSource,
): boolean {
  return candidate.version === 'dave-web-report-source/1.0' &&
    candidate.scopeKey === currentSource.scopeKey &&
    candidate.fingerprint === currentSource.fingerprint &&
    sameExactIdentifierSet(candidate.taskIds, currentSource.taskIds) &&
    sameExactIdentifierSet(candidate.updateIds, currentSource.updateIds) &&
    sameExactIdentifierSet(candidate.documentIds, currentSource.documentIds) &&
    sameExactDAVEWebReportMedia(candidate.media, currentSource.media);
}

function compareDAVEWebReportMediaSource(
  left: DAVEWebReportMediaSource,
  right: DAVEWebReportMediaSource,
): number {
  const leftKey = [left.projectId, left.updateId, left.photoId, left.storagePath || '', left.contentSha256 || '']
    .join('\u0000');
  const rightKey = [right.projectId, right.updateId, right.photoId, right.storagePath || '', right.contentSha256 || '']
    .join('\u0000');
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function sameExactDAVEWebReportMedia(
  candidate: readonly DAVEWebReportMediaSource[] | null | undefined,
  current: readonly DAVEWebReportMediaSource[],
): boolean {
  if (!candidate || candidate.length !== current.length) return false;
  return candidate.every((item, index) => {
    const expected = current[index];
    return item.bucket === expected.bucket &&
      item.projectId === expected.projectId &&
      item.updateId === expected.updateId &&
      item.photoId === expected.photoId &&
      item.storagePath === expected.storagePath &&
      item.contentSha256 === expected.contentSha256;
  });
}

function buildDAVEWebProjectTruths(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: DAVEWebReportProjectSelection,
): DAVEProjectTruth[] {
  const project = resolveExactDAVEWebReportProject(snapshot, selectedProject);
  const projectId = project.id as string;
  const evidenceBelongsToProject = (value: { projectId?: string | null }) => {
    const binding = readReportEvidenceProjectId(value.projectId);
    return binding === projectId;
  };
  const scheduleItems = snapshot.scheduleItems
    .filter(evidenceBelongsToProject)
    .map(item => readReportEvidenceProjectId(item.projectId) === projectId
      ? { ...item, scheduleProjectName: project.name }
      : item);
  const updates = snapshot.projectUpdates
    .map(update => update.updateData)
    .filter(evidenceBelongsToProject)
    .map(update => readReportEvidenceProjectId(update.projectId) === projectId
      ? { ...update, projectName: project.name, scheduleProjectName: project.name }
      : update);
  const referenceDocuments = snapshot.referenceDocuments
    .filter(evidenceBelongsToProject)
    .map(document => readReportEvidenceProjectId(document.projectId) === projectId
      ? {
          ...document,
          projectName: project.name,
          projectNames: [project.name],
        }
      : document);
  const scope = buildDailyReportAuthorityScope({
    selectedProjectName: project.name,
    selectedProjectNames: [project.name],
    projectRecords: [{ id: projectId, name: project.name }],
    updates,
    scheduleItems,
    referenceDocuments,
  });
  return [buildDAVEProjectTruth({
    projectId,
    projectName: project.name,
    updates: scope.updates.map(update => ({ ...update, projectId, projectName: project.name })),
    scheduleItems: scope.scheduleItems,
    projectAreas: scope.projectAreas,
    referenceDocuments: scope.referenceDocuments.map(document => ({
      ...document,
      projectId,
      projectName: project.name,
    })),
    now: snapshot.refreshedAt,
  })];
}

export function buildDAVEWebReportTitle(
  briefing: DAVEReportBriefing,
  audience: DAVEWebReportAudience,
): string {
  return audience === 'executive'
    ? `${briefing.scopeLabel} — Executive Summary`
    : `${briefing.scopeLabel} — Project Manager Report`;
}

function cappedReportItems(
  items: readonly string[],
  limit: number,
  emptyText: string,
): string[] {
  if (items.length === 0) return [`- ${emptyText}`];
  const visible = items.slice(0, limit).map(item => `- ${item}`);
  const remaining = items.length - visible.length;
  return remaining > 0
    ? [...visible, `- ${remaining} additional item${remaining === 1 ? '' : 's'} available in the detailed project record.`]
    : visible;
}

export function formatDAVEWebReport(
  briefing: DAVEReportBriefing,
  audience: DAVEWebReportAudience = 'project_manager',
): string {
  if (audience === 'executive') {
    const executiveLines = [
      `# ${buildDAVEWebReportTitle(briefing, audience)}`,
      '',
      `Generated: ${new Date(briefing.generatedAt).toLocaleString()}`,
      `Overall condition: ${briefing.conditionLabel}`,
      '',
      '## Executive Snapshot',
      briefing.executiveSnapshot,
      '',
      '## Project Status',
      ...briefing.projectConditions.map(item => `- ${item.projectName}: ${item.currentReality} ${item.schedule}`),
      '',
      '## Completed Work',
      ...cappedReportItems(
        briefing.completedWork,
        5,
        'No completed work is recorded in the current project scope.',
      ),
      '',
      '## Material Changes',
      ...cappedReportItems(
        briefing.whatChanged,
        5,
        'No recent material changes are recorded.',
      ),
      '',
      '## Schedule Position',
      ...cappedReportItems(
        briefing.schedulePosition,
        5,
        'No schedule position is available.',
      ),
      '',
      '## Risks and Decisions',
      ...cappedReportItems(
        [
          ...briefing.criticalRisks,
          ...briefing.decisionsRequired.map(item => `Decision required: ${item}`),
        ],
        5,
        'No current critical risks or pending decisions are recorded.',
      ),
      '',
      '## Management Actions',
      ...cappedReportItems(
        briefing.nextActions.map(item =>
          `${item.projectName} — ${item.taskName}: ${item.action} Owner: ${item.owner}. Timing: ${item.timing}.`,
        ),
        4,
        'Continue planned work and record the next material change.',
      ),
    ];
    return executiveLines.join('\n');
  }

  const lines = [
    `# ${buildDAVEWebReportTitle(briefing, audience)}`,
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
    '## Completed Work',
    ...(briefing.completedWork.length
      ? briefing.completedWork.map(item => `- ${item}`)
      : ['- No completed work is recorded in the current project scope.']),
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

function resolveExactDAVEWebReportProject(
  snapshot: DAVEWebReadOnlySnapshot,
  selection: DAVEWebReportProjectSelection,
) {
  const projectId = selection && typeof selection.projectId === 'string' &&
    selection.projectId.length > 0 && selection.projectId.trim() === selection.projectId
    ? selection.projectId
    : null;
  const projectName = selection && typeof selection.projectName === 'string'
    ? selection.projectName.trim()
    : '';
  if (!projectId || !projectName) {
    throw new Error('Choose one exact project before preparing a report.');
  }
  const matches = snapshot.projects.filter(project =>
    project.id === projectId && normalized(project.name) === normalized(projectName),
  );
  if (matches.length !== 1) {
    throw new Error('The selected project changed. Refresh before preparing this report.');
  }
  return matches[0];
}

function readReportEvidenceProjectId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : undefined;
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

function sameExactIdentifierSet(left: unknown, right: unknown): boolean {
  const leftIds = exactUniqueIdentifiers(left);
  const rightIds = exactUniqueIdentifiers(right);
  return leftIds !== null && rightIds !== null &&
    leftIds.length === rightIds.length &&
    leftIds.every((value, index) => value === rightIds[index]);
}

function exactUniqueIdentifiers(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item || item.trim() !== item || seen.has(item)) return null;
    seen.add(item);
    ids.push(item);
  }
  return ids.sort();
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
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}
