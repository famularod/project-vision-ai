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
import { sameReportSource, type DAVEReportSnapshot } from './DAVEReportSnapshot';
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
import { mergeApprovedScheduleImportItems, scheduleImportPairingQuestions, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport, type ScheduleImportPairingQuestion } from './ScheduleImportMerge';
import {
  scheduleDependenciesAfterScheduleDeleted,
  scheduleItemsAfterScheduleDeleted,
  scheduleLookaheadDeleteNote,
  suggestScheduleImportRole,
  withScheduleImportRole,
  type ScheduleImportRole,
  type ScheduleImportRoleSuggestion,
} from './ScheduleLookahead';
import { scheduleDocumentsAfterApproval } from './ScheduleDocumentLabels';
import { scheduleTaskProjectKey } from './ScheduleTaskRevisions';
import { scheduleItemIdsDeletedWithTask } from './DAVEDeletedTaskEvidence';
import { dependencyChangesForDeletedTask } from './VitruviusScheduleEngine';
import { scheduleItemForCloud, type DAVEWebScheduleItem } from './DAVEWebTaskEditing';
import { buildDAVEReportProjectTruths } from './DAVEReportProjectTruths';
import { daveWebListedDocuments } from './DAVEWebDocumentManagement';
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

/**
 * Web batch WS2 item 7 (6 Oct 2026): a schedule file this browser cannot read tasks from can still be stored as a
 * full schedule's prior version, but it cannot be added as a lookahead here (a lookahead is its tasks), and the
 * review said nothing about that: the Lookahead choice simply was not there. Said plainly, after what the review
 * already says of such a file.
 */
export const DAVE_WEB_UNREADABLE_LOOKAHEAD_TEXT =
  'If it is a lookahead: this file could not be read here. Import it on the phone or iPad.';

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
      reviewMessage: `The schedule file can be stored now, but this browser could not extract dated activities. Keep it as a prior version, or use a CSV/text schedule so tasks can be reviewed before making it current. ${DAVE_WEB_UNREADABLE_LOOKAHEAD_TEXT}`,
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
      reviewMessage: `No dated schedule activities were found. Check the column headings or upload a CSV with Task, Project, Location, Start, Finish, Owner, Status, and Percent Complete. ${DAVE_WEB_UNREADABLE_LOOKAHEAD_TEXT}`,
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
/**
 * Every saved task the web's upload pairs against, as the phone's approval is
 * given them (open item, web batch WS1 item 1; 6 Oct 2026): the tasks the web
 * shows, as saved, and after them the saved rows it does not show, with the
 * test of which are shown. The upload was given only the tasks shown, so a
 * task one master left out and a later master lists again had nothing to
 * come back to: it came in as a new task at 0%, unasked, and what David had
 * set stayed on the hidden row (the phone asks since S2 item 1).
 *
 * A snapshot read before the web kept every saved task (no
 * knownScheduleItems) pairs as before, on the tasks shown alone.
 */
type DAVEWebImportSnapshot =
  Pick<DAVEWebReadOnlySnapshot, 'scheduleItems'> & Partial<Pick<DAVEWebReadOnlySnapshot, 'knownScheduleItems' | 'referenceDocuments'>>;

function daveWebSavedTasksForImport(
  snapshot: DAVEWebImportSnapshot,
): Readonly<{
  saved: readonly Readonly<{ item: ScheduleItem; cloudUpdatedAt: string | null }>[];
  isShown: (item: ScheduleItem) => boolean;
}> {
  // Paired on the saved tasks, as the phone's approval pairs them: a task a replaced lookahead moved is shown on the
  // master's dates, saved on the lookahead's (owner answer Q25, gen26 follow-up).
  const shown = snapshot.scheduleItems.map(item => ({
    item: scheduleItemForCloud(scheduleItemAsSaved(item)),
    cloudUpdatedAt: item.cloudUpdatedAt ?? null,
  }));
  const shownIds = new Set(shown.map(entry => entry.item.id));
  const hidden = ((snapshot.knownScheduleItems ?? []) as readonly DAVEWebScheduleItem[])
    .filter(item => !shownIds.has(item.id))
    .map(item => ({ item: scheduleItemForCloud(item), cloudUpdatedAt: item.cloudUpdatedAt ?? null }));
  return { saved: [...shown, ...hidden], isShown: item => shownIds.has(item.id) };
}

/** The schedule file an upload brings, as far as the planner reads it. */
export type DAVEWebUploadDocument = Pick<ReferenceDocument, 'scheduleRole' | 'category' | 'name' | 'originalFileName' | 'notes' | 'importBatchId'>;

