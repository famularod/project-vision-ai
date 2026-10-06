import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ScheduleItem,
} from '../types';
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
import type { DAVEReportSnapshot } from './DAVEReportSnapshot';
import {
  bindPIEScheduleImportBatchProvenance,
  dedupeScheduleImportItems,
  type PIEScheduleImportBatch,
} from './PIEScheduleImportBatch';
import {
  normalizeMicrosoftProjectWebPdfPages,
  normalizeScheduleImport,
} from './PIEScheduleIntelligence';
import { currentScheduleDocumentWinners, scheduleDocumentAddsToMaster, scheduleDocumentIsScheduleLike, scheduleItemAsSaved } from './PIEScheduleReconciliation';
import {
  findExactScheduleTaskForCompletionClaim,
  mergeReportedCompletionClaim,
} from './DAVECompletionVerification';
import { mergeApprovedScheduleImportItems, scheduleImportPairingQuestions, type ScheduleImportPairingQuestion } from './ScheduleImportMerge';
import { scheduleDependenciesAfterScheduleDeleted, scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from './ScheduleLookahead';
import { scheduleTaskProjectKey } from './ScheduleTaskRevisions';
import { scheduleItemForCloud, type DAVEWebScheduleItem } from './DAVEWebTaskEditing';
import { buildDAVEReportProjectTruths } from './DAVEReportProjectTruths';
import { scheduleTaskIsComplete } from './dave-project-schedule-rollup';
import type { GoogleDriveLinkedSource } from './GoogleDriveWebProvider';

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
  /**
   * The "since the last report" period the report was prepared on
   * (everyday item 3): 'sent:<time>' when it counted from a sent report.
   * Absent on reports saved before then.
   */
  sourcePeriodKey?: string | null;
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
  /** The period it was prepared on (everyday item 3); absent on reports saved before then. */
  periodKey?: string;
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
  /** David's answers at the upload review to which same-named task each row is (owner answer Q30, review N1). */
  pairingChoices?: Readonly<Record<string, string | null>> | null;
}>;