/** An upload he chose "Lookahead" for: its file says so (withDAVEWebScheduleUploadRole), as a saved lookahead does. */
function daveWebUploadIsLookahead(document: DAVEWebUploadDocument | null | undefined): boolean {
  return Boolean(document) && scheduleDocumentAddsToMaster(document as ReferenceDocument);
}

/**
 * What a lookahead uploaded on the web is merged against (WS1 item 2): what
 * the phone's approval of a lookahead is given. Every saved task as saved,
 * and the phone's own test of which were shown before this import
 * (scheduleItemsVisibleBeforeImport), which also tells the merge which
 * lookahead files are still saved (review N2 F2). A snapshot without every
 * saved task or the schedules falls back to the tasks shown.
 */
function daveWebSavedTasksForLookahead(
  snapshot: DAVEWebImportSnapshot,
  rows: readonly ScheduleItem[],
  document?: DAVEWebUploadDocument | null,
): ReturnType<typeof daveWebSavedTasksForImport> {
  const known = snapshot.knownScheduleItems as readonly DAVEWebScheduleItem[] | undefined;
  const documents = snapshot.referenceDocuments;
  if (!known || !documents) return daveWebSavedTasksForImport(snapshot);
  const saved = known.map(item => ({ item: scheduleItemForCloud(item), cloudUpdatedAt: item.cloudUpdatedAt ?? null }));
  const importBatchId = (document?.importBatchId || '').trim() ||
    rows.map(row => (typeof row.importBatchId === 'string' ? row.importBatchId.trim() : '')).find(Boolean) || '';
  return { saved, isShown: scheduleItemsVisibleBeforeImport(saved.map(({ item }) => item), documents, importBatchId) };
}

/** The web's words for the two ways a schedule file can be used (owner answer Q22); the lookahead's are the phone's. */
export const DAVE_WEB_SCHEDULE_ROLE_CHOICES: readonly Readonly<{ role: ScheduleImportRole; title: string; detail: string }>[] = Object.freeze([
  Object.freeze({
    role: 'master' as const,
    title: 'Full schedule (replaces)',
    detail: 'Use this file as the whole schedule for its projects. It is saved as a prior version first, and replaces the schedule in use for them when you choose Make Current Schedule.',
  }),
  Object.freeze({
    role: 'lookahead' as const,
    title: 'Lookahead / partial (adds to the master)',
    detail: 'Keep the master schedule. A task in both files shows once, with this file’s dates and progress. Tasks only in this file are added. The master’s other tasks stay. It applies as soon as it is uploaded, and a newer lookahead for the same project replaces it.',
  }),
]);

/**
 * WS1 item 2 (open item, medium; 6 Oct 2026): "How should Vitruvius use this
 * schedule?" at the web's upload review. The web could only upload a full
 * schedule. The default is the phone's own suggestion
 * (suggestScheduleImportRole) from the schedules and tasks saved now. Null
 * when the upload is not a schedule with tasks to review: a lookahead with no
 * task of its own to state would replace the lookahead in effect with nothing.
 */
export function daveWebScheduleUploadRoleSuggestion({
  snapshot,
  prepared,
}: {
  snapshot: DAVEWebImportSnapshot | null | undefined;
  prepared: Pick<DAVEWebPreparedUpload, 'document' | 'scheduleItems' | 'extractionStatus'> | null | undefined;
}): ScheduleImportRoleSuggestion | null {
  if (!snapshot || !prepared || prepared.extractionStatus !== 'ready' || normalized(prepared.document.category) !== 'schedules') return null;
  const { scheduleRole: _role, ...file } = prepared.document;
  return suggestScheduleImportRole({
    batch: { documents: [file as ReferenceDocument], items: [...prepared.scheduleItems] },
    documents: snapshot.referenceDocuments ?? [],
    scheduleItems: snapshot.knownScheduleItems ?? snapshot.scheduleItems,
  });
}

export const DAVE_WEB_LOOKAHEAD_NEEDS_TASK_TEXT =
  'A lookahead needs at least one task from the file. Keep a task in the list above, or choose Full schedule.';

/**
 * The reviewed upload as the role David chose (WS1 item 2). "Lookahead": the
 * schedule file is marked as the phone's review marks it
 * (withScheduleImportRole) and labelled with the projects its rows belong
 * to, as the phone's approval labels it (scheduleDocumentsAfterApproval): a
 * lookahead replaces an older lookahead only for the projects it covers
 * (owner answer Q25), so it must not cover a project it lists no task for.
 * The rows are not marked (WS2, the coordinator's decision 4): the planner
 * is handed the file itself and reads its role. (The mark a task a
 * lookahead ADDS carries once saved, importedAsLookahead, stays: the phone's
 * merge writes it, because such a task outlives its file, which can be
 * deleted on its own while the task is kept.)
 * "Full schedule": the upload as every schedule uploaded before.
 */
export function withDAVEWebScheduleUploadRole<T extends DAVEWebPreparedUpload>(prepared: T, role: ScheduleImportRole): T {
  if (normalized(prepared.document.category) !== 'schedules') return prepared;
  if (role !== 'lookahead') {
    if (prepared.document.scheduleRole !== 'lookahead') return prepared;
    const { scheduleRole: _role, ...document } = prepared.document;
    return { ...prepared, document: { ...document, webContentReview: 'Schedule activities must be reviewed before this file can become current.' } };
  }
  const scheduleItems = prepared.scheduleItems;
  const marked = withScheduleImportRole({ documents: [prepared.document] }, 'lookahead').documents;
  const [document] = scheduleItems.length > 0
    ? scheduleDocumentsAfterApproval({ documents: [], approvedDocuments: marked, approvedItems: [...scheduleItems], updatedAt: prepared.document.importedAt })
    : marked;
  return {
    ...prepared,
    document: { ...document, webContentReview: 'Lookahead: it adds to the master schedule and is in effect until a newer lookahead for the same project replaces it.' },
  };
}

/** Why the reviewed upload cannot go up as the role chosen, or null. */
export function daveWebScheduleUploadRoleRefusal(
  prepared: Pick<DAVEWebPreparedUpload, 'document' | 'scheduleItems'>,
  role: ScheduleImportRole | null,
): string | null {
  return role === 'lookahead' && normalized(prepared.document.category) === 'schedules' && prepared.scheduleItems.length === 0
    ? DAVE_WEB_LOOKAHEAD_NEEDS_TASK_TEXT
    : null;
}