type DAVEWebDocumentPreparationInput = Readonly<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contents: string | null;
  extractedPages?: readonly ReferenceDocumentExtractedPage[];
  category: string;
  projectName?: string;
  projectNames?: readonly string[];
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
  extractedPages = [],
  category,
  projectName,
  projectNames,
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
  if (!cleanName) throw new Error('Choose a named document before continuing.');
  if (selectedProjectNames.length === 0) throw new Error('Choose at least one project for this document.');
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error('The selected document is empty.');
  if (sizeBytes > maximumBytes) {
    throw new Error(sourceProvider === 'google_drive'
      ? 'The selected Google Drive PDF is larger than 250 MB. Optimize or split it, then retry.'
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
    projectId: null,
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

  const scheduleProjects = selectedProjectNames.length > 0
    ? [...selectedProjectNames]
    : [...projects];
  const pdfSchedule = mimeType.toLowerCase().includes('pdf') || cleanName.toLowerCase().endsWith('.pdf');
  const positionedPdfItems = pdfSchedule && extractedPages.length > 0
    ? normalizeMicrosoftProjectWebPdfPages({
        pages: extractedPages,
        sourceName: cleanName,
        projects: scheduleProjects,
        projectAreas: [],
        now: new Date(now),
      })
    : [];
  const normalizedImport = pdfSchedule
    ? null
    : normalizeScheduleImport({
        contents: readableContents,
        sourceName: cleanName,
        mimeType,
        projects: scheduleProjects,
        projectAreas: [],
        now: new Date(now),
      });
  const items = dedupeScheduleImportItems(
    (pdfSchedule ? positionedPdfItems : normalizedImport?.items || []).map(item => ({
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
    message: normalizedImport?.message ||
      `${items.length} Microsoft Project PDF activities reconstructed from positioned schedule rows.`,
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

export type DAVEWebScheduleImportRevision = Readonly<{
  /** The saved task as this import leaves it. */
  item: ScheduleItem;
  /** The saved task as the web read it; written back if the import rolls back. */
  previous: ScheduleItem;
  /** The cloud revision the web read; the task changes only while it still matches. */
  cloudUpdatedAt: string | null;
}>;

export type DAVEWebScheduleImportPlan = Readonly<{
  /** New rows: tasks new to the schedule, and changed tasks carrying the manager's progress. */
  additions: readonly ScheduleItem[];
  /** Saved tasks the import changes: unchanged tasks re-homed into it, merged completion claims. */
  revisions: readonly DAVEWebScheduleImportRevision[];
}>;

/**
 * How a schedule uploaded on the web joins the tasks the manager sees, at
 * upload time (whole-app audit A5 pass 3 F5, 30 Sep 2026). The web saved
 * every row of a revised file as a new task at the file's percent, so making
 * it current hid all of the manager's progress on the web, iPhone and iPad.
 * It now runs the phone's approval merge (ScheduleImportMerge): an unchanged
 * task keeps its id, progress, owner and notes and also belongs to this
 * import; a changed task takes the manager's progress; a completion claim
 * merges into its task.
 *
 * Only the tasks the web shows (snapshot.scheduleItems, the current
 * schedules) are offered: with every saved row, a task changed in two
 * revisions running has two manager-progress copies and carries nothing.
 *
 * Whole-app audit A5 pass 18 L3 (1 Oct 2026): the upload is not current
 * until Make Current, so a task entered by hand is no longer restated here
 * (that moved David's task on every device even if he never made the file
 * current): the row is noted on the task and restates it at Make Current
 * (scheduleProgressCarriedToShownTasks with the schedules before and after).
 */
export function planDAVEWebScheduleImport({
  snapshot,
  importedScheduleItems,
  pairingChoices,
}: {
  snapshot: Pick<DAVEWebReadOnlySnapshot, 'scheduleItems'>;
  importedScheduleItems: readonly ScheduleItem[];
  /** David's answers at the upload review (owner answer Q30): a row's id to the saved task's, or null for a new task. */
  pairingChoices?: Readonly<Record<string, string | null>> | null;
}): DAVEWebScheduleImportPlan {
  if (importedScheduleItems.length === 0) {
    return Object.freeze({ additions: Object.freeze([]), revisions: Object.freeze([]) });
  }
  // Paired on the saved tasks, as the phone's approval pairs them: a task a replaced lookahead moved is shown on the
  // master's dates, saved on the lookahead's (owner answer Q25, gen26 follow-up).
  const saved = snapshot.scheduleItems.map(item => ({
    item: scheduleItemForCloud(scheduleItemAsSaved(item)),
    cloudUpdatedAt: item.cloudUpdatedAt ?? null,
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: saved.map(({ item }) => item),
    imported: importedScheduleItems,
    completionMatch: findExactScheduleTaskForCompletionClaim,
    mergeCompletion: mergeReportedCompletionClaim,
    // Every task offered is one the web shows.
    isCurrent: () => true,
    // Uploaded, not current: a task entered by hand is restated at Make Current (whole-app audit A5 pass 18 L3).
    current: false,
    pairingChoices,
  });
  const savedById = new Map(saved.map(entry => [entry.item.id, entry]));
  const revisions = merged.next.flatMap(item => {
    const before = savedById.get(item.id);
    return before && before.item !== item
      ? [Object.freeze({ item, previous: before.item, cloudUpdatedAt: before.cloudUpdatedAt })]
      : [];
  });
  return Object.freeze({
    additions: Object.freeze([...merged.additions]),
    revisions: Object.freeze(revisions),
  });
}

/**
 * Review N1 (3 Oct 2026, the gap owner answer Q30 left on the web): the
 * upload's "Review before upload" asks, as the phone's import review does,
 * which same-named task in one area each row is when the dates cannot settle
 * it. The questions for the rows to upload against the tasks the web shows,
 * as planDAVEWebScheduleImport pairs them.
 */
export function daveWebScheduleImportPairingQuestions({
  snapshot,
  importedScheduleItems,
}: {
  snapshot: Pick<DAVEWebReadOnlySnapshot, 'scheduleItems'> | null | undefined;
  importedScheduleItems: readonly ScheduleItem[];
}): ScheduleImportPairingQuestion[] {
  if (!snapshot || importedScheduleItems.length === 0) return [];
  return scheduleImportPairingQuestions({
    existing: snapshot.scheduleItems.map(item => scheduleItemForCloud(scheduleItemAsSaved(item))),
    imported: importedScheduleItems,
    isCurrent: () => true,
  });
}

/**
 * Whole-app audit A10 pass 8 M1 / A8 pass 9 M1 (30 Sep 2026): "Delete
 * Document + N Tasks" on the web wrote only the deletion records. A row a new
 * master saved for a task it moved before 79f49d3 lists no earlier id, so a
 * field update linked to the old row became "Historical evidence — linked
 * task was deleted." on the web and the phone, and left every summary; the
 * phone's "Delete PDF + Items" writes the removed id onto the task shown
 * first (A10 pass 6 M1). The saved tasks the web delete now changes before
 * its deletion records, worked out by the phone's own helper
 * (scheduleItemsAfterScheduleDeleted) over every saved task the web read,
 * each saved only while its cloud revision is the one read. None when the
 * delete keeps the tasks.
 */
export function planDAVEWebScheduleDocumentDelete({
  snapshot,
  document,
  updatedAt = new Date().toISOString(),
  keepTasks = false,
}: {
  snapshot: Pick<DAVEWebReadOnlySnapshot, 'scheduleItems' | 'knownScheduleItems' | 'referenceDocuments'>;
  document: DAVEWebReferenceDocument;
  updatedAt?: string;
  /** "Delete Document" / "Delete Document Only": no task is removed. */
  keepTasks?: boolean;
}): readonly DAVEWebScheduleImportRevision[] {
  const removedIds = new Set(keepTasks ? [] : document.linkedScheduleItems.map(item => item.id));
  // Review N1 web M1 (3 Oct 2026, caused by ada8ef6): a lookahead a newer one replaced (owner answer Q25) is a prior
  // version the web may delete. Deleted with no task written, a master task it had moved jumped from the master's
  // dates to the deleted lookahead's on the web, the phone and the iPad. Its delete with its tasks gives the master
  // tasks it restated their dates back as the phone's Delete PDF + Items does; without them, see below.
  if (removedIds.size === 0 && !scheduleDocumentAddsToMaster(document)) return Object.freeze([]);
  const saved = (snapshot.knownScheduleItems ?? snapshot.scheduleItems) as readonly DAVEWebScheduleItem[];
  const kept = saved.filter(item => !removedIds.has(item.id));
  const keptById = new Map(kept.map(item => [item.id, item]));
  const documents = snapshot.referenceDocuments.filter(other => other.id !== document.id);
  // Review N2 W1 (5 Oct 2026, Medium, caused by e9a3443): "Delete Document" / "Delete Document Only" on a replaced
  // lookahead ran the whole give-back too, so a percent that lookahead's file had given a master task went back
  // (60% to 0%) with nothing said, where the phone's "Delete PDF Only" from the same state keeps it. Keeping the
  // tasks now does what the phone's file-only delete does, by the phone's own helper: the dates shown are saved, no
  // percent moves, and the task's note says it left that lookahead's dates (review N2 F2). "+ Tasks" is unchanged.
  const restored = keepTasks
    ? scheduleItemsAfterScheduleDeleted({ items: kept, removed: [], document, documents: snapshot.referenceDocuments, updatedAt, fileOnly: true, withWhatHeSet: true })
    : scheduleItemsAfterScheduleDeleted({
      items: kept,
      removed: saved.filter(item => removedIds.has(item.id)),
      document,
      documents,
      updatedAt,
    });
  // Owner answer Q29 (2 Oct 2026): David's hand links to a removed row move to the row that answers to it, as the
  // phone's Delete PDF + Items moves them (dropped only when none does); the web left them pointing at nothing.
  const byId = new Map<string, ScheduleItem>(restored.map(item => [item.id, item]));
  scheduleDependenciesAfterScheduleDeleted(kept.map(item => byId.get(item.id) || item), [...removedIds], documents)
    .forEach(change => {
      const item = byId.get(change.id) || keptById.get(change.id);
      if (item) byId.set(change.id, { ...item, dependencies: change.dependencies, updatedAt });
    });
  const changed = [...byId.values()];
  return Object.freeze(changed.flatMap(item => {
    const before = keptById.get(item.id);
    return before
      ? [Object.freeze({ item: scheduleItemForCloud(item), previous: scheduleItemForCloud(before), cloudUpdatedAt: before.cloudUpdatedAt ?? null })]
      : [];
  }));
}

/**
 * Review N2 W1 (5 Oct 2026): what "Delete Document + N Tasks" also does to
 * the tasks a lookahead changed, said in the web's delete dialog as the
 * phone's question says it of "Delete PDF + Items" (the same sentence, from
 * the same helper, with the web's button): " Delete Document + 2 Tasks also
 * puts back the earlier progress of 1 task this lookahead changed." The
 * dialog said nothing, and that button lowers a percent the lookahead's file
 * gave. Empty for a schedule that is not a lookahead, for one with no linked
 * task (only "Delete Document" is offered, which keeps the percent), and when
 * nothing goes back.
 */
export function daveWebScheduleDocumentDeleteNote({
  snapshot,
  document,
}: {
  snapshot: Pick<DAVEWebReadOnlySnapshot, 'scheduleItems' | 'knownScheduleItems' | 'referenceDocuments'>;
  document: DAVEWebReferenceDocument;
}): string {
  const count = document.linkedScheduleItems.length;
  if (count === 0 || !scheduleDocumentAddsToMaster(document)) return '';
  const saved = snapshot.knownScheduleItems ?? snapshot.scheduleItems;
  const linked = new Set(document.linkedScheduleItems.map(item => item.id));
  return scheduleLookaheadDeleteNote(
    saved,
    document,
    saved.filter(item => linked.has(item.id)),
    snapshot.referenceDocuments,
    `Delete Document + ${count} Task${count === 1 ? '' : 's'}`,
  );
}

function canonicalSha256(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function buildDAVEWebReportDraft(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: string | null,
  /** The phone's shared period, as the web counts it (everyday item 3); none: no "since" period. */
  period?: Readonly<{ previousSnapshot: DAVEReportSnapshot | null; waitingForOtherDevice: boolean }>,
): DAVEReportBriefing {
  const truths = buildDAVEWebProjectTruths(snapshot, selectedProject);
  return buildDAVEReportBriefing({
    truths,
    selectedProjectNames: truths.map(truth => truth.projectName),
    previousSnapshot: period?.previousSnapshot ?? null,
    waitingForOtherDevice: period?.waitingForOtherDevice ?? false,
    // When each task's progress was confirmed, for Completed Work's dates (A6 pass 14 L4).
    scheduleItems: snapshot.knownScheduleItems ?? snapshot.scheduleItems,
  });
}

/** The project facts a web report is made from, for its period's scope and fingerprint (everyday item 3). */
export function buildDAVEWebReportTruths(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: string | null,
): DAVEProjectTruth[] {
  return buildDAVEWebProjectTruths(snapshot, selectedProject);
}

/**
 * Captures the exact semantic project facts used to prepare a web report.
 * Refresh timestamps and collection ordering do not create false changes,
 * while any meaningful task, update, document, or conclusion change does.
 */
export function buildDAVEWebReportSource(
  snapshot: DAVEWebReadOnlySnapshot,
  selectedProject: string | null,
  /**
   * The period the report counts "since the last report" from (everyday item
   * 3): a report counted from a sent report is current only on that period.
   */
  periodKey?: string,
  /**
   * Review N2 (5 Oct 2026): the report is prepared while this tab still waits
   * for the other device's changes, so its "since the last report" section
   * says "Not counted yet". It is current only while the tab still waits:
   * the fingerprint had the period but not the wait, so once the changes
   * arrived the page called that draft current, and it was approved and sent.
   */
  periodNotCounted = false,
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
    fingerprint: `${truthFingerprint}:media-${mediaFingerprint}${periodNotCounted ? NOT_COUNTED_MARK : ''}${periodKey?.startsWith('sent:') ? `:period-${periodKey}` : ''}`,
    taskIds: Object.freeze(uniqueSorted(truths.flatMap(truth =>
      truth.schedule.map(task => task.taskId),
    ))),
    updateIds: Object.freeze(uniqueSorted(evidenceRecords
      .filter(record => record.kind === 'update')
      .map(record => record.sourceRecordId))),
    documentIds: Object.freeze(uniqueSorted(evidenceRecords
      .filter(record => record.kind === 'document')
      .map(record => record.sourceRecordId))),
    ...(periodKey ? { periodKey } : {}),
  });
}

/** In the fingerprint of a report prepared while "since the last report" was not counted (review N2); before the period, which ends it. */
const NOT_COUNTED_MARK = ':not-counted';

/**
 * Whether a report with this source fingerprint was prepared while this tab
 * waited for the other device's changes (review N2, 5 Oct 2026). A saved
 * report keeps its fingerprint, so a draft saved then still says so when it
 * is reopened.
 */
export function daveWebReportSourceNotCounted(sourceFingerprint: string | null | undefined): boolean {
  return Boolean(sourceFingerprint?.replace(/:period-sent:.*$/, '').endsWith(NOT_COUNTED_MARK));
}

/**
 * The prepared report's source on another period (owner answer 2 Oct, web
 * sends count): this computer's own send of an approved report starts the
 * next period, and the approval stands on it, as on the phone (A6 pass 8 M1).
 */
export function daveWebReportSourceOnPeriod(source: DAVEWebReportSource, periodKey: string): DAVEWebReportSource {
  const base = source.fingerprint.replace(/:period-sent:.*$/, '');
  return Object.freeze({
    ...source,
    periodKey,
    fingerprint: periodKey.startsWith('sent:') ? `${base}:period-${periodKey}` : base,
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
  // One recipe with the phone's Reports screen (open item, 6 Oct 2026).
  return buildDAVEReportProjectTruths({
    projects: projects.map(project => ({ name: project.name, projectId: project.id || normalized(project.name) })),
    projectRecords,
    updates: snapshot.projectUpdates.map(update => update.updateData),
    scheduleItems: snapshot.scheduleItems,
    knownScheduleItems: snapshot.knownScheduleItems,
    knownScheduleDocuments: snapshot.referenceDocuments,
    referenceDocuments: snapshot.referenceDocuments,
    now: snapshot.refreshedAt,
  });
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

export const DAVE_WEB_REPORT_EMAIL_LIMIT = 12_000;
export const DAVE_WEB_REPORT_EMAIL_SHORTENED =
  '[Report shortened to fit an email draft. The full report is in Vitruvius.]';

/**
 * The body for a mailto: draft, which has a practical length limit. A report
 * over the limit used to be cut mid-sentence with no word to anyone (code
 * review 27 Sep 2026); it is now cut at a line break, marked, and reported.
 */
export function prepareDAVEWebReportEmailBody(
  body: string,
  limit = DAVE_WEB_REPORT_EMAIL_LIMIT,
): Readonly<{ text: string; shortened: boolean }> {
  const trimmed = body.trim();
  if (trimmed.length <= limit) return { text: trimmed, shortened: false };
  const room = limit - DAVE_WEB_REPORT_EMAIL_SHORTENED.length - 2;
  const lastBreak = trimmed.lastIndexOf('\n', room);
  const cut = trimmed.slice(0, lastBreak > room / 2 ? lastBreak : room).trimEnd();
  return { text: `${cut}\n\n${DAVE_WEB_REPORT_EMAIL_SHORTENED}`, shortened: true };
}

export function formatDAVEWebReport(
  briefing: DAVEReportBriefing,
  audience: DAVEWebReportAudience = 'project_manager',
  /**
   * "Since the last report", counted as on the phone (everyday item 3): the
   * period's label and the phone's lines. Absent: no such section.
   */
  since?: Readonly<{ label: string; lines: readonly string[] }> | null,
): string {
  const sinceSection = since && since.lines.length > 0
    ? ['## Since the Last Report', since.label, ...since.lines.map(line => `- ${line}`), '']
    : [];
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
      ...sinceSection,
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
    ...sinceSection,
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

/**
 * Whole-app audit A5 pass 12 K1 (1 Oct 2026): a task is a duplicate of
 * another only in the same app project. Keyed by the Microsoft Project root a
 * combined master keeps on every row ("2400 Compliance Project"), Harbor
 * North's and Harbor South's Install HVAC on the same dates read as one task
 * twice, and Data health reported a conflict for every such twin. Keyed now
 * by the app project, as the merge and the shown schedule key a task
 * (scheduleTaskProjectKey).
 */
export function buildDAVEWebTruthDiagnostics(
  snapshot: DAVEWebReadOnlySnapshot,
): DAVEWebTruthDiagnostics {
  const groups = new Map<string, string[]>();
  snapshot.scheduleItems.forEach(item => {
    const key = [scheduleTaskProjectKey(item), ...[item.locationName, item.taskName, item.finishDate].map(normalized)]
      .join('|');
    const ids = groups.get(key) || [];
    ids.push(item.id);
    groups.set(key, ids);
  });
  const duplicateTaskGroups = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, taskIds]) => Object.freeze({ key, taskIds: Object.freeze(taskIds) }));
  // A lookahead adds to the master: not a second current schedule (owner answer Q22).
  const currentSchedules = snapshot.referenceDocuments.filter(document =>
    scheduleDocumentIsScheduleLike(document) && document.isCurrent && !scheduleDocumentAddsToMaster(document),
  );
  const completedTaskCount = snapshot.scheduleItems.filter(item =>
    scheduleTaskIsComplete(item),
  ).length;
  const conflicts = [
    ...(duplicateTaskGroups.length ? [`${duplicateTaskGroups.length} duplicate task occurrence group${duplicateTaskGroups.length === 1 ? '' : 's'} need review.`] : []),
    // One current schedule per project is expected; two for the same project is a conflict (audit A5).
    ...(currentSchedules.length > currentScheduleDocumentWinners(currentSchedules).length ? ['More than one current schedule is visible for the same project after reconciliation.'] : []),
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