export function planDAVEWebScheduleImport({
  snapshot,
  importedScheduleItems,
  pairingChoices,
  document,
}: {
  snapshot: DAVEWebImportSnapshot;
  importedScheduleItems: readonly ScheduleItem[];
  /** David's answers at the upload review (owner answer Q30): a row's id to the saved task's, or null for a new task. */
  pairingChoices?: Readonly<Record<string, string | null>> | null;
  /**
   * The schedule file being uploaded, as reviewed (WS2, the coordinator's decision 4): its role says whether the
   * rows are a lookahead's. Without it the rows are a full schedule's, as before the web could upload a lookahead.
   */
  document?: DAVEWebUploadDocument | null;
}): DAVEWebScheduleImportPlan {
  if (importedScheduleItems.length === 0) {
    return Object.freeze({ additions: Object.freeze([]), revisions: Object.freeze([]) });
  }
  // WS1 item 2: the rows of a file he chose "Lookahead" for at the review (withDAVEWebScheduleUploadRole) are merged
  // as the phone's approval merges a lookahead: it restates the master's tasks in place, adds its own, and is in
  // effect at once (owner answer Q22), so nothing waits for Make Current. The file's own role says so (WS2).
  const overlay = daveWebUploadIsLookahead(document);
  // Every saved task, with which of them the web shows, as the phone's approval is given them (WS1 item 1): a row may
  // be a task no longer shown only by its Unique ID or by his answer at the review (scheduleTasksNoLongerShown).
  const { saved, isShown } = overlay
    ? daveWebSavedTasksForLookahead(snapshot, importedScheduleItems, document)
    : daveWebSavedTasksForImport(snapshot);
  const merged = mergeApprovedScheduleImportItems({
    existing: saved.map(({ item }) => item),
    imported: importedScheduleItems,
    // A completion claim is for a task he sees, as before: never merged into a row that is not shown.
    completionMatch: (importedItem, items) => findExactScheduleTaskForCompletionClaim(importedItem, items.filter(isShown)),
    mergeCompletion: mergeReportedCompletionClaim,
    isCurrent: isShown,
    overlay,
    // A full schedule is uploaded, not current: a task entered by hand is restated at Make Current (whole-app audit
    // A5 pass 18 L3). A lookahead is in effect as soon as it is saved.
    current: overlay,
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
  document,
}: {
  snapshot: DAVEWebImportSnapshot | null | undefined;
  importedScheduleItems: readonly ScheduleItem[];
  /** The file as reviewed: a lookahead's rows are asked about as a lookahead's (WS2, decision 4). */
  document?: DAVEWebUploadDocument | null;
}): ScheduleImportPairingQuestion[] {
  if (!snapshot || importedScheduleItems.length === 0) return [];
  // WS1 item 2: a lookahead's rows are asked about as the phone's review asks about a lookahead's, by the phone's
  // review function, from every saved task and the schedules saved now.
  if (daveWebUploadIsLookahead(document)) {
    const importBatchId = (document?.importBatchId || '').trim() ||
      importedScheduleItems.map(row => (typeof row.importBatchId === 'string' ? row.importBatchId.trim() : '')).find(Boolean) || '';
    if (snapshot.knownScheduleItems && snapshot.referenceDocuments) {
      return scheduleImportReviewPairingQuestions({
        saved: snapshot.knownScheduleItems.map(scheduleItemForCloud),
        documents: snapshot.referenceDocuments,
        importBatchId,
        imported: importedScheduleItems,
        overlay: true,
      });
    }
    const shown = daveWebSavedTasksForImport(snapshot);
    return scheduleImportPairingQuestions({ existing: shown.saved.map(({ item }) => item), imported: importedScheduleItems, isCurrent: shown.isShown, overlay: true });
  }
  // WS1 item 1: with the saved rows the web does not show, so a task that was on an earlier schedule and is listed
  // again is asked about ("the same task, or new work?") by the phone's own function, in the phone's own words.
  const { saved, isShown } = daveWebSavedTasksForImport(snapshot);
  return scheduleImportPairingQuestions({
    existing: saved.map(({ item }) => item),
    imported: importedScheduleItems,
    isCurrent: isShown,
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
 * gave. Empty for a schedule that is not a lookahead and when nothing goes
 * back.
 *
 * WS1 item 4 (open item; 6 Oct 2026): a replaced lookahead with no task of
 * its own (it only re-dated or re-stated the master's tasks) was offered
 * "Delete Document" alone, which keeps the dates and percent it gave; the
 * web had no button that puts them back, where the phone offers "Delete PDF
 * + Items" for the same lookahead. The same sentence is now given for it,
 * with the web's button for that ("Delete Document + Its Changes"), and the
 * dialog offers that button whenever the sentence says something goes back.
 */
export const DAVE_WEB_DELETE_WITH_CHANGES_LABEL = 'Delete Document + Its Changes';

export function daveWebScheduleDocumentDeleteNote({
  snapshot,
  document,
}: {
  snapshot: Pick<DAVEWebReadOnlySnapshot, 'scheduleItems' | 'knownScheduleItems' | 'referenceDocuments'>;
  document: DAVEWebReferenceDocument;
}): string {
  const count = document.linkedScheduleItems.length;
  if (!scheduleDocumentAddsToMaster(document)) return '';
  const saved = snapshot.knownScheduleItems ?? snapshot.scheduleItems;
  const linked = new Set(document.linkedScheduleItems.map(item => item.id));
  return scheduleLookaheadDeleteNote(
    saved,
    document,
    saved.filter(item => linked.has(item.id)),
    snapshot.referenceDocuments,
    count === 0 ? DAVE_WEB_DELETE_WITH_CHANGES_LABEL : `Delete Document + ${count} Task${count === 1 ? '' : 's'}`,
  );
}

/**
 * Open item, web batch WS1 item 8 (6 Oct 2026): deleting a task on the web's
 * Tasks page recorded the task (and the hidden rows of its revision chain)
 * as deleted and wrote nothing else, so every task that listed it as a
 * predecessor went on naming a row that no longer exists: "Missing" on the
 * web's Schedule, "Map predecessor" on the phone, and a finish-to-start
 * calculation that is unsafe to apply. The phone drops those links when it
 * deletes a task (dropDeletedPredecessors); "Delete Document + N Tasks"
 * already moves or drops them (planDAVEWebScheduleDocumentDelete).
 *
 * The rows a task's delete takes, by the phone's own helper, as the web's
 * delete itself works them out.
 */
export function daveWebTaskDeleteRowIds(
  snapshot: Pick<DAVEWebReadOnlySnapshot, 'scheduleItems' | 'knownScheduleItems' | 'referenceDocuments'>,
  task: ScheduleItem,
): string[] {
  return scheduleItemIdsDeletedWithTask(snapshot.knownScheduleItems ?? snapshot.scheduleItems, task, snapshot.referenceDocuments);
}

/**
 * The saved tasks that still list a deleted row as a predecessor, each
 * without those links (the phone's helper, dependencyChangesForDeletedTask,
 * over every saved row, hidden ones included), to be saved while its cloud
 * revision is the one read. The links are stamped as changed now, as a link
 * he unticks is, so they stay removed when the task moves between rows.
 */
export function planDAVEWebLinksRemovedWithTasks({
  snapshot,
  deletedIds,
  updatedAt = new Date().toISOString(),
}: {
  snapshot: Pick<DAVEWebReadOnlySnapshot, 'scheduleItems' | 'knownScheduleItems'>;
  deletedIds: readonly string[];
  updatedAt?: string;
}): readonly DAVEWebScheduleItem[] {
  const saved = (snapshot.knownScheduleItems ?? snapshot.scheduleItems) as readonly DAVEWebScheduleItem[];
  const byId = new Map(saved.map(item => [item.id, item] as const));
  return Object.freeze(dependencyChangesForDeletedTask(saved, deletedIds).flatMap(change => {
    const before = byId.get(change.id);
    return before
      ? [{ ...scheduleItemForCloud(before), dependencies: change.dependencies, dependenciesUpdatedAt: updatedAt, updatedAt, cloudUpdatedAt: before.cloudUpdatedAt ?? null } as DAVEWebScheduleItem]
      : [];
  }));
}

/**
 * Review pass 1, web L6 (6 Oct 2026; caused by WS1 item 8): the tasks that
 * still list a deleted task as a predecessor after its delete, by why each
 * link could not be taken. He was told "N other tasks still list it as a
 * predecessor, because they were being changed on another device at that
 * moment." whatever had happened (a dropped connection and an ended sign-in
 * included), and N counted every saved row, the hidden ones he cannot open
 * too. These count tasks the schedule shows.
 */
export type DAVEWebLinksLeftAfterDelete = Readonly<{
  /** Another device changed the task at that moment (the cloud refused the save as out of date, twice). */
  changedElsewhere: number;
  /** The save failed and it was no other device: the cloud did not take it, or could not be reached. */
  notSaved: number;
  /** The cloud no longer accepted this browser's sign-in. */
  signedOut: number;
  /**
   * The save of the links was cut short and the cloud could not be read again to finish: the count is of the tasks
   * that were to lose the link, and some of them may have lost it.
   */
  unsure?: boolean;
}>;

/** What he is told after Delete Task: the delete, then each link left with its true reason and what to do. */
export function daveWebTaskDeletedNotice(left: DAVEWebLinksLeftAfterDelete | null): string {
  const deleted = 'Task deleted and protected from returning on another device.';
  const total = left ? left.changedElsewhere + left.notSaved + left.signedOut : 0;
  if (!left || total === 0) return deleted;
  const those = total === 1 ? 'that task' : 'those tasks';
  if (left.unsure) {
    // One task shown here means the links cut short were its own and those of rows the schedule does not show.
    const may = total === 1 ? '1 other task may still list it as a predecessor' : `Up to ${total} other tasks may still list it as a predecessor`;
    const still = total === 1 ? 'if it is still listed' : 'where it is still listed';
    return left.signedOut > 0
      ? `${deleted} ${may}, because this browser's sign-in was no longer accepted before every link was removed. Sign in again, then open ${those} in Schedule and untick the deleted task ${still}.`
      : `${deleted} ${may}: removing ${total === 1 ? 'the' : 'those'} links was interrupted, and the schedule could not then be read from the cloud to finish (the connection may have dropped). Open ${those} in Schedule and untick the deleted task ${still}.`;
  }
  const kinds: Array<readonly [number, (count: number) => string]> = [
    [left.changedElsewhere, count => `${count === 1 ? 'it was' : 'they were'} being changed on another device at that moment`],
    [left.notSaved, count => `the change to ${count === 1 ? 'it' : 'them'} could not be saved just then (the connection may have dropped)`],
    [left.signedOut, count => `this browser's sign-in was no longer accepted when ${count === 1 ? 'its link was' : 'their links were'} to be removed`],
  ];
  const clauses = kinds.filter(([count]) => count > 0).map(([count, why], index) => index === 0
    ? `${count} other task${count === 1 ? ' still lists' : 's still list'} it as a predecessor, because ${why(count)}`
    : `${count} more still list${count === 1 ? 's' : ''} it, because ${why(count)}`);
  return `${deleted} ${clauses.join('; ')}. ${left.signedOut > 0 ? 'Sign in again, then open' : 'Open'} ${those} in Schedule and untick the deleted task.`;
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
  // The same facts, also when the report was prepared under the earlier fingerprint version (R4 item 4a).
  return sameReportSource(sourceFingerprint, currentSource.fingerprint);
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
    // A document the cloud marks archived is not counted (owner answer Q44; review of D1, L10); with none, this is the list itself.
    referenceDocuments: daveWebListedDocuments(snapshot.referenceDocuments, snapshot.archivedDocumentIds),
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
