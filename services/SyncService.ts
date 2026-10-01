import { classifySyncFailureText, CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE, currentDrawingProjectsKeptMessage, isSyncFailureCategory, type SyncFailureCategory } from './SyncFailureCategory';
import {
  archiveProjectUpdate,
  countCloudProjects,
  createProject,
  createPhotoSignedUrl,
  deleteProjectUpdate,
  deleteProject,
  getProjectUpdateSyncMetadata,
  getScheduleItem,
  getSupabaseConfigurationStatus,
  listProjectUpdates,
  listProjectAreas,
  listArchivedProjects,
  listProjects,
  listReferenceDocuments,
  listScheduleItems,
  saveProjectUpdate,
  testSupabaseConnection,
  updateProject,
  uploadPhoto,
  upsertProjectArea,
  upsertReferenceDocument,
  upsertScheduleItem,
  verifyDAVEAppOwner,
  type CloudProject,
  type CloudProjectUpdate,
  type JsonValue,
  type SupabaseConfigurationStatus,
} from './SupabaseService';
import * as FileSystem from 'expo-file-system/legacy';
import { LEGACY_WORK_CONTAINER_PROJECT_NAMES } from './ReservedProjectNames';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isProjectDocumentBridge,
  parseStoredProjectDocuments,
  PROJECT_DOCUMENTS_STORAGE_KEY,
  projectDocumentBridgeOrphaned,
} from './ProjectDocumentBridge';
import { getStoredJson, setStoredJson } from './StorageService';
import {
  deletedDAVERecordIds,
  loadDAVEOperationalTombstones,
  removeDAVETombstonedRecords,
  synchronizeDAVESyncTombstones,
  type DAVESyncTombstoneSyncResult,
} from './DAVESyncTombstones';
import {
  daveProjectAreasNeedingCloudUpload,
  mergeDAVEProjectAreaRecoveryRecords,
} from './DAVEProjectAreaRecovery';
import {
  daveScheduleItemsNeedingCloudUpload,
  recoverDAVEScheduleRecords,
} from './DAVEScheduleRecovery';
import {
  daveReferenceDocumentsNeedingCloudUpload,
  mergeDAVEReferenceDocumentRecoveryRecords,
  referenceDocumentEditOutlivingActivation,
  referenceDocumentSharedDetailsFingerprint,
} from './DAVECloudRecovery';
import { cloudPhotoPreviewIsFresh } from './ProjectPhotoTransport';
import {
  confirmProjectUpdateCloudDeletion,
  confirmedProjectUpdateDeletionIds,
  hasProjectUpdateDeletionIntent,
  recordProjectUpdateDeletionIntent,
} from './ProjectUpdateDeletionJournal';
import { createDurableLocalTransactionRepository } from './DurableLocalTransaction';
import { withoutDeletedSharedProject } from './ProjectDeletionTransaction';
import { startGuardedBackgroundTask } from './BackgroundTaskGuard';
import { createPendingChangesRetryController } from './PendingChangesRetryController';
import { runDAVECloudMaintenanceIfDue } from './DAVECloudMaintenanceBudget';
import { prepareReferenceDocumentForCloud } from './ReferenceDocumentRepository';
import { compactECOSDocumentIndexForCloud } from './ECOSDocumentIndexPersistence';
import { mergeProjectControlsRevisions } from './VitruviusProjectControls';
import { withScheduleImportMembershipOf } from './ScheduleImportProvenance';
import { withScheduleTaskEarlierIdsOf } from './ScheduleTaskRevisions';
import { canonicalScheduleItemJson } from './ScheduleItemCloudAcknowledgement';
import { planPendingUploadBatch } from './SyncUploadBatchPolicy';
import {
  applyFieldUpdateDocumentPatches,
  fieldUpdateDocumentPatchFor,
  mergeFieldUpdateDocumentPatches,
  queuedDocumentPatchesForUpdate,
  queuedFieldUpdateDocumentPatches,
  removedFieldUpdateDocumentKey,
  withoutDocumentUploadState,
  type FieldUpdateDocumentPatch,
  type RemovedFieldUpdateDocuments,
} from './FieldUpdateDocumentPatch';
import {
  applyFieldUpdatePhotoAnalysisPatch,
  fieldUpdatePhotoAnalysisPatchFor,
  isFieldUpdatePhotoAnalysisPatch,
  withoutPhotoAnalysis,
  type FieldUpdatePhotoAnalysisPatch,
} from './FieldUpdatePhotoAnalysisPatch';
import { loadRemovedFieldUpdateDocuments, recordRemovedFieldUpdateDocument } from './FieldUpdateRemovedDocuments';
import { resetDocumentsResentThisLaunchForTests, withDeviceDocumentUploadState } from './FieldUpdateDocumentUploadState';
import { sameFieldUpdateSyncGeneration } from './FieldUpdateSyncGeneration';

export { loadRemovedFieldUpdateDocuments } from './FieldUpdateRemovedDocuments';
import {
  daveProjectUpdateMatchesCloudReceipt,
  daveProjectUpdatesNeedingCloudUpload,
  daveProjectUpdatesSemanticallyMatch,
} from './DAVEProjectUpdateCloudReceipt';
import {
  buildOperationalProjectIdentityAuthority,
  resolveOperationalProjectIdentity,
  resolveOperationalReferenceDocumentScope,
  type OperationalProjectIdentityAuthority,
  type OperationalProjectIdentityResult,
} from './OperationalProjectIdentity';
import {
  createBoundedTaskRunner,
  mapWithBoundedConcurrency,
} from './BoundedConcurrency';
import {
  cloudOwnerUnchanged,
  currentCloudOwner,
  heldForAnotherOwner,
  type CloudOwnerBinding,
} from './CloudOwnerBinding';
import type {
  DAVESyncTombstone,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';

export type SyncEntity =
  | 'project'
  | 'project_update'
  | 'project_area'
  | 'schedule_item'
  | 'reference_document';
export type SyncOperation = 'create' | 'update' | 'delete';

export type SyncQueueItem<TPayload = Record<string, unknown>> = {
  id: string;
  entity: SyncEntity;
  operation: SyncOperation;
  payload: TPayload;
  createdAt: string;
  changedAt: string;
  retryCount: number;
  lastError?: string | null;
  /** Why the last attempt failed, recorded from the raw failure before lastError is sanitised (audit A4). */
  lastFailureCategory?: SyncFailureCategory | null;
  /** The account it was queued under; only that account sends it (audit A1 M3). */
  ownerId?: string;
};

export type SyncConflict<TPayload = unknown> = {
  id: string;
  entity: SyncEntity;
  localId: string;
  localChangedAt: string;
  remoteChangedAt: string | null;
  reason: string;
  detectedAt: string;
  localPayload: TPayload;
  remotePayload?: unknown;
};

/**
 * The conflict saved on this phone for a field update, while one is open
 * (whole-app audit A4 pass 15 H1, L1). The one test for both: while it is
 * open, the update's card reads "Needs Review", and nothing automatic sends
 * the update.
 */
export function openFieldUpdateConflict(conflicts: readonly SyncConflict[], updateId: string): SyncConflict | null {
  return conflicts.find(conflict => conflict.entity === 'project_update' && conflict.localId === updateId) ?? null;
}

/**
 * How a field update's sync was asked for (whole-app audit A4 pass 15 H1).
 * While a conflict is open for the update, nothing automatic sends it: only a
 * choice David made for it does. `overConflict`: a Retry he confirmed ("This
 * update was also changed on another device. Send your version over it?");
 * Keep Phone and Keep Cloud mark their own copy. `automatic` changes nothing
 * now; the callers that pass it are automatic, as is every call without
 * `overConflict`.
 */
export type FieldUpdateSyncChoice = Readonly<{ automatic?: boolean; overConflict?: boolean }>;

export type SyncStatus = {
  configured: boolean;
  queuedChanges: number;
  /**
   * Of queuedChanges: whole copies of field updates in conflict, held for
   * Review Conflicts (A4 pass 15 H1); each update is one of `conflicts`
   * already (whole-app audit A4 pass 15b F2).
   */
  heldForConflictReview: number;
  conflicts: number;
  recoveryAvailable: boolean;
  recoveryCopies: number;
  lastSyncAt: string | null;
  message: string;
};

export type SyncUploadResult = {
  configured: boolean;
  uploaded: number;
  uploadedByEntity?: Partial<Record<SyncEntity, number>>;
  /**
   * Exact authoritative document metadata accepted by the cloud during this
   * pass. File-backed documents may gain storagePath/integrity fields while
   * uploading, so callers must replace their older local copy with this one.
   */
  uploadedReferenceDocuments?: ReferenceDocument[];
  itemOutcomes?: Record<string, SyncItemOutcome>;
  queued: number;
  conflicts: number;
  errors: string[];
  /** The queue item's recorded failure category, when it is still queued after this pass (audit A4). */
  failureCategory?: SyncFailureCategory | null;
  /**
   * How many of `errors` belong to items held until the owner edits them
   * again. They are shown but ask for no retry (whole-app audit A8 pass 1 F3).
   */
  heldErrorCount?: number;
  /**
   * The error of each queue item that failed in this pass, by its id (an
   * entry of `errors`): Sync Now counts an item failing in both of its passes
   * once (whole-app audit A7 pass 13 L-2).
   */
  itemErrors?: Record<string, string>;
  /**
   * A task save only: this phone's own create or reopen of the task's project
   * is still queued, so a cloud answer that the project is not open clears
   * once that change uploads (whole-app audit A3 pass 7 L1).
   */
  projectStillUploading?: boolean;
};

export type SyncItemOutcome =
  | 'uploaded'
  | 'superseded'
  | 'conflict'
  | 'blocked'
  | 'failed';

export type ScheduleImportCloudSyncResult = SyncUploadResult & {
  /**
   * True only after every exact task/document revision can be read back from
   * the durable offline queue. This distinguishes a protected local save from
   * an in-memory UI transition.
   */
  durablyQueued: boolean;
  /**
   * True only when every exact imported record was uploaded and none of those
   * records remains queued or conflicted.
   */
  fullySynced: boolean;
  /** Imported task ids rejected because deletion history outranks the import. */
  supersededScheduleItemIds: string[];
  /** Imported document ids rejected because deletion history outranks the import. */
  supersededReferenceDocumentIds: string[];
};

/**
 * Audit P1-27: a failed cloud read must never be silently converted into an
 * empty, apparently-authoritative collection. Each collection carries its own
 * read error; consumers must not apply a collection whose error is non-null.
 */
export type CloudCollectionErrors = {
  projects: string | null;
  updates: string | null;
  projectAreas: string | null;
  scheduleItems: string | null;
  referenceDocuments: string | null;
};

export type CloudDownloadResult<TUpdate> = {
  configured: boolean;
  projects: CloudProject[];
  projectNames: string[];
  updates: CloudProjectUpdate<TUpdate>[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  tombstones: DAVESyncTombstone[];
  tombstonesAuthoritative: boolean;
  tombstoneError: string | null;
  collectionErrors: CloudCollectionErrors;
};

export type LocalSyncPayload = {
  projects: string[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
};

export type SyncProgressEvent = {
  message: string;
  completed: number;
  total: number;
};

export type FullSyncResult = {
  configured: boolean;
  connected: boolean;
  /**
   * Audit P1-27: 'complete' only when every cloud collection downloaded
   * successfully. 'partial' means at least one collection failed to read;
   * its recovered array is empty and must not be treated as authoritative.
   */
  downloadStatus: 'complete' | 'partial';
  uploaded: number;
  downloaded: number;
  queued: number;
  conflicts: number;
  cloudProjectCount: number | null;
  lastSyncAt: string | null;
  errors: string[];
  missingPhotos: MissingSyncPhoto[];
  details: {
    queuedUploads: number;
    projectsUploaded: number;
    updatesUploaded: number;
    photosUploaded: number;
    areasUploaded: number;
    schedulesUploaded: number;
    documentsUploaded: number;
    cloudProjectsDownloaded: number;
    cloudUpdatesDownloaded: number;
    cloudAreasDownloaded: number;
    cloudSchedulesDownloaded: number;
    cloudDocumentsDownloaded: number;
  };
  recovered: {
    projects: CloudProject[];
    updates: ProjectUpdate[];
    projectAreas: ProjectArea[];
    scheduleItems: ScheduleItem[];
    referenceDocuments: ReferenceDocument[];
    tombstones: DAVESyncTombstone[];
    /** Audit P1-27: appliers must skip any collection with a non-null error. */
    collectionErrors: CloudCollectionErrors;
  };
};

export function allCollectionsFailed(message: string): CloudCollectionErrors {
  return {
    projects: message,
    updates: message,
    projectAreas: message,
    scheduleItems: message,
    referenceDocuments: message,
  };
}

/**
 * A failed cloud write already carries its reason. Dropping it leaves the field
 * with a bare "could not sync." and nothing to act on — a permission refusal, a
 * rejected value and a missing table all read identically, and the same count
 * returns every sync with no way to tell what to do about it. Always append
 * what the write actually said.
 */
export function cloudWriteFailureReason(result: {
  error?: string;
  message?: string;
  stubbed?: boolean;
}): string {
  const reason = (result.error || result.message || '').trim();
  // Sync Now named the raw database code; the queue already said it in words (whole-app audit A8 pass 2 #9).
  if (reason && classifySyncFailureText([reason]) === 'current_drawing_protected') return ` ${CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE}`;
  if (reason) return ` ${reason}`;
  return result.stubbed ? ' The cloud table is not available yet.' : '';
}

export type MissingSyncPhoto = {
  updateId: string;
  photoId: string;
};

export type SyncStorageCleanupResult = {
  cleaned: boolean;
  keysChecked: string[];
  missingPhotosRemoved: number;
};

export type PhotoStorageUploadFailureCategory =
  | 'bucket_missing'
  | 'rls_denied'
  | 'auth_missing'
  | 'invalid_path'
  | 'invalid_payload'
  | 'unsupported_content_type'
  | 'file_unreadable'
  | 'stale_local_uri'
  | 'network'
  | 'unknown_storage_error';

export type PhotoStorageUploadDiagnostic = {
  bucketName: string;
  bucketExists: 'yes' | 'no' | 'unknown';
  uploadAttempted: boolean;
  uploadResult: 'success' | 'failed' | 'skipped';
  failureCategory: PhotoStorageUploadFailureCategory | null;
  httpStatus: number | null;
  errorCode: string | null;
  localFileExists: boolean | null;
  localFileReadable: boolean | null;
  fileByteSizeCategory: 'zero' | 'nonzero' | 'unknown';
  uploadPayloadType: 'ArrayBuffer' | 'Blob' | 'base64' | 'unknown';
  contentType: string | null;
  objectPathCategory: string | null;
};

export type LocalPhotoUploadResult = {
  result: 'uploaded' | 'missing' | 'failed' | 'skipped';
  message: string | null;
  diagnostic: PhotoStorageUploadDiagnostic;
  /** Set when the photo was found in the cloud under a legacy project path. */
  foundAtPath?: string;
};

export type FieldUpdateSyncWorkAttempt = {
  cloudUpdateInsertAttempted: boolean;
  photoStorageUploadAttempted: boolean;
  storageUploadResult: 'success' | 'failed' | 'skipped';
  databaseUpsertResult: 'success' | 'failed' | 'skipped';
  storageBucketName: string | null;
  storageBucketExists: 'yes' | 'no' | 'unknown';
  storageFailureCategory: PhotoStorageUploadFailureCategory | null;
  storageHttpStatus: number | null;
  storageErrorCode: string | null;
  localFileExists: boolean | null;
  localFileReadable: boolean | null;
  fileByteSizeCategory: 'zero' | 'nonzero' | 'unknown';
  uploadPayloadType: 'ArrayBuffer' | 'Blob' | 'base64' | 'unknown';
  storageContentType: string | null;
  objectPathCategory: string | null;
  databaseSyncRanAfterUpload: boolean | null;
  errors: string[];
};

export type StagedProjectUpdateSync = {
  workAttempt: FieldUpdateSyncWorkAttempt;
  uploadedPhotoCount: number;
  missingPhotos: MissingSyncPhoto[];
  pendingPhotoAssetIds: string[];
  /** Left for review: in conflict, and this attempt automatic or Sync Now's (whole-app audit A4 pass 13 M1, G2). Nothing was written or sent. */
  heldForConflictReview?: boolean;
};

export type OfflineQueueQuarantineExport = {
  storageKey: string;
  rawValue: string;
};

export type OfflineQueueRecoveryState = {
  activeItems: number;
  quarantineKeys: string[];
  unresolvedQuarantineKeys: string[];
  recoveryAvailable: boolean;
};

export type OfflineQueueRecoveryAttempt = {
  status:
    | 'recovered'
    | 'already_recovered'
    | 'still_corrupt'
    | 'active_queue_not_empty'
    | 'not_found';
  quarantineKey: string;
  restoredItems: number;
  activeItems: number;
};

const PROJECT_PHOTOS_BUCKET = 'project-photos';
const RECOVERED_PHOTOS_FOLDER = 'dave-recovered-project-photos';
export const PROJECT_PHOTO_PREVIEW_WIDTH = 960;
export const PROJECT_PHOTO_PREVIEW_QUALITY = 72;
export const PROJECT_PHOTO_NETWORK_CONCURRENCY = 3;
const PROJECT_PHOTO_PREVIEW_CACHE_LIMIT = 256;
const PROJECT_PHOTO_PREVIEW_USABLE_MS = 9 * 60_000;
type PhotoSignedUrlResult = Awaited<ReturnType<typeof createPhotoSignedUrl>>;
type CachedPhotoPreviewSignedUrl = Readonly<{
  result: PhotoSignedUrlResult;
  usableUntil: number;
}>;
const photoPreviewSigningRunner = createBoundedTaskRunner(
  PROJECT_PHOTO_NETWORK_CONCURRENCY,
);
const photoPreviewSigningInFlight = new Map<
  string,
  Promise<CachedPhotoPreviewSignedUrl>
>();
const photoPreviewSignedUrlCache = new Map<string, CachedPhotoPreviewSignedUrl>();

export function sanitizeUserFacingSyncMessage(message: string): string {
  if (!message.trim()) return message;

  // A Current drawing the cloud refused to change is named in plain words,
  // not by its raw database code (whole-app audit A8 pass 1 F3 (30 Sep 2026)).
  if (classifySyncFailureText([message]) === 'current_drawing_protected') {
    return message.startsWith('This drawing is Current for ECOS') ? message : CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE;
  }

  // Deliberately narrow to signals that only appear in a genuine local
  // file-read failure (native path segments, the file-read API name, the
  // photo storage folder, the image extension). Generic phrases like "does
  // not exist", "Caused by", or "Sync failed:" were removed from this check
  // because they also appear in real Postgres/PostgREST schema errors (e.g.
  // "column ... does not exist") - matching on them mislabeled a permanent
  // backend/schema failure as a harmless missing-photo-file notice.
  if (
    /readAsStringAsync|readAsString|\/var\/mobile|Containers\/Data\/Application|project-photos|\.heic/i.test(message)
  ) {
    return 'Some photos could not be synced because the original files are no longer available. The remaining items will continue syncing.';
  }

  if (/unauthorized|forbidden|jwt|session|sign.?in|auth/i.test(message)) {
    return 'Cloud sync needs you to sign in again. Your changes remain saved on this phone.';
  }

  if (/network|fetch|offline|timeout|timed out|connection|dns/i.test(message)) {
    return 'Cloud sync could not connect. Your changes remain saved and will be retried.';
  }

  if (/schema|column|relation|bucket|row.level|permission|postgres|supabase|storage/i.test(message)) {
    return 'Cloud sync needs service attention. Your changes remain saved on this phone.';
  }

  if (/^[\w .,'“”'!?()-]{1,180}$/.test(message) && !/error|exception|failed|failure/i.test(message)) {
    return message;
  }

  return 'Cloud sync could not finish. Your changes remain saved on this phone and will be retried.';
}

export async function cleanupStoredSyncStatusMessages(): Promise<SyncStorageCleanupResult> {
  const keys = await AsyncStorage.getAllKeys();
  const syncKeys = keys.filter(isSyncStorageKey);
  let cleaned = false;
  let missingPhotosRemoved = 0;

  for (const key of syncKeys) {
    if (isOfflineQueueRecoveryInternalKey(key)) continue;

    if (key === SYNC_QUEUE_STORAGE_KEY) {
      const queueCleanup = await serializeOfflineQueueMutation(async () => {
        const recovered = await readOfflineQueueUnsafe();
        if (recovered.rawValue === null) {
          return { changed: false, missingPhotosRemoved: 0 };
        }
        const result = await cleanupSyncQueueValue(recovered.rawValue);
        const contentChanged = result.value !== recovered.rawValue;
        const changed =
          recovered.quarantineKey !== null ||
          contentChanged;
        // Discovery already committed and verified the salvaged active queue.
        // Do not immediately rewrite those bytes. If message cleanup really
        // changed the content, route it through the same durable verifier.
        if (contentChanged) {
          await persistVerifiedOfflineQueue(parseOfflineQueueValue(result.value));
        }
        return {
          changed,
          missingPhotosRemoved: result.missingPhotosRemoved,
        };
      });
      cleaned = cleaned || queueCleanup.changed;
      missingPhotosRemoved += queueCleanup.missingPhotosRemoved;
      continue;
    }

    const value = await AsyncStorage.getItem(key);
    if (value === null) continue;

    if (key === SYNC_LAST_RUN_STORAGE_KEY) {
      const nextValue = cleanupLastSyncValue(value);

      if (nextValue !== value) {
        await AsyncStorage.setItem(key, nextValue);
        cleaned = true;
      }

      continue;
    }

    if (key === SYNC_CONFLICTS_STORAGE_KEY) {
      const nextValue = cleanupSyncConflictsValue(value);

      if (nextValue !== value) {
        await AsyncStorage.setItem(key, nextValue);
        cleaned = true;
      }

      continue;
    }
  }

  return {
    cleaned,
    keysChecked: syncKeys,
    missingPhotosRemoved,
  };
}

type ProjectCreatePayload = {
  name: string;
};

type ProjectUpdatePayload = {
  id?: string;
  name?: string;
  previousName?: string;
  status?: string;
  archived?: boolean;
  isFavorite?: boolean;
  data?: JsonValue | null;
  coverPhotoUpload?: {
    localUri: string;
    remotePath: string;
    mimeType: string;
  };
};

type ProjectDeletePayload = {
  name: string;
};

type ProjectUpdateRecordPayload<TUpdate = unknown> = {
  id: string;
  projectId?: string | null;
  projectName?: string;
  selectedAreaName?: string | null;
  updateData?: TUpdate;
  pendingPhotoAssetIds?: string[];
  archiveOnly?: boolean;
  archivedAt?: string;
  /**
   * Only document changes wait: they go onto the cloud's copy, and
   * updateData (this device's copy) goes up only when the cloud has none
   * (whole-app audit A7 pass 6 M1).
   */
  documentPatches?: FieldUpdateDocumentPatch[];
  /**
   * Keep Phone's kept copy: a newer edit saved on this phone since the
   * conflict, queued again in the same write that takes this copy off once
   * it lands (whole-app audit A7 pass 11 L-2; see newerEditQueuedAfter).
   * A late analysis result's patch: the edit held for conflict review it
   * stands in front of, queued again as it was (A7 pass 14 L-2).
   */
  newerEdit?: SyncQueueItem;
  /**
   * A copy David chose to send over this open conflict (its id): Keep Phone's,
   * Keep Cloud's, or a Retry he confirmed (whole-app audit A4 pass 15 H1).
   * Any other whole copy of an update in conflict waits for his choice.
   */
  overConflict?: string;
};

type ProjectUpdateDeletePayload = {
  id: string;
  projectName?: string;
  /**
   * Durable second phase for project-update deletion. Once the owner-scoped
   * cloud delete succeeds, retries finish the local confirmation journal
   * without issuing the destructive request again.
   */
  cloudDeleteSucceededAt?: string;
};

type ProjectAreaRecordPayload = {
  id: string;
  areaData: ProjectArea;
};

type ScheduleItemRecordPayload = {
  id: string;
  itemData: ScheduleItem;
  /**
   * Exact fields changed by the user. Persisting this scope lets a delayed
   * upload merge a note or ownership edit into a newer cloud task without
   * overwriting unrelated changes made on another device.
   */
  changedFields?: Array<keyof ScheduleItem>;
  /** Explicit conflict resolution may intentionally replace the cloud copy. */
  forceLocal?: boolean;
  /**
   * On a task's conflict only (whole-app audit A7 pass 16 L-2): this phone's
   * edits of the task that a Keep Cloud which could not finish took off the
   * queue, one of which landed during that choice. They wait here, not on
   * the queue, where the next automatic pass sent the edit David chose to
   * discard; a later Keep Cloud undoes the one that landed.
   */
  withdrawnEdits?: SyncQueueItem[];
};

type ReferenceDocumentRecordPayload = {
  id: string;
  documentData: ReferenceDocument;
};

const SYNC_QUEUE_STORAGE_KEY = 'projectVisionAI.syncQueue.v1';
export const SYNC_QUEUE_QUARANTINE_KEY_PREFIX =
  `${SYNC_QUEUE_STORAGE_KEY}.quarantine.`;
const SYNC_QUEUE_QUARANTINE_METADATA_KEY_PREFIX =
  `${SYNC_QUEUE_STORAGE_KEY}.quarantine-metadata.`;
const SYNC_QUEUE_RECOVERY_TRANSACTION_KEY =
  `${SYNC_QUEUE_STORAGE_KEY}.recovery-transaction.v1`;
const SYNC_QUEUE_ARCHIVE_RECOVERY_INDEX_KEY =
  `${SYNC_QUEUE_STORAGE_KEY}.archive-recovery-index.v1`;
const SYNC_CONFLICTS_STORAGE_KEY = 'projectVisionAI.syncConflicts.v1';
const SYNC_LAST_RUN_STORAGE_KEY = 'projectVisionAI.lastSyncAt.v1';
const LEGACY_DELETED_PROJECTS_STORAGE_KEY =
  'projectPhotoUpdate.deletedProjects.v1';
const PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS = 'blocked_on_photo_assets';

let offlineQueueMutationTail: Promise<void> = Promise.resolve();
let syncConflictMutationTail: Promise<void> = Promise.resolve();
const offlineQueueRecoveryTransaction = createDurableLocalTransactionRepository({
  storage: AsyncStorage,
  journalKey: SYNC_QUEUE_RECOVERY_TRANSACTION_KEY,
  createTransactionId: () =>
    `offline-queue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  now: () => new Date().toISOString(),
});

function serializeOfflineQueueMutation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = offlineQueueMutationTail.then(operation);
  offlineQueueMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

type OfflineQueueReadResult = {
  queue: SyncQueueItem[];
  rawValue: string | null;
  quarantineKey: string | null;
};

type OfflineQueueQuarantineMetadata = {
  version: 1;
  quarantineKey: string;
  salvagedItemIds: string[];
  restoredItemIds: string[];
  invalidItemCount: number;
  resolvedAt: string | null;
};

type OfflineQueueValueAnalysis = {
  queue: SyncQueueItem[];
  invalidItemCount: number;
};

type ArchiveOnlyRecoveryIndex = {
  version: 1;
  resolvedQuarantineKeys: string[];
  resolvedArchiveItemIds: string[];
  updatedAt: string;
};

type ArchiveOnlyQuarantineCandidate = {
  quarantineKey: string;
  items: SyncQueueItem<ProjectUpdateRecordPayload>[];
};

type StagedArchiveOnlyRecovery = {
  eligibleQuarantines: Array<{
    quarantineKey: string;
    itemIds: string[];
  }>;
};

function isOfflineQueueQuarantineKey(key: string): boolean {
  return key.startsWith(SYNC_QUEUE_QUARANTINE_KEY_PREFIX);
}

function parseOfflineQueueValue(rawValue: string): SyncQueueItem[] {
  const analysis = analyzeOfflineQueueValue(rawValue);
  if (analysis.invalidItemCount > 0) {
    throw new Error('Stored offline queue is not a valid queue.');
  }
  return analysis.queue;
}

/**
 * Parse each queue row independently so a single malformed row cannot erase
 * unrelated valid offline work. Duplicate IDs are also isolated: normal queue
 * mutations maintain one current revision per ID, so the last valid revision
 * is retained and the anomalous duplicates remain in the exact quarantine.
 */
function analyzeOfflineQueueValue(rawValue: string): OfflineQueueValueAnalysis {
  const parsed = JSON.parse(rawValue) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Stored offline queue is not an array.');
  }

  const lastValidIndexById = new Map<string, number>();
  parsed.forEach((value, index) => {
    if (isValidSyncQueueItem(value)) lastValidIndexById.set(value.id, index);
  });

  const queue: SyncQueueItem[] = [];
  let invalidItemCount = 0;
  parsed.forEach((value, index) => {
    if (!isValidSyncQueueItem(value)) {
      invalidItemCount += 1;
      return;
    }
    if (lastValidIndexById.get(value.id) !== index) {
      invalidItemCount += 1;
      return;
    }
    queue.push(value);
  });

  return { queue, invalidItemCount };
}

function isValidSyncQueueItem(value: unknown): value is SyncQueueItem {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
  if (
    value.entity !== 'project' &&
    value.entity !== 'project_update' &&
    value.entity !== 'project_area' &&
    value.entity !== 'schedule_item' &&
    value.entity !== 'reference_document'
  ) return false;
  if (
    value.operation !== 'create' &&
    value.operation !== 'update' &&
    value.operation !== 'delete'
  ) return false;
  if (!isFiniteSyncTimestamp(value.createdAt)) return false;
  if (!isFiniteSyncTimestamp(value.changedAt)) return false;
  if (
    typeof value.retryCount !== 'number' ||
    !Number.isInteger(value.retryCount) ||
    value.retryCount < 0
  ) return false;
  const lastErrorIsValid = (
    value.lastError === undefined ||
    value.lastError === null ||
    typeof value.lastError === 'string'
  );
  if (!lastErrorIsValid) return false;
  // A category this build does not know (a newer build's, after a downgrade)
  // must not sideline a pending upload: any string is kept and read as
  // unknown (audit A4, 30 Sep 2026).
  if (
    value.lastFailureCategory !== undefined &&
    value.lastFailureCategory !== null &&
    typeof value.lastFailureCategory !== 'string'
  ) return false;

  if (value.entity === 'project_update') {
    if (value.operation === 'create') return false;
    if (
      typeof value.payload.id !== 'string' ||
      value.payload.id.trim().length === 0
    ) return false;
    if (value.operation === 'delete') {
      return (
        value.payload.cloudDeleteSucceededAt === undefined ||
        isFiniteSyncTimestamp(value.payload.cloudDeleteSucceededAt)
      );
    }
    if (value.payload.archiveOnly === true) {
      return isFiniteSyncTimestamp(value.payload.archivedAt);
    }
    return isRecord(value.payload.updateData);
  }

  if (
    value.entity === 'project_area' ||
    value.entity === 'schedule_item' ||
    value.entity === 'reference_document'
  ) {
    if (value.operation !== 'update') return false;
    if (typeof value.payload.id !== 'string' || !value.payload.id.trim()) return false;
    if (value.entity === 'project_area') return isRecord(value.payload.areaData);
    if (value.entity === 'schedule_item') return isRecord(value.payload.itemData);
    return isRecord(value.payload.documentData);
  }

  if (value.operation === 'create' || value.operation === 'delete') {
    return typeof value.payload.name === 'string' && value.payload.name.trim().length > 0;
  }
  return [value.payload.id, value.payload.name, value.payload.previousName]
    .some(item => typeof item === 'string' && item.trim().length > 0);
}

function isFiniteSyncTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

async function nextOfflineQueueQuarantineKey(): Promise<string> {
  const keys = new Set(await AsyncStorage.getAllKeys());
  const baseKey = `${SYNC_QUEUE_QUARANTINE_KEY_PREFIX}${new Date().toISOString()}`;
  let key = baseKey;
  let suffix = 1;
  while (keys.has(key)) {
    key = `${baseKey}.${suffix}`;
    suffix += 1;
  }
  return key;
}

function offlineQueueQuarantineMetadataKey(quarantineKey: string): string {
  const suffix = quarantineKey.slice(SYNC_QUEUE_QUARANTINE_KEY_PREFIX.length);
  return `${SYNC_QUEUE_QUARANTINE_METADATA_KEY_PREFIX}${suffix}`;
}

function isOfflineQueueQuarantineMetadata(
  value: unknown,
  quarantineKey: string,
): value is OfflineQueueQuarantineMetadata {
  if (!isRecord(value) || value.version !== 1) return false;
  if (value.quarantineKey !== quarantineKey) return false;
  if (
    !Array.isArray(value.salvagedItemIds) ||
    !value.salvagedItemIds.every(id => typeof id === 'string' && id.length > 0) ||
    !Array.isArray(value.restoredItemIds) ||
    !value.restoredItemIds.every(id => typeof id === 'string' && id.length > 0)
  ) return false;
  if (
    typeof value.invalidItemCount !== 'number' ||
    !Number.isInteger(value.invalidItemCount) ||
    value.invalidItemCount < 1
  ) return false;
  return value.resolvedAt === null || isFiniteSyncTimestamp(value.resolvedAt);
}

async function readOfflineQueueQuarantineMetadata(
  quarantineKey: string,
  strict = false,
): Promise<OfflineQueueQuarantineMetadata | null> {
  const rawValue = await AsyncStorage.getItem(
    offlineQueueQuarantineMetadataKey(quarantineKey),
  );
  if (rawValue === null) return null;
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (isOfflineQueueQuarantineMetadata(parsed, quarantineKey)) return parsed;
  } catch {
    // Handled by the strict recovery gate below.
  }
  if (strict) {
    throw new Error(
      'Offline queue recovery metadata is damaged. Manual restore is blocked to prevent duplicate or resurrected work.',
    );
  }
  return null;
}

function emptyArchiveOnlyRecoveryIndex(): ArchiveOnlyRecoveryIndex {
  return {
    version: 1,
    resolvedQuarantineKeys: [],
    resolvedArchiveItemIds: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function isArchiveOnlyRecoveryIndex(value: unknown): value is ArchiveOnlyRecoveryIndex {
  if (!isRecord(value) || value.version !== 1) return false;
  if (
    !Array.isArray(value.resolvedQuarantineKeys) ||
    !value.resolvedQuarantineKeys.every(key => (
      typeof key === 'string' && isOfflineQueueQuarantineKey(key)
    )) ||
    !Array.isArray(value.resolvedArchiveItemIds) ||
    !value.resolvedArchiveItemIds.every(id => typeof id === 'string' && id.trim().length > 0)
  ) return false;
  return isFiniteSyncTimestamp(value.updatedAt);
}

async function readArchiveOnlyRecoveryIndex(): Promise<ArchiveOnlyRecoveryIndex> {
  const rawValue = await AsyncStorage.getItem(SYNC_QUEUE_ARCHIVE_RECOVERY_INDEX_KEY);
  if (rawValue === null) return emptyArchiveOnlyRecoveryIndex();
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return isArchiveOnlyRecoveryIndex(parsed)
      ? parsed
      : emptyArchiveOnlyRecoveryIndex();
  } catch {
    // A damaged resolution index suppresses nothing. At worst, an idempotent
    // archive request is replayed while the exact quarantine copy stays intact.
    return emptyArchiveOnlyRecoveryIndex();
  }
}

function isArchiveOnlyProjectUpdateQueueItem(
  value: unknown,
): value is SyncQueueItem<ProjectUpdateRecordPayload> {
  if (!isValidSyncQueueItem(value)) return false;
  if (value.entity !== 'project_update' || value.operation !== 'update') return false;
  const payload = value.payload as ProjectUpdateRecordPayload;
  return (
    payload.archiveOnly === true &&
    typeof payload.id === 'string' &&
    payload.id.trim().length > 0 &&
    isFiniteSyncTimestamp(payload.archivedAt)
  );
}

async function readArchiveOnlyQuarantineCandidate(
  quarantineKey: string,
): Promise<ArchiveOnlyQuarantineCandidate | null> {
  const [metadata, rawValue] = await Promise.all([
    readOfflineQueueQuarantineMetadata(quarantineKey),
    AsyncStorage.getItem(quarantineKey),
  ]);
  if (!metadata || metadata.resolvedAt || rawValue === null) return null;

  try {
    const analysis = analyzeOfflineQueueValue(rawValue);
    const archiveItems = analysis.queue.filter(isArchiveOnlyProjectUpdateQueueItem);
    const previouslySalvagedItemIds = new Set(metadata.salvagedItemIds);
    if (
      analysis.invalidItemCount !== 0 ||
      archiveItems.length === 0 ||
      !analysis.queue.every(item => (
        isArchiveOnlyProjectUpdateQueueItem(item) ||
        previouslySalvagedItemIds.has(item.id)
      ))
    ) return null;
    return {
      quarantineKey,
      // Rows named in salvagedItemIds were already retained when the exact
      // snapshot was quarantined. Only replay the archive rows that the older
      // validator incorrectly rejected; otherwise already-synced project work
      // could be applied a second time.
      items: archiveItems,
    };
  } catch {
    return null;
  }
}

async function readArchiveOnlyQuarantineCandidates(
  quarantineKeys: readonly string[],
): Promise<ArchiveOnlyQuarantineCandidate[]> {
  const candidates: ArchiveOnlyQuarantineCandidate[] = [];
  const batchSize = 40;
  for (let index = 0; index < quarantineKeys.length; index += batchSize) {
    const batch = quarantineKeys.slice(index, index + batchSize);
    const results = await Promise.all(batch.map(readArchiveOnlyQuarantineCandidate));
    candidates.push(...results.filter(
      (candidate): candidate is ArchiveOnlyQuarantineCandidate => candidate !== null,
    ));
  }
  return candidates;
}

async function quarantineCorruptOfflineQueue(
  rawValue: string,
  salvage: OfflineQueueValueAnalysis,
): Promise<string> {
  const quarantineKey = await nextOfflineQueueQuarantineKey();
  await AsyncStorage.setItem(quarantineKey, rawValue);

  const verifiedQuarantine = await AsyncStorage.getItem(quarantineKey);
  if (verifiedQuarantine !== rawValue) {
    throw new Error('Offline queue quarantine could not be verified.');
  }

  const metadata: OfflineQueueQuarantineMetadata = {
    version: 1,
    quarantineKey,
    salvagedItemIds: salvage.queue.map(item => item.id),
    restoredItemIds: [],
    invalidItemCount: Math.max(1, salvage.invalidItemCount),
    resolvedAt: null,
  };

  const salvageValue = JSON.stringify(salvage.queue);
  await offlineQueueRecoveryTransaction.commit([
    {
      kind: 'set',
      key: offlineQueueQuarantineMetadataKey(quarantineKey),
      value: JSON.stringify(metadata),
    },
    { kind: 'set', key: SYNC_QUEUE_STORAGE_KEY, value: salvageValue },
  ]);
  const verifiedActiveQueue = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
  if (verifiedActiveQueue !== salvageValue) {
    throw new Error('Offline queue salvage write could not be verified.');
  }

  return quarantineKey;
}

async function readOfflineQueueUnsafe(): Promise<OfflineQueueReadResult> {
  // Complete a verified recovery transaction before accepting the active
  // queue. This closes the process-kill window between queue and metadata
  // writes and prevents a repaired snapshot from being replayed twice.
  await offlineQueueRecoveryTransaction.recover();
  const rawValue = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
  if (rawValue === null) {
    return { queue: [], rawValue: null, quarantineKey: null };
  }

  let analysis: OfflineQueueValueAnalysis;
  try {
    analysis = analyzeOfflineQueueValue(rawValue);
  } catch {
    analysis = { queue: [], invalidItemCount: 1 };
  }
  if (analysis.invalidItemCount === 0) {
    return { queue: analysis.queue, rawValue, quarantineKey: null };
  }

  const quarantineKey = await quarantineCorruptOfflineQueue(rawValue, analysis);
  const salvagedRawValue = JSON.stringify(analysis.queue);
  return { queue: analysis.queue, rawValue: salvagedRawValue, quarantineKey };
}

function mutateOfflineQueue<T>(
  mutator: (queue: SyncQueueItem[]) => {
    nextQueue: SyncQueueItem[];
    result: T;
    persist?: boolean;
  },
): Promise<T> {
  return serializeOfflineQueueMutation(async () => {
    const { queue } = await readOfflineQueueUnsafe();
    const mutation = mutator(queue);
    if (mutation.persist !== false) {
      await persistVerifiedOfflineQueue(mutation.nextQueue);
    }
    return mutation.result;
  });
}

async function persistVerifiedOfflineQueue(
  queue: readonly SyncQueueItem[],
): Promise<void> {
  const value = JSON.stringify(queue);
  await offlineQueueRecoveryTransaction.commit([
    { kind: 'set', key: SYNC_QUEUE_STORAGE_KEY, value },
  ]);
  offlineQueueListeners.forEach(listener => {
    try {
      listener(queue);
    } catch {
      // A screen's listener never fails a queue write.
    }
  });
}

const offlineQueueListeners = new Set<(queue: readonly SyncQueueItem[]) => void>();

/**
 * Called with the queue each time this device writes it (whole-app audit A7
 * pass 8 L2): a field update's card says when its document change is still
 * waiting to sync. The unsubscribe function.
 */
export function subscribeToOfflineQueue(listener: (queue: readonly SyncQueueItem[]) => void): () => void {
  offlineQueueListeners.add(listener);
  return () => {
    offlineQueueListeners.delete(listener);
  };
}

export async function getOfflineQueue(): Promise<SyncQueueItem[]> {
  return serializeOfflineQueueMutation(async () =>
    (await readOfflineQueueUnsafe()).queue,
  );
}

export async function listOfflineQueueQuarantines(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter(isOfflineQueueQuarantineKey).sort().reverse();
}

export async function exportOfflineQueueQuarantine(
  quarantineKey: string,
): Promise<OfflineQueueQuarantineExport | null> {
  if (!isOfflineQueueQuarantineKey(quarantineKey)) return null;
  const rawValue = await AsyncStorage.getItem(quarantineKey);
  return rawValue === null ? null : { storageKey: quarantineKey, rawValue };
}

export async function getOfflineQueueRecoveryState(): Promise<OfflineQueueRecoveryState> {
  const activeItems = (await getOfflineQueue()).length;
  const [quarantineKeys, archiveRecoveryIndex] = await Promise.all([
    listOfflineQueueQuarantines(),
    readArchiveOnlyRecoveryIndex(),
  ]);
  const archiveResolvedKeys = new Set(archiveRecoveryIndex.resolvedQuarantineKeys);
  const keysNeedingMetadata = quarantineKeys.filter(key => !archiveResolvedKeys.has(key));
  const metadata = await Promise.all(
    keysNeedingMetadata.map(key => readOfflineQueueQuarantineMetadata(key)),
  );
  const unresolvedQuarantineKeys = keysNeedingMetadata.filter(
    (_key, index) => metadata[index]?.resolvedAt == null,
  );
  return {
    activeItems,
    quarantineKeys,
    unresolvedQuarantineKeys,
    recoveryAvailable: unresolvedQuarantineKeys.length > 0,
  };
}

export async function retryOfflineQueueRecovery(
  quarantineKey: string,
  repairedRawValue?: string,
): Promise<OfflineQueueRecoveryAttempt> {
  if (!isOfflineQueueQuarantineKey(quarantineKey)) {
    return {
      status: 'not_found',
      quarantineKey,
      restoredItems: 0,
      activeItems: (await getOfflineQueue()).length,
    };
  }

  const archiveRecoveryIndex = await readArchiveOnlyRecoveryIndex();
  if (archiveRecoveryIndex.resolvedQuarantineKeys.includes(quarantineKey)) {
    return {
      status: 'already_recovered',
      quarantineKey,
      restoredItems: 0,
      activeItems: (await getOfflineQueue()).length,
    };
  }

  return serializeOfflineQueueMutation(async () => {
    await offlineQueueRecoveryTransaction.recover();
    const quarantinedRawValue = await AsyncStorage.getItem(quarantineKey);
    if (quarantinedRawValue === null) {
      const { queue } = await readOfflineQueueUnsafe();
      return {
        status: 'not_found',
        quarantineKey,
        restoredItems: 0,
        activeItems: queue.length,
      };
    }

    const metadata = await readOfflineQueueQuarantineMetadata(quarantineKey, true);
    if (metadata?.resolvedAt) {
      const { queue } = await readOfflineQueueUnsafe();
      return {
        status: 'already_recovered',
        quarantineKey,
        restoredItems: 0,
        activeItems: queue.length,
      };
    }

    let recoveredQueue: SyncQueueItem[];
    try {
      recoveredQueue = parseOfflineQueueValue(
        repairedRawValue === undefined ? quarantinedRawValue : repairedRawValue,
      );
    } catch {
      const { queue } = await readOfflineQueueUnsafe();
      return {
        status: 'still_corrupt',
        quarantineKey,
        restoredItems: 0,
        activeItems: queue.length,
      };
    }

    const { queue: activeQueue } = await readOfflineQueueUnsafe();
    if (activeQueue.length > 0) {
      return {
        status: 'active_queue_not_empty',
        quarantineKey,
        restoredItems: 0,
        activeItems: activeQueue.length,
      };
    }

    // Rows already salvaged automatically must never be restored again after
    // they have synced and left the active queue. The same protection applies
    // to a repeated manual recovery attempt.
    const previouslyRecoveredIds = new Set([
      ...(metadata?.salvagedItemIds || []),
      ...(metadata?.restoredItemIds || []),
    ]);
    const uniqueRecoveredQueue = recoveredQueue.filter(
      item => !previouslyRecoveredIds.has(item.id),
    );
    const recoveredQueueValue = JSON.stringify(uniqueRecoveredQueue);
    const resolvedMetadata: OfflineQueueQuarantineMetadata = {
      version: 1,
      quarantineKey,
      salvagedItemIds: metadata?.salvagedItemIds || [],
      restoredItemIds: [
        ...(metadata?.restoredItemIds || []),
        ...uniqueRecoveredQueue.map(item => item.id),
      ],
      invalidItemCount: Math.max(1, metadata?.invalidItemCount || 1),
      resolvedAt: new Date().toISOString(),
    };
    await offlineQueueRecoveryTransaction.commit([
      { kind: 'set', key: SYNC_QUEUE_STORAGE_KEY, value: recoveredQueueValue },
      {
        kind: 'set',
        key: offlineQueueQuarantineMetadataKey(quarantineKey),
        value: JSON.stringify(resolvedMetadata),
      },
    ]);
    const restoredRawValue = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
    if (restoredRawValue !== recoveredQueueValue) {
      throw new Error('Offline queue recovery write could not be verified.');
    }
    const restoredQueue = parseOfflineQueueValue(restoredRawValue);
    return {
      status: 'recovered',
      quarantineKey,
      restoredItems: restoredQueue.length,
      activeItems: restoredQueue.length,
    };
  });
}

async function stageMisclassifiedArchiveOnlyQuarantines(): Promise<StagedArchiveOnlyRecovery> {
  return serializeOfflineQueueMutation(async () => {
    const [{ queue }, quarantineKeys, archiveRecoveryIndex] = await Promise.all([
      readOfflineQueueUnsafe(),
      listOfflineQueueQuarantines(),
      readArchiveOnlyRecoveryIndex(),
    ]);
    const previouslyResolved = new Set(archiveRecoveryIndex.resolvedQuarantineKeys);
    const candidates = await readArchiveOnlyQuarantineCandidates(
      quarantineKeys.filter(key => !previouslyResolved.has(key)),
    );
    if (candidates.length === 0) return { eligibleQuarantines: [] };

    const newestCandidateById = new Map<
      string,
      SyncQueueItem<ProjectUpdateRecordPayload>
    >();
    candidates.forEach(candidate => {
      candidate.items.forEach(item => {
        const current = newestCandidateById.get(item.id);
        if (
          !current ||
          new Date(item.changedAt).getTime() > new Date(current.changedAt).getTime()
        ) newestCandidateById.set(item.id, item);
      });
    });

    const nextQueue = [...queue];
    const currentById = new Map(queue.map(item => [item.id, item]));
    const trackableItemIds = new Set<string>();

    newestCandidateById.forEach((candidate, itemId) => {
      const current = currentById.get(itemId);
      if (!current) {
        nextQueue.push(candidate);
        currentById.set(itemId, candidate);
        trackableItemIds.add(itemId);
        return;
      }

      if (current.entity === 'project_update' && current.operation === 'delete') {
        trackableItemIds.add(itemId);
        return;
      }

      const candidateIsNewer = (
        new Date(candidate.changedAt).getTime() > new Date(current.changedAt).getTime()
      );
      if (candidateIsNewer) {
        const currentIndex = nextQueue.findIndex(item => item.id === itemId);
        if (currentIndex >= 0) nextQueue[currentIndex] = candidate;
        currentById.set(itemId, candidate);
        trackableItemIds.add(itemId);
        return;
      }

      if (isArchiveOnlyProjectUpdateQueueItem(current)) {
        trackableItemIds.add(itemId);
      }
    });

    if (JSON.stringify(nextQueue) !== JSON.stringify(queue)) {
      await persistVerifiedOfflineQueue(nextQueue);
    }

    return {
      eligibleQuarantines: candidates
        .map(candidate => ({
          quarantineKey: candidate.quarantineKey,
          itemIds: [...new Set(candidate.items.map(item => item.id))],
        }))
        .filter(candidate => candidate.itemIds.every(id => trackableItemIds.has(id))),
    };
  });
}

async function resolveUploadedArchiveOnlyQuarantines(
  stagedRecovery: StagedArchiveOnlyRecovery,
  itemOutcomes: Readonly<Record<string, SyncItemOutcome>>,
): Promise<number> {
  if (stagedRecovery.eligibleQuarantines.length === 0) return 0;
  const uploadedItemIds = new Set(
    Object.entries(itemOutcomes)
      .filter(([, outcome]) => outcome === 'uploaded')
      .map(([itemId]) => itemId),
  );
  const resolvedQuarantines = stagedRecovery.eligibleQuarantines.filter(candidate =>
    candidate.itemIds.every(itemId => uploadedItemIds.has(itemId)),
  );
  if (resolvedQuarantines.length === 0) return 0;

  const currentIndex = await readArchiveOnlyRecoveryIndex();
  const nextIndex: ArchiveOnlyRecoveryIndex = {
    version: 1,
    resolvedQuarantineKeys: [...new Set([
      ...currentIndex.resolvedQuarantineKeys,
      ...resolvedQuarantines.map(candidate => candidate.quarantineKey),
    ])],
    resolvedArchiveItemIds: [...new Set([
      ...currentIndex.resolvedArchiveItemIds,
      ...resolvedQuarantines.flatMap(candidate => candidate.itemIds),
    ])],
    updatedAt: new Date().toISOString(),
  };
  await offlineQueueRecoveryTransaction.commit([{
    kind: 'set',
    key: SYNC_QUEUE_ARCHIVE_RECOVERY_INDEX_KEY,
    value: JSON.stringify(nextIndex),
  }]);
  return resolvedQuarantines.length;
}

export async function getSyncConflicts(): Promise<SyncConflict[]> {
  await syncConflictMutationTail;
  return readSyncConflictsUnsafe();
}

export async function reconcileSyncConflicts(): Promise<SyncConflict[]> {
  return serializeSyncConflictMutation(async () => {
    const stored = await getStoredJson<SyncConflict[]>(SYNC_CONFLICTS_STORAGE_KEY, []);
    const reconciled = normalizeSyncConflicts(stored);

    if (JSON.stringify(stored) !== JSON.stringify(reconciled)) {
      await writeSyncConflicts(reconciled);
    }

    return reconciled;
  });
}

export async function getSyncStatus(): Promise<SyncStatus> {
  // Read the queue first because that read can discover and quarantine damage.
  // The recovery state must be computed afterward so status cannot race and
  // incorrectly report that the queue is clear.
  const queue = await getOfflineQueue();
  const [conflicts, lastSyncAt, recovery] = await Promise.all([
    getSyncConflicts(),
    getStoredJson<string | null>(SYNC_LAST_RUN_STORAGE_KEY, null),
    getOfflineQueueRecoveryState(),
  ]);
  const configuration = getSupabaseConfigurationStatus();

  return {
    configured: configuration.configured,
    queuedChanges: queue.length,
    heldForConflictReview: queue.filter(item => fieldUpdateCopyHeldForReview(item, conflicts)).length,
    conflicts: conflicts.length,
    recoveryAvailable: recovery.recoveryAvailable,
    recoveryCopies: recovery.unresolvedQuarantineKeys.length,
    lastSyncAt,
    message: buildSyncStatusMessage(
      configuration,
      queue.length,
      conflicts.length,
      recovery.recoveryAvailable,
    ),
  };
}

export async function enqueuePendingChange<TPayload>(
  item: Omit<SyncQueueItem<TPayload>, 'id' | 'createdAt' | 'retryCount'> & {
    id?: string;
    createdAt?: string;
    retryCount?: number;
    autoUpload?: boolean;
    /** An item already queued under this id that stays, as returned; null to replace it. */
    keepExisting?: (existing: SyncQueueItem) => SyncQueueItem | null;
  },
): Promise<SyncQueueItem<TPayload>> {
  const createdAt = item.createdAt ?? new Date().toISOString();
  const ownerId = currentCloudOwner().ownerId;
  const queueItem: SyncQueueItem<TPayload> = {
    id: item.id ?? createQueueId(item.entity, createdAt),
    entity: item.entity,
    operation: item.operation,
    payload: item.payload,
    createdAt,
    changedAt: item.changedAt,
    retryCount: item.retryCount ?? 0,
    lastError: null,
    ...(ownerId ? { ownerId } : {}),
  };

  await mutateOfflineQueue(queue => {
    const existingDelete = queue.find(existing =>
      existing.id === queueItem.id && existing.operation === 'delete',
    );
    if (existingDelete && queueItem.operation !== 'delete') {
      return { nextQueue: queue, result: undefined, persist: false };
    }
    const existingItem = queue.find(existing => existing.id === queueItem.id);
    const kept = existingItem && item.keepExisting?.(existingItem);
    if (kept) {
      return {
        nextQueue: queue.map(existing => existing === existingItem ? kept : existing),
        result: undefined,
        persist: kept !== existingItem,
      };
    }
    const mergedQueueItem = mergeScheduleItemQueueChangeScope(
      existingItem,
      queueItem as unknown as SyncQueueItem,
    );

    return {
      nextQueue: [
        ...queue.filter(existing => (
          existing.id !== queueItem.id &&
          !sameProjectArchiveMutation(existing, mergedQueueItem)
        )),
        mergedQueueItem,
      ],
      result: undefined,
    };
  });
  if (item.autoUpload !== false) {
    requestPendingChangesUpload('queue_item_enqueued');
  }

  return queueItem;
}

function mergeScheduleItemQueueChangeScope(
  existing: SyncQueueItem | undefined,
  incoming: SyncQueueItem,
): SyncQueueItem {
  if (
    !existing ||
    existing.entity !== 'schedule_item' ||
    incoming.entity !== 'schedule_item' ||
    existing.operation !== 'update' ||
    incoming.operation !== 'update'
  ) {
    return incoming;
  }

  const existingPayload = existing.payload as ScheduleItemRecordPayload;
  const incomingPayload = incoming.payload as ScheduleItemRecordPayload;
  if (
    !Array.isArray(existingPayload.changedFields) ||
    !Array.isArray(incomingPayload.changedFields)
  ) {
    const fullRecordPayload = { ...incomingPayload };
    delete fullRecordPayload.changedFields;
    return {
      ...incoming,
      payload: fullRecordPayload,
    };
  }

  const incomingFields = new Set(incomingPayload.changedFields);
  const itemData = existingPayload.changedFields.reduce<ScheduleItem>(
    (merged, field) => {
      if (field === 'projectControls') {
        if (!existingPayload.itemData.projectControls) return merged;
        if (!merged.projectControls) {
          return {
            ...merged,
            projectControls: existingPayload.itemData.projectControls,
          };
        }
        return {
          ...merged,
          projectControls: mergeProjectControlsRevisions(
            merged.projectControls,
            existingPayload.itemData.projectControls,
          ),
        };
      }
      return incomingFields.has(field)
        ? merged
        : {
            ...merged,
            [field]: existingPayload.itemData[field],
          };
    },
    incomingPayload.itemData,
  );

  return {
    ...incoming,
    payload: {
      ...incomingPayload,
      itemData,
      changedFields: [
        ...new Set([
          ...existingPayload.changedFields,
          ...incomingPayload.changedFields,
        ]),
      ],
    },
  };
}

/**
 * Safe fire-and-forget entry point for the durable queue. The queue remains
 * authoritative on failure; errors are diagnostic-only and never escape as
 * unhandled promise rejections.
 */
export function requestPendingChangesUpload(trigger: string): void {
  if (pendingChangesRetryController.isRunning()) {
    void pendingChangesRetryController.request(trigger);
    return;
  }

  startGuardedBackgroundTask({
    key: 'offline-queue-upload',
    label: 'Pending cloud sync',
    trigger,
    maxConsecutiveRuns: 2,
    task: uploadPendingChanges,
  });
}

export async function queueProjectCreate(name: string): Promise<void> {
  await enqueuePendingChange<ProjectCreatePayload>({
    entity: 'project',
    operation: 'create',
    payload: { name },
    changedAt: new Date().toISOString(),
  });
}

export async function queueProjectUpdate(
  payload: ProjectUpdatePayload,
): Promise<void> {
  const archiveQueueId = projectArchiveQueueItemId(payload);
  await enqueuePendingChange<ProjectUpdatePayload>({
    id: archiveQueueId ?? undefined,
    entity: 'project',
    operation: 'update',
    payload,
    changedAt: new Date().toISOString(),
  });
}

function projectArchiveQueueItemId(payload: ProjectUpdatePayload): string | null {
  const projectName = normalizedProjectArchiveName(payload.previousName);
  if (typeof payload.archived !== 'boolean' || !projectName) return null;
  return `project-archive-${encodeURIComponent(projectName)}`;
}

function sameProjectArchiveMutation(
  current: SyncQueueItem,
  attempted: SyncQueueItem,
): boolean {
  if (
    current.entity !== 'project' ||
    attempted.entity !== 'project' ||
    current.operation !== 'update' ||
    attempted.operation !== 'update'
  ) return false;

  const currentPayload = current.payload as Partial<ProjectUpdatePayload>;
  const attemptedPayload = attempted.payload as Partial<ProjectUpdatePayload>;
  return (
    typeof currentPayload.archived === 'boolean' &&
    typeof attemptedPayload.archived === 'boolean' &&
    normalizedProjectArchiveName(currentPayload.previousName) ===
      normalizedProjectArchiveName(attemptedPayload.previousName) &&
    normalizedProjectArchiveName(attemptedPayload.previousName).length > 0
  );
}

function normalizedProjectArchiveName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

export async function queueProjectDelete(name: string): Promise<void> {
  await enqueuePendingChange<ProjectDeletePayload>({
    entity: 'project',
    operation: 'delete',
    payload: { name },
    changedAt: new Date().toISOString(),
  });
}

export async function queueProjectAreaRecord(area: ProjectArea): Promise<void> {
  const changedAt = area.updatedAt || area.locationCapturedAt || new Date().toISOString();
  await enqueuePendingChange<ProjectAreaRecordPayload>({
    id: `project-area-${encodeURIComponent(area.id)}`,
    entity: 'project_area',
    operation: 'update',
    payload: { id: area.id, areaData: area },
    changedAt,
  });
}

function scheduleItemQueueItemId(itemId: string): string {
  return `schedule-item-${encodeURIComponent(itemId)}`;
}

function referenceDocumentQueueItemId(documentId: string): string {
  return `reference-document-${encodeURIComponent(documentId)}`;
}

export async function queueScheduleItemRecord(
  item: ScheduleItem,
  autoUpload = true,
  changedFields?: readonly (keyof ScheduleItem)[],
): Promise<void> {
  const changedAt = item.updatedAt || item.progressConfirmedAt || new Date().toISOString();
  await enqueuePendingChange<ScheduleItemRecordPayload>({
    id: scheduleItemQueueItemId(item.id),
    entity: 'schedule_item',
    operation: 'update',
    payload: {
      id: item.id,
      itemData: item,
      ...(changedFields ? { changedFields: [...changedFields] } : {}),
    },
    changedAt,
    autoUpload,
  });
}

/**
 * Durably stage one task revision and verify that exact queue item reaches the
 * cloud. A resolved global upload is not sufficient because another upload
 * pass may already have been in flight before this revision was queued.
 */
export async function runScheduleItemCloudSync(
  item: ScheduleItem,
  changedFields?: readonly (keyof ScheduleItem)[],
): Promise<SyncUploadResult> {
  const queueItemId = scheduleItemQueueItemId(item.id);
  let effectiveChangedFields = changedFields;
  if (effectiveChangedFields === undefined) {
    const existingQueue = await getOfflineQueue();
    const existing = existingQueue.find(candidate => candidate.id === queueItemId);
    const existingPayload = existing?.payload as
      | Partial<ScheduleItemRecordPayload>
      | undefined;
    if (Array.isArray(existingPayload?.changedFields)) {
      effectiveChangedFields = existingPayload.changedFields;
    }
  }
  await queueScheduleItemRecord(item, false, effectiveChangedFields);
  let aggregateResult = await uploadPendingChanges();
  let remainingQueue = await getOfflineQueue();
  let remainingItem = remainingQueue.find(candidate => candidate.id === queueItemId);

  // Task edits are metadata-only and idempotent. Give the exact revision one
  // bounded follow-up pass when it was missed by an older in-flight snapshot
  // or when the first handled attempt left it queued.
  if (
    remainingItem &&
    (!aggregateResult.itemOutcomes?.[queueItemId] ||
      aggregateResult.itemOutcomes[queueItemId] === 'uploaded')
  ) {
    aggregateResult = await uploadPendingChanges();
    remainingQueue = await getOfflineQueue();
    remainingItem = remainingQueue.find(candidate => candidate.id === queueItemId);
  }

  const conflicts = await getSyncConflicts();
  const currentConflict = conflicts.find(
    conflict => conflict.entity === 'schedule_item' && conflict.localId === item.id,
  );
  const itemOutcome = aggregateResult.itemOutcomes?.[queueItemId];
  const itemSucceeded =
    itemOutcome === 'uploaded' && !remainingItem && !currentConflict;
  const itemErrors = remainingItem?.lastError
    ? [formatQueueItemFailure(remainingItem, remainingItem.lastError)]
    : currentConflict
      ? [`Task “${item.taskName || 'Unnamed Task'}” has a cloud conflict that needs review.`]
      : !aggregateResult.configured
        ? [...aggregateResult.errors]
        : itemOutcome === 'failed'
          ? [`Task “${item.taskName || 'Unnamed Task'}” could not sync.`]
          : [];

  return {
    configured: aggregateResult.configured,
    uploaded: itemSucceeded ? 1 : 0,
    uploadedByEntity: itemSucceeded ? { schedule_item: 1 } : {},
    itemOutcomes: itemOutcome ? { [queueItemId]: itemOutcome } : {},
    queued: remainingItem ? 1 : 0,
    conflicts: currentConflict ? 1 : 0,
    errors: itemErrors,
    ...(remainingItem && projectOpeningStillQueued(remainingQueue, item.projectName)
      ? { projectStillUploading: true }
      : {}),
  };
}

/**
 * Whether this phone's own create or reopen of the named project is still
 * queued. Tasks are sent ahead of project changes, so until it lands the
 * cloud answers that the task's project is not open (whole-app audit A3
 * pass 7 L1). The queue keys both by name: a create by its name, a reopen by
 * the name it had. A close, or another account's change, does not count.
 */
function projectOpeningStillQueued(
  queue: readonly SyncQueueItem[],
  projectName: string | null | undefined,
): boolean {
  const key = normalizedProjectArchiveName(projectName);
  if (!key) return false;
  const owner = currentCloudOwner();
  return queue.some(candidate => {
    if (candidate.entity !== 'project' || heldForAnotherOwner(candidate.ownerId, owner)) return false;
    const payload = (candidate.payload || {}) as Partial<ProjectCreatePayload & ProjectUpdatePayload>;
    if (candidate.operation === 'create') return normalizedProjectArchiveName(payload.name) === key;
    return candidate.operation === 'update' && payload.archived === false &&
      normalizedProjectArchiveName(payload.previousName) === key;
  });
}

export async function queueReferenceDocumentRecord(
  document: ReferenceDocument,
  autoUpload = true,
): Promise<void> {
  const changedAt = document.updatedAt || document.importedAt || new Date().toISOString();
  await enqueuePendingChange<ReferenceDocumentRecordPayload>({
    id: referenceDocumentQueueItemId(document.id),
    entity: 'reference_document',
    operation: 'update',
    payload: { id: document.id, documentData: compactECOSDocumentIndexForCloud(document) },
    changedAt,
    autoUpload,
  });
}

/**
 * The shared details this phone last put in the cloud for each document, this
 * launch: its own upload counts as seen before its echo comes back (whole-app
 * audit A7 pass 6 L1).
 */
const referenceDocumentDetailsSent = new Map<string, string>();

/**
 * After this phone's Make Current: each phone edit still queued that the
 * activation's stamp now outranks (text typed just before it, whose upload
 * starts after the activation call) is queued again, stamped after the
 * activation and carrying the cloud's current flags, so it reaches the
 * other devices and a stale copy never undoes the activation. Returns the
 * documents queued again, for this phone's list (whole-app audit A8 pass 3
 * M2). Another account's queued work is left alone.
 */
export async function requeueReferenceDocumentEditsOutlivingActivation(
  cloudDocuments: readonly ReferenceDocument[],
): Promise<ReferenceDocument[]> {
  const owner = currentCloudOwner();
  const cloudById = new Map(cloudDocuments.map(document => [document.id, document]));
  const kept = (await getOfflineQueue()).flatMap(item => {
    if (item.entity !== 'reference_document' || item.operation === 'delete' || heldForAnotherOwner(item.ownerId, owner)) return [];
    const local = (item.payload as Partial<ReferenceDocumentRecordPayload>)?.documentData;
    const cloud = local ? cloudById.get(local.id) : undefined;
    const edit = local && cloud
      ? referenceDocumentEditOutlivingActivation(local, cloud, Date.now(), referenceDocumentDetailsSent.get(local.id)) : null;
    return edit && cloud ? mergeDAVEReferenceDocumentRecoveryRecords({ local: [edit], cloud: [cloud] }) : [];
  });
  await Promise.all(kept.map(document => queueReferenceDocumentRecord(document)));
  return kept;
}

/**
 * Durably stage an approved schedule import, then verify the exact task and
 * document revisions rather than trusting aggregate queue totals. A global
 * upload may already be in flight with an older queue snapshot, so one bounded
 * follow-up pass is allowed only when one of these exact revisions appears to
 * have been missed by that snapshot.
 */
export async function runScheduleImportCloudSync(input: {
  scheduleItems: readonly ScheduleItem[];
  referenceDocuments: readonly ReferenceDocument[];
}): Promise<ScheduleImportCloudSyncResult> {
  const scheduleItems = uniqueRecordsById(input.scheduleItems);
  const referenceDocuments = uniqueRecordsById(input.referenceDocuments);
  const scheduleQueueIds = new Map(
    scheduleItems.map(item => [scheduleItemQueueItemId(item.id), item]),
  );
  const documentQueueIds = new Map(
    referenceDocuments.map(document => [
      referenceDocumentQueueItemId(document.id),
      document,
    ]),
  );
  const requestedQueueIds = new Set([
    ...scheduleQueueIds.keys(),
    ...documentQueueIds.keys(),
  ]);
  const configuration = getSupabaseConfigurationStatus();

  if (requestedQueueIds.size === 0) {
    return {
      configured: configuration.configured,
      uploaded: 0,
      uploadedByEntity: {},
      itemOutcomes: {},
      queued: 0,
      conflicts: 0,
      errors: [],
      durablyQueued: true,
      fullySynced: true,
      supersededScheduleItemIds: [],
      supersededReferenceDocumentIds: [],
    };
  }

  let tombstoneSync: DAVESyncTombstoneSyncResult;
  try {
    tombstoneSync = await synchronizeDAVESyncTombstones();
  } catch {
    return {
      configured: configuration.configured,
      uploaded: 0,
      uploadedByEntity: {},
      itemOutcomes: {},
      queued: requestedQueueIds.size,
      conflicts: 0,
      errors: [
        'The approved schedule could not be protected because deletion history is unavailable.',
      ],
      durablyQueued: false,
      fullySynced: false,
      supersededScheduleItemIds: [],
      supersededReferenceDocumentIds: [],
    };
  }

  let staged: ScheduleImportQueueStageResult;
  try {
    staged = await stageScheduleImportQueue({
      scheduleItems,
      referenceDocuments,
      tombstones: tombstoneSync.tombstones,
    });
  } catch {
    return {
      configured: configuration.configured,
      uploaded: 0,
      uploadedByEntity: {},
      itemOutcomes: {},
      queued: requestedQueueIds.size,
      conflicts: 0,
      errors: [
        'The approved schedule could not be protected in the local sync queue.',
      ],
      durablyQueued: false,
      fullySynced: false,
      supersededScheduleItemIds: [],
      supersededReferenceDocumentIds: [],
    };
  }

  const exactQueueIds = new Set(staged.acceptedQueueIds);
  const stagedQueue = await getOfflineQueue();
  const durablyQueued = staged.acceptedRevisions.every(expected =>
    stagedQueue.some(current => sameQueueRevision(current, expected)),
  );
  if (!durablyQueued) {
    const missingCount = staged.acceptedRevisions
      .filter(expected =>
        !stagedQueue.some(current => sameQueueRevision(current, expected)),
      )
      .length;
    return {
      configured: configuration.configured,
      uploaded: 0,
      uploadedByEntity: {},
      itemOutcomes: {},
      queued: missingCount,
      conflicts: 0,
      errors: [
        'The approved schedule could not be fully verified in the local sync queue.',
      ],
      durablyQueued: false,
      fullySynced: false,
      supersededScheduleItemIds: staged.supersededScheduleItemIds,
      supersededReferenceDocumentIds:
        staged.supersededReferenceDocumentIds,
    };
  }

  const exactOutcomes: Record<string, SyncItemOutcome> = Object.fromEntries([
    ...staged.supersededScheduleItemIds.map(id => [
      scheduleItemQueueItemId(id),
      'superseded' as const,
    ]),
    ...staged.supersededReferenceDocumentIds.map(id => [
      referenceDocumentQueueItemId(id),
      'superseded' as const,
    ]),
  ]);

  if (exactQueueIds.size === 0) {
    const errors = exactScheduleImportSyncErrors({
      configured: configuration.configured,
      aggregateErrors: [],
      exactRemaining: [],
      exactConflicts: [],
      exactOutcomes,
      exactQueueIds: requestedQueueIds,
      scheduleQueueIds,
      documentQueueIds,
    });
    return {
      configured: configuration.configured,
      uploaded: 0,
      uploadedByEntity: {},
      itemOutcomes: exactOutcomes,
      queued: 0,
      conflicts: 0,
      errors,
      durablyQueued: true,
      fullySynced: false,
      supersededScheduleItemIds: staged.supersededScheduleItemIds,
      supersededReferenceDocumentIds:
        staged.supersededReferenceDocumentIds,
    };
  }

  let upload = await uploadPendingChanges();
  const uploadedReferenceDocuments = new Map<string, ReferenceDocument>();
  mergeUploadedReferenceDocuments(
    uploadedReferenceDocuments,
    upload.uploadedReferenceDocuments,
    documentIdsForQueueIds(exactQueueIds, documentQueueIds),
  );
  mergeExactItemOutcomes(exactOutcomes, upload.itemOutcomes, exactQueueIds);
  let remainingQueue = await getOfflineQueue();
  let exactRemaining = remainingQueue.filter(item => exactQueueIds.has(item.id));

  if (
    exactRemaining.some(item => {
      const outcome = exactOutcomes[item.id];
      return !outcome || outcome === 'uploaded';
    })
  ) {
    upload = await uploadPendingChanges();
    mergeUploadedReferenceDocuments(
      uploadedReferenceDocuments,
      upload.uploadedReferenceDocuments,
      documentIdsForQueueIds(exactQueueIds, documentQueueIds),
    );
    mergeExactItemOutcomes(exactOutcomes, upload.itemOutcomes, exactQueueIds);
    remainingQueue = await getOfflineQueue();
    exactRemaining = remainingQueue.filter(item => exactQueueIds.has(item.id));
  }

  const scheduleIds = new Set(
    [...exactQueueIds]
      .map(id => scheduleQueueIds.get(id)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const documentIds = documentIdsForQueueIds(
    exactQueueIds,
    documentQueueIds,
  );
  const exactConflicts = (await getSyncConflicts()).filter(conflict => (
    (conflict.entity === 'schedule_item' && scheduleIds.has(conflict.localId)) ||
    (conflict.entity === 'reference_document' && documentIds.has(conflict.localId))
  ));
  const remainingIds = new Set(exactRemaining.map(item => item.id));
  const conflictedQueueIds = new Set(exactConflicts.map(conflict =>
    conflict.entity === 'schedule_item'
      ? scheduleItemQueueItemId(conflict.localId)
      : referenceDocumentQueueItemId(conflict.localId),
  ));
  const uploadedIds = [...exactQueueIds].filter(id => (
    exactOutcomes[id] === 'uploaded' &&
    !remainingIds.has(id) &&
    !conflictedQueueIds.has(id)
  ));
  const errors = exactScheduleImportSyncErrors({
    configured: upload.configured,
    aggregateErrors: upload.errors,
    exactRemaining,
    exactConflicts,
    exactOutcomes,
    exactQueueIds: requestedQueueIds,
    scheduleQueueIds,
    documentQueueIds,
  });
  const uploadedScheduleCount = uploadedIds
    .filter(id => scheduleQueueIds.has(id))
    .length;
  const uploadedDocumentCount = uploadedIds
    .filter(id => documentQueueIds.has(id))
    .length;
  const uploadSupersededScheduleItemIds = [...exactQueueIds]
    .filter(id => (
      exactOutcomes[id] === 'superseded' &&
      scheduleQueueIds.has(id)
    ))
    .map(id => scheduleQueueIds.get(id)?.id)
    .filter((id): id is string => Boolean(id));
  const uploadSupersededReferenceDocumentIds = [...exactQueueIds]
    .filter(id => (
      exactOutcomes[id] === 'superseded' &&
      documentQueueIds.has(id)
    ))
    .map(id => documentQueueIds.get(id)?.id)
    .filter((id): id is string => Boolean(id));
  const supersededScheduleItemIds = uniqueStrings([
    ...staged.supersededScheduleItemIds,
    ...uploadSupersededScheduleItemIds,
  ]);
  const supersededReferenceDocumentIds = uniqueStrings([
    ...staged.supersededReferenceDocumentIds,
    ...uploadSupersededReferenceDocumentIds,
  ]);
  const fullySynced = (
    durablyQueued &&
    uploadedIds.length === exactQueueIds.size &&
    exactRemaining.length === 0 &&
    exactConflicts.length === 0 &&
    supersededScheduleItemIds.length === 0 &&
    supersededReferenceDocumentIds.length === 0
  );

  return {
    configured: upload.configured,
    uploaded: uploadedIds.length,
    uploadedByEntity: {
      ...(uploadedScheduleCount > 0
        ? { schedule_item: uploadedScheduleCount }
        : {}),
      ...(uploadedDocumentCount > 0
        ? { reference_document: uploadedDocumentCount }
        : {}),
    },
    uploadedReferenceDocuments: [...uploadedReferenceDocuments.values()],
    itemOutcomes: exactOutcomes,
    queued: exactRemaining.length,
    conflicts: exactConflicts.length,
    errors,
    durablyQueued,
    fullySynced,
    supersededScheduleItemIds,
    supersededReferenceDocumentIds,
  };
}

function documentIdsForQueueIds(
  queueIds: ReadonlySet<string>,
  documentQueueIds: ReadonlyMap<string, ReferenceDocument>,
): Set<string> {
  return new Set(
    [...queueIds]
      .map(id => documentQueueIds.get(id)?.id)
      .filter((id): id is string => Boolean(id)),
  );
}

function mergeUploadedReferenceDocuments(
  target: Map<string, ReferenceDocument>,
  source: readonly ReferenceDocument[] | undefined,
  exactDocumentIds: ReadonlySet<string>,
): void {
  source?.forEach(document => {
    if (exactDocumentIds.has(document.id)) target.set(document.id, document);
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

type ScheduleImportQueueStageResult = {
  acceptedQueueIds: string[];
  acceptedRevisions: SyncQueueItem[];
  supersededScheduleItemIds: string[];
  supersededReferenceDocumentIds: string[];
};

async function stageScheduleImportQueue(input: {
  scheduleItems: readonly ScheduleItem[];
  referenceDocuments: readonly ReferenceDocument[];
  tombstones: readonly DAVESyncTombstone[];
}): Promise<ScheduleImportQueueStageResult> {
  const createdAt = new Date().toISOString();
  const candidates: SyncQueueItem[] = [
    ...input.scheduleItems.map(item => ({
      id: scheduleItemQueueItemId(item.id),
      entity: 'schedule_item' as const,
      operation: 'update' as const,
      payload: {
        id: item.id,
        itemData: item,
      } satisfies ScheduleItemRecordPayload,
      createdAt,
      changedAt: validSyncTimestampOrFallback(
        item.updatedAt || item.progressConfirmedAt,
        createdAt,
      ),
      retryCount: 0,
      lastError: null,
    })),
    ...input.referenceDocuments.map(document => ({
      id: referenceDocumentQueueItemId(document.id),
      entity: 'reference_document' as const,
      operation: 'update' as const,
      payload: {
        id: document.id,
        documentData: document,
      } satisfies ReferenceDocumentRecordPayload,
      createdAt,
      changedAt: validSyncTimestampOrFallback(
        document.updatedAt || document.importedAt,
        createdAt,
      ),
      retryCount: 0,
      lastError: null,
    })),
  ];

  return mutateOfflineQueue(queue => {
    let nextQueue = [...queue];
    const result: ScheduleImportQueueStageResult = {
      acceptedQueueIds: [],
      acceptedRevisions: [],
      supersededScheduleItemIds: [],
      supersededReferenceDocumentIds: [],
    };

    candidates.forEach(candidate => {
      const protectedByDelete = nextQueue.some(existing =>
        queuedDeleteProtectsRecord(existing, candidate),
      );
      if (
        protectedByDelete ||
        queueItemMatchesDAVESyncTombstone(candidate, input.tombstones)
      ) {
        const payload = candidate.payload as { id: string };
        if (candidate.entity === 'schedule_item') {
          result.supersededScheduleItemIds.push(payload.id);
        } else {
          result.supersededReferenceDocumentIds.push(payload.id);
        }
        return;
      }

      const existingItem = nextQueue.find(existing =>
        existing.id === candidate.id,
      );
      const mergedCandidate = mergeScheduleItemQueueChangeScope(
        existingItem,
        candidate,
      );
      nextQueue = [
        ...nextQueue.filter(existing => existing.id !== candidate.id),
        mergedCandidate,
      ];
      result.acceptedQueueIds.push(candidate.id);
      result.acceptedRevisions.push(mergedCandidate);
    });

    return {
      nextQueue,
      result,
      persist: result.acceptedQueueIds.length > 0,
    };
  });
}

function queuedDeleteProtectsRecord(
  existing: SyncQueueItem,
  incoming: SyncQueueItem,
): boolean {
  if (
    existing.operation !== 'delete' ||
    existing.entity !== incoming.entity
  ) return false;
  if (existing.id === incoming.id) return true;

  const existingPayload = existing.payload as { id?: unknown };
  const incomingPayload = incoming.payload as { id?: unknown };
  return (
    typeof existingPayload.id === 'string' &&
    typeof incomingPayload.id === 'string' &&
    existingPayload.id.trim().toLowerCase() ===
      incomingPayload.id.trim().toLowerCase()
  );
}

function validSyncTimestampOrFallback(
  value: string | null | undefined,
  fallback: string,
): string {
  return isFiniteSyncTimestamp(value) ? value : fallback;
}

function uniqueRecordsById<T extends { id: string }>(
  records: readonly T[],
): T[] {
  return [...new Map(records.map(record => [record.id, record])).values()];
}

function mergeExactItemOutcomes(
  target: Record<string, SyncItemOutcome>,
  source: Record<string, SyncItemOutcome> | undefined,
  exactQueueIds: ReadonlySet<string>,
): void {
  if (!source) return;
  Object.entries(source).forEach(([id, outcome]) => {
    if (exactQueueIds.has(id)) target[id] = outcome;
  });
}

function exactScheduleImportSyncErrors(input: {
  configured: boolean;
  aggregateErrors: readonly string[];
  exactRemaining: readonly SyncQueueItem[];
  exactConflicts: readonly SyncConflict[];
  exactOutcomes: Readonly<Record<string, SyncItemOutcome>>;
  exactQueueIds: ReadonlySet<string>;
  scheduleQueueIds: ReadonlyMap<string, ScheduleItem>;
  documentQueueIds: ReadonlyMap<string, ReferenceDocument>;
}): string[] {
  const errors: string[] = [];
  input.exactRemaining.forEach(item => {
    if (item.lastError) {
      errors.push(formatQueueItemFailure(item, item.lastError));
    }
  });
  input.exactConflicts.forEach(conflict => {
    errors.push(
      conflict.entity === 'schedule_item'
        ? 'An imported task has a cloud conflict that needs review.'
        : 'An imported schedule document has a cloud conflict that needs review.',
    );
  });
  input.exactQueueIds.forEach(id => {
    const outcome = input.exactOutcomes[id];
    if (outcome === 'superseded') {
      errors.push(
        input.scheduleQueueIds.has(id)
          ? 'An imported task was not added: it was deleted earlier, and its protected deletion marker keeps it deleted.'
          : 'An imported schedule document was not added: it was deleted earlier, and its protected deletion marker keeps it deleted.',
      );
    } else if (outcome === 'failed' && !input.exactRemaining.some(item => item.id === id)) {
      const scheduleItem = input.scheduleQueueIds.get(id);
      const document = input.documentQueueIds.get(id);
      errors.push(
        scheduleItem
          ? `Task “${scheduleItem.taskName || 'Unnamed Task'}” could not sync.`
          : `Document “${document?.name || 'Unnamed Document'}” could not sync.`,
      );
    }
  });
  if (!input.configured && errors.length === 0) {
    errors.push(
      input.aggregateErrors[0] ||
        'Cloud sync is not configured. The approved schedule remains saved on this device.',
    );
  }
  return [...new Set(errors)];
}

export async function removeOperationalRecordFromSyncQueue(
  entity: 'project_area' | 'schedule_item' | 'reference_document',
  recordId: string,
): Promise<number> {
  const queueId = entity === 'project_area'
    ? `project-area-${encodeURIComponent(recordId)}`
    : entity === 'schedule_item'
      ? `schedule-item-${encodeURIComponent(recordId)}`
      : `reference-document-${encodeURIComponent(recordId)}`;
  return mutateOfflineQueue(queue => {
    const nextQueue = queue.filter(item => item.id !== queueId);
    return {
      nextQueue,
      result: queue.length - nextQueue.length,
      persist: nextQueue.length !== queue.length,
    };
  });
}

export async function queueProjectUpdateRecord<TUpdate extends {
  id: string;
  projectId?: string | null;
  projectName?: string;
  selectedAreaName?: string | null;
  photos?: Array<{ id: string }>;
}>(
  update: TUpdate,
  autoUpload = true,
): Promise<void> {
  await persistProjectUpdateRecord(
    update,
    autoUpload,
    update.photos?.map(photo => photo.id) || [],
  );
}

/**
 * A change to one document of a sent field update, queued as a patch on the
 * cloud's copy (whole-app audit A7 pass 6 M1): `update` is this device's copy
 * with the change made, sent whole only when the cloud has no copy. Added to
 * this device's own edit when one is waiting. A document taken off is kept in
 * this device's journal: an older copy sent later by the iPad does not put it
 * back. The whole copy of an update not yet sent waits for its photos, as its
 * own sync does (A4 pass 9 L2): it went up listing photos nothing uploaded.
 *
 * An update still owing its own sync ("Waiting to Sync" or failed, not in
 * conflict) with no record of its own queued goes up whole, with the change,
 * waiting for its photos (A7 pass 8 L1): its edit's queue write was lost, and
 * the patch, once landed, stood for that edit, which was never sent. An
 * update in conflict keeps its copy for review: only the patch goes up.
 *
 * That status can be stale (A7 pass 9 L1): the update's own record went up in
 * a background pass whose echo was ignored, or Keep Phone wrote it. When the
 * copy this device last put in the cloud, or the copy a waiting patch was
 * made on, with this change is this copy, the update owes nothing more: only
 * the patch goes up, as for a sent update. Sending the whole copy, stamped
 * now, put the phone's older note over the iPad's newer one.
 */
export async function queueProjectUpdateDocumentChange<TUpdate extends PatchedProjectUpdate>(
  update: TUpdate,
  documentId: string,
): Promise<void> {
  await queueProjectUpdatePatch(update, fieldUpdateDocumentPatchFor(update, documentId));
}

/**
 * A photo analysis result that finished after the update was saved (`before`
 * is the update without it), queued as a patch on the cloud's copy, under
 * the same rules as a document change (whole-app audit A4 pass 13 G1;
 * FieldUpdatePhotoAnalysisPatch). A sent update stays sent and only the
 * result goes up: its whole copy, queued again stamped now, went over a
 * newer iPad edit of the note. An edit still waiting on this phone takes the
 * result in its own queued copy, which keeps the time David saved it.
 */
export async function queueProjectUpdatePhotoAnalysis<TUpdate extends PatchedProjectUpdate>(
  update: TUpdate,
  photoId: string,
  before: object,
): Promise<void> {
  await queueProjectUpdatePatch(update, fieldUpdatePhotoAnalysisPatchFor(before, update, photoId));
}

type PatchedProjectUpdate = {
  id: string;
  projectId?: string | null;
  projectName?: string;
  selectedAreaName?: string | null;
  status?: string;
  photos?: ReadonlyArray<{ id: string }>;
  documents?: ReadonlyArray<{ id: string }> | null;
};

async function queueProjectUpdatePatch(update: PatchedProjectUpdate, patch: FieldUpdateDocumentPatch): Promise<void> {
  const lastInCloud = projectUpdateLastVersionInCloud.get(update.id); // read before it goes (A7 pass 9 L1)
  projectUpdateLastVersionInCloud.delete(update.id);
  if (await hasProjectUpdateDeletionIntent(update.id)) return;
  if (!isFieldUpdatePhotoAnalysisPatch(patch) && patch.remove) {
    await recordRemovedFieldUpdateDocument(update.id, patch.documentId).catch(() => undefined);
  }
  const inCloudButForThisChange = fieldUpdateOwesNothingBeyond(lastInCloud, [patch], update);
  const conflicts = await getSyncConflicts();
  const inConflict = Boolean(openFieldUpdateConflict(conflicts, update.id));
  const mayOweOwnSync = fieldUpdateOwesOwnSync(update.status) && !inCloudButForThisChange && !inConflict;
  // A late analysis result is the phone's copy's too, in a conflict (whole-
  // app audit A4 pass 14 #4): Keep Phone sends the copy recorded with the
  // conflict, and undid the result once its patch had gone up. A document
  // change is already taken in at the choice (withDocumentChangesSinceConflict).
  if (inConflict && isFieldUpdatePhotoAnalysisPatch(patch)) await addResultToConflictCopy(update.id, patch);
  const queueId = projectUpdateQueueItemId(update.id);
  const now = new Date().toISOString();
  const ownerId = currentCloudOwner().ownerId;
  await mutateOfflineQueue(queue => {
    const existing = queue.find(item => item.id === queueId);
    const existingPayload = existing?.payload as ProjectUpdateRecordPayload | undefined;
    if (existing && (existing.operation === 'delete' || existingPayload?.archiveOnly)) {
      return { nextQueue: queue, result: undefined, persist: false };
    }
    const waitingPatches = queuedFieldUpdateDocumentPatches(existing);
    const owesOwnSync = mayOweOwnSync &&
      !(waitingPatches && fieldUpdateOwesNothingBeyond(existingPayload?.updateData, [patch], update));
    const photoIds = uniquePhotoAssetIds((update.photos || []).map(photo => photo.id));
    const withChange = (item: SyncQueueItem): SyncQueueItem => ({ ...item, payload: {
      ...(item.payload as ProjectUpdateRecordPayload),
      updateData: applyFieldUpdateDocumentPatches((item.payload as ProjectUpdateRecordPayload).updateData as object, [patch]),
    } });
    // An edit held for conflict review (whole-app audit A7 pass 14 L-2)
    // takes a late analysis result too, but the result also goes onto the
    // cloud's copy now, as it does with nothing held: taken only into the
    // held edit, it never reached the iPad while the conflict was open, and
    // Keep Cloud, which withdraws that edit, lost it. The patch carries the
    // held edit (newerEdit), which is queued again, as it was, once the
    // patch lands (newerEditQueuedAfter). A later change goes into both.
    const heldForReview = existing && !waitingPatches && existingPayload?.updateData &&
      isFieldUpdatePhotoAnalysisPatch(patch) && fieldUpdateCopyHeldForReview(existing, conflicts) ? existing : null;
    const carried = heldForReview ?? (waitingPatches && isRecord(existingPayload?.newerEdit) ? existingPayload!.newerEdit : null);
    const next: SyncQueueItem = existing && !waitingPatches && existingPayload?.updateData && !heldForReview
      ? withChange(existing)
      : {
          id: queueId, entity: 'project_update', operation: 'update', createdAt: now, changedAt: now, retryCount: 0, lastError: null,
          payload: {
            id: update.id, projectId: update.projectId, projectName: update.projectName, selectedAreaName: update.selectedAreaName,
            updateData: update,
            ...(owesOwnSync ? { pendingPhotoAssetIds: photoIds } : {
              documentPatches: mergeFieldUpdateDocumentPatches(waitingPatches || [], patch),
              pendingPhotoAssetIds: update.status === 'sent' ? []
                : waitingPatches ? existingPayload?.pendingPhotoAssetIds || [] : photoIds,
            }),
            ...(carried ? { newerEdit: withChange(carried) } : {}),
          },
          ...(ownerId ? { ownerId } : {}),
        };
    return { nextQueue: [...queue.filter(item => item.id !== queueId), next], result: undefined };
  });
}

/** The phone's copy recorded with an update's conflict, with this analysis result (A4 pass 14 #4). */
async function addResultToConflictCopy(updateId: string, patch: FieldUpdatePhotoAnalysisPatch): Promise<void> {
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    let changed = false;
    const next = conflicts.map(conflict => {
      const local = conflict.localPayload as Partial<ProjectUpdateRecordPayload> | undefined;
      if (conflict.entity !== 'project_update' || conflict.localId !== updateId || !isRecord(local?.updateData)) return conflict;
      const updateData = applyFieldUpdatePhotoAnalysisPatch(local!.updateData as object, patch);
      if (updateData === local!.updateData) return conflict;
      changed = true;
      return { ...conflict, localPayload: { ...local, updateData } };
    });
    if (changed) await writeSyncConflicts(next);
  });
}

const removedDocumentsRequeuedThisLaunch = new Set<string>();

/**
 * Takes off the cloud copy, again, a document this device took off an
 * update, when a cloud copy lists it once more: the iPad sent its own older
 * copy (whole-app audit A7 pass 6 M1). Once per document per launch. The
 * number queued.
 */
export async function requeueRemovedFieldUpdateDocuments(
  cloudUpdates: readonly object[],
  localUpdates: readonly object[],
  removed: RemovedFieldUpdateDocuments,
): Promise<number> {
  if (removed.size === 0) return 0;
  const localById = new Map(localUpdates.map(update => [(update as { id: string }).id, update]));
  const due = cloudUpdates.flatMap(cloudUpdate => {
    const { id, isArchived, documents } = cloudUpdate as { id: string; isArchived?: boolean; documents?: Array<{ id: string }> };
    const local = localById.get(id);
    if (!local || isArchived || !Array.isArray(documents)) return [];
    return documents
      .map(document => removedFieldUpdateDocumentKey(id, document.id))
      .filter(key => removed.has(key) && !removedDocumentsRequeuedThisLaunch.has(key))
      .map(key => ({ key, local, documentId: key.slice(id.length + 1) }));
  });
  for (const { key, local, documentId } of due) {
    removedDocumentsRequeuedThisLaunch.add(key);
    await queueProjectUpdateDocumentChange(local as { id: string }, documentId);
  }
  return due.length;
}

export async function queueProjectUpdateDelete(update: {
  id: string;
  projectName?: string;
}): Promise<void> {
  const updateId = update.id.trim();
  if (!updateId) return;

  const intent = await recordProjectUpdateDeletionIntent(update);
  if (intent.cloudDeleteConfirmedAt) return;
  await enqueuePendingChange<ProjectUpdateDeletePayload>({
    id: projectUpdateQueueItemId(updateId),
    entity: 'project_update',
    operation: 'delete',
    payload: {
      id: updateId,
      projectName: update.projectName,
    },
    changedAt: new Date().toISOString(),
  });
}

export async function queueProjectUpdateArchive(
  updateId: string,
  archivedAt: string,
): Promise<void> {
  if (!updateId.trim()) return;
  await enqueuePendingChange<ProjectUpdateRecordPayload>({
    id: projectUpdateQueueItemId(updateId),
    entity: 'project_update',
    operation: 'update',
    payload: { id: updateId, updateData: undefined, archiveOnly: true, archivedAt },
    changedAt: archivedAt,
  });
}

async function persistProjectUpdateRecord<TUpdate extends {
  id: string;
  projectId?: string | null;
  projectName?: string;
  selectedAreaName?: string | null;
}>(
  update: TUpdate,
  autoUpload: boolean,
  pendingPhotoAssetIds: readonly string[],
) {
  projectUpdateLastVersionInCloud.delete(update.id); // a new version to send (A7 pass 7 M1)
  if (await hasProjectUpdateDeletionIntent(update.id)) return;
  const pendingPhotos = uniquePhotoAssetIds(pendingPhotoAssetIds);
  await enqueuePendingChange<ProjectUpdateRecordPayload<TUpdate>>({
    id: projectUpdateQueueItemId(update.id),
    entity: 'project_update',
    operation: 'update',
    payload: {
      id: update.id,
      projectId: update.projectId,
      projectName: update.projectName,
      selectedAreaName: update.selectedAreaName,
      updateData: update,
      pendingPhotoAssetIds: pendingPhotos,
    },
    changedAt: new Date().toISOString(),
    autoUpload,
  });
}

function projectUpdateQueueItemId(updateId: string) {
  return `project-update-${updateId}`;
}

/**
 * A sync attempt's own write of the update's queue record (whole-app audit
 * A7 pass 7 M1). A sync attempt is not an edit:
 * - a waiting document patch stays a patch on the cloud's copy; its photos
 *   are this attempt's, for the whole-copy fallback (A7 pass 6 M1);
 * - with nothing queued, and this copy (its documents' upload state aside)
 *   the one this device last put in the cloud (`lastVersionInCloud`),
 *   nothing is written. Once a document patch had landed, the attempt sent
 *   this device's whole, older copy again, stamped now, over the iPad's
 *   newer note;
 * - the attempt's second write (`replacing`, what its first write left)
 *   replaces only that record. One uploaded meanwhile is not queued again,
 *   whole; a newer record written meanwhile (a late photo-analysis result)
 *   stays.
 * - a waiting patch stays only while this copy owes nothing beyond it: it
 *   reads sent, or it is the patch's copy, a Retry's stamps aside (A7 pass
 *   8 L1; the same test as a document change makes, A7 pass 9 L1). Otherwise
 *   this copy goes up whole: an edit whose queue write was lost after the
 *   document change was never sent.
 * - a whole copy keeps the time David saved it (A4 pass 13 M1; see
 *   queuedEditSavedAt), unless David chose to send it over a conflict (a
 *   Retry he confirmed): `overConflict`, that conflict's id, which the copy
 *   carries so the upload pass sends it (A4 pass 15 H1). Such a copy goes up
 *   whole, a waiting patch with it: "Send your version over it".
 * The item left in the queue; null when nothing was written.
 */
async function writeStagedProjectUpdateRecord(
  update: ProjectUpdate,
  pendingPhotoAssetIds: readonly string[],
  { lastVersionInCloud = false, replacing, overConflict }: {
    lastVersionInCloud?: boolean; replacing?: SyncQueueItem | null; overConflict?: string;
  },
): Promise<SyncQueueItem | null> {
  if (await hasProjectUpdateDeletionIntent(update.id)) return null;
  const id = projectUpdateQueueItemId(update.id);
  const pending = uniquePhotoAssetIds(pendingPhotoAssetIds);
  const now = new Date().toISOString();
  const ownerId = currentCloudOwner().ownerId;
  return mutateOfflineQueue(queue => {
    const existing = queue.find(item => item.id === id);
    const unchanged = { nextQueue: queue, result: null, persist: false };
    if (existing?.operation === 'delete') return unchanged;
    if (replacing !== undefined && !(existing && replacing && sameStagedProjectUpdateRecord(existing, replacing))) return unchanged;
    // Archived when the copy it goes over is (whole-app audit A4 pass 17
    // L2): one queued, or the one this phone last put in the cloud. Nothing
    // un-archives a field update. After Keep Phone kept the iPad's archive,
    // the card's copy, never archived, went up over it, and the update came
    // back on the iPad.
    const queuedCopy = (existing?.payload as Partial<ProjectUpdateRecordPayload> | undefined)?.updateData;
    const copy = withArchiveKept(update, existing ? [existing] : [], [queuedCopy, projectUpdateLastVersionInCloud.get(update.id)]
      .find(item => isRecord(item) && item.isArchived === true)) as ProjectUpdate;
    if (!existing && lastVersionInCloud && projectUpdateVersionIsInCloud(copy)) return unchanged;
    const patch = !overConflict && Boolean(queuedFieldUpdateDocumentPatches(existing)) && (!fieldUpdateOwesOwnSync(copy.status) ||
      fieldUpdateOwesNothingBeyond((existing!.payload as ProjectUpdateRecordPayload).updateData, [], copy));
    const next: SyncQueueItem = existing && patch
      ? { ...existing, payload: { ...(existing.payload as ProjectUpdateRecordPayload), pendingPhotoAssetIds: pending } }
      : {
          id, entity: 'project_update', operation: 'update', createdAt: now, retryCount: 0, lastError: null,
          // The second write of a send over a conflict keeps the first's time.
          changedAt: ((!overConflict || replacing) && existing && queuedEditSavedAt(existing, copy)) || now,
          payload: {
            id: copy.id, projectId: copy.projectId, projectName: copy.projectName,
            selectedAreaName: copy.selectedAreaName, updateData: copy, pendingPhotoAssetIds: pending,
            ...(overConflict ? { overConflict } : {}),
          },
          ...(ownerId ? { ownerId } : {}),
        };
    if (!patch) projectUpdateLastVersionInCloud.delete(copy.id);
    return {
      nextQueue: patch ? queue.map(item => item === existing ? next : item) : [...queue.filter(item => item.id !== id), next],
      result: next,
    };
  });
}

/**
 * When David saved this copy of the update: the time its whole queued copy
 * of the same content carries (its documents' upload state, the project id
 * an upload pass bound and a Retry's stamps aside); null for any other
 * record (whole-app audit A4 pass 13 M1). The conflict check compares the
 * cloud's time with it. Each sync attempt stamped it "now": an edit saved
 * with no signal, waiting on its photos, always read newer than the iPad's
 * later edit, and went over it with no conflict shown. Photo analysis aside
 * too (A4 pass 13 G1): a result that landed in the queued copy after a sync
 * attempt read the update is not an edit, and re-stamped it now.
 */
function queuedEditSavedAt(item: SyncQueueItem, update: ProjectUpdate): string | null {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  if (item.operation === 'delete' || payload.archiveOnly || queuedFieldUpdateDocumentPatches(item)) return null;
  return sameProjectUpdateContent(withoutPhotoAnalysis(payload.updateData), withoutPhotoAnalysis(update) as ProjectUpdate,
    { retryStampsAside: true }) ? item.changedAt : null;
}

/**
 * The record a sync attempt wrote, still: retry stamps aside, and whether or
 * not an upload pass has since bound its project id
 * (prepareQueueItemProjectIdentity), as one that found it waiting for its
 * photos does. Otherwise that record kept waiting for photos the attempt had
 * just checked.
 */
function sameStagedProjectUpdateRecord(current: SyncQueueItem, written: SyncQueueItem): boolean {
  const unbound = (item: SyncQueueItem): SyncQueueItem => {
    const { projectId: _projectId, projectName: _projectName, updateData, ...rest } = item.payload as ProjectUpdateRecordPayload;
    return {
      ...item,
      payload: { ...rest, updateData: updateData && typeof updateData === 'object' ? { ...updateData, projectId: undefined } : updateData },
    };
  };
  return sameQueueRevision(unbound(current), unbound(written));
}

export async function removeProjectUpdateFromSyncQueue(updateId: string): Promise<number> {
  return (await withdrawProjectUpdateFromSyncQueue(updateId)).length;
}

/** The update's queued record work (its deletes stay), taken off the queue: the items as they were. */
async function withdrawProjectUpdateFromSyncQueue(updateId: string): Promise<SyncQueueItem[]> {
  if (!updateId.trim()) return [];

  return mutateOfflineQueue(queue => {
    const nextQueue = queue.filter(item => {
      if (item.entity !== 'project_update') return true;
      if (item.operation === 'delete') return true;

      const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
      return payload.id !== updateId;
    });
    const withdrawn = queue.filter(item => !nextQueue.includes(item));
    return {
      nextQueue,
      result: withdrawn,
      persist: withdrawn.length > 0,
    };
  });
}

/**
 * Keep Cloud's save failed (whole-app audit A4 pass 13 L2): the phone's work
 * it withdrew goes back, in place of the cloud copy it queued, so neither
 * copy has changed, as Settings says. That work had been lost (a newer
 * edit, a document change), and the cloud copy went up later and cleared
 * the conflict. Work queued since is newer, and stays.
 */
async function putBackWithdrawnProjectUpdateWork(withdrawn: readonly SyncQueueItem[], queued: SyncQueueItem | null): Promise<void> {
  await mutateOfflineQueue(queue => {
    const kept = queued ? queue.filter(item => !(item.id === queued.id && sameStagedProjectUpdateRecord(item, queued))) : queue;
    const queuedIds = new Set(kept.map(item => item.id));
    // The later withdrawal of an id holds the newer work. None of it goes
    // over the conflict now without a new choice (A4 pass 15 H1).
    const back = [...new Map(withdrawn.map(item => [item.id, withoutChoiceOverConflict(item)])).values()]
      .filter(item => !queuedIds.has(item.id));
    return { nextQueue: [...kept, ...back], result: undefined, persist: kept.length !== queue.length || back.length > 0 };
  });
}

function withoutChoiceOverConflict(item: SyncQueueItem): SyncQueueItem {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload> | undefined;
  if (item.entity !== 'project_update' || !payload?.overConflict) return item;
  const { overConflict: _chosen, ...rest } = payload;
  return { ...item, payload: rest };
}

export type ProjectUpdateTombstoneReplay = {
  updateId: string;
  /**
   * Re-queue a cloud archive when none is queued; null for any archive time.
   * `documentChangesOnly`: the cloud already reads it archived, so an archive
   * goes only to carry document changes still waiting (A4 pass 12 L2).
   */
  archive: false | { archivedAt: string | null; documentChangesOnly?: boolean };
};

/**
 * The startup replay of the field-update deletion journal as ONE queue pass
 * (whole-app audit A2 pass 2 M1). Before, every tombstone ever made removed
 * and re-added its own queue item: about five queue rewrites per old archive
 * on every launch. Now record work for a tombstoned update is dropped, an
 * archive already queued is kept as it is (with its retry state), a missing
 * archive is added, and the queue is written once, only when something
 * changed. Queued deletes are never touched; their ids are returned, with
 * the deletes the cloud confirmed, from one journal read (audit A2 pass 3
 * L2; an unreadable journal confirms none, so every unqueued delete is
 * re-queued as before).
 */
export async function replayProjectUpdateTombstonesInQueue(
  replays: readonly ProjectUpdateTombstoneReplay[],
): Promise<{ queuedDeleteIds: ReadonlySet<string>; confirmedDeleteIds: ReadonlySet<string> }> {
  const byId = new Map(replays.filter(replay => replay.updateId.trim()).map(replay => [replay.updateId, replay]));
  const confirmedDeleteIds = byId.size === 0 ? new Set<string>()
    : await confirmedProjectUpdateDeletionIds().catch(() => new Set<string>());
  const ownerId = currentCloudOwner().ownerId;
  const queuedAt = new Date().toISOString();
  const outcome = await mutateOfflineQueue(queue => {
    const updateItems = queue.filter(item => item.entity === 'project_update');
    const payloadId = (item: SyncQueueItem) => (item.payload as Partial<ProjectUpdateRecordPayload>).id;
    const queuedDeleteIds = new Set(updateItems.flatMap(item => {
      const id = item.operation === 'delete' ? payloadId(item) : undefined;
      return id ? [id] : [];
    }));
    const archiveKept = new Set<string>();
    // A document change still waiting for an update being archived goes up
    // with the archive (whole-app audit A4 pass 11 O2): the archive replaced
    // it, and the archived cloud copy still listed a document taken off. So
    // does one for an update the cloud already reads archived (A4 pass 12
    // L2): a refresh turns this phone's archive record into that one, and
    // the next replay dropped the change with the rest of the update's work.
    // The archive save re-reads the cloud's copy, so sending it again is
    // harmless; with nothing waiting, no archive goes, as before.
    const waitingDocumentChanges = new Map<string, FieldUpdateDocumentPatch[]>();
    const kept = queue.filter(item => {
      const replay = item.entity === 'project_update' && item.operation !== 'delete'
        ? byId.get(payloadId(item) ?? '')
        : undefined;
      if (!replay) return true;
      const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
      const sameArchive = replay.archive !== false && payload.archiveOnly === true &&
        item.id === projectUpdateQueueItemId(replay.updateId) &&
        (replay.archive.archivedAt === null || payload.archivedAt === replay.archive.archivedAt) &&
        (!replay.archive.documentChangesOnly || Boolean(queuedFieldUpdateDocumentPatches(item)));
      if (sameArchive) archiveKept.add(replay.updateId);
      const patches = replay.archive !== false && !sameArchive ? queuedFieldUpdateDocumentPatches(item) : null;
      if (patches) waitingDocumentChanges.set(replay.updateId, patches);
      return sameArchive;
    });
    const added: SyncQueueItem[] = [...byId.values()].flatMap(replay => {
      if (replay.archive === false || archiveKept.has(replay.updateId) || queuedDeleteIds.has(replay.updateId)) return [];
      const archivedAt = replay.archive.archivedAt || queuedAt;
      const documentPatches = waitingDocumentChanges.get(replay.updateId);
      if (replay.archive.documentChangesOnly && !documentPatches) return [];
      return [{
        id: projectUpdateQueueItemId(replay.updateId), entity: 'project_update', operation: 'update',
        payload: { id: replay.updateId, updateData: undefined, archiveOnly: true, archivedAt, ...(documentPatches ? { documentPatches } : {}) },
        createdAt: queuedAt, changedAt: archivedAt, retryCount: 0, lastError: null, ...(ownerId ? { ownerId } : {}),
      }];
    });
    const changed = added.length > 0 || kept.length !== queue.length;
    return {
      nextQueue: [...kept, ...added],
      result: { queuedDeleteIds, added: added.length },
      persist: changed,
    };
  });
  if (outcome.added > 0) requestPendingChangesUpload('queue_item_enqueued');
  return { queuedDeleteIds: outcome.queuedDeleteIds, confirmedDeleteIds };
}

export async function stageProjectUpdateForSync(
  update: ProjectUpdate,
  { overConflict = false }: FieldUpdateSyncChoice = {},
): Promise<StagedProjectUpdateSync> {
  const cloudRecoverableUpdate = projectUpdateWithCloudPhotoPaths(update);
  const owner = currentCloudOwner();
  // A sync attempt is not an edit (whole-app audit A7 pass 6 M1, pass 7 M1):
  // see writeStagedProjectUpdateRecord. While a conflict is open for the
  // update, nothing automatic sends it, whichever copy this is (A4 pass 15
  // H1): the waiting-update sync, Sync Now, Retry Sync and a Save's own sync
  // write nothing, and the card reads "Needs Review". Since 139b0bb any copy
  // that was not exactly the conflict's own (a document's details edited, an
  // older copy put back, the iPad's copy a refresh showed) went up whole,
  // stamped now, over the iPad's edit, and the conflict was gone with
  // David's offline edit in it. Keep Phone sends a newer edit saved since
  // (A7 pass 11 L-2), its photos checked here once the conflict is settled.
  // Only a Retry David confirmed sends this copy over the conflict.
  const conflict = openFieldUpdateConflict(await getSyncConflicts(), update.id);
  const conflicted = Boolean(conflict);
  const heldForConflictReview = conflicted && !overConflict;
  const sentOverConflict = conflict && overConflict ? conflict.id : undefined;
  const staged = heldForConflictReview ? null : await writeStagedProjectUpdateRecord(
    cloudRecoverableUpdate, cloudRecoverableUpdate.photos.map(photo => photo.id),
    { lastVersionInCloud: !conflicted, overConflict: sentOverConflict });
  const nothingToSend = heldForConflictReview ||
    (!staged && !conflicted && projectUpdateVersionIsInCloud(cloudRecoverableUpdate));
  const photoAttempt = await uploadUpdatePhotosForSync(
    nothingToSend ? { ...cloudRecoverableUpdate, photos: [] } : cloudRecoverableUpdate, owner);
  // A photo found under a legacy project path keeps that path, so the cloud
  // record (and the desktop) point at the file that exists.
  const recordToPersist = Object.keys(photoAttempt.relocatedPhotoPaths).length === 0
    ? cloudRecoverableUpdate
    : {
      ...cloudRecoverableUpdate,
      photos: cloudRecoverableUpdate.photos.map(photo => photoAttempt.relocatedPhotoPaths[photo.id]
        ? { ...photo, cloudStoragePath: photoAttempt.relocatedPhotoPaths[photo.id], cloudRecoveryStatus: null }
        : photo),
    };
  // Not into the next account's storage (whole-app audit A1 H2/M3).
  if (cloudOwnerUnchanged(owner) && staged) {
    await writeStagedProjectUpdateRecord(recordToPersist, photoAttempt.failedPhotoIds, { replacing: staged, overConflict: sentOverConflict });
  }

  return {
    workAttempt: {
      cloudUpdateInsertAttempted: false,
      photoStorageUploadAttempted: photoAttempt.photoStorageUploadAttempted,
      storageUploadResult: photoAttempt.storageUploadResult,
      databaseUpsertResult: 'skipped',
      storageBucketName: photoAttempt.storageBucketName,
      storageBucketExists: photoAttempt.storageBucketExists,
      storageFailureCategory: photoAttempt.storageFailureCategory,
      storageHttpStatus: photoAttempt.storageHttpStatus,
      storageErrorCode: photoAttempt.storageErrorCode,
      localFileExists: photoAttempt.localFileExists,
      localFileReadable: photoAttempt.localFileReadable,
      fileByteSizeCategory: photoAttempt.fileByteSizeCategory,
      uploadPayloadType: photoAttempt.uploadPayloadType,
      storageContentType: photoAttempt.storageContentType,
      objectPathCategory: photoAttempt.objectPathCategory,
      databaseSyncRanAfterUpload: false,
      errors: [...photoAttempt.errors],
    },
    uploadedPhotoCount: photoAttempt.uploadedPhotoCount,
    missingPhotos: photoAttempt.missingPhotos,
    pendingPhotoAssetIds: photoAttempt.failedPhotoIds,
    ...(heldForConflictReview ? { heldForConflictReview } : {}),
  };
}

export async function runFieldUpdateCloudSync(
  update: ProjectUpdate,
  choice: FieldUpdateSyncChoice = {},
): Promise<{
  syncResult: SyncUploadResult;
  workAttempt: FieldUpdateSyncWorkAttempt;
  missingPhotos: MissingSyncPhoto[];
  /** Left alone, in conflict (A4 pass 13 M1, A4 pass 15 H1): its card stays as it is. */
  heldForConflictReview?: boolean;
}> {
  const staged = await stageProjectUpdateForSync(update, choice);
  const workAttempt = staged.workAttempt;
  if (staged.heldForConflictReview) {
    return {
      syncResult: {
        configured: true, uploaded: 0, uploadedByEntity: {}, itemOutcomes: {}, queued: 0, conflicts: 1, failureCategory: 'unknown',
        errors: [`Field update for “${update.projectName || 'Unassigned Project'}” has a cloud conflict that needs review.`],
      },
      workAttempt, missingPhotos: [], heldForConflictReview: true,
    };
  }
  const queueItemId = projectUpdateQueueItemId(update.id);
  let aggregateResult = await uploadPendingChanges();
  let remainingQueue = await getOfflineQueue();
  let remainingItem = remainingQueue.find(item => item.id === queueItemId);

  // If another upload pass was already in flight, this newly staged item may
  // not have been in that pass's snapshot. A successful older same-ID revision
  // can also leave a newer revision queued. Give either case one bounded
  // follow-up pass before assigning the local lifecycle status.
  if (
    remainingItem &&
    (!aggregateResult.itemOutcomes?.[queueItemId] ||
      aggregateResult.itemOutcomes[queueItemId] === 'uploaded')
  ) {
    aggregateResult = await uploadPendingChanges();
    remainingQueue = await getOfflineQueue();
    remainingItem = remainingQueue.find(item => item.id === queueItemId);
  }

  const conflicts = await getSyncConflicts();
  const currentConflict = conflicts.find(
    conflict => conflict.entity === 'project_update' && conflict.localId === update.id,
  );
  // Its record sent by another upload pass meanwhile, or nothing to send
  // again: this device's last version is in the cloud (A7 pass 7 M1).
  const itemOutcome = aggregateResult.itemOutcomes?.[queueItemId] ||
    (!remainingItem && !currentConflict && projectUpdateVersionIsInCloud(update) ? 'uploaded' : undefined);
  const itemSucceeded =
    itemOutcome === 'uploaded' && !remainingItem && !currentConflict;
  const itemErrors = remainingItem?.lastError
    ? [formatQueueItemFailure(remainingItem, remainingItem.lastError)]
    : currentConflict
      ? [`Field update for “${update.projectName || 'Unassigned Project'}” has a cloud conflict that needs review.`]
      : !aggregateResult.configured
        ? [...aggregateResult.errors]
        : itemOutcome === 'failed'
          ? [`Field update for “${update.projectName || 'Unassigned Project'}” could not sync.`]
          : [];
  const syncResult: SyncUploadResult = {
    configured: aggregateResult.configured,
    uploaded: itemSucceeded ? 1 : 0,
    uploadedByEntity: itemSucceeded ? { project_update: 1 } : {},
    itemOutcomes: itemOutcome ? { [queueItemId]: itemOutcome } : {},
    queued: remainingItem ? 1 : 0,
    conflicts: currentConflict ? 1 : 0,
    errors: itemErrors,
    // A conflict or an item failure is never read from its sentence: that
    // sentence carries the project name, so "Fiber Network" read as offline
    // and was re-sent over the other device's row (whole-app audit A4 pass 5).
    failureCategory: isSyncFailureCategory(remainingItem?.lastFailureCategory)
      ? remainingItem.lastFailureCategory
      : currentConflict || itemOutcome === 'failed' ? 'unknown' : null,
  };
  const metadataBlocked = staged.pendingPhotoAssetIds.length > 0;

  workAttempt.cloudUpdateInsertAttempted = !metadataBlocked;
  workAttempt.databaseSyncRanAfterUpload = metadataBlocked
    ? false
    : workAttempt.storageUploadResult === 'success';
  workAttempt.databaseUpsertResult = metadataBlocked
    ? 'skipped'
    : itemSucceeded
      ? 'success'
      : 'failed';

  return {
    syncResult,
    workAttempt,
    missingPhotos: staged.missingPhotos,
  };
}

let uploadPendingChangesInFlight: Promise<SyncUploadResult> | null = null;
let anotherUploadPassRequested = false;
const pendingChangesRetryController = createPendingChangesRetryController({
  upload: uploadPendingChanges,
  getPendingChangeCount: async () => (await getOfflineQueue()).length,
});

export function startPendingChangesRetryController(): void {
  pendingChangesRetryController.start();
}

export function stopPendingChangesRetryController(): void {
  pendingChangesRetryController.stop();
}

// enqueuePendingChange() fires this off fire-and-forget every time something
// is queued, so overlapping calls are the common case (e.g. saving an update
// while a background timer-driven sync is already running). Without this
// guard, two overlapping runs each read their own snapshot of the queue and
// later blindly overwrite storage with what they think is "remaining" -
// whichever run finishes last wins, silently erasing anything the other run
// already uploaded or anything enqueued in between. Serializing here so only
// one pass actually reads+writes the queue at a time, and queuing a single
// follow-up pass so a change enqueued mid-run still gets picked up promptly.
export async function uploadPendingChanges(): Promise<SyncUploadResult> {
  if (uploadPendingChangesInFlight) {
    anotherUploadPassRequested = true;
    return uploadPendingChangesInFlight;
  }

  uploadPendingChangesInFlight = runUploadPendingChanges();

  try {
    return await uploadPendingChangesInFlight;
  } finally {
    uploadPendingChangesInFlight = null;

    if (anotherUploadPassRequested) {
      anotherUploadPassRequested = false;
      requestPendingChangesUpload('coalesced_follow_up');
    }
  }
}

async function runUploadPendingChanges(): Promise<SyncUploadResult> {
  const configuration = getSupabaseConfigurationStatus();
  // One pass sends one account's work (whole-app audit A1 M3): items queued
  // under another account are held, and a sign-out or another sign-in stops
  // the pass before its next item.
  const owner = currentCloudOwner();
  const initialQueue = await getOfflineQueue();
  // Active user work is always the first recovery authority. Some older
  // devices retain hundreds of forensic quarantine snapshots; scanning every
  // one before touching the live queue can indefinitely postpone items that
  // are already safely present in the cloud. Only inspect legacy quarantine
  // history after the active queue has drained.
  const archiveRecovery = initialQueue.length === 0
    ? await stageMisclassifiedArchiveOnlyQuarantines()
    : { eligibleQuarantines: [] };
  const queue = initialQueue.length === 0
    ? await getOfflineQueue()
    : initialQueue;
  const orderedQueue = pendingUploadOrder(
    queue.filter(item => !heldForAnotherOwner(item.ownerId, owner)),
  );
  // Nothing automatic sends an update in conflict (whole-app audit A4 pass
  // 15 H1): a whole copy of it waits, as it is, for Keep Phone, Keep Cloud or
  // a Retry David confirms, which mark their copy. This pass is the automatic
  // retry, the refresh and realtime triggers, and every sync's upload.
  const conflictsAtStart = await getSyncConflicts();
  const heldForReview = orderedQueue.filter(item => fieldUpdateCopyHeldForReview(item, conflictsAtStart));
  const {
    taskPriorityBatch,
    uploadBatch,
  } = planPendingUploadBatch(orderedQueue.filter(item => !heldForReview.includes(item)));

  if (!configuration.configured) {
    return {
      configured: false,
      uploaded: 0,
      queued: queue.length,
      conflicts: (await getSyncConflicts()).length,
      errors: [configuration.message],
    };
  }

  const resolvedIds = new Set<string>();
  const retriedItemsById = new Map<string, SyncQueueItem>();
  const attemptedItemsById = new Map(uploadBatch.map(item => [item.id, item]));
  const itemOutcomes: Record<string, SyncItemOutcome> = {};
  const errors: string[] = [];
  const itemErrors: Record<string, string> = {};
  const itemFailed = (itemId: string, message: string) => {
    errors.push(message);
    itemErrors[itemId] = message;
  };
  const uploadedReferenceDocuments = new Map<string, ReferenceDocument>();
  const uploadContext: QueueUploadContext = { settledQueueItemIds: resolvedIds };
  // Still queued, with no error: no retry is owed until David chooses.
  heldForReview.forEach(item => { itemOutcomes[item.id] = 'blocked'; });
  let uploaded = 0;
  let heldErrorCount = 0;
  const uploadedByEntity: Record<SyncEntity, number> = {
    project: 0,
    project_update: 0,
    project_area: 0,
    schedule_item: 0,
    reference_document: 0,
  };

  // Exact cloud receipts are read concurrently within a small fixed bound.
  // This turns a large stale mobile queue into one short reconciliation pass
  // without weakening the per-record semantic receipt checks below.
  await preloadProjectUpdateCloudReceipts(uploadBatch, uploadContext);
  for (const item of uploadBatch) {
    if (!await projectUpdateAlreadyHasCloudReceipt(item, uploadContext)) continue;
    itemOutcomes[item.id] = 'uploaded';
    uploaded += 1;
    uploadedByEntity[item.entity] += 1;
    resolvedIds.add(item.id);
  }

  const operationalQueueItems = uploadBatch.filter(item => (
    !resolvedIds.has(item.id) &&
    queueEntityUsesDAVESyncTombstones(item.entity)
  ));
  let operationalTombstoneGate: DAVESyncTombstoneSyncResult | null = null;
  if (operationalQueueItems.length > 0) {
    try {
      // Routine task/area/document saves only need the authoritative deletion
      // inventory before writing. synchronizeDAVESyncTombstones() also
      // re-uploads the entire durable deletion journal; large long-lived
      // workspaces can contain hundreds of markers, which previously blocked
      // the current task save before its queue item was even attempted.
      operationalTombstoneGate = await loadDAVEOperationalTombstones();
    } catch (error) {
      operationalTombstoneGate = {
        tombstones: [],
        cloudAuthoritative: false,
        cloudError: error instanceof Error
          ? error.message
          : 'Deletion history could not be verified.',
      };
    }
  }

  // A user-confirmed task edit is the interactive critical path. Finish and
  // durably reconcile task rows as one bounded batch; unrelated historical
  // field-update retries must not keep the Save button waiting.
  for (const item of uploadBatch) {
    if (!cloudOwnerUnchanged(owner)) break;
    if (resolvedIds.has(item.id)) continue;
    let attemptedItem = item;

    if (
      operationalTombstoneGate &&
      queueItemMatchesDAVESyncTombstone(
        item,
        operationalTombstoneGate.tombstones,
      )
    ) {
      // A durable local or cloud deletion marker always outranks stale queued
      // data. Resolve only the obsolete queue row; the tombstone itself stays
      // in its independent durable journal.
      itemOutcomes[item.id] = 'superseded';
      resolvedIds.add(item.id);
      continue;
    }

    if (item.entity === 'reference_document' && await queuedBridgeDocumentWasDeleted(item)) {
      // The phone document behind this shared record was deleted before it
      // uploaded (audit A7 pass 4); see ProjectDocumentBridge.
      itemOutcomes[item.id] = 'superseded';
      resolvedIds.add(item.id);
      continue;
    }

    if (await queuedProjectChangeWasDeleted(item, uploadContext)) {
      itemOutcomes[item.id] = 'superseded';
      resolvedIds.add(item.id);
      continue;
    }

    if (item.lastFailureCategory === 'current_drawing_protected') {
      // The cloud refused this revision for good. It is held, with its plain
      // reason and no retry, until the owner edits the document again, which
      // queues a new revision (whole-app audit A8 pass 1 F3 (30 Sep 2026)).
      itemOutcomes[item.id] = 'blocked';
      heldErrorCount += 1;
      itemFailed(item.id, formatQueueItemFailure(item, item.lastError || CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE));
      continue;
    }

    if (
      operationalTombstoneGate &&
      queueEntityUsesDAVESyncTombstones(item.entity) &&
      !operationalTombstoneGate.cloudAuthoritative
    ) {
      const reason = operationalTombstoneGate.cloudError ||
        'Cross-device deletion history could not be verified.';
      const sanitizedResult = sanitizeUserFacingSyncMessage(reason);
      itemOutcomes[item.id] = 'failed';
      retriedItemsById.set(item.id, {
        ...item,
        retryCount: item.retryCount + 1,
        lastError: sanitizedResult,
        lastFailureCategory: classifySyncFailureText([reason]),
      });
      itemFailed(item.id, formatQueueItemFailure(item, sanitizedResult));
      continue;
    }

    const prepared = await prepareQueueItemProjectIdentity(item, uploadContext);
    if (typeof prepared === 'string') {
      if (await projectUpdateBelongsToLegacyDeletedProject(item, uploadContext)) {
        // Old installs could record the deleted project name before project
        // tombstones existed. If the protected cloud project inventory also
        // confirms that no active project has that name, the queued child is
        // obsolete. Remove only the retry row; its local update/photo record
        // remains preserved in the normal project-update store.
        itemOutcomes[item.id] = 'superseded';
        resolvedIds.add(item.id);
        continue;
      }
      const sanitizedResult = sanitizeUserFacingSyncMessage(prepared);
      itemOutcomes[item.id] = 'failed';
      retriedItemsById.set(item.id, {
        ...item,
        retryCount: item.retryCount + 1,
        lastError: sanitizedResult,
        lastFailureCategory: classifySyncFailureText([prepared]),
      });
      itemFailed(item.id, formatQueueItemFailure(item, sanitizedResult));
      continue;
    }
    attemptedItem = prepared;
    attemptedItemsById.set(item.id, attemptedItem);
    const result = await uploadQueueItem(attemptedItem, uploadContext);
    const resultCode = typeof result === 'string' ? result : result.outcome;

    if (resultCode === 'uploaded') {
      itemOutcomes[item.id] = 'uploaded';
      uploaded += 1;
      uploadedByEntity[item.entity] += 1;
      if (typeof result !== 'string') {
        uploadedReferenceDocuments.set(
          result.referenceDocument.id,
          result.referenceDocument,
        );
      }
      resolvedIds.add(item.id);
      continue;
    }

    if (resultCode === 'conflict') {
      itemOutcomes[item.id] = 'conflict';
      resolvedIds.add(item.id);
      continue;
    }

    if (resultCode === PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS) {
      itemOutcomes[item.id] = 'blocked';
      continue;
    }

    const sanitizedResult = sanitizeUserFacingSyncMessage(resultCode);
    const failureCategory = classifySyncFailureText([resultCode]);
    const heldForOwner = failureCategory === 'current_drawing_protected';
    itemOutcomes[item.id] = heldForOwner ? 'blocked' : 'failed';
    if (heldForOwner) heldErrorCount += 1;

    retriedItemsById.set(item.id, {
      ...attemptedItem,
      retryCount: attemptedItem.retryCount + 1,
      lastError: sanitizedResult,
      lastFailureCategory: failureCategory,
    });
    itemFailed(item.id, formatQueueItemFailure(attemptedItem, sanitizedResult));
  }

  // The account changed: the queue on this phone is no longer this pass's,
  // so nothing is written back; its items stay queued for their account.
  if (!cloudOwnerUnchanged(owner)) {
    return accountChangedDuringUpload(uploaded, uploadedByEntity, itemOutcomes, queue.length);
  }

  // Reconcile against the queue as it stands right now, not the snapshot
  // read at the top of this function - anything enqueued while the uploads
  // above were in flight needs to survive this write.
  const remaining = await mutateOfflineQueue(currentQueue => {
    const nextQueue = currentQueue.flatMap(item => {
      const attempted = attemptedItemsById.get(item.id);
      if (!attempted || !sameQueueRevision(item, attempted)) return [item];
      if (resolvedIds.has(item.id)) {
        if (itemOutcomes[item.id] !== 'uploaded') return [];
        noteProjectUpdateVersionInCloud(item);
        return newerEditQueuedAfter(item);
      }
      return [retriedItemsById.get(item.id) ?? item];
    });
    return { nextQueue, result: nextQueue };
  });

  await resolveUploadedArchiveOnlyQuarantines(archiveRecovery, itemOutcomes);

  let storageCleanupRemaining = 0;
  let storageCleanupCompleted = 0;
  if (!taskPriorityBatch) {
    try {
      const maintenance = await runDAVECloudMaintenanceIfDue({
        forceStorageCleanup: uploadBatch.some(item =>
          item.entity === 'project' && item.operation === 'delete'),
      });
      storageCleanupRemaining = maintenance.storageCleanupRemaining;
      storageCleanupCompleted = maintenance.storageCleanupCompleted;
      errors.push(
        ...maintenance.storageCleanupErrors.map(error =>
          sanitizeUserFacingSyncMessage(error)),
      );
    } catch {
      storageCleanupRemaining = 1;
      errors.push('Protected file cleanup is temporarily unavailable.');
    }
  }

  if (uploaded > 0 || storageCleanupCompleted > 0) {
    await setStoredJson(SYNC_LAST_RUN_STORAGE_KEY, new Date().toISOString());
  }

  return {
    configured: true,
    uploaded,
    uploadedByEntity,
    uploadedReferenceDocuments: [...uploadedReferenceDocuments.values()],
    itemOutcomes,
    queued: remaining.length + storageCleanupRemaining,
    conflicts: (await getSyncConflicts()).length,
    errors,
    heldErrorCount,
    itemErrors,
  };
}

/**
 * The newer edit Keep Phone's kept copy carries, queued in the write that
 * takes the landed copy off (whole-app audit A7 pass 11 L-2): the queue on
 * disk always holds it. Stamped now, after the kept copy, so it goes up
 * next; its photos still wait as they did.
 */
function newerEditQueuedAfter(landed: SyncQueueItem): SyncQueueItem[] {
  const newer = landed.entity === 'project_update' ? (landed.payload as Partial<ProjectUpdateRecordPayload>).newerEdit : undefined;
  if (!newer || !isRecord(newer)) return [];
  // An edit held for review that a patch carried (A7 pass 14 L-2) keeps the
  // time David saved it, as it was.
  if (queuedFieldUpdateDocumentPatches(landed)) return [newer];
  const now = new Date().toISOString();
  return [{ ...newer, createdAt: now, changedAt: now }];
}

/**
 * A whole copy of a field update while a conflict is open for it, queued by
 * anything but a choice David made over that conflict (whole-app audit A4
 * pass 15 H1): held for review, as it is. A document change or a late
 * analysis result (a patch on the cloud's copy, which settles no conflict),
 * an archive and a delete still go.
 */
function fieldUpdateCopyHeldForReview(item: SyncQueueItem, conflicts: readonly SyncConflict[]): boolean {
  if (item.entity !== 'project_update' || item.operation === 'delete') return false;
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  if (!payload.id || payload.archiveOnly || queuedFieldUpdateDocumentPatches(item)) return false;
  const conflict = openFieldUpdateConflict(conflicts, payload.id);
  return Boolean(conflict) && payload.overConflict !== conflict!.id;
}

function accountChangedDuringUpload(
  uploaded: number,
  uploadedByEntity: Record<SyncEntity, number>,
  itemOutcomes: Record<string, SyncItemOutcome>,
  queued: number,
): SyncUploadResult {
  return {
    configured: true,
    uploaded,
    uploadedByEntity,
    itemOutcomes,
    queued,
    conflicts: 0,
    errors: ['The account changed during sync. Work not yet sent waits for the account that saved it.'],
  };
}

async function projectUpdateBelongsToLegacyDeletedProject(
  item: SyncQueueItem,
  context: QueueUploadContext,
): Promise<boolean> {
  if (
    item.entity !== 'project_update' ||
    item.operation !== 'update' ||
    !context.projectIdentityAuthority
  ) return false;

  const payload = item.payload as ProjectUpdateRecordPayload<Record<string, unknown>>;
  if (payload.archiveOnly || !isRecord(payload.updateData)) return false;
  const payloadProjectId = typeof payload.projectId === 'string'
    ? payload.projectId.trim()
    : '';
  const updateProjectId = typeof payload.updateData.projectId === 'string'
    ? payload.updateData.projectId.trim()
    : '';
  // An explicit project UUID must never be reclassified by a name-only legacy
  // marker. That path requires normal exact-identity review.
  if (payloadProjectId || updateProjectId) return false;

  const payloadName = normalizedProjectArchiveName(payload.projectName);
  const updateName = normalizedProjectArchiveName(payload.updateData.projectName);
  const projectName = payloadName || updateName;
  if (!projectName || (payloadName && updateName && payloadName !== updateName)) {
    return false;
  }
  // A current authorized project with this name always outranks the local
  // legacy deletion marker, including a legitimately recreated project.
  if ((context.projectIdentityAuthority.byNormalizedName.get(projectName) || []).length > 0) {
    return false;
  }

  context.legacyDeletedProjectNamesPromise ??=
    loadLegacyDeletedProjectNames();
  return (await context.legacyDeletedProjectNamesPromise).has(projectName);
}

async function loadLegacyDeletedProjectNames(): Promise<ReadonlySet<string>> {
  const rawValue = await AsyncStorage.getItem(LEGACY_DELETED_PROJECTS_STORAGE_KEY);
  if (!rawValue) return new Set();
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) {
      return new Set();
    }
    return new Set(parsed.map(normalizedProjectArchiveName).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function queuedBridgeDocumentWasDeleted(item: SyncQueueItem): Promise<boolean> {
  const document = (item.payload as Partial<ReferenceDocumentRecordPayload>)?.documentData;
  if (!document?.id || !isProjectDocumentBridge(document)) return false;
  const projectDocuments = parseStoredProjectDocuments(
    await AsyncStorage.getItem(PROJECT_DOCUMENTS_STORAGE_KEY).catch(() => null),
  );
  return projectDocuments !== null && projectDocumentBridgeOrphaned(document, projectDocuments);
}

function queueEntityUsesDAVESyncTombstones(
  entity: SyncEntity,
): entity is DAVESyncTombstone['entityType'] {
  return (
    entity === 'project' ||
    entity === 'project_update' ||
    entity === 'project_area' ||
    entity === 'schedule_item' ||
    entity === 'reference_document'
  );
}

function queueItemMatchesDAVESyncTombstone(
  item: SyncQueueItem,
  tombstones: readonly DAVESyncTombstone[],
): boolean {
  if (!queueEntityUsesDAVESyncTombstones(item.entity)) return false;
  if (item.operation === 'delete') return false;
  const payload = item.payload as { id?: unknown; name?: unknown; previousName?: unknown };
  // A project's cover, archive and reopen items carry only previousName, so a
  // deleted project's were never retired and retried for good (whole-app
  // audit A3 pass 2, 30 Sep 2026).
  const projectName = [payload.name, payload.previousName]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const recordId = String(
    item.entity === 'project' ? projectName : payload.id,
  )
    .trim()
    .toLowerCase();
  if (!recordId) return false;
  return tombstones.some(tombstone => (
    tombstone.entityType === item.entity &&
    tombstone.recordId.trim().toLowerCase() === recordId
  ));
}

export async function downloadCloudChanges<TUpdate>(
  knownTombstoneSync?: DAVESyncTombstoneSyncResult,
): Promise<
  CloudDownloadResult<TUpdate>
> {
  const [
    tombstoneSync,
    projectsResult,
    updatesResult,
    areasResult,
    schedulesResult,
    documentsResult,
  ] = await Promise.all([
    knownTombstoneSync ?? synchronizeDAVESyncTombstones(),
    listProjects(),
    listProjectUpdates<TUpdate>(),
    listProjectAreas(),
    listScheduleItems(),
    listReferenceDocuments(),
  ]);

  // Audit P1-27: record WHY a collection is empty. A read failure or an
  // unverifiable deletion history yields an explicit error, never a silent [].
  const readError = (
    result: {
      ok: boolean;
      configured: boolean;
      stubbed?: boolean;
      error?: string;
      message?: string;
    },
    label: string,
  ): string | null => {
    if (!result.configured) return null;
    if (result.ok && !result.stubbed) return null;
    return result.error || result.message || `${label} could not be read from the cloud.`;
  };
  const tombstoneGateError = tombstoneSync.cloudAuthoritative
    ? null
    : tombstoneSync.cloudError || 'Deletion history could not be verified.';
  const collectionErrors: CloudCollectionErrors = {
    projects: tombstoneGateError ?? readError(projectsResult, 'Projects'),
    updates: tombstoneGateError ?? readError(updatesResult, 'Updates'),
    projectAreas: tombstoneGateError ?? readError(areasResult, 'Areas'),
    scheduleItems: tombstoneGateError ?? readError(schedulesResult, 'Schedule items'),
    referenceDocuments: tombstoneGateError ?? readError(documentsResult, 'Reference documents'),
  };

  const deletedProjectKeys = new Set(
    deletedDAVERecordIds(tombstoneSync.tombstones, 'project')
      .map(recordId => recordId.trim().toLowerCase()),
  );
  const deletedUpdateIds = new Set(
    deletedDAVERecordIds(tombstoneSync.tombstones, 'project_update')
      .map(recordId => recordId.trim().toLowerCase()),
  );
  const projects = collectionErrors.projects === null && projectsResult.data
    ? projectsResult.data.filter(project =>
        !deletedProjectKeys.has(project.name.trim().toLowerCase()))
    : [];
  const updates = collectionErrors.updates === null && updatesResult.data
    ? updatesResult.data.filter(update =>
        !deletedUpdateIds.has(update.id.trim().toLowerCase()))
    : [];
  const projectAreas = collectionErrors.projectAreas === null && areasResult.data
    ? removeDAVETombstonedRecords(
        areasResult.data,
        tombstoneSync.tombstones,
        'project_area',
      )
    : [];
  const scheduleItems = collectionErrors.scheduleItems === null && schedulesResult.data
    ? removeDAVETombstonedRecords(
        schedulesResult.data,
        tombstoneSync.tombstones,
        'schedule_item',
      )
    : [];
  const referenceDocuments = collectionErrors.referenceDocuments === null && documentsResult.data
    ? documentsResult.data
    : [];
  const filteredReferenceDocuments = removeDAVETombstonedRecords(
    referenceDocuments,
    tombstoneSync.tombstones,
    'reference_document',
  );

  return {
    configured: projectsResult.configured || updatesResult.configured,
    collectionErrors,
    projects,
    projectNames: projects
      .map(project => project.name)
      .filter(name => typeof name === 'string' && name.trim()),
    updates,
    projectAreas,
    scheduleItems,
    referenceDocuments: filteredReferenceDocuments,
    tombstones: tombstoneSync.tombstones,
    tombstonesAuthoritative: tombstoneSync.cloudAuthoritative,
    tombstoneError: tombstoneSync.cloudError,
  };
}

export async function synchronize<TUpdate>(): Promise<{
  upload: SyncUploadResult;
  download: CloudDownloadResult<TUpdate>;
}> {
  const upload = await uploadPendingChanges();
  const download = await downloadCloudChanges<TUpdate>();

  return {
    upload,
    download,
  };
}

export async function synchronizeLocalData(
  payload: LocalSyncPayload,
  onProgress?: (event: SyncProgressEvent) => void,
): Promise<FullSyncResult> {
  const configuration = getSupabaseConfigurationStatus();
  // This phone's records are sent only as the account signed in now (A1 M3).
  const owner = currentCloudOwner();
  const errors: string[] = [];
  const missingPhotos: MissingSyncPhoto[] = [];
  const details = {
    queuedUploads: 0,
    projectsUploaded: 0,
    updatesUploaded: 0,
    photosUploaded: 0,
    areasUploaded: 0,
    schedulesUploaded: 0,
    documentsUploaded: 0,
    cloudProjectsDownloaded: 0,
    cloudUpdatesDownloaded: 0,
    cloudAreasDownloaded: 0,
    cloudSchedulesDownloaded: 0,
    cloudDocumentsDownloaded: 0,
  };
  const emptyRecovery: FullSyncResult['recovered'] = {
    projects: [],
    updates: [],
    projectAreas: [],
    scheduleItems: [],
    referenceDocuments: [],
    tombstones: [],
    // Nothing was downloaded, so nothing here may be applied as cloud truth.
    collectionErrors: allCollectionsFailed('Cloud download did not run.'),
  };
  let syncableProjects = payload.projects;
  let syncableUpdates = payload.savedUpdates;
  let syncableProjectAreas = payload.projectAreas;
  let syncableScheduleItems = payload.scheduleItems;
  let syncableReferenceDocuments = payload.referenceDocuments;
  let total =
    5 +
    payload.projects.length +
    payload.savedUpdates.length +
    countPhotos(payload.savedUpdates) +
    payload.projectAreas.length +
    payload.scheduleItems.length +
    payload.referenceDocuments.length;
  let completed = 0;

  function progress(message: string) {
    completed += 1;
    onProgress?.({ message, completed, total });
  }

  if (!configuration.configured) {
    return {
      configured: false,
      connected: false,
      downloadStatus: 'partial',
      uploaded: 0,
      downloaded: 0,
      queued: (await getOfflineQueue()).length,
      conflicts: (await getSyncConflicts()).length,
      cloudProjectCount: null,
      lastSyncAt: null,
      errors: [configuration.message],
      missingPhotos,
      details,
      recovered: emptyRecovery,
    };
  }

  progress('Testing Supabase connection');
  const connection = await testSupabaseConnection();

  if (!connection.connected) {
    return {
      configured: true,
      connected: false,
      downloadStatus: 'partial',
      uploaded: 0,
      downloaded: 0,
      queued: (await getOfflineQueue()).length,
      conflicts: (await getSyncConflicts()).length,
      cloudProjectCount: connection.projectCount,
      lastSyncAt: null,
      errors: [connection.error || 'Supabase connection failed.'],
      missingPhotos,
      details,
      recovered: emptyRecovery,
    };
  }

  progress('Checking cross-device deletion history');
  const tombstoneSync = await synchronizeDAVESyncTombstones();
  if (!tombstoneSync.cloudAuthoritative) {
    return {
      configured: true,
      connected: true,
      downloadStatus: 'partial',
      uploaded: 0,
      downloaded: 0,
      queued: (await getOfflineQueue()).length,
      conflicts: (await getSyncConflicts()).length,
      cloudProjectCount: connection.projectCount,
      lastSyncAt: null,
      errors: [
        `Full cloud sync stopped because ECOS could not verify cross-device deletion history. No local records were uploaded.${
          tombstoneSync.cloudError ? ` ${tombstoneSync.cloudError}` : ''
        }`,
      ],
      missingPhotos,
      details,
      recovered: {
        ...emptyRecovery,
        tombstones: tombstoneSync.tombstones,
      },
    };
  }

  syncableProjectAreas = removeDAVETombstonedRecords(
    payload.projectAreas,
    tombstoneSync.tombstones,
    'project_area',
  );
  syncableScheduleItems = removeDAVETombstonedRecords(
    payload.scheduleItems,
    tombstoneSync.tombstones,
    'schedule_item',
  );
  syncableReferenceDocuments = removeDAVETombstonedRecords(
    payload.referenceDocuments,
    tombstoneSync.tombstones,
    'reference_document',
  );
  const deletedProjectKeys = new Set(
    deletedDAVERecordIds(tombstoneSync.tombstones, 'project')
      .map(recordId => recordId.trim().toLowerCase()),
  );
  const deletedUpdateIds = new Set(
    deletedDAVERecordIds(tombstoneSync.tombstones, 'project_update')
      .map(recordId => recordId.trim().toLowerCase()),
  );
  syncableProjects = payload.projects.filter(projectName =>
    !deletedProjectKeys.has(projectName.trim().toLowerCase()));
  syncableUpdates = payload.savedUpdates.filter(update =>
    !deletedUpdateIds.has(update.id.trim().toLowerCase()));
  total =
    5 +
    syncableProjects.length +
    syncableUpdates.length +
    countPhotos(syncableUpdates) +
    syncableProjectAreas.length +
    syncableScheduleItems.length +
    syncableReferenceDocuments.length;

  progress('Reconciling current tasks, GPS, and documents');
  const [
    cloudUpdatesBeforeUpload,
    cloudAreasBeforeUpload,
    cloudSchedulesBeforeUpload,
    cloudDocumentsBeforeUpload,
  ] = await Promise.all([
    listProjectUpdates<ProjectUpdate>(),
    listProjectAreas(),
    listScheduleItems(),
    listReferenceDocuments(),
  ]);
  const deletedAreaIds = deletedDAVERecordIds(tombstoneSync.tombstones, 'project_area');
  const deletedScheduleIds = deletedDAVERecordIds(tombstoneSync.tombstones, 'schedule_item');
  const deletedDocumentIds = deletedDAVERecordIds(tombstoneSync.tombstones, 'reference_document');

  if (
    cloudUpdatesBeforeUpload.ok &&
    !cloudUpdatesBeforeUpload.stubbed &&
    Array.isArray(cloudUpdatesBeforeUpload.data)
  ) {
    syncableUpdates = daveProjectUpdatesNeedingCloudUpload({
      local: syncableUpdates,
      cloud: cloudUpdatesBeforeUpload.data,
    });
  } else {
    // A full sync is reconciliation, not permission to replay every historical
    // field update. If cloud receipts cannot be read, keep local records and
    // let the already-durable queue retry independently.
    syncableUpdates = [];
    errors.push('Cloud field updates could not be checked before upload. Local updates were preserved and will retry.');
  }

  if (
    cloudAreasBeforeUpload.ok &&
    !cloudAreasBeforeUpload.stubbed &&
    Array.isArray(cloudAreasBeforeUpload.data)
  ) {
    syncableProjectAreas = daveProjectAreasNeedingCloudUpload({
      local: syncableProjectAreas,
      cloud: cloudAreasBeforeUpload.data,
      deletedIds: deletedAreaIds,
    });
  } else {
    // A placeholder must never be uploaded blindly when the device cannot
    // first verify whether another device already captured real GPS.
    syncableProjectAreas = syncableProjectAreas.filter(area => Boolean(area.locationCapturedAt));
    errors.push('Cloud GPS areas could not be checked before upload. Placeholder locations were not uploaded.');
  }

  if (
    cloudSchedulesBeforeUpload.ok &&
    !cloudSchedulesBeforeUpload.stubbed &&
    Array.isArray(cloudSchedulesBeforeUpload.data)
  ) {
    syncableScheduleItems = daveScheduleItemsNeedingCloudUpload({
      local: syncableScheduleItems,
      cloud: cloudSchedulesBeforeUpload.data,
      deletedIds: deletedScheduleIds,
    });
  } else {
    // Uploading a stale local snapshot before a successful read can erase a
    // newer edit from another device. Preserve the phone and retry later.
    syncableScheduleItems = [];
    errors.push('Cloud tasks could not be checked before upload. Local tasks were preserved and will retry.');
  }

  if (
    cloudDocumentsBeforeUpload.ok &&
    !cloudDocumentsBeforeUpload.stubbed &&
    Array.isArray(cloudDocumentsBeforeUpload.data)
  ) {
    syncableReferenceDocuments = daveReferenceDocumentsNeedingCloudUpload({
      local: syncableReferenceDocuments,
      cloud: cloudDocumentsBeforeUpload.data,
      deletedIds: deletedDocumentIds,
    });
  } else {
    // A stale device must not overwrite a newer current/prior schedule choice.
    syncableReferenceDocuments = [];
    errors.push('Cloud documents could not be checked before upload. Local documents were preserved and will retry.');
  }

  total =
    5 +
    syncableProjects.length +
    syncableUpdates.length +
    countPhotos(syncableUpdates) +
    syncableProjectAreas.length +
    syncableScheduleItems.length +
    syncableReferenceDocuments.length;

  progress('Uploading queued changes');
  const queuedUpload = await uploadPendingChanges();
  details.queuedUploads = queuedUpload.uploaded;
  errors.push(...queuedUpload.errors);

  const cloudProjects = await listProjects();
  const cloudProjectRecords = cloudProjects.ok && !cloudProjects.stubbed && Array.isArray(cloudProjects.data)
    ? [...cloudProjects.data]
    : [];
  if (!cloudProjects.ok || cloudProjects.stubbed || !Array.isArray(cloudProjects.data)) {
    errors.push(
      cloudProjects.error || cloudProjects.message ||
      'Cloud projects could not be checked before operational records were uploaded.',
    );
    // Schedule items and reference documents both resolve their project
    // through the identity authority built from this read. If the read failed
    // the authority is empty, so every one of them would fail to bind and add
    // its own error — turning a single upstream failure into one error per
    // record. Skip the phase instead, the same way the collection reads above
    // preserve the phone and retry later.
    syncableScheduleItems = [];
    syncableReferenceDocuments = [];
  }
  const existingProjectNames = new Set(
    cloudProjectRecords.map(project => project.name.toLowerCase()),
  );

  for (const projectName of syncableProjects) {
    if (!cloudOwnerUnchanged(owner)) break;
    const normalizedName = projectName.trim();

    if (!normalizedName) {
      progress('Empty project skipped');
      continue;
    }

    if (!cloudProjects.ok || cloudProjects.stubbed) {
      progress(`Project preserved for retry: ${normalizedName}`);
      continue;
    }

    if (existingProjectNames.has(normalizedName.toLowerCase())) {
      progress(`Project already synced: ${normalizedName}`);
      continue;
    }

    const result = await createProject({ name: normalizedName });

    if (result.ok && !result.stubbed) {
      details.projectsUploaded += 1;
      existingProjectNames.add(normalizedName.toLowerCase());
      if (result.data) cloudProjectRecords.push(result.data);
    } else {
      errors.push(
        `Project “${normalizedName}” could not sync.${cloudWriteFailureReason(result)}`,
      );
    }

    progress(`Project synced: ${normalizedName}`);
  }

  for (const update of syncableUpdates) {
    // Sync Now is not a choice between two copies either (whole-app audit A4
    // pass 13 G2): it sent an update in conflict whole, stamped now, over the
    // iPad's newer edit, a silent Keep Phone. Left for Keep Phone or Keep
    // Cloud, as the waiting-update sync leaves it; its saved conflict is in
    // `conflicts`, which Settings reads as needing review.
    const staged = await stageProjectUpdateForSync(update, { automatic: true });
    details.photosUploaded += staged.uploadedPhotoCount;
    missingPhotos.push(...staged.missingPhotos);
    errors.push(...staged.workAttempt.errors.map(error =>
      `Field update for “${update.projectName || 'Unassigned Project'}”: ${error}`,
    ));
    progress(`${staged.heldForConflictReview ? 'Update left for review' : 'Update staged'}: ${update.projectName}`);

    const missingPhotoIds = new Set(staged.missingPhotos.map(photo => photo.photoId));
    update.photos.forEach(photo => {
      progress(
        staged.heldForConflictReview
          ? 'Photo left for review'
          : missingPhotoIds.has(photo.id)
          ? 'Photo skipped: unavailable'
          : 'Photo synced',
      );
    });
  }

  const stagedUpdateUpload = await uploadPendingChanges();
  details.updatesUploaded = stagedUpdateUpload.uploadedByEntity?.project_update || 0;
  errors.push(...withoutRepeatedItemErrors(stagedUpdateUpload, queuedUpload));

  for (const area of syncableProjectAreas) {
    if (!cloudOwnerUnchanged(owner)) break;
    const result = await upsertProjectArea(area);

    if (result.ok && !result.stubbed) {
      details.areasUploaded += 1;
    } else {
      errors.push(
        `GPS area “${area.name}” could not sync.${cloudWriteFailureReason(result)}`,
      );
    }

    progress(`GPS area synced: ${area.name}`);
  }

  const operationalProjectAuthority = buildOperationalProjectIdentityAuthority(
    cloudProjectRecords,
  );

  for (const item of syncableScheduleItems) {
    if (!cloudOwnerUnchanged(owner)) break;
    const binding = resolveOperationalProjectIdentity(item, operationalProjectAuthority);
    if (!binding.ok) {
      errors.push(`Schedule task “${item.taskName}” could not sync. ${binding.error}`);
      progress(`Schedule preserved: ${item.taskName}`);
      continue;
    }
    const result = await upsertScheduleItem({
      ...item,
      projectId: binding.identity.id,
    });

    if (result.ok && !result.stubbed) {
      details.schedulesUploaded += 1;
    } else {
      errors.push(
        `Schedule task “${item.taskName}” could not sync.${cloudWriteFailureReason(result)}`,
      );
    }

    progress(`Schedule synced: ${item.taskName}`);
  }

  for (const document of syncableReferenceDocuments) {
    if (!cloudOwnerUnchanged(owner)) break;
    const binding = resolveOperationalReferenceDocumentScope(
      document,
      operationalProjectAuthority,
    );
    if (!binding.ok) {
      errors.push(`Document “${document.name}” could not sync. ${binding.error}`);
      progress(`Document preserved: ${document.name}`);
      continue;
    }
    let authoritativeDocument: ReferenceDocument = {
      ...document,
      projectId: binding.scope.projectId,
      projectName: binding.scope.projectName,
      projectNames: [...binding.scope.projectNames],
    };
    if (!authoritativeDocument.storagePath && authoritativeDocument.uri?.trim()) {
      try {
        authoritativeDocument = await prepareReferenceDocumentForCloud(
          authoritativeDocument,
        );
      } catch {
        errors.push(
          `Document “${document.name}” could not sync. The protected file is not available on this device and was preserved for retry.`,
        );
        progress(`Document preserved: ${document.name}`);
        continue;
      }
      if (!authoritativeDocument.storagePath) {
        errors.push(
          `Document “${document.name}” could not sync. The protected file upload did not complete and was preserved for retry.`,
        );
        progress(`Document preserved: ${document.name}`);
        continue;
      }
    }
    const result = await upsertReferenceDocument(authoritativeDocument, {
      existing: Boolean(cloudDocumentsBeforeUpload.data?.some(cloud => cloud.id === document.id)),
    });

    if (result.ok && !result.stubbed) {
      details.documentsUploaded += 1;
    } else {
      errors.push(
        `Document “${document.name}” could not sync.${cloudWriteFailureReason(result)}`,
      );
    }

    progress(`Document synced: ${document.name}`);
  }

  // Another account's cloud records must not be handed to this one's screen,
  // which merges and saves them on this phone (whole-app audit A1 M3).
  if (!cloudOwnerUnchanged(owner)) {
    return {
      configured: true,
      connected: true,
      downloadStatus: 'partial',
      uploaded: 0,
      downloaded: 0,
      queued: 0,
      conflicts: 0,
      cloudProjectCount: null,
      lastSyncAt: null,
      errors: [...errors, 'The account changed during sync. Nothing more was sent or downloaded.'],
      missingPhotos,
      details,
      recovered: emptyRecovery,
    };
  }

  progress('Downloading cloud changes');
  const download = await downloadCloudChanges<ProjectUpdate>(tombstoneSync);
  const recoveredUpdates = await Promise.all(
    download.updates.map(row => hydrateProjectUpdatePhotoPreviews(row.updateData)),
  );
  details.cloudProjectsDownloaded = download.projects.length;
  details.cloudUpdatesDownloaded = download.updates.length;
  details.cloudAreasDownloaded = download.projectAreas.length;
  details.cloudSchedulesDownloaded = download.scheduleItems.length;
  details.cloudDocumentsDownloaded = download.referenceDocuments.length;

  // Audit P1-28: unacknowledged deletion-history uploads are a visible
  // partial-sync condition, not a silent retry-later.
  if ((tombstoneSync.uploadFailures ?? 0) > 0) {
    errors.push(
      `${tombstoneSync.uploadFailures} deletion ${
        tombstoneSync.uploadFailures === 1 ? 'record' : 'records'
      } could not be confirmed in the cloud. They remain saved on this phone and will retry next sync.`,
    );
  }

  // Audit P1-27: a failed collection read is a visible sync failure, and an
  // incomplete download must not stamp lastSync as if the sync were whole.
  const collectionFailureMessages = Object.entries(download.collectionErrors)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([collection, error]) => `Cloud ${collection} could not be downloaded: ${error}`);
  collectionFailureMessages.forEach(message => errors.push(message));
  const downloadComplete = collectionFailureMessages.length === 0;

  const cloudCount = await countCloudProjects();
  const lastSyncAt = downloadComplete ? new Date().toISOString() : null;
  if (lastSyncAt !== null) {
    await setStoredJson(SYNC_LAST_RUN_STORAGE_KEY, lastSyncAt);
  }
  const [queue, conflicts] = await Promise.all([
    getOfflineQueue(),
    getSyncConflicts(),
  ]);
  const uploaded =
    details.queuedUploads +
    details.projectsUploaded +
    details.updatesUploaded +
    details.photosUploaded +
    details.areasUploaded +
    details.schedulesUploaded +
    details.documentsUploaded;
  const downloaded =
    details.cloudProjectsDownloaded +
    details.cloudUpdatesDownloaded +
    details.cloudAreasDownloaded +
    details.cloudSchedulesDownloaded +
    details.cloudDocumentsDownloaded;

  return {
    configured: true,
    connected: true,
    downloadStatus: downloadComplete ? 'complete' : 'partial',
    uploaded,
    downloaded,
    queued: queue.length,
    conflicts: conflicts.length,
    cloudProjectCount:
      cloudCount.ok && cloudCount.data !== null
        ? cloudCount.data
        : connection.projectCount,
    lastSyncAt,
    errors,
    missingPhotos,
    details,
    recovered: {
      projects: download.projects,
      updates: recoveredUpdates,
      projectAreas: download.projectAreas,
      scheduleItems: download.scheduleItems,
      referenceDocuments: download.referenceDocuments,
      tombstones: download.tombstones,
      collectionErrors: download.collectionErrors,
    },
  };
}

/**
 * A later pass's errors without those of items that failed in the earlier
 * pass with the same message (whole-app audit A7 pass 13 L-2): Sync Now
 * counted and listed such an item twice. Two items failing with the same
 * words still count as two.
 */
function withoutRepeatedItemErrors(later: SyncUploadResult, earlier: SyncUploadResult): string[] {
  const errors = [...later.errors];
  Object.entries(later.itemErrors ?? {}).forEach(([itemId, message]) => {
    if (earlier.itemErrors?.[itemId] !== message) return;
    const index = errors.indexOf(message);
    if (index >= 0) errors.splice(index, 1);
  });
  return errors;
}

export async function removeMissingPhotosFromSyncQueue(
  missingPhotos: MissingSyncPhoto[],
): Promise<void> {
  if (missingPhotos.length === 0) return;

  const missingPhotoIds = new Set(missingPhotos.map(photo => photo.photoId));
  const missingPhotoIdsByUpdate = new Map<string, Set<string>>();
  missingPhotos.forEach(photo => {
    const ids = missingPhotoIdsByUpdate.get(photo.updateId) || new Set<string>();
    ids.add(photo.photoId);
    missingPhotoIdsByUpdate.set(photo.updateId, ids);
  });
  await mutateOfflineQueue(queue => ({
    nextQueue: queue
      .filter(item => {
        const entity = (item as SyncQueueItem & { entity: string }).entity;

        return String(entity) !== 'photo' || !missingPhotoIds.has(item.id);
      })
      .map(item => {
        if (item.entity !== 'project_update') return item;

        const payload = item.payload as ProjectUpdateRecordPayload<ProjectUpdate>;
        const updateData = payload.updateData;
        const updateMissingPhotoIds = missingPhotoIdsByUpdate.get(payload.id);

        if (!updateMissingPhotoIds || !Array.isArray(updateData?.photos)) return item;

        const nextPhotos = updateData.photos.map(photo =>
          updateMissingPhotoIds.has(photo.id)
            ? {
                ...photo,
                cloudRecoveryStatus: 'unavailable' as const,
                cloudSignedUrlExpiresAt: null,
              }
            : photo,
        );

        return {
          ...item,
          payload: {
            ...payload,
            pendingPhotoAssetIds: uniquePhotoAssetIds(
              payload.pendingPhotoAssetIds || [],
            ).filter(photoId => !updateMissingPhotoIds.has(photoId)),
            updateData: {
              ...updateData,
              photos: nextPhotos,
            },
          },
          lastError: null,
        };
      }),
    result: undefined,
  }));
}

export function markMissingPhotosUnavailable<TUpdate extends ProjectUpdate>(
  update: TUpdate,
  missingPhotos: readonly MissingSyncPhoto[],
): TUpdate {
  const missingPhotoIds = new Set(
    missingPhotos
      .filter(photo => photo.updateId === update.id)
      .map(photo => photo.photoId),
  );
  if (missingPhotoIds.size === 0) return update;

  return {
    ...update,
    photos: update.photos.map(photo =>
      missingPhotoIds.has(photo.id)
        ? {
            ...photo,
            cloudRecoveryStatus: 'unavailable' as const,
            cloudSignedUrlExpiresAt: null,
          }
        : photo,
    ),
  };
}

async function cleanupSyncQueueValue(value: string) {
  const queue = parseOfflineQueueValue(value);
  let missingPhotosRemoved = 0;
  const nextQueue: SyncQueueItem[] = [];

  for (const item of queue) {
    let nextItem: SyncQueueItem = {
      ...item,
      lastError:
        typeof item.lastError === 'string'
          ? sanitizeUserFacingSyncMessage(item.lastError)
          : item.lastError,
    };

    if (item.entity === 'project_update') {
      const payload = item.payload as ProjectUpdateRecordPayload<ProjectUpdate>;
      const updateData = payload.updateData;

      if (Array.isArray(updateData?.photos)) {
        const referencedPhotoIds = new Set(updateData.photos.map(photo => photo.id));
        const pendingPhotoAssetIds = uniquePhotoAssetIds(
          Array.isArray(payload.pendingPhotoAssetIds)
            ? payload.pendingPhotoAssetIds
            : updateData.photos.map(photo => photo.id),
        ).filter(photoId => referencedPhotoIds.has(photoId));

        nextItem = {
          ...nextItem,
          payload: {
            ...payload,
            pendingPhotoAssetIds,
            updateData,
          },
        };
      }
    }

    nextQueue.push(nextItem);
  }

  return {
    value: JSON.stringify(nextQueue),
    missingPhotosRemoved,
  };
}

export async function clearResolvedConflict(conflictId: string): Promise<void> {
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    const conflict = conflicts.find(item => item.id === conflictId);
    await writeSyncConflicts(
      conflicts.filter(item =>
        conflict
          ? item.entity !== conflict.entity || item.localId !== conflict.localId
          : item.id !== conflictId,
      ),
    );
  });
}

export async function clearScheduleItemSyncConflicts(
  itemId: string,
): Promise<void> {
  await clearConflictsForLocalRecord('schedule_item', itemId);
}

export async function resolveProjectUpdateSyncConflict<TUpdate>(
  conflictId: string,
  resolution: 'keep_local' | 'keep_cloud',
  /**
   * The cloud copy Review Conflicts showed when David chose (whole-app audit
   * A4 pass 17 L1): the check below compares the cloud with it. Without it,
   * the copy saved with the conflict, as before.
   */
  { cloudCopyShown, beforeClose }: {
    cloudCopyShown?: unknown;
    /**
     * Keep Cloud: puts the chosen copy on the card before the conflict is
     * cleared (whole-app audit A4 pass 19): a document upload finishing in
     * between found the discarded edit on the card and no conflict, and
     * queued it whole over the copy David kept.
     */
    beforeClose?: (chosen: TUpdate) => void;
  } = {},
): Promise<TUpdate> {
  const conflicts = await getSyncConflicts();
  const conflict = conflicts.find(item => item.id === conflictId);

  if (!conflict || conflict.entity !== 'project_update') {
    throw new Error('sync_conflict_not_found');
  }

  const localPayload = conflict.localPayload as ProjectUpdateRecordPayload<TUpdate>;
  // As for tasks (whole-app audit A4 pass 5): a deleted update is not written
  // back, whichever copy David chose. Its conflict is closed and nothing is
  // sent (sync_conflict_record_deleted, which Settings shows as closed). Keep
  // Phone failed every time (A4 pass 16 L2): the deletion record superseded
  // its kept copy, and Settings said neither copy was changed.
  await closeConflictOfDeletedProjectUpdate(conflict);
  // The cloud's copy as it is now, before either choice writes anything
  // (whole-app audit A4 pass 16 L3, A7 pass 14 M-1). Review Conflicts showed
  // the copy saved when the conflict was found: Keep Phone, stamped now, put
  // the phone's copy over an iPad edit made since that the screen never
  // showed, and Keep Cloud ended with it. When it changed, the conflict is
  // saved again with it, and nothing is sent: David reviews it again. A copy
  // that cannot be read changes nothing either. Keep Cloud's own first read
  // (A4 pass 11 O1, pass 12 L1). Compared with the copy the screen showed
  // (A4 pass 17 L1): on weak signal Review Conflicts' own read could land
  // while "Keep Phone Copy?" was up and save the iPad's newest copy into the
  // conflict, which then passed this check unseen.
  const current = await getProjectUpdateSyncMetadata<Record<string, unknown>>(conflict.localId);
  if (!current.ok || current.stubbed) throw new Error('sync_conflict_cloud_copy_unreadable');
  const withDocumentChanges = await withDocumentChangesSinceConflict(conflict.localId);
  const phoneCopies = phoneCopiesOfFieldUpdateInConflict(conflict, await getOfflineQueue());
  if (await recordCloudCopyIfChangedSinceConflict(conflict, current.data, phoneCopies, withDocumentChanges,
    cloudCopyShown === undefined ? conflict.remotePayload : cloudCopyShown)) {
    throw new Error('sync_conflict_cloud_copy_changed');
  }

  if (resolution === 'keep_cloud') {
    const cloudUpdate = conflict.remotePayload;
    if (!isRecord(cloudUpdate)) {
      throw new Error('sync_conflict_cloud_copy_missing');
    }
    // The phone's queued revisions (the conflict-era edit and any newer one)
    // are withdrawn around any upload in flight, and the chosen copy goes
    // back through the queue (the one write path, as Keep Phone does), so
    // neither a later upload nor a retry that already reached the cloud
    // undoes the choice. The cloud's copy as it is now (whole-app audit A4
    // pass 11 O1): not one of this phone's own copies, which a retry in
    // flight may have put there: that is not the cloud's choice. Read before
    // this phone's waiting work is withdrawn (A4 pass 12 L1): a failed read
    // had taken a newer phone edit or a document change off the queue, while
    // Settings said neither copy was changed.
    const withdrawn = await withdrawProjectUpdateFromSyncQueue(conflict.localId);
    let queuedCloudCopy: SyncQueueItem | null = null;
    let chosenCloudUpdate: TUpdate;
    try {
      await uploadPendingChanges();
      withdrawn.push(...await withdrawProjectUpdateFromSyncQueue(conflict.localId));
      // And read again now (A4 pass 13 L1): an iPad save that landed while
      // this phone's work was withdrawn and that upload pass ran went under
      // the copy read before it. The first read stays the check that the
      // cloud can be reached, and stands in when this one fails.
      const reread = await getProjectUpdateSyncMetadata<Record<string, unknown>>(conflict.localId).catch(() => null);
      const currentCopy = (reread?.ok && !reread.stubbed ? reread : current).data?.updateData;
      const cloudNow = isRecord(currentCopy) && !phoneCopies.some(copy =>
        sameProjectUpdateContent(copy, currentCopy as unknown as ProjectUpdate, { retryStampsAside: true }))
        ? currentCopy : cloudUpdate;
      // Archived on this phone while the archive still waits (whole-app
      // audit A7 pass 14 L-3): withdrawn with the rest, it is kept.
      // And this phone's analysis results for the photos the cloud's copy
      // shares (A7 pass 14 L-2): one taken into an edit of the phone's (the
      // conflict's own, or one held for review) never reached the cloud.
      chosenCloudUpdate = withArchiveKept(
        withPhoneAnalysisResults(withDocumentChanges(cloudNow), phoneCopies), withdrawn) as TUpdate;
      queuedCloudCopy = await enqueuePendingChange<ProjectUpdateRecordPayload<TUpdate>>({
        id: projectUpdateQueueItemId(conflict.localId),
        entity: 'project_update',
        operation: 'update',
        payload: {
          id: conflict.localId,
          projectId: typeof cloudNow.projectId === 'string' ? cloudNow.projectId : localPayload.projectId,
          projectName: typeof cloudNow.projectName === 'string' ? cloudNow.projectName : localPayload.projectName,
          selectedAreaName: typeof cloudNow.selectedAreaName === 'string'
            ? cloudNow.selectedAreaName
            : localPayload.selectedAreaName,
          updateData: chosenCloudUpdate,
          // The cloud copy's photos are already in cloud storage.
          pendingPhotoAssetIds: [],
          overConflict: conflict.id, // David's choice (A4 pass 15 H1)
        },
        changedAt: new Date().toISOString(),
        autoUpload: false,
      }) as SyncQueueItem;
      const exact = await uploadExactQueueItem(projectUpdateQueueItemId(conflict.localId));
      if (!exact.landed) throw new Error(exact.error || 'sync_conflict_save_failed');
    } catch (error) {
      await putBackWithdrawnProjectUpdateWork(withdrawn, queuedCloudCopy);
      throw error;
    }
    beforeClose?.(chosenCloudUpdate);
    await clearResolvedConflict(conflict.id);
    return chosenCloudUpdate;
  }

  if (localPayload.updateData === undefined) {
    throw new Error('sync_conflict_local_copy_missing');
  }
  // Archived during the conflict, on either device (whole-app audit A7 pass
  // 14 L-3): an archive settles neither copy, so the conflict stays for
  // David's choice, and the copy he keeps stays archived. The conflict's own
  // copy, never archived, un-archived the update in the cloud.
  const conflictCopy = withDocumentChanges(localPayload.updateData);
  const localUpdateData = withArchiveKept(conflictCopy, await getOfflineQueue(), current.data?.updateData) as TUpdate;
  const queueItemId = projectUpdateQueueItemId(localPayload.id);
  // A newer edit saved on this phone since the conflict, still waiting to go
  // up (whole-app audit A7 pass 10 L-4): the copy recorded with the conflict
  // was put over it, and once that went up a refresh before the waiting-
  // update sync showed it as Sent; the newer edit was lost. It is put back:
  // as it was when the choice fails ("Neither copy was changed"), and after
  // the kept copy when it lands, so it goes up next. It travels in the kept
  // copy's own record, written in the same queue write (A7 pass 11 L-2):
  // held in memory, it was lost when the app was killed while the kept copy
  // uploaded, or before it was queued again. One an earlier kept copy still
  // carries (queued, or recorded with this conflict) is still one. Review
  // Conflicts shows the same edit (A4 pass 15b F1).
  const { newerEdit: _carried, ...conflictPayload } = localPayload;
  const now = new Date().toISOString();
  const ownerId = currentCloudOwner().ownerId;
  const { written, newerEdit, before } = await mutateOfflineQueue(queue => {
    const existing = queue.find(item => item.id === queueItemId);
    const newerFound = newerPhoneEditForFieldUpdateConflict(conflict, queue, conflictCopy);
    const newer = newerFound && withArchiveKeptInQueuedCopy(newerFound, localUpdateData);
    const kept: SyncQueueItem = {
      id: `project-update-${localPayload.id}`, entity: 'project_update', operation: 'update',
      payload: { ...conflictPayload, updateData: localUpdateData, overConflict: conflict.id, ...(newer ? { newerEdit: newer } : {}) },
      createdAt: now, changedAt: now, retryCount: 0, lastError: null, ...(ownerId ? { ownerId } : {}),
    };
    const nextQueue = existing?.operation === 'delete' ? queue : [...queue.filter(item => item.id !== queueItemId), kept];
    return { nextQueue, result: { written: kept, newerEdit: newer, before: existing ?? null }, persist: nextQueue !== queue };
  });
  const exact = await uploadExactQueueItem(queueItemId, written);
  if (!exact.landed) {
    // The queue as it was before the choice (whole-app audit A4 pass 16 L1):
    // with no newer edit, the kept copy stayed queued, marked as David's
    // choice, and went up by itself once the signal returned, clearing the
    // conflict, while Settings said "Neither copy was changed". What waited
    // for the update (a document change, a newer edit) goes back unmarked; an
    // earlier kept copy of this choice gives way to the edit it carries.
    const earlierChoice = (before?.payload as Partial<ProjectUpdateRecordPayload> | undefined)?.overConflict === conflict.id;
    await putBackPhoneWorkAfterFailedKeepPhone(before && !earlierChoice ? before : newerEdit, written);
    throw new Error(exact.error || 'sync_conflict_save_failed');
  }

  await clearResolvedConflict(conflict.id);
  return localUpdateData;
}

/**
 * The copy with the update's archive, when it was archived on either device
 * and this copy is not (whole-app audit A7 pass 14 L-3): the cloud's copy
 * reads archived, or this phone's archive waits in `queued`. A copy is never
 * un-archived here.
 */
function withArchiveKept(copy: unknown, queued: readonly SyncQueueItem[], cloudCopy?: unknown): unknown {
  if (!isRecord(copy) || copy.isArchived === true) return copy;
  if (isRecord(cloudCopy) && cloudCopy.isArchived === true) {
    return { ...copy, isArchived: true, archivedAt: typeof cloudCopy.archivedAt === 'string' ? cloudCopy.archivedAt : null };
  }
  const archive = queued.find(item => item.entity === 'project_update' && item.operation !== 'delete' &&
    (item.payload as Partial<ProjectUpdateRecordPayload>).id === copy.id &&
    (item.payload as Partial<ProjectUpdateRecordPayload>).archiveOnly === true);
  if (!archive) return copy;
  return { ...copy, isArchived: true, archivedAt: (archive.payload as Partial<ProjectUpdateRecordPayload>).archivedAt || archive.changedAt };
}

/**
 * The cloud's copy with this phone's analysis results for the photos it
 * shares (whole-app audit A7 pass 14 L-2), as each result's own patch would
 * have put them there: a finished result newer than the copy's (or the copy
 * still analysing), with the analysis summary of the phone copy it came
 * from. Keep Cloud lost a result taken into one of the phone's copies.
 */
function withPhoneAnalysisResults(copy: unknown, phoneCopies: readonly unknown[]): unknown {
  if (!isRecord(copy) || !Array.isArray(copy.photos)) return copy;
  const finishedAt = (analysis: unknown) => isRecord(analysis) && typeof analysis.status === 'string' && analysis.status !== 'analyzing'
    ? Date.parse(typeof analysis.updatedAt === 'string' ? analysis.updatedAt : '') || 0 : null;
  const analysisOf = (update: unknown, photoId: string) => isRecord(update) && Array.isArray(update.photos)
    ? (update.photos as unknown[]).find(photo => isRecord(photo) && photo.id === photoId) as Record<string, unknown> | undefined
    : undefined;
  let next: object = copy;
  for (const photo of copy.photos as unknown[]) {
    if (!isRecord(photo) || typeof photo.id !== 'string') continue;
    const photoId = photo.id;
    const cloudFinishedAt = finishedAt(photo.photoIntelligence);
    const newest = phoneCopies
      .map(phone => ({ phone, at: finishedAt(analysisOf(phone, photoId)?.photoIntelligence) }))
      .filter((candidate): candidate is { phone: unknown; at: number } => candidate.at !== null)
      .sort((left, right) => right.at - left.at)[0];
    if (!newest || (cloudFinishedAt !== null && newest.at <= cloudFinishedAt)) continue;
    next = applyFieldUpdatePhotoAnalysisPatch(next, fieldUpdatePhotoAnalysisPatchFor(newest.phone as object, newest.phone as object, photoId));
  }
  return next;
}

/** A newer edit Keep Phone carries, archived as the copy it keeps is (A7 pass 14 L-3). */
function withArchiveKeptInQueuedCopy(item: SyncQueueItem, kept: unknown): SyncQueueItem {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  const { isArchived, archivedAt } = (isRecord(kept) ? kept : {}) as { isArchived?: unknown; archivedAt?: unknown };
  if (isArchived !== true || !isRecord(payload.updateData) || payload.updateData.isArchived === true) return item;
  return { ...item, payload: { ...payload, updateData: { ...payload.updateData, isArchived, archivedAt } } };
}

/**
 * This phone's whole copies of an update in conflict: the conflict's own,
 * those queued, and a newer edit one of them carries (A7 pass 11 L-2). A
 * cloud copy that is one of them is not the iPad's edit.
 */
function phoneCopiesOfFieldUpdateInConflict(conflict: SyncConflict, queue: readonly SyncQueueItem[]): unknown[] {
  const localPayload = conflict.localPayload as Partial<ProjectUpdateRecordPayload> | undefined;
  const queued = queue.filter(item => item.entity === 'project_update' && item.operation !== 'delete' &&
    (item.payload as Partial<ProjectUpdateRecordPayload>).id === conflict.localId);
  const carried = [...queued.map(item => (item.payload as Partial<ProjectUpdateRecordPayload>).newerEdit), localPayload?.newerEdit]
    .filter((item): item is SyncQueueItem => isRecord(item));
  return [localPayload?.updateData, ...[...queued, ...carried]
    .filter(item => !queuedFieldUpdateDocumentPatches(item))
    .map(item => (item.payload as Partial<ProjectUpdateRecordPayload>).updateData)]
    .filter(isRecord);
}

/**
 * Whether the cloud's copy of an update in conflict changed since the
 * conflict was saved, and if so, the conflict saved again with it (whole-app
 * audit A4 pass 16 L3, A7 pass 14 M-1): Review Conflicts then shows it. Not a
 * change: this phone's own document changes and analysis results, which go
 * onto the cloud's copy during a conflict, an archive (carried by either
 * choice), or one of this phone's own copies (a retry that reached the
 * cloud). `cloud`: the cloud's row as read now; none, no change.
 * `seen`: the cloud copy the screen showed (A4 pass 17 L1), by default the
 * one saved with the conflict.
 */
async function recordCloudCopyIfChangedSinceConflict(
  conflict: SyncConflict,
  cloud: { updatedAt?: string | null; updateData?: unknown } | null | undefined,
  phoneCopies: readonly unknown[],
  withDocumentChanges: (copy: unknown) => unknown,
  seen: unknown = conflict.remotePayload,
): Promise<boolean> {
  const cloudCopy = cloud?.updateData;
  if (!isRecord(cloudCopy)) return false;
  const shown = (copy: unknown) => {
    if (!isRecord(copy)) return copy;
    const { isArchived: _isArchived, archivedAt: _archivedAt, ...rest } = withoutPhotoAnalysis(copy) as Record<string, unknown>;
    return withDocumentChanges(rest);
  };
  if (sameProjectUpdateContent(shown(seen), shown(cloudCopy) as ProjectUpdate, { retryStampsAside: true })) return false;
  if (phoneCopies.some(copy => sameProjectUpdateContent(copy, cloudCopy as unknown as ProjectUpdate, { retryStampsAside: true }))) {
    return false;
  }
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    if (!conflicts.some(item => item.id === conflict.id)) return;
    await writeSyncConflicts(conflicts.map(item => item.id === conflict.id
      ? { ...item, remotePayload: cloudCopy, remoteChangedAt: cloud?.updatedAt ?? item.remoteChangedAt }
      : item));
  });
  return true;
}

/**
 * The cloud's copy of each field update in conflict, read again when Review
 * Conflicts opens (whole-app audit A4 pass 16 L3, A7 pass 14 M-1): a conflict
 * whose cloud copy changed since it was saved is saved again with it, so the
 * "Cloud:" line shows the copy Keep Cloud keeps and Keep Phone replaces. One
 * that cannot be read stays as it is. The conflicts, as saved now.
 */
export async function refreshFieldUpdateConflictCloudCopies(): Promise<SyncConflict[]> {
  const conflicts = (await getSyncConflicts()).filter(conflict => conflict.entity === 'project_update');
  for (const conflict of conflicts) {
    const current = await getProjectUpdateSyncMetadata<Record<string, unknown>>(conflict.localId).catch(() => null);
    if (!current?.ok || current.stubbed) continue;
    await recordCloudCopyIfChangedSinceConflict(conflict, current.data,
      phoneCopiesOfFieldUpdateInConflict(conflict, await getOfflineQueue()),
      await withDocumentChangesSinceConflict(conflict.localId));
  }
  return getSyncConflicts();
}

/**
 * A field update deleted on any device (this phone's deletion journal, or the
 * cloud's deletion records): its conflict is cleared and
 * sync_conflict_record_deleted thrown, before either choice writes anything
 * (whole-app audit A4 pass 16 L2). The cloud's deletion history must be
 * readable, as for Keep Cloud before.
 */
async function closeConflictOfDeletedProjectUpdate(conflict: SyncConflict): Promise<void> {
  const tombstoneSync = await synchronizeDAVESyncTombstones();
  if (!tombstoneSync.cloudAuthoritative) {
    throw new Error('sync_conflict_deletion_history_unavailable');
  }
  const normalizedUpdateId = conflict.localId.trim().toLowerCase();
  const updateWasDeleted =
    (await hasProjectUpdateDeletionIntent(conflict.localId)) ||
    deletedDAVERecordIds(tombstoneSync.tombstones, 'project_update')
      .some(recordId => recordId.trim().toLowerCase() === normalizedUpdateId);
  if (!updateWasDeleted) return;
  await clearConflictsForLocalRecord('project_update', conflict.localId);
  throw new Error('sync_conflict_record_deleted');
}

/**
 * Why a conflict choice stopped without sending anything, for Settings to
 * explain in plain words: the record was deleted on another device, or the
 * cloud's copy changed since the screen showed it. Null for any other failure,
 * which Settings reports without detail (raw errors are never shown there).
 */
export function syncConflictChoiceStopReason(
  error: unknown,
): 'record_deleted' | 'cloud_copy_changed' | 'save_unconfirmed' | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'sync_conflict_record_deleted') return 'record_deleted';
  if (error.message === 'sync_conflict_cloud_copy_changed') return 'cloud_copy_changed';
  // A task's Keep Cloud wrote and the cloud did not answer (A7 pass 16 L-2).
  if (error.message === 'sync_conflict_save_unconfirmed') return 'save_unconfirmed';
  return null;
}

/**
 * The newer edit Keep Phone sends after a field update conflict's own copy:
 * the update's queued whole copy when it is not the conflict's copy, or one
 * an earlier kept copy still carries (queued, or recorded with the conflict).
 * Settings › Review Conflicts shows it as the phone's side, what Keep Phone
 * ends with (whole-app audit A4 pass 15b F1); `conflictCopy` defaults to the
 * copy recorded with the conflict, as the screen reads it.
 */
export function newerPhoneEditForFieldUpdateConflict(
  conflict: SyncConflict,
  queue: readonly SyncQueueItem[],
  conflictCopy: unknown = (conflict.localPayload as Partial<ProjectUpdateRecordPayload> | undefined)?.updateData,
): SyncQueueItem | null {
  if (conflict.entity !== 'project_update' || !isRecord(conflict.localPayload)) return null;
  const localPayload = conflict.localPayload as Partial<ProjectUpdateRecordPayload>;
  const existing = queue.find(item => item.id === projectUpdateQueueItemId(localPayload.id ?? conflict.localId));
  const queuedCarried = (existing?.payload as Partial<ProjectUpdateRecordPayload> | undefined)?.newerEdit;
  return [existing, queuedCarried, localPayload.newerEdit].find((item): item is SyncQueueItem =>
    isRecord(item) && isNewerQueuedPhoneEdit(item as SyncQueueItem, conflictCopy)) ?? null;
}

/** A whole copy of the update, queued, that is not the conflict's copy: an edit saved since (A7 pass 10 L-4). */
function isNewerQueuedPhoneEdit(item: SyncQueueItem, conflictCopy: unknown): boolean {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  return item.entity === 'project_update' && item.operation !== 'delete' && !payload.archiveOnly &&
    !queuedFieldUpdateDocumentPatches(item) && isRecord(payload.updateData) &&
    !sameProjectUpdateContent(payload.updateData, conflictCopy as ProjectUpdate, { retryStampsAside: true });
}

/**
 * What waited for the update back in place of the kept copy Keep Phone
 * queued (none: the kept copy is dropped), never marked as a choice over the
 * conflict, unless something newer was queued meanwhile (A4 pass 16 L1).
 */
async function putBackPhoneWorkAfterFailedKeepPhone(before: SyncQueueItem | null, written: SyncQueueItem): Promise<void> {
  await mutateOfflineQueue(queue => {
    const current = queue.find(item => item.id === written.id);
    if (current ? !sameStagedProjectUpdateRecord(current, written) : !before) {
      return { nextQueue: queue, result: undefined, persist: false };
    }
    const others = queue.filter(item => item.id !== written.id);
    return { nextQueue: before ? [...others, withoutChoiceOverConflict(before)] : others, result: undefined };
  });
}

/**
 * A copy recorded with a field update's conflict, with the document changes
 * this device made since (whole-app audit A4 pass 10 R2H-3): a document
 * change leaves the conflict (A4 pass 9 L1), so both recorded copies predate
 * it. Keep Phone and Keep Cloud wrote that older copy: the cloud listed a
 * document taken off again, or read a finished upload as failed. The copy
 * now loses the documents this device took off, takes this device's upload
 * state, as a refresh does, and then the document patches still queued, the
 * newest change. Read before the resolution withdraws the queued patches.
 */
async function withDocumentChangesSinceConflict(updateId: string): Promise<(copy: unknown) => unknown> {
  const [queue, removed, storedDocuments] = await Promise.all([
    getOfflineQueue(),
    loadRemovedFieldUpdateDocuments(),
    AsyncStorage.getItem(PROJECT_DOCUMENTS_STORAGE_KEY).catch(() => null),
  ]);
  const deviceDocuments = parseStoredProjectDocuments(storedDocuments) || [];
  const waiting = queuedDocumentPatchesForUpdate(queue, updateId) || [];
  return copy => isRecord(copy)
    ? applyFieldUpdateDocumentPatches(withDeviceDocumentUploadState(copy, deviceDocuments, undefined, removed), waiting)
    : copy;
}

/**
 * Uploads the queue and says whether this one item landed, whatever else is
 * still queued (whole-app audit A7 pass 3: Keep Phone and Keep Cloud failed,
 * and said "Neither copy was changed", whenever any other item was waiting,
 * after they had in fact written the chosen copy). One more pass when an
 * older in-flight upload missed the item, as for tasks.
 */
async function uploadExactQueueItem(
  queueItemId: string,
  /** The record written, when what replaces it once it lands is not it (Keep Phone's newer edit, A7 pass 11 L-2). */
  written?: SyncQueueItem,
): Promise<{ landed: boolean; error: string | null }> {
  const stillQueued = async () => (await getOfflineQueue()).find(item =>
    item.id === queueItemId && (!written || sameStagedProjectUpdateRecord(item, written)));
  let result = await uploadPendingChanges();
  let remaining = await stillQueued();
  let outcome = result.itemOutcomes?.[queueItemId];
  if (remaining && (!outcome || outcome === 'uploaded')) {
    result = await uploadPendingChanges();
    remaining = await stillQueued();
    outcome = result.itemOutcomes?.[queueItemId];
  }
  const landed = outcome === 'uploaded' && !remaining;
  return { landed, error: landed ? null : remaining?.lastError || result.errors[0] || null };
}

/**
 * The cloud's row for a task as it is now (whole-app audit A8 pass 12 L2);
 * null when the cloud has none. sync_conflict_cloud_copy_unreadable when the
 * cloud cannot be read. Read by its id (A7 pass 15 L-2): the full list pages
 * by offset, newest first, so a row edited while it was read could be missed,
 * and the conflict was closed as "deleted on another device".
 */
async function currentCloudScheduleItem(itemId: string): Promise<ScheduleItem | null> {
  const cloud = await getScheduleItem(itemId).catch(() => null);
  if (!cloud?.ok || cloud.stubbed) {
    throw new Error('sync_conflict_cloud_copy_unreadable');
  }
  return cloud.data ?? null;
}

/**
 * The fields of a task's cloud row that hold one of this phone's waiting
 * edits and not the copy the screen showed (whole-app audit A7 pass 15 L-1):
 * of each edit's own fields (every field of a whole copy), those where the
 * row has the edit's value. Identity, stamps, earlier task ids and import
 * memberships aside.
 */
function taskFieldsHoldingPhoneEdits(
  row: ScheduleItem,
  shown: unknown,
  edits: readonly SyncQueueItem[],
): string[] {
  return [...new Set(edits.flatMap(edit => {
    const payload = edit.payload as Partial<ScheduleItemRecordPayload>;
    if (edit.entity !== 'schedule_item' || edit.operation === 'delete' || !isRecord(payload.itemData)) return [];
    const fields = Array.isArray(payload.changedFields) ? payload.changedFields.map(String) : Object.keys(payload.itemData);
    return fields.filter(field => !TASK_FIELDS_ASIDE_IN_CONFLICT_CHECK.has(field) &&
      taskFieldValue(row, field) === taskFieldValue(payload.itemData, field) &&
      taskFieldValue(row, field) !== taskFieldValue(shown, field));
  }))];
}

/** Identity, stamps, and the ids Keep Phone keeps from both copies: no edit of David's (whole-app audit A7 pass 15). */
const TASK_FIELDS_ASIDE_IN_CONFLICT_CHECK: ReadonlySet<string> = new Set([
  'id', 'projectId', 'updatedAt', 'cloudUpdatedAt', 'revisedFromTaskIds', 'alsoImportedInBatchIds',
]);

/** One field of a task copy, as compared: key order aside, and a missing field reads as null. */
function taskFieldValue(item: unknown, field: string): string {
  const value = isRecord(item) ? item[field] : undefined;
  return value === undefined || value === null ? 'null' : canonicalScheduleItemJson(value);
}

/**
 * The task's cloud row with this phone's landed edits undone (whole-app audit
 * A7 pass 15 L-1): each such field, and the row's stamp, back to the cloud's
 * value before the edit landed (`before`, Keep Cloud's first read), or, when
 * that already held it, to the copy the screen showed.
 */
function withPhoneEditsUndone(row: ScheduleItem, fields: readonly string[], before: ScheduleItem, shown: unknown): ScheduleItem {
  const next: Record<string, unknown> = { ...row };
  [...fields, 'updatedAt'].forEach(field => {
    const source: unknown = taskFieldValue(before, field) !== taskFieldValue(row, field) ? before : shown;
    const value = isRecord(source) ? source[field] : undefined;
    if (value === undefined) delete next[field];
    else next[field] = value;
  });
  return next as ScheduleItem;
}

/** Two copies of a task alike in every field but identity, stamps, earlier task ids and import memberships. */
function sameTaskContent(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(field =>
    TASK_FIELDS_ASIDE_IN_CONFLICT_CHECK.has(field) || taskFieldValue(left, field) === taskFieldValue(right, field));
}

/** This phone's copies of a task in conflict: the conflict's own, and any waiting in the queue. */
function phoneCopiesOfTaskInConflict(conflict: SyncConflict, queue: readonly SyncQueueItem[]): unknown[] {
  const queueItemId = scheduleItemQueueItemId(conflict.localId);
  return [
    (conflict.localPayload as Partial<ScheduleItemRecordPayload> | undefined)?.itemData,
    ...queue.filter(item => item.id === queueItemId && item.operation !== 'delete')
      .map(item => (item.payload as Partial<ScheduleItemRecordPayload>).itemData),
  ].filter(isRecord);
}

/**
 * A task's conflict saved again with the cloud's row when the row changed
 * since the copy the screen showed (whole-app audit A7 pass 15 L-3, as for
 * field updates): in any field but identity, stamps, earlier task ids and
 * import memberships, which change with no edit of David's or which Keep
 * Phone keeps from the row; and not when the row is one of this phone's own
 * copies. `seen` is by default the copy saved with the conflict. True when
 * it changed.
 */
async function recordTaskCloudCopyIfChanged(
  conflict: SyncConflict,
  row: ScheduleItem,
  phoneCopies: readonly unknown[],
  seen: unknown = conflict.remotePayload,
): Promise<boolean> {
  if (sameTaskContent(row, seen) || phoneCopies.some(copy => sameTaskContent(row, copy))) return false;
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    if (!conflicts.some(item => item.id === conflict.id)) return;
    await writeSyncConflicts(conflicts.map(item => item.id === conflict.id
      ? { ...item, remotePayload: row, remoteChangedAt: row.updatedAt ?? item.remoteChangedAt }
      : item));
  });
  return true;
}

/**
 * The cloud's row of each task in conflict, read again when Review Conflicts
 * opens (whole-app audit A7 pass 15 L-3, as field updates are): the "Cloud:"
 * line showed the copy saved when the conflict was found, after the web set
 * the task to 50%. One that cannot be read, or is gone, stays as it is. The
 * conflicts, as saved now.
 */
export async function refreshScheduleItemConflictCloudCopies(): Promise<SyncConflict[]> {
  const conflicts = (await getSyncConflicts()).filter(conflict => conflict.entity === 'schedule_item');
  for (const conflict of conflicts) {
    const row = await currentCloudScheduleItem(conflict.localId).catch(() => null);
    if (!row) continue;
    await recordTaskCloudCopyIfChanged(conflict, row, phoneCopiesOfTaskInConflict(conflict, await getOfflineQueue()));
  }
  return getSyncConflicts();
}

/** Takes a task's waiting edits off the queue; the edits taken. */
function withdrawScheduleItemFromSyncQueue(itemId: string): Promise<SyncQueueItem[]> {
  const queueItemId = scheduleItemQueueItemId(itemId);
  return mutateOfflineQueue(queue => {
    const withdrawn = queue.filter(item => item.id === queueItemId);
    return {
      nextQueue: queue.filter(item => item.id !== queueItemId),
      result: withdrawn,
      persist: withdrawn.length > 0,
    };
  });
}

/**
 * A task's conflict put back as it was before Keep Cloud (whole-app audit A7
 * pass 15 L-1), when it stops without keeping a copy after an edit of this
 * phone's landed: the conflict, which that landing closed, is saved again.
 * The edits it withdrew, or that an upload already under way took off the
 * queue as it landed, wait on the conflict, oldest first (A7 pass 16 L-2):
 * put back on the queue, the next automatic pass sent them (tasks have no
 * hold), undoing the choice. An edit made since stays queued, as any is.
 */
async function putBackTaskConflictAsItWas(conflict: SyncConflict, edits: readonly SyncQueueItem[]): Promise<void> {
  const unique = edits.filter((edit, index) =>
    edits.findIndex(other => JSON.stringify(other) === JSON.stringify(edit)) === index);
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    const open = conflicts.find(item => item.entity === conflict.entity && item.localId === conflict.localId);
    const base = open ?? conflict;
    const saved = { ...base, localPayload: { ...(base.localPayload as ScheduleItemRecordPayload), withdrawnEdits: unique } };
    await writeSyncConflicts(open ? conflicts.map(item => item === open ? saved : item) : [...conflicts, saved]);
  });
}

export async function resolveScheduleItemSyncConflict(
  conflictId: string,
  resolution: 'keep_local' | 'keep_cloud',
  /**
   * The cloud copy Review Conflicts showed when David chose (whole-app audit
   * A7 pass 15, as for field updates, A4 pass 17 L1); without it, the copy
   * saved with the conflict.
   */
  { cloudCopyShown }: { cloudCopyShown?: unknown } = {},
): Promise<ScheduleItem> {
  // This phone's waiting edits of the task, before anything else: an upload
  // already under way takes one off the queue once it has landed it.
  const queueAtChoice = await getOfflineQueue();
  const conflicts = await getSyncConflicts();
  const conflict = conflicts.find(item => item.id === conflictId);

  if (!conflict || conflict.entity !== 'schedule_item') {
    throw new Error('sync_conflict_not_found');
  }
  const shown = cloudCopyShown === undefined ? conflict.remotePayload : cloudCopyShown;
  const waitingEdits = queueAtChoice.filter(item => item.id === scheduleItemQueueItemId(conflict.localId));

  const tombstoneSync = await synchronizeDAVESyncTombstones();
  if (!tombstoneSync.cloudAuthoritative) {
    throw new Error('sync_conflict_deletion_history_unavailable');
  }
  const tombstones = tombstoneSync.tombstones;
  const normalizedConflictId = conflict.localId.trim().toLowerCase();
  const itemWasDeleted = deletedDAVERecordIds(tombstones, 'schedule_item')
    .some(recordId => recordId.trim().toLowerCase() === normalizedConflictId);
  if (itemWasDeleted) {
    await clearScheduleItemSyncConflicts(conflict.localId);
    throw new Error('sync_conflict_record_deleted');
  }

  const localPayload = conflict.localPayload as ScheduleItemRecordPayload;
  const localItem = localPayload.itemData;

  if (resolution === 'keep_cloud') {
    // The cloud's row as it is now, read before this phone's waiting work is
    // withdrawn (whole-app audit A8 pass 12 L2, as for field updates, A4
    // pass 12 L1 and pass 16 L3). Keep Cloud wrote back the copy saved when
    // the conflict was found, over an earlier task id a web delete handed the
    // task since and the progress David entered on the web. A cloud that
    // cannot be read changes nothing; a task the cloud no longer has is not
    // written back, and its conflict is closed.
    const cloudItem = await currentCloudScheduleItem(conflict.localId);
    if (!cloudItem) {
      await clearScheduleItemSyncConflicts(conflict.localId);
      throw new Error('sync_conflict_record_deleted');
    }
    // Remove both the conflict-era edit and any newer queued local revision,
    // around any upload of this phone's already under way.
    const withdrawn = await withdrawScheduleItemFromSyncQueue(conflict.localId);
    await uploadPendingChanges();
    withdrawn.push(...await withdrawScheduleItemFromSyncQueue(conflict.localId));
    // With those an earlier Keep Cloud that could not finish withdrew (A7 pass 16 L-2).
    const phoneEdits = [...localPayload.withdrawnEdits ?? [], ...waitingEdits, ...withdrawn];
    try {
      // Read again now: an edit from another device that landed meanwhile is
      // the cloud's too.
      const reread = await currentCloudScheduleItem(conflict.localId).catch(() => undefined);
      if (reread === null) {
        await clearScheduleItemSyncConflicts(conflict.localId);
        throw new Error('sync_conflict_record_deleted');
      }
      // The first read stands in when this one fails, unless an edit of this
      // phone's may be in the cloud (whole-app audit A7 pass 15 L-1): one
      // landed during the choice (its landing closes the conflict), or the
      // first read holds one. Then nothing is decided, and nothing changes.
      if (reread === undefined && (
        !(await getSyncConflicts()).some(item => item.entity === 'schedule_item' && item.localId === conflict.localId) ||
        taskFieldsHoldingPhoneEdits(cloudItem, shown, phoneEdits).length > 0
      )) {
        throw new Error('sync_conflict_cloud_copy_unreadable');
      }
      const cloudNow = reread ?? cloudItem;
      // The cloud already holds its own copy, so nothing is written back,
      // unless it holds an edit of this phone's that David discarded: an
      // upload under way when he chose landed it, before Keep Cloud read the
      // cloud or after. It is undone, back to the copy the screen showed
      // (A7 pass 15 L-1: only a landing between the two reads was undone).
      const phoneFields = taskFieldsHoldingPhoneEdits(cloudNow, shown, phoneEdits);
      if (phoneFields.length === 0) {
        await clearResolvedConflict(conflict.id);
        return cloudNow;
      }
      const restored = withPhoneEditsUndone(cloudNow, phoneFields, cloudItem, shown);
      // A write that fails may still have landed (its answer lost on weak
      // signal), so Settings does not say "Neither copy was changed" (A7
      // pass 16 L-2). Chosen again, Keep Cloud finds the restore there, or
      // writes it.
      const restore = await upsertScheduleItem(restored).catch(() => null);
      if (!restore?.ok || restore.stubbed) {
        throw new Error('sync_conflict_save_unconfirmed');
      }
      await clearResolvedConflict(conflict.id);
      return restored;
    } catch (error) {
      if (!(error instanceof Error && error.message === 'sync_conflict_record_deleted')) {
        await putBackTaskConflictAsItWas(conflict, phoneEdits);
      }
      throw error;
    }
  }

  if (!localItem || typeof localItem.id !== 'string') {
    throw new Error('sync_conflict_local_copy_missing');
  }

  // The cloud's row as it is now, before anything is sent (whole-app audit
  // A7 pass 15 L-3, as for field updates, A4 pass 16 L3 and pass 17 L1).
  // Keep Phone put the phone's copy over a cloud edit the screen never
  // showed: the web's 50% was lost while Review Conflicts said "0%". When the
  // row changed since the copy the screen showed, the conflict is saved with
  // it and nothing is sent: David reviews it again. A cloud that cannot be
  // read changes nothing; a task the cloud no longer has is not written
  // back, and its conflict is closed.
  const cloudNow = await currentCloudScheduleItem(conflict.localId);
  if (!cloudNow) {
    await clearScheduleItemSyncConflicts(conflict.localId);
    throw new Error('sync_conflict_record_deleted');
  }
  if (await recordTaskCloudCopyIfChanged(conflict, cloudNow, phoneCopiesOfTaskInConflict(conflict, await getOfflineQueue()), shown)) {
    throw new Error('sync_conflict_cloud_copy_changed');
  }

  // The phone's copy, still in every revision the cloud copy was re-homed
  // into (whole-app audit A5 pass 3 F6) and answering to every earlier task
  // id the cloud copy names (A8 pass 10 L2: a delete on another device wrote
  // one): the cloud's row as it is now, not the copy saved with the conflict
  // (A7 pass 15 L-3). The upload adds any newer ones.
  const keptItem = withScheduleTaskEarlierIdsOf(
    withScheduleImportMembershipOf(localItem, cloudNow),
    cloudNow,
  );
  const queueItemId = scheduleItemQueueItemId(localItem.id);
  await enqueuePendingChange<ScheduleItemRecordPayload>({
    id: queueItemId,
    entity: 'schedule_item',
    operation: 'update',
    payload: {
      id: localItem.id,
      itemData: keptItem,
      forceLocal: true,
    },
    changedAt: new Date().toISOString(),
    autoUpload: false,
  });
  let result = await uploadPendingChanges();
  let remainingQueue = await getOfflineQueue();
  let exactItemStillQueued = remainingQueue.some(item => item.id === queueItemId);
  let exactOutcome = result.itemOutcomes?.[queueItemId];

  if (
    exactItemStillQueued &&
    (!exactOutcome || exactOutcome === 'uploaded')
  ) {
    result = await uploadPendingChanges();
    remainingQueue = await getOfflineQueue();
    exactItemStillQueued = remainingQueue.some(item => item.id === queueItemId);
    exactOutcome = result.itemOutcomes?.[queueItemId];
  }

  if (
    exactOutcome !== 'uploaded' ||
    exactItemStillQueued
  ) {
    throw new Error(result.errors[0] || 'sync_conflict_save_failed');
  }

  await clearResolvedConflict(conflict.id);
  return keptItem;
}

type ReferenceDocumentUploadSuccess = {
  outcome: 'uploaded';
  referenceDocument: ReferenceDocument;
};

type QueueUploadContext = {
  projectsAuthorityPromise?: ReturnType<typeof listProjects>;
  projectIdentityAuthority?: OperationalProjectIdentityAuthority;
  archivedProjectsAuthorityPromise?: ReturnType<typeof listArchivedProjects>;
  archivedProjectIdentityAuthority?: OperationalProjectIdentityAuthority;
  projectAreasAuthorityPromise?: ReturnType<typeof listProjectAreas>;
  projectAreasById?: Map<string, ProjectArea>;
  scheduleItemsAuthorityPromise?: ReturnType<typeof listScheduleItems>;
  scheduleItemsById?: Map<string, ScheduleItem>;
  referenceDocumentsAuthorityPromise?: ReturnType<typeof listReferenceDocuments>;
  referenceDocumentsById?: Map<string, ReferenceDocument>;
  projectUpdateMetadataPromises?: Map<
    string,
    ReturnType<typeof getProjectUpdateSyncMetadata>
  >;
  legacyDeletedProjectNamesPromise?: Promise<ReadonlySet<string>>;
  /** Items this pass already uploaded or retired (still in the stored queue until it ends). */
  settledQueueItemIds?: ReadonlySet<string>;
};

const PROJECT_UPDATE_RECEIPT_PREFETCH_CONCURRENCY = 8;

function projectUpdateCanUseCloudReceipt(item: SyncQueueItem): boolean {
  if (item.entity !== 'project_update' || item.operation !== 'update') return false;
  const payload = item.payload as ProjectUpdateRecordPayload;
  if (payload.archiveOnly || !payload.updateData) return false;
  const pendingPhotoAssetIds = Array.isArray(payload.pendingPhotoAssetIds)
    ? payload.pendingPhotoAssetIds
    : [];
  return uniquePhotoAssetIds(pendingPhotoAssetIds).length === 0;
}

async function preloadProjectUpdateCloudReceipts(
  items: readonly SyncQueueItem[],
  context: QueueUploadContext,
): Promise<void> {
  const updateIds = [...new Set(items.flatMap(item => {
    if (!projectUpdateCanUseCloudReceipt(item)) return [];
    return [(item.payload as ProjectUpdateRecordPayload).id];
  }))];
  await mapWithBoundedConcurrency(
    updateIds,
    PROJECT_UPDATE_RECEIPT_PREFETCH_CONCURRENCY,
    updateId => loadProjectUpdateSyncMetadata(updateId, context).then(() => undefined),
  );
}

function pendingUploadOrder(queue: readonly SyncQueueItem[]): SyncQueueItem[] {
  return queue
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftIsTask = left.item.entity === 'schedule_item';
      const rightIsTask = right.item.entity === 'schedule_item';
      if (leftIsTask !== rightIsTask) return leftIsTask ? -1 : 1;

      if (leftIsTask && rightIsTask) {
        const leftChangedAt = new Date(left.item.changedAt).getTime();
        const rightChangedAt = new Date(right.item.changedAt).getTime();
        if (
          Number.isFinite(leftChangedAt) &&
          Number.isFinite(rightChangedAt) &&
          leftChangedAt !== rightChangedAt
        ) {
          return rightChangedAt - leftChangedAt;
        }
      }

      return left.index - right.index;
    })
    .map(entry => entry.item);
}

async function prepareQueueItemProjectIdentity(
  item: SyncQueueItem,
  context: QueueUploadContext,
): Promise<SyncQueueItem | string> {
  if (
    item.operation === 'delete' ||
    (
      item.entity !== 'project_update' &&
      item.entity !== 'schedule_item' &&
      item.entity !== 'reference_document'
    )
  ) {
    return item;
  }

  if (item.entity === 'project_update') {
    const payload = item.payload as ProjectUpdateRecordPayload;
    if (payload.archiveOnly && !payload.projectId) return item;
  }
  if (item.entity === 'reference_document') {
    const payload = item.payload as ReferenceDocumentRecordPayload;
    if (
      !payload.documentData.projectId &&
      !payload.documentData.projectName &&
      !payload.documentData.projectNames?.some(name => name.trim())
    ) {
      return item;
    }
  }

  const authority = await loadOperationalProjectIdentityAuthority(context);
  if (typeof authority === 'string') return authority;

  let nextPayload: SyncQueueItem['payload'] | null = null;
  if (item.entity === 'project_update') {
    const payload = item.payload as ProjectUpdateRecordPayload<Record<string, unknown>>;
    if (!payload.updateData) return item;
    const identity = {
      projectId: payload.projectId || payload.updateData.projectId as string | null | undefined,
      projectName: payload.projectName || payload.updateData.projectName as string | null | undefined,
    };
    const active = resolveOperationalProjectIdentity(identity, authority);
    const resolved = active.ok
      ? active
      : await resolveArchivedProjectUpdateIdentity(identity, active, context);
    if (!resolved.ok) return resolved.error;
    nextPayload = {
      ...payload,
      projectId: resolved.identity.id,
      projectName: payload.projectName || resolved.identity.name,
      updateData: {
        ...payload.updateData,
        projectId: resolved.identity.id,
      },
    };
  } else if (item.entity === 'schedule_item') {
    const payload = item.payload as ScheduleItemRecordPayload;
    const resolved = resolveOperationalProjectIdentity(payload.itemData, authority);
    if (!resolved.ok) return resolved.error;
    nextPayload = {
      ...payload,
      itemData: {
        ...payload.itemData,
        projectId: resolved.identity.id,
      },
    };
  } else {
    const payload = item.payload as ReferenceDocumentRecordPayload;
    const resolved = resolveOperationalReferenceDocumentScope(
      payload.documentData,
      authority,
    );
    if (!resolved.ok) return resolved.error;
    nextPayload = {
      ...payload,
      documentData: {
        ...payload.documentData,
        projectId: resolved.scope.projectId,
        projectName: resolved.scope.projectName,
        projectNames: [...resolved.scope.projectNames],
      },
    };
  }

  if (JSON.stringify(nextPayload) === JSON.stringify(item.payload)) return item;
  const preparedItem: SyncQueueItem = { ...item, payload: nextPayload };
  const persisted = await mutateOfflineQueue(queue => {
    const currentIndex = queue.findIndex(current => sameQueueRevision(current, item));
    if (currentIndex < 0) {
      return { nextQueue: queue, result: null, persist: false };
    }
    const nextQueue = [...queue];
    nextQueue[currentIndex] = preparedItem;
    return { nextQueue, result: preparedItem };
  });
  return persisted || 'The saved item changed while its cloud project identity was being prepared.';
}

/**
 * Audit A7 M2: a field update saved before its project was closed never
 * uploaded, because identity is checked against active projects only. Close
 * Project could even reach the cloud first: an update waits in the queue for
 * its photos, so closing the project right after saving the last update
 * stranded that update. A field update whose project is not active is
 * looked up once among closed projects. Tasks and documents still need an
 * active project.
 */
async function resolveArchivedProjectUpdateIdentity(
  identity: Readonly<{ projectId?: string | null; projectName?: string | null }>,
  activeFailure: Extract<OperationalProjectIdentityResult, { ok: false }>,
  context: QueueUploadContext,
): Promise<OperationalProjectIdentityResult> {
  if (
    activeFailure.code !== 'project_identity_required' &&
    activeFailure.code !== 'project_identity_invalid'
  ) {
    return activeFailure;
  }
  context.archivedProjectsAuthorityPromise ??= listArchivedProjects();
  const archived = await context.archivedProjectsAuthorityPromise;
  if (!archived.ok || archived.stubbed || !Array.isArray(archived.data)) return activeFailure;
  context.archivedProjectIdentityAuthority ??=
    buildOperationalProjectIdentityAuthority(archived.data);
  const resolved = resolveOperationalProjectIdentity(
    identity,
    context.archivedProjectIdentityAuthority,
  );
  return resolved.ok ? resolved : activeFailure;
}

async function loadOperationalProjectIdentityAuthority(
  context: QueueUploadContext,
): Promise<OperationalProjectIdentityAuthority | string> {
  if (context.projectIdentityAuthority) return context.projectIdentityAuthority;
  context.projectsAuthorityPromise ??= listProjects();
  const result = await context.projectsAuthorityPromise;
  if (!result.ok || result.stubbed || !Array.isArray(result.data)) {
    return result.error || result.message || 'Cloud projects could not be checked before upload.';
  }
  context.projectIdentityAuthority = buildOperationalProjectIdentityAuthority(result.data);
  return context.projectIdentityAuthority;
}

async function uploadQueueItem(
  item: SyncQueueItem,
  context: QueueUploadContext,
): Promise<string | ReferenceDocumentUploadSuccess> {
  if (item.entity === 'project') {
    return uploadProjectQueueItem(item, context);
  }

  if (item.entity === 'project_update') {
    return uploadProjectUpdateQueueItem(item, context);
  }

  if (item.entity === 'project_area') {
    const payload = item.payload as ProjectAreaRecordPayload;
    context.projectAreasAuthorityPromise ??= listProjectAreas();
    const cloud = await context.projectAreasAuthorityPromise;
    if (!cloud.ok || cloud.stubbed || !Array.isArray(cloud.data)) {
      return cloud.error || cloud.message || 'GPS area authority could not be checked.';
    }
    context.projectAreasById ??= new Map(
      cloud.data.map(candidate => [candidate.id, candidate]),
    );
    const remote = context.projectAreasById.get(payload.id);
    const authoritative = remote
      ? mergeDAVEProjectAreaRecoveryRecords({
          local: [payload.areaData],
          cloud: [remote],
        })[0]
      : payload.areaData;
    if (remote && JSON.stringify(authoritative) === JSON.stringify(remote)) {
      return 'uploaded';
    }
    const result = await upsertProjectArea(authoritative);
    if (result.ok && !result.stubbed) {
      context.projectAreasById.set(payload.id, authoritative);
      return 'uploaded';
    }
    return result.error || result.message || 'GPS area sync is waiting for Supabase.';
  }

  if (item.entity === 'schedule_item') {
    const payload = item.payload as ScheduleItemRecordPayload;
    context.scheduleItemsAuthorityPromise ??= listScheduleItems();
    const cloud = await context.scheduleItemsAuthorityPromise;
    if (!cloud.ok || cloud.stubbed || !Array.isArray(cloud.data)) {
      return cloud.error || cloud.message || 'Task authority could not be checked.';
    }
    context.scheduleItemsById ??= new Map(
      cloud.data.map(candidate => [candidate.id, candidate]),
    );
    const remote = context.scheduleItemsById.get(payload.id);
    const changedFields = Array.isArray(payload.changedFields)
      ? payload.changedFields
      : null;
    const authoritative = remote && changedFields
      ? {
          ...changedFields.reduce<ScheduleItem>(
            (merged, field) => field === 'projectControls' &&
              payload.itemData.projectControls &&
              remote.projectControls
              ? {
                  ...merged,
                  projectControls: mergeProjectControlsRevisions(
                    payload.itemData.projectControls,
                    remote.projectControls,
                  ),
                }
              : {
                  ...merged,
                  [field]: payload.itemData[field],
                },
            remote,
          ),
          updatedAt: new Date().toISOString(),
        }
      : remote && !payload.forceLocal
        ? recoverDAVEScheduleRecords({
            local: [payload.itemData],
            cloud: [remote],
            allowCloudOnly: true,
          }).find(candidate => candidate.id === payload.id) || payload.itemData
        // Keep Phone keeps the cloud's import memberships (whole-app audit A5 pass 3 F6)
        // and earlier task ids (A8 pass 10 L2).
        : withScheduleTaskEarlierIdsOf(withScheduleImportMembershipOf(payload.itemData, remote), remote);
    if (remote && JSON.stringify(authoritative) === JSON.stringify(remote)) {
      if (
        changedFields ||
        payload.forceLocal ||
        JSON.stringify(payload.itemData) === JSON.stringify(remote)
      ) {
        await clearConflictsForLocalRecord('schedule_item', payload.id);
        return 'uploaded';
      }

      await recordConflict({
        id: createQueueId('schedule_item_conflict', new Date().toISOString()),
        entity: 'schedule_item',
        localId: payload.id,
        localChangedAt: item.changedAt,
        remoteChangedAt: remote.updatedAt || null,
        reason: 'This task changed on another device before the local edit finished syncing.',
        detectedAt: new Date().toISOString(),
        localPayload: payload,
        remotePayload: remote,
      });
      return 'conflict';
    }
    const result = await upsertScheduleItem(authoritative);
    if (result.ok && !result.stubbed) {
      context.scheduleItemsById.set(payload.id, authoritative);
      await clearConflictsForLocalRecord('schedule_item', payload.id);
      return 'uploaded';
    }
    return result.error || result.message || 'Task sync is waiting for Supabase.';
  }

  if (item.entity === 'reference_document') {
    const payload = item.payload as ReferenceDocumentRecordPayload;
    context.referenceDocumentsAuthorityPromise ??= listReferenceDocuments();
    const cloud = await context.referenceDocumentsAuthorityPromise;
    if (!cloud.ok || cloud.stubbed || !Array.isArray(cloud.data)) {
      return cloud.error || cloud.message || 'Document authority could not be checked.';
    }
    context.referenceDocumentsById ??= new Map(
      cloud.data.map(candidate => [candidate.id, candidate]),
    );
    const remote = context.referenceDocumentsById.get(payload.id);
    // An edit made before the document was made current, here or on another
    // device, is not outranked by the activation's stamp (whole-app audit A8
    // pass 3 M2).
    const local = (remote && referenceDocumentEditOutlivingActivation(
      payload.documentData, remote, Date.now(), referenceDocumentDetailsSent.get(payload.id))) ||
      payload.documentData;
    const merged = remote
      ? mergeDAVEReferenceDocumentRecoveryRecords({
          local: [local],
          cloud: [remote],
        }).find(candidate => candidate.id === payload.id) || local
      : local;
    const pending = remote
      ? daveReferenceDocumentsNeedingCloudUpload({
          local: [local],
          cloud: [remote],
        }).find(candidate => candidate.id === payload.id)
      : local;
    if (remote && !pending) {
      return {
        outcome: 'uploaded',
        referenceDocument: merged,
      };
    }
    let authoritative = pending || merged;
    const hasLocalFile = Boolean(authoritative.uri?.trim());
    if (!authoritative.storagePath && hasLocalFile) {
      try {
        authoritative = await prepareReferenceDocumentForCloud(authoritative);
      } catch {
        return 'The document file could not be prepared for protected cloud storage.';
      }
      if (!authoritative.storagePath) {
        return 'The document file is still waiting for protected cloud storage.';
      }
    }
    // A record the cloud already has is updated (whole-app audit A8 pass 1 F3).
    const result = await upsertReferenceDocument(authoritative, { existing: Boolean(remote) });
    if (result.ok && !result.stubbed) {
      context.referenceDocumentsById.set(payload.id, authoritative);
      referenceDocumentDetailsSent.set(payload.id, referenceDocumentSharedDetailsFingerprint(authoritative));
      return {
        outcome: 'uploaded',
        referenceDocument: authoritative,
      };
    }
    const reason = result.error || result.message || 'Document sync is waiting for Supabase.';
    // A Current drawing whose projects the cloud kept says so (whole-app audit A8 pass 3 L2).
    return remote && classifySyncFailureText([reason]) === 'current_drawing_protected' &&
      projectNamesKey(authoritative) !== projectNamesKey(remote)
      ? currentDrawingProjectsKeptMessage(projectNamesOf(remote))
      : reason;
  }

  return `Unsupported sync entity: ${item.entity}`;
}

/** A shared record's projects, as its list or its single project name. */
function projectNamesOf(document: ReferenceDocument): string[] {
  const listed = (document.projectNames || []).filter(name => typeof name === 'string' && name.trim());
  return listed.length > 0 ? listed : [document.projectName || ''].filter(name => name.trim());
}

function projectNamesKey(document: ReferenceDocument): string {
  return [...new Set([document.projectName, ...(document.projectNames || [])]
    .map(name => String(name || '').trim().toLowerCase()).filter(Boolean))].sort().join('|');
}

async function uploadProjectQueueItem(
  item: SyncQueueItem,
  context: QueueUploadContext,
): Promise<'uploaded' | string> {
  const payload = item.payload as ProjectCreatePayload &
    ProjectUpdatePayload &
    ProjectDeletePayload;
  // A delete sent while the project's own create is still queued found no
  // cloud row, and the create then made the deleted project active on the
  // next pass (whole-app audit A3 pass 4). It waits, as a close does.
  if (
    item.operation === 'delete' &&
    await projectCreateStillQueued(payload.name || payload.previousName || '', context)
  ) {
    return 'Project delete is waiting for the project to reach the cloud.';
  }
  if (item.operation === 'update' && payload.coverPhotoUpload) {
    const upload = await uploadPhoto({
      path: payload.coverPhotoUpload.remotePath,
      uri: payload.coverPhotoUpload.localUri,
      contentType: payload.coverPhotoUpload.mimeType,
      upsert: true,
      cacheControl: '86400',
    });
    if (!upload.ok || upload.stubbed) {
      return upload.error || upload.message || 'Project cover upload is waiting for cloud sync.';
    }
  }
  if (item.operation === 'create') {
    const existing = await cloudProjectNameExists(payload.name || '');
    if (typeof existing === 'string') return existing;
    if (existing) return 'uploaded';
  }
  const result =
    item.operation === 'create'
      ? await createProject({ name: payload.name || 'Untitled Project' })
      : item.operation === 'delete'
        ? await deleteProject({ name: payload.name || payload.previousName || '' })
        : await updateProject(payload);

  if (result.ok && !result.stubbed) {
    // A close finds no cloud row while the project's own create, queued ahead
    // of it offline, has not landed yet (for example its name check could not
    // read the lists). Dropping the close let the create make the project
    // active on the next pass (whole-app audit A3 pass 3); it waits instead.
    if (
      item.operation === 'update' && payload.archived === true && !result.data &&
      await projectCreateStillQueued(payload.previousName || payload.name || '', context)
    ) {
      return 'Project close is waiting for the project to reach the cloud.';
    }
    return 'uploaded';
  }

  return result.error || result.message || 'Project sync is waiting for Supabase.';
}

async function projectCreateStillQueued(
  name: string,
  context: QueueUploadContext,
): Promise<boolean> {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  const queue = await getOfflineQueue().catch(() => null);
  if (!queue) return true;
  return queue.some(candidate =>
    candidate.entity === 'project' && candidate.operation === 'create' &&
    !context.settledQueueItemIds?.has(candidate.id) &&
    String((candidate.payload as Partial<ProjectCreatePayload>)?.name || '').trim().toLowerCase() === key);
}

/**
 * A queued create, cover photo or reopen for a project on this phone's
 * deleted-project list. The deletion record already retires them when it is
 * on this phone; a project deleted before deletion records existed has only
 * the list, and its create made the deleted project active again while its
 * cover and reopen retried for good (whole-app audit A3 pass 4). A close is
 * still sent: the cloud reads a missing project as already closed, and the
 * startup migration closes the retired shell projects, which are on the list.
 */
async function queuedProjectChangeWasDeleted(
  item: SyncQueueItem,
  context: QueueUploadContext,
): Promise<boolean> {
  if (item.entity !== 'project' || item.operation === 'delete') return false;
  const payload = (item.payload || {}) as Partial<ProjectCreatePayload & ProjectUpdatePayload>;
  if (item.operation === 'update' && payload.archived === true) return false;
  const key = normalizedProjectArchiveName(
    item.operation === 'create' ? payload.name : payload.previousName || payload.name,
  );
  if (!key) return false;
  context.legacyDeletedProjectNamesPromise ??= loadLegacyDeletedProjectNames();
  return (await context.legacyDeletedProjectNamesPromise).has(key);
}

/**
 * Called by the project delete cascade (whole-app audit A3 pass 4). The
 * project's queued cover photo and reopen are withdrawn: each pass
 * re-uploaded the cover and then failed "Project could not be found." A
 * document shared with other projects has its queued copy rewritten as the
 * saved one was, so it no longer names the deleted project or carries its id.
 */
export async function withdrawQueuedChangesOfDeletedProject(
  projectName: string,
  projectRecords: readonly Readonly<{ name: string; id?: string | null }>[] = [],
): Promise<number> {
  const key = normalizedProjectArchiveName(projectName);
  if (!key) return 0;
  return mutateOfflineQueue(queue => {
    let changed = 0;
    const nextQueue = queue.flatMap(item => {
      if (item.entity === 'project' && item.operation === 'update') {
        const payload = (item.payload || {}) as Partial<ProjectUpdatePayload>;
        if (payload.archived !== true &&
          normalizedProjectArchiveName(payload.previousName || payload.name) === key) {
          changed += 1;
          return [];
        }
      }
      const document = item.entity === 'reference_document' && item.operation !== 'delete'
        ? (item.payload as Partial<ReferenceDocumentRecordPayload>)?.documentData
        : null;
      const shared = document ? withoutDeletedSharedProject(document, projectName, projectRecords) : null;
      if (!shared) return [item];
      changed += 1;
      return [{ ...item, payload: { ...(item.payload as ReferenceDocumentRecordPayload), documentData: shared } }];
    });
    return { nextQueue, result: changed, persist: changed > 0 };
  });
}

/**
 * Whether the cloud already has a project by this name, active or archived
 * (a string when the lists could not be read, to retry later). A phone that
 * had not yet heard of an archived project queued its create for a schedule
 * that named it, which made an active copy of it (whole-app audit A3 pass 2).
 */
async function cloudProjectNameExists(name: string): Promise<boolean | string> {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  const lists = await Promise.all([listProjects(), listArchivedProjects()]);
  const unreadable = lists.find(result => !result.ok || result.stubbed);
  if (unreadable) return unreadable.error || unreadable.message || 'Project list is waiting for cloud sync.';
  return lists.some(result => (result.data || []).some(project => project.name.trim().toLowerCase() === key));
}

async function uploadProjectUpdateQueueItem(
  item: SyncQueueItem,
  context: QueueUploadContext,
): Promise<'uploaded' | 'conflict' | string> {
  if (item.operation === 'delete') {
    const deletePayload = item.payload as ProjectUpdateDeletePayload;
    let cloudDeleteSucceededAt = deletePayload.cloudDeleteSucceededAt;

    if (!cloudDeleteSucceededAt) {
      const result = await deleteProjectUpdate({
        id: deletePayload.id,
      });

      if (!result.ok || result.stubbed) {
        return result.error
          ? `Field update delete failed: ${result.error}`
          : result.message || 'Field update deletion is waiting for cloud sync.';
      }

      cloudDeleteSucceededAt = new Date().toISOString();
      try {
        await markProjectUpdateCloudDeletionSucceeded(
          item,
          cloudDeleteSucceededAt,
        );
      } catch (error) {
        return `Field update deletion confirmation is waiting for local storage. ${
          error instanceof Error ? error.message : 'The deletion receipt could not be saved.'
        }`;
      }
    }

    try {
      await confirmProjectUpdateCloudDeletion(deletePayload.id);
      await clearConflictsForLocalRecord('project_update', deletePayload.id);
      await removeConfirmedProjectUpdateDeleteFromQueue(deletePayload.id);
      return 'uploaded';
    } catch (error) {
      return `Field update deletion confirmation is saved for retry. ${
        error instanceof Error ? error.message : 'The local deletion journal could not be confirmed.'
      }`;
    }
  }

  const payload = item.payload as ProjectUpdateRecordPayload;
  if (await hasProjectUpdateDeletionIntent(payload.id)) return 'uploaded';
  if (payload.archiveOnly) {
    const result = await archiveProjectUpdate({
      id: payload.id,
      archivedAt: payload.archivedAt || item.changedAt,
      projectId: payload.projectId,
    });
    if (!result.ok || result.stubbed) return result.error || result.message || 'Field update archive is waiting for cloud sync.';
    if (!queuedFieldUpdateDocumentPatches(item)) return 'uploaded';
    // Then the document changes that waited when it was archived go onto the
    // archived copy (whole-app audit A4 pass 11 O2), read again after it.
    context.projectUpdateMetadataPromises?.delete(payload.id);
  } else if (!payload.updateData) return 'Project update database payload is missing.';
  const pendingPhotoAssetIds = Array.isArray(payload.pendingPhotoAssetIds)
    ? payload.pendingPhotoAssetIds
    : projectUpdateReferencedPhotoIds(payload.updateData);
  const documentPatches = queuedFieldUpdateDocumentPatches(item);
  if (!documentPatches && uniquePhotoAssetIds(pendingPhotoAssetIds).length > 0) {
    return PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS;
  }
  const remoteMetadata = await loadProjectUpdateSyncMetadata(payload.id, context);

  if (!remoteMetadata.ok && remoteMetadata.error) {
    return `Project update database select failed: ${remoteMetadata.error}`;
  }
  // Document changes go onto the cloud's current copy, whoever edited it last
  // and whatever it says now (an archive on the iPad stays): this device's
  // copy goes up whole only when the cloud has none (whole-app audit A7 pass
  // 6 M1, A4 pass 8 F3).
  const cloudCopy = documentPatches && remoteMetadata.ok && !remoteMetadata.stubbed ? remoteMetadata.data : null;
  const patchedCloudCopy = cloudCopy?.updateData
    ? applyFieldUpdateDocumentPatches(cloudCopy.updateData as object, documentPatches || [])
    : null;
  // An archive has no copy of its own to send (A4 pass 11 O2).
  if (payload.archiveOnly && !patchedCloudCopy) return 'uploaded';
  // A document change settles no conflict: the phone's own edit waits for
  // review, with its Keep Phone choice (whole-app audit A4 pass 9 L1).
  if (cloudCopy && patchedCloudCopy === cloudCopy.updateData) {
    recordProjectUpdateUpload(payload.id);
    return 'uploaded';
  }
  if (!patchedCloudCopy && uniquePhotoAssetIds(pendingPhotoAssetIds).length > 0) {
    return PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS;
  }

  // Newer in the cloud only by this device's own patches, which went onto a
  // copy no newer than this edit (whole-app audit A4 pass 14 #3): no conflict.
  // The edit goes up with them, stamped as the cloud's copy is.
  const ownPatchesSinceEdit = !patchedCloudCopy && remoteMetadata.ok && remoteMetadata.data?.updatedAt
    ? ownProjectUpdatePatchesSince(payload.id, remoteMetadata.data, item.changedAt)
    : null;
  if (
    !patchedCloudCopy &&
    !ownPatchesSinceEdit &&
    remoteMetadata.ok &&
    remoteMetadata.data?.updatedAt &&
    isRemoteNewer(remoteMetadata.data.updatedAt, item.changedAt)
  ) {
    if (projectUpdatePayloadsMatch(payload.updateData, remoteMetadata.data.updateData)) {
      await clearConflictsForLocalRecord('project_update', payload.id);
      recordProjectUpdateUpload(payload.id);
      return 'uploaded';
    }

    await recordConflict({
      id: createQueueId('project_update_conflict', new Date().toISOString()),
      entity: 'project_update',
      localId: payload.id,
      localChangedAt: item.changedAt,
      remoteChangedAt: remoteMetadata.data.updatedAt,
      reason: 'Remote update changed after the local pending change.',
      detectedAt: new Date().toISOString(),
      localPayload: payload,
      remotePayload: remoteMetadata.data.updateData,
    });

    return 'conflict';
  }

  const record = cloudCopy && patchedCloudCopy ? {
    projectId: cloudCopy.projectId || payload.projectId || '',
    projectName: cloudCopy.projectName || payload.projectName || 'Unassigned Project',
    areaName: cloudCopy.areaName ?? payload.selectedAreaName ?? '',
    idempotencyKey: projectUpdateIdempotencyKey(cloudCopy.updateData, payload.id),
    updateData: patchedCloudCopy as unknown,
    updatedAt: new Date().toISOString(),
  } : {
    projectId: payload.projectId || '',
    projectName: payload.projectName || 'Unassigned Project',
    areaName: payload.selectedAreaName || '',
    idempotencyKey: projectUpdateIdempotencyKey(payload.updateData, payload.id),
    updateData: ownPatchesSinceEdit
      ? applyFieldUpdateDocumentPatches(payload.updateData as object, ownPatchesSinceEdit.patches) as unknown
      : payload.updateData,
    // The later of the two (whole-app audit A7 pass 13 L-1): Keep Phone's
    // copy and a confirmed Retry's are stamped now, after the patches, and
    // went up stamped back to the last patch's time; an iPad edit saved
    // offline in between then read newer, and went over the chosen copy.
    updatedAt: ownPatchesSinceEdit && isRemoteNewer(ownPatchesSinceEdit.at, item.changedAt)
      ? ownPatchesSinceEdit.at : item.changedAt,
  };
  const result = await saveProjectUpdate({ id: payload.id, ...record });

  if (result.ok && !result.stubbed) {
    // A retry after a conflict put the phone's copy in the cloud: that
    // conflict is settled, as when the cloud already matched (audit A4 pass 5).
    if (!documentPatches) await clearConflictsForLocalRecord('project_update', payload.id);
    if (cloudCopy && patchedCloudCopy) {
      noteProjectUpdatePatchesLanded(payload.id, cloudCopy.updatedAt, { updatedAt: record.updatedAt, updateData: patchedCloudCopy }, documentPatches || []);
    }
    else projectUpdatePatchesLanded.delete(payload.id);
    recordProjectUpdateUpload(payload.id);
    return 'uploaded';
  }

  return result.error
    ? `Project update database upsert failed: ${result.error}`
    : result.message || 'Project update sync is waiting for Supabase.';
}

/**
 * This device's own patches (a document change, a late photo analysis
 * result) that went up onto an update's cloud copy (whole-app audit A4 pass
 * 14 #3): the cloud's time on the copy they went onto (`onto`), and the
 * copy the last of them left, with its time (`at`). A patch stamps the
 * cloud's row with the time it went up, and an edit keeps the time David
 * saved it (A4 pass 13 M1): an edit saved while a patch went up read older
 * than the cloud's copy, and a conflict was shown. While the cloud's copy is
 * still the one they left (its time and content), and the copy they went
 * onto is no newer than the edit, the edit goes up with them. Held in
 * memory: after a relaunch such an edit shows the conflict, as before;
 * nothing is lost.
 */
const projectUpdatePatchesLanded = new Map<string, {
  onto: string; at: string; copy: unknown; patches: FieldUpdateDocumentPatch[];
}>();

function noteProjectUpdatePatchesLanded(
  updateId: string,
  onto: string | null | undefined,
  left: { updatedAt: string; updateData: unknown },
  patches: readonly FieldUpdateDocumentPatch[],
): void {
  const earlier = projectUpdatePatchesLanded.get(updateId);
  if (!onto || !Number.isFinite(Date.parse(onto))) {
    projectUpdatePatchesLanded.delete(updateId);
    return;
  }
  // One after another: the first went onto the copy before them all.
  const chained = earlier && sameCloudTime(earlier.at, onto);
  projectUpdatePatchesLanded.set(updateId, {
    onto: chained ? earlier.onto : onto, at: left.updatedAt, copy: left.updateData,
    patches: [...(chained ? earlier.patches : []), ...patches],
  });
}

/** This device's own patches, when they are all the cloud's copy holds that is newer than an edit saved at `changedAt`. */
function ownProjectUpdatePatchesSince(
  updateId: string,
  cloud: { updatedAt?: string | null; updateData?: unknown },
  changedAt: string,
) {
  const landed = projectUpdatePatchesLanded.get(updateId);
  return landed && cloud.updatedAt && sameCloudTime(landed.at, cloud.updatedAt) &&
    projectUpdatePayloadsMatch(landed.copy, cloud.updateData) && !isRemoteNewer(landed.onto, changedAt) ? landed : null;
}

function sameCloudTime(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  return Number.isFinite(leftTime) && leftTime === Date.parse(right);
}

/**
 * Audit A7 M5: when this device last put each field update in the cloud. A
 * refresh lists the cloud's rows first and merges them afterwards; an upload
 * that lands in between leaves the listed row older than the phone's copy,
 * which then replaced it (shown as sent, with the older content). The
 * refresh keeps the phone's copy of an update uploaded since it started
 * listing. Held in memory: a relaunch starts a fresh refresh.
 */
const projectUpdateUploadedAt = new Map<string, number>();

/**
 * For each field update, the copy this device last put in the cloud, whole
 * or with a document patch, while nothing newer was queued for it (whole-app
 * audit A7 pass 7 M1). A sync attempt that finds nothing queued for an update
 * still this copy, the document upload state aside, has nothing to send
 * again (writeStagedProjectUpdateRecord). Held in memory: after a relaunch a
 * sync attempt queues the whole copy, as before.
 */
const projectUpdateLastVersionInCloud = new Map<string, ProjectUpdate>();

function noteProjectUpdateVersionInCloud(item: SyncQueueItem) {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  if (item.entity !== 'project_update' || item.operation === 'delete' || payload.archiveOnly || !payload.id) return;
  if (payload.updateData && typeof payload.updateData === 'object') {
    projectUpdateLastVersionInCloud.set(payload.id, payload.updateData as ProjectUpdate);
  }
}

/** Its archive aside when that copy is archived and this one not (A4 pass 17 L2): nothing un-archives an update. */
function projectUpdateVersionIsInCloud(update: ProjectUpdate): boolean {
  const sent = projectUpdateLastVersionInCloud.get(update.id);
  return Boolean(sent) && sameProjectUpdateContent(sent, withArchiveKept(update, [], sent) as ProjectUpdate);
}

/**
 * Whether this copy of a field update is, in content, the one this device
 * last put in the cloud (its documents' upload state and a Retry's stamps
 * aside): as Keep Phone leaves it (whole-app audit A7 pass 9 L1). An archive
 * that copy carries and this one does not is aside too (A4 pass 17 L2): the
 * card is not archived when Keep Phone keeps an archive made on the iPad,
 * and Settings took it for a newer edit, which left it Waiting to Sync.
 */
export function projectUpdateCopyIsLastInCloud(update: ProjectUpdate): boolean {
  const sent = projectUpdateLastVersionInCloud.get(update.id);
  return fieldUpdateOwesNothingBeyond(sent, [], withArchiveKept(update, [], sent) as object);
}

/** A field update still owing its own sync: "Waiting to Sync", or failed (A7 pass 8 L1). */
function fieldUpdateOwesOwnSync(status: unknown): boolean {
  return status === 'queued' || status === 'failed';
}

/**
 * A field update that owes nothing beyond these document changes (whole-app
 * audit A7 pass 9 L1): `base` (a copy this device put in the cloud, or the
 * copy a waiting patch was made on) with them is this copy, a Retry's send
 * stamps aside. Whatever its status says, its own record has been sent.
 */
function fieldUpdateOwesNothingBeyond(
  base: unknown,
  patches: readonly FieldUpdateDocumentPatch[],
  update: object,
): boolean {
  return Boolean(base) && typeof base === 'object' && sameProjectUpdateContent(
    applyFieldUpdateDocumentPatches(base as object, patches), update as ProjectUpdate, { retryStampsAside: true });
}

/**
 * Two copies of a field update with the same content: its documents' upload
 * state aside, and the project id the upload resolved, which is not an edit.
 * With `retryStampsAside`, a Retry's send stamps aside too (A7 pass 8 L1).
 */
function sameProjectUpdateContent(left: unknown, right: ProjectUpdate, { retryStampsAside = false } = {}): boolean {
  if (!left || typeof left !== 'object') return false;
  const content = (copy: object) => {
    const rest: Record<string, unknown> = { ...withoutDocumentUploadState(copy), projectId: undefined };
    if (retryStampsAside) ['sendAttempts', 'lastSendAttemptAt', 'stableSendId', 'idempotencyKey'].forEach(field => { delete rest[field]; });
    return rest as never;
  };
  return sameFieldUpdateSyncGeneration(content(left), content(right));
}

/**
 * Test support: forget what this launch holds in memory about field updates
 * (the copies in the cloud, the uploads, the documents re-sent), as a
 * relaunch does, so no test depends on the one before it.
 */
export function resetFieldUpdateSyncMemoryForTests(): void {
  projectUpdateLastVersionInCloud.clear();
  projectUpdateUploadedAt.clear();
  projectUpdatePatchesLanded.clear();
  removedDocumentsRequeuedThisLaunch.clear();
  resetDocumentsResentThisLaunchForTests();
}

function recordProjectUpdateUpload(updateId: string) {
  projectUpdateUploadedAt.set(updateId, Date.now());
}

export function projectUpdateUploadedSince(updateId: string, since: number): boolean {
  return (projectUpdateUploadedAt.get(updateId) ?? Number.NEGATIVE_INFINITY) >= since;
}

async function projectUpdateAlreadyHasCloudReceipt(
  item: SyncQueueItem,
  context: QueueUploadContext,
): Promise<boolean> {
  if (!projectUpdateCanUseCloudReceipt(item)) return false;
  const payload = item.payload as ProjectUpdateRecordPayload;

  const remote = await loadProjectUpdateSyncMetadata(payload.id, context);
  if (
    !remote.ok ||
    remote.stubbed ||
    !remote.data?.updateData ||
    !daveProjectUpdateMatchesCloudReceipt(payload.updateData, remote.data.updateData)
  ) {
    return false;
  }

  // A patch already in the cloud's copy settles no conflict (A4 pass 9 L1):
  // its copy may be the iPad's a refresh showed, while David's offline edit
  // waits in the conflict (whole-app audit A4 pass 15 H1).
  if (!queuedFieldUpdateDocumentPatches(item)) await clearConflictsForLocalRecord('project_update', payload.id);
  recordProjectUpdateUpload(payload.id);
  return true;
}

function loadProjectUpdateSyncMetadata(
  updateId: string,
  context: QueueUploadContext,
): ReturnType<typeof getProjectUpdateSyncMetadata> {
  context.projectUpdateMetadataPromises ??= new Map();
  const existing = context.projectUpdateMetadataPromises.get(updateId);
  if (existing) return existing;
  const pending = getProjectUpdateSyncMetadata(updateId);
  context.projectUpdateMetadataPromises.set(updateId, pending);
  return pending;
}

async function markProjectUpdateCloudDeletionSucceeded(
  attempted: SyncQueueItem,
  cloudDeleteSucceededAt: string,
): Promise<void> {
  const persisted = await mutateOfflineQueue(queue => {
    const currentIndex = queue.findIndex(current =>
      sameQueueRevision(current, attempted),
    );
    if (currentIndex < 0) {
      return { nextQueue: queue, result: false, persist: false };
    }
    const current = queue[currentIndex];
    const payload = current.payload as ProjectUpdateDeletePayload;
    const nextQueue = [...queue];
    nextQueue[currentIndex] = {
      ...current,
      payload: {
        ...payload,
        cloudDeleteSucceededAt,
      },
      lastError: null,
    };
    return { nextQueue, result: true };
  });
  if (!persisted) {
    throw new Error('The pending deletion changed before its receipt could be saved.');
  }
}

async function removeConfirmedProjectUpdateDeleteFromQueue(
  updateId: string,
): Promise<void> {
  await mutateOfflineQueue(queue => {
    const nextQueue = queue.filter(item => {
      if (item.entity !== 'project_update' || item.operation !== 'delete') {
        return true;
      }
      const payload = item.payload as ProjectUpdateDeletePayload;
      return (
        payload.id !== updateId ||
        !payload.cloudDeleteSucceededAt
      );
    });
    return {
      nextQueue,
      result: undefined,
      persist: nextQueue.length !== queue.length,
    };
  });
}

async function recordConflict(conflict: SyncConflict): Promise<void> {
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    const nextConflicts = conflicts.filter(item =>
      item.entity !== conflict.entity || item.localId !== conflict.localId,
    );
    await writeSyncConflicts([...nextConflicts, conflict]);
  });
}

async function clearConflictsForLocalRecord(
  entity: SyncEntity,
  localId: string,
): Promise<void> {
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    const nextConflicts = conflicts.filter(item =>
      item.entity !== entity || item.localId !== localId,
    );
    if (nextConflicts.length !== conflicts.length) {
      await writeSyncConflicts(nextConflicts);
    }
  });
}

const syncConflictListeners = new Set<(conflicts: readonly SyncConflict[]) => void>();

/**
 * Called with the saved conflicts each time this device writes them
 * (whole-app audit A7 pass 12 M-1): a field update's card says when it waits
 * for Review Conflicts. The unsubscribe function.
 */
export function subscribeToSyncConflicts(listener: (conflicts: readonly SyncConflict[]) => void): () => void {
  syncConflictListeners.add(listener);
  return () => {
    syncConflictListeners.delete(listener);
  };
}

async function writeSyncConflicts(conflicts: SyncConflict[]): Promise<void> {
  await setStoredJson(SYNC_CONFLICTS_STORAGE_KEY, conflicts);
  const saved = normalizeSyncConflicts(conflicts);
  syncConflictListeners.forEach(listener => {
    try {
      listener(saved);
    } catch {
      // A screen's listener never fails a conflict write.
    }
  });
}

async function readSyncConflictsUnsafe(): Promise<SyncConflict[]> {
  const conflicts = await getStoredJson<SyncConflict[]>(SYNC_CONFLICTS_STORAGE_KEY, []);
  return normalizeSyncConflicts(conflicts);
}

function serializeSyncConflictMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = syncConflictMutationTail.then(operation, operation);
  syncConflictMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function normalizeSyncConflicts(conflicts: SyncConflict[]): SyncConflict[] {
  const conflictsByRecord = new Map<string, SyncConflict>();

  for (const conflict of conflicts) {
    if (
      conflict.entity === 'project_update' &&
      projectUpdatePayloadsMatch(
        extractProjectUpdateData(conflict.localPayload),
        conflict.remotePayload,
      )
    ) {
      continue;
    }

    const key = `${conflict.entity}:${conflict.localId}`;
    const previous = conflictsByRecord.get(key);
    if (!previous || conflictSortTime(conflict) >= conflictSortTime(previous)) {
      conflictsByRecord.set(key, conflict);
    }
  }

  return [...conflictsByRecord.values()].sort(
    (left, right) => conflictSortTime(right) - conflictSortTime(left),
  );
}

function conflictSortTime(conflict: SyncConflict): number {
  const parsed = new Date(conflict.detectedAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractProjectUpdateData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return 'updateData' in value ? value.updateData : value;
}

function projectUpdatePayloadsMatch(left: unknown, right: unknown): boolean {
  return daveProjectUpdatesSemanticallyMatch(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildSyncStatusMessage(
  configuration: SupabaseConfigurationStatus,
  queuedChanges: number,
  conflicts: number,
  recoveryAvailable: boolean,
): string {
  if (recoveryAvailable) {
    return queuedChanges > 0
      ? 'Some current changes are waiting to sync, and a protected recovery copy also needs review.'
      : 'Current changes are synced. A protected copy of older sync data still needs review.';
  }

  if (!configuration.configured) {
    return 'Local storage is active. Supabase sync will start after environment configuration is added.';
  }

  if (conflicts > 0) {
    return 'Supabase is configured. Some pending changes need conflict review.';
  }

  if (queuedChanges > 0) {
    return 'Supabase is configured. Pending local changes will sync automatically.';
  }

  return 'Supabase is configured and the offline queue is clear.';
}

function isRemoteNewer(remoteUpdatedAt: string, localChangedAt: string): boolean {
  const remoteTime = new Date(remoteUpdatedAt).getTime();
  const localTime = new Date(localChangedAt).getTime();

  if (!Number.isFinite(remoteTime) || !Number.isFinite(localTime)) {
    return false;
  }

  return remoteTime > localTime;
}

function formatQueueItemFailure(item: SyncQueueItem, reason: string): string {
  if (item.entity === 'project_update') {
    const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
    const projectName = payload.projectName?.trim() || 'Unassigned Project';
    return `Field update for “${projectName}” could not sync. ${reason}`;
  }

  if (item.entity === 'project_area') {
    const payload = item.payload as Partial<ProjectAreaRecordPayload>;
    return `GPS area “${payload.areaData?.name || 'Unnamed Area'}” could not sync. ${reason}`;
  }
  if (item.entity === 'schedule_item') {
    const payload = item.payload as Partial<ScheduleItemRecordPayload>;
    return `Task “${payload.itemData?.taskName || 'Unnamed Task'}” could not sync. ${reason}`;
  }
  if (item.entity === 'reference_document') {
    const payload = item.payload as Partial<ReferenceDocumentRecordPayload>;
    return `Document “${payload.documentData?.name || 'Unnamed Document'}” could not sync. ${reason}`;
  }

  const payload = item.payload as Partial<ProjectCreatePayload & ProjectUpdatePayload & ProjectDeletePayload>;
  const projectName = payload.name?.trim() || payload.previousName?.trim() || 'Unnamed Project';
  return `Project “${projectName}” could not sync. ${reason}`;
}

function createQueueId(entity: string, createdAt: string): string {
  return `${entity}-${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameQueueRevision(
  current: SyncQueueItem,
  attempted: SyncQueueItem,
): boolean {
  return (
    current.id === attempted.id &&
    current.createdAt === attempted.createdAt &&
    current.changedAt === attempted.changedAt &&
    current.operation === attempted.operation &&
    JSON.stringify(current.payload) === JSON.stringify(attempted.payload)
  );
}

function projectUpdateIdempotencyKey(
  updateData: unknown,
  fallbackId: string,
): string {
  const update =
    updateData && typeof updateData === 'object' && !Array.isArray(updateData)
      ? (updateData as Record<string, unknown>)
      : {};
  const stableKey =
    typeof update.idempotencyKey === 'string' && update.idempotencyKey.trim()
      ? update.idempotencyKey.trim()
      : typeof update.stableSendId === 'string' && update.stableSendId.trim()
        ? update.stableSendId.trim()
        : fallbackId;

  return stableKey;
}

export async function uploadLocalPhoto(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): Promise<'uploaded' | 'missing' | string | null> {
  const detailed = await uploadLocalPhotoWithDiagnostics(update, photo);

  if (detailed.result === 'uploaded') return 'uploaded';
  if (detailed.result === 'missing') return 'missing';
  if (detailed.result === 'skipped') return null;

  return detailed.message || 'Photo sync could not finish.';
}

export function cloudPhotoLookupConfirmedMissing(
  lookup: {
    error?: string;
    message?: string;
    status?: number;
    code?: string;
  },
  ownerVerified: boolean,
) {
  if (!ownerVerified || (lookup.status !== 400 && lookup.status !== 404)) {
    return false;
  }

  const message = `${lookup.error || ''} ${lookup.message || ''}`.toLowerCase();
  const code = (lookup.code || '').toLowerCase();
  if (/bucket/.test(`${message} ${code}`)) return false;

  return (
    /object\s+(?:not found|missing)/.test(message) ||
    /^(?:not_found|object_not_found|404)$/.test(code)
  );
}

export async function uploadLocalPhotoWithDiagnostics(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): Promise<LocalPhotoUploadResult> {
  const path = projectUpdatePhotoStoragePath(update, photo);
  const diagnosticBase: PhotoStorageUploadDiagnostic = {
    bucketName: PROJECT_PHOTOS_BUCKET,
    bucketExists: 'unknown',
    uploadAttempted: false,
    uploadResult: 'skipped',
    failureCategory: null,
    httpStatus: null,
    errorCode: null,
    localFileExists: null,
    localFileReadable: null,
    fileByteSizeCategory: 'unknown',
    uploadPayloadType: 'unknown',
    contentType: photo.mimeType || 'image/jpeg',
    objectPathCategory: null,
  };

  const cloudCopy = await createPhotoSignedUrl(path, 60, PROJECT_PHOTOS_BUCKET);
  if (cloudCopy.ok && !cloudCopy.stubbed && cloudCopy.data) {
    return {
      result: 'skipped',
      message: null,
      diagnostic: {
        ...diagnosticBase,
        bucketExists: 'yes',
        objectPathCategory: photoObjectPathCategory(path),
      },
    };
  }

  const localUri = photo.uri?.trim() ? photo.uri : null;
  const fileState = localUri
    ? await isPhotoFileAvailable(localUri)
    : { exists: false, readable: false, byteSizeCategory: 'unknown' as const };

  if (!fileState.exists) {
    // Not on this phone and not at its own path: an old rename may have left
    // it under a legacy project path. Recorded so the cloud record points at
    // the file (field test 28 Sep 2026).
    const legacyCopy = cloudPhotoLookupConfirmedMissing(cloudCopy, true)
      ? await findPhotoUnderLegacyProjectPath(update, photo, path, 60)
      : null;
    if (legacyCopy === 'owner_unverified') {
      return {
        result: 'failed',
        message: 'Cloud photo availability could not be verified. Sync will retry without removing the photo record.',
        diagnostic: {
          ...diagnosticBase,
          localFileExists: false,
          localFileReadable: false,
          uploadResult: 'failed',
          failureCategory: 'unknown_storage_error',
          objectPathCategory: photoObjectPathCategory(path),
        },
      };
    }
    if (legacyCopy) {
      return {
        result: 'skipped',
        message: null,
        foundAtPath: legacyCopy.path,
        diagnostic: {
          ...diagnosticBase,
          bucketExists: 'yes',
          localFileExists: false,
          localFileReadable: false,
          objectPathCategory: photoObjectPathCategory(legacyCopy.path),
        },
      };
    }
    if (photo.cloudRecoveryStatus === 'unavailable') {
      return {
        result: 'skipped',
        message: null,
        diagnostic: {
          ...diagnosticBase,
          localFileExists: false,
          localFileReadable: false,
          objectPathCategory: photoObjectPathCategory(path),
        },
      };
    }

    const ownerCheck = await verifyDAVEAppOwner();
    const confirmedMissing = cloudPhotoLookupConfirmedMissing(
      cloudCopy,
      ownerCheck.ok && !ownerCheck.stubbed && ownerCheck.data === true,
    );

    if (!confirmedMissing) {
      const lookupMessage = [
        cloudCopy.error || cloudCopy.message || '',
        ownerCheck.error || ownerCheck.message || '',
      ].filter(Boolean).join(' ');
      let failureCategory = ownerCheck.ok && ownerCheck.data === false
        ? 'rls_denied' as const
        : classifyPhotoStorageUploadFailure(
            lookupMessage || 'Cloud photo availability could not be verified.',
            cloudCopy.status ?? ownerCheck.status ?? null,
            cloudCopy.code ?? ownerCheck.code ?? null,
          );
      if (failureCategory === 'stale_local_uri') {
        failureCategory = 'unknown_storage_error';
      }

      return {
        result: 'failed',
        message: 'Cloud photo availability could not be verified. Sync will retry without removing the photo record.',
        diagnostic: {
          ...diagnosticBase,
          bucketExists: failureCategory === 'bucket_missing' ? 'no' : 'unknown',
          localFileExists: false,
          localFileReadable: false,
          fileByteSizeCategory: fileState.byteSizeCategory,
          uploadResult: 'failed',
          failureCategory,
          httpStatus: cloudCopy.status ?? ownerCheck.status ?? null,
          errorCode: cloudCopy.code ?? ownerCheck.code ?? null,
          objectPathCategory: photoObjectPathCategory(path),
        },
      };
    }

    return {
      result: 'missing',
      message: 'Photo storage upload failed: the photo is confirmed missing from both local and cloud storage.',
      diagnostic: {
        ...diagnosticBase,
        bucketExists: 'yes',
        localFileExists: false,
        localFileReadable: false,
        fileByteSizeCategory: fileState.byteSizeCategory,
        uploadResult: 'failed',
        failureCategory: 'stale_local_uri',
        httpStatus: cloudCopy.status ?? null,
        errorCode: cloudCopy.code ?? null,
        objectPathCategory: photoObjectPathCategory(path),
      },
    };
  }

  if (!fileState.readable) {
    return {
      result: 'failed',
      message: 'Photo storage upload failed: photo file unreadable.',
      diagnostic: {
        ...diagnosticBase,
        localFileExists: true,
        localFileReadable: false,
        fileByteSizeCategory: fileState.byteSizeCategory,
        uploadResult: 'failed',
        failureCategory: 'file_unreadable',
      },
    };
  }

  if (fileState.byteSizeCategory === 'zero') {
    return {
      result: 'failed',
      message: 'Photo storage upload failed: empty photo payload.',
      diagnostic: {
        ...diagnosticBase,
        localFileExists: true,
        localFileReadable: true,
        fileByteSizeCategory: 'zero',
        uploadResult: 'failed',
        failureCategory: 'invalid_payload',
      },
    };
  }

  try {
    const contentType = photo.mimeType || 'image/jpeg';
    const objectPathCategory = photoObjectPathCategory(path);
    const invalidPath = validatePhotoStoragePath(path);
    const unsupportedContentType = validatePhotoContentType(contentType);

    if (invalidPath) {
      return {
        result: 'failed',
        message: invalidPath,
        diagnostic: {
          ...diagnosticBase,
          localFileExists: true,
          localFileReadable: true,
          fileByteSizeCategory: fileState.byteSizeCategory,
          contentType,
          objectPathCategory,
          uploadAttempted: false,
          uploadResult: 'failed',
          failureCategory: 'invalid_path',
        },
      };
    }

    if (unsupportedContentType) {
      return {
        result: 'failed',
        message: unsupportedContentType,
        diagnostic: {
          ...diagnosticBase,
          localFileExists: true,
          localFileReadable: true,
          fileByteSizeCategory: fileState.byteSizeCategory,
          contentType,
          objectPathCategory,
          uploadAttempted: false,
          uploadResult: 'failed',
          failureCategory: 'unsupported_content_type',
        },
      };
    }

    const result = await uploadPhoto({
      bucket: PROJECT_PHOTOS_BUCKET,
      path,
      uri: localUri!,
      contentType,
      upsert: true,
    });

    if (result.ok && !result.stubbed) {
      return {
        result: 'uploaded',
        message: null,
        diagnostic: {
          ...diagnosticBase,
          bucketExists: 'yes',
          localFileExists: true,
          localFileReadable: true,
          fileByteSizeCategory: fileState.byteSizeCategory,
          uploadPayloadType: 'ArrayBuffer',
          contentType,
          objectPathCategory,
          uploadAttempted: true,
          uploadResult: 'success',
        },
      };
    }

    const message = result.error || result.message || 'Photo sync could not finish.';
    const failureCategory = classifyPhotoStorageUploadFailure(
      message,
      result.status ?? null,
      result.code ?? null,
    );

    return {
      result: 'failed',
      message,
      diagnostic: {
        ...diagnosticBase,
        bucketExists: failureCategory === 'bucket_missing' ? 'no' : 'unknown',
        localFileExists: true,
        localFileReadable: true,
        fileByteSizeCategory: fileState.byteSizeCategory,
        uploadPayloadType: 'ArrayBuffer',
        contentType,
        objectPathCategory,
        uploadAttempted: true,
        uploadResult: 'failed',
        failureCategory,
        httpStatus: result.status ?? null,
        errorCode: result.code ?? null,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Photo sync could not finish.';
    return {
      result: 'failed',
      message,
      diagnostic: {
        ...diagnosticBase,
        localFileExists: fileState.exists,
        localFileReadable: fileState.readable,
        fileByteSizeCategory: fileState.byteSizeCategory,
        uploadPayloadType: 'ArrayBuffer',
        uploadAttempted: true,
        uploadResult: 'failed',
        failureCategory: classifyPhotoStorageUploadFailure(message, null, null),
      },
    };
  }
}

export function projectUpdateWithCloudPhotoPaths<TUpdate extends ProjectUpdate>(
  update: TUpdate,
): TUpdate {
  return {
    ...update,
    photos: update.photos.map(photo => ({
      ...photo,
      cloudStoragePath:
        photo.cloudStoragePath || projectUpdatePhotoStoragePath(update, photo),
    })),
  };
}

/**
 * The same photo's path under each project name an earlier app version used.
 * Cloud paths start with the update's project name, and an old migration
 * renamed updates (for example "2321 North Side Lot" to "2321 Compliance
 * Project") without keeping the path its photos were uploaded to. Sync then
 * pins the new path, and the lookup there reports the photo "missing" (field
 * test 28 Sep 2026: two July photos). Only the first segment changes; the
 * update and photo ids stay, so another photo can never be matched.
 */
export function legacyProjectPhotoStoragePaths(path: string): string[] {
  const segments = path.split('/');
  if (segments.length < 3) return [];
  const tail = segments.slice(1).join('/');
  // Only the migrated work-container names: updates were renamed away from
  // these, while legacy shell names were never renamed.
  return [...new Set(
    LEGACY_WORK_CONTAINER_PROJECT_NAMES
      .map(name => `${sanitizePathSegment(name)}/${tail}`)
      .filter(candidate => candidate !== path),
  )];
}

type PhotoSignedUrlLookup = Awaited<ReturnType<typeof createPhotoSignedUrl>>;
const legacyPhotoPathsSearched = new Set<string>();
const legacyPhotoPathsFound = new Map<string, string>();

/**
 * The photo under a legacy project path, for a photo that is on neither this
 * phone nor its own cloud path. It runs only for the verified owner: storage
 * answers "not found" for objects a signed-out caller cannot see, and that
 * must not be remembered as a real miss. A photo searched in full is not
 * searched again this session. An inconclusive lookup stops the search and is
 * not remembered.
 */
async function findPhotoUnderLegacyProjectPath(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  path: string,
  ttlSeconds: number,
): Promise<{ path: string; lookup: PhotoSignedUrlLookup } | 'owner_unverified' | null> {
  const searchKey = `${update.id}|${photo.id}`;
  if (legacyPhotoPathsSearched.has(searchKey)) return null;
  const known = legacyPhotoPathsFound.get(searchKey);
  const candidates = known ? [known] : legacyProjectPhotoStoragePaths(path);
  if (!known) {
    const owner = await verifyDAVEAppOwner();
    // A failed check is not an answer: the caller retries later instead of
    // syncing the record without the path (review pass 11).
    if (!owner.ok && !owner.stubbed) return 'owner_unverified';
    if (!owner.ok || owner.stubbed || owner.data !== true) return null;
  }
  for (const candidate of candidates) {
    const found = await createPhotoSignedUrl(candidate, ttlSeconds, PROJECT_PHOTOS_BUCKET);
    if (found.ok && found.data && !found.stubbed) {
      legacyPhotoPathsFound.set(searchKey, candidate);
      return { path: candidate, lookup: found };
    }
    // A path found earlier this session is kept through a bad connection, so
    // an inconclusive pass cannot write the empty pinned path back.
    if (!cloudPhotoLookupConfirmedMissing(found, true)) return known ? { path: known, lookup: found } : null;
  }
  if (known) {
    legacyPhotoPathsFound.delete(searchKey);
    return null;
  }
  legacyPhotoPathsSearched.add(searchKey);
  return null;
}

/**
 * A signed URL for a photo that is not on this phone: its own path first,
 * then the legacy project paths when that is confirmed not found.
 */
export async function locateCloudPhotoCopy(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  ttlSeconds: number,
): Promise<{ path: string; lookup: PhotoSignedUrlLookup }> {
  const path = projectUpdatePhotoStoragePath(update, photo);
  const lookup = await createPhotoSignedUrl(path, ttlSeconds, PROJECT_PHOTOS_BUCKET);
  if ((lookup.ok && lookup.data && !lookup.stubbed) || !cloudPhotoLookupConfirmedMissing(lookup, true)) {
    return { path, lookup };
  }
  const legacy = await findPhotoUnderLegacyProjectPath(update, photo, path, ttlSeconds);
  return legacy && legacy !== 'owner_unverified' ? legacy : { path, lookup };
}

export async function hydrateRecoveredProjectUpdatePhotos<TUpdate extends ProjectUpdate>(
  update: TUpdate,
): Promise<TUpdate> {
  const photos = await Promise.all(update.photos.map(async photo => {
    if (await hasUsablePhotoUri(photo)) return photo;
    const relocated = await relocateLocalPhotoUri(photo);
    if (relocated) return { ...photo, uri: relocated };
    const located = await locateCloudPhotoCopy(update, photo, 600);
    const cloudStoragePath = located.path;
    const signed = located.lookup;
    if (!signed.ok || !signed.data || signed.stubbed) {
      return {
        ...photo,
        cloudStoragePath,
        cloudRecoveryStatus: 'unavailable' as const,
        cloudSignedUrlExpiresAt: null,
      };
    }

    const recoveredAt = new Date().toISOString();
    const localUri = await cacheRecoveredPhoto(
      signed.data,
      update.id,
      photo.id,
      photo.mimeType,
    );
    return {
      ...photo,
      uri: localUri || signed.data,
      cloudStoragePath,
      cloudRecoveredAt: recoveredAt,
      cloudRecoveryStatus: localUri ? 'cached' as const : 'signed_url' as const,
      cloudSignedUrlExpiresAt: localUri
        ? null
        : new Date(Date.now() + 9 * 60 * 1000).toISOString(),
    };
  }));
  return { ...update, photos };
}

/**
 * Adds a bandwidth-bounded presentation URL without downloading the original
 * evidence file. Reports, backup, and photo analysis continue to call
 * hydrateRecoveredProjectUpdatePhotos() and therefore retain original bytes.
 * With `sign: false` (the operational refresh) a photo is judged and keeps its
 * cloud path, but no preview is signed: the refresh signed every photo from
 * another device and ran past its time limit, and the image signs its own
 * preview when shown (whole-app audit A4 pass 6 (30 Sep 2026)).
 */
export async function hydrateProjectUpdatePhotoPreviews<TUpdate extends ProjectUpdate>(
  update: TUpdate,
  { sign = true }: Readonly<{ sign?: boolean }> = {},
): Promise<TUpdate> {
  const photos = await Promise.all(update.photos.map(async current => {
    if (await hasUsablePhotoUri(current)) return current;
    const relocated = await relocateLocalPhotoUri(current);
    if (relocated) return { ...current, uri: relocated };
    const photo = await withoutMissingPhotoPath(update, current);
    if (cloudPhotoPreviewIsFresh(photo)) return photo;
    const cloudStoragePath =
      photo.cloudStoragePath || projectUpdatePhotoStoragePath(update, photo);
    const preview = sign ? await signProjectPhotoPreview({ ...photo, cloudStoragePath }) : null;
    if (!preview) return { ...photo, cloudStoragePath };
    return {
      ...photo,
      cloudStoragePath,
      cloudPreviewUri: preview.uri,
      cloudPreviewSignedUrlExpiresAt: new Date(preview.usableUntil).toISOString(),
    };
  }));
  return { ...update, photos };
}

/**
 * A preview URL for a photo shown without its file, and how long it can be
 * shown. A signed URL lapses about 9 minutes after signing, so the image signs
 * again when displayed (whole-app audit A4 pass 6 (30 Sep 2026)); it shares
 * the cache, request dedupe and 3-at-a-time limit with hydration. `force`
 * drops a cached URL the image could not load. Null when not signed.
 */
export async function signProjectPhotoPreview(
  photo: Pick<UpdatePhoto, 'cloudStoragePath' | 'mimeType' | 'fileName'>,
  { force = false }: Readonly<{ force?: boolean }> = {},
): Promise<Readonly<{ uri: string; usableUntil: number }> | null> {
  const cloudStoragePath = photo.cloudStoragePath;
  if (!cloudStoragePath?.trim()) return null;
  const transform = projectPhotoPreviewTransform(photo);
  if (force) photoPreviewSignedUrlCache.delete(photoPreviewCacheKey(cloudStoragePath, transform));
  const { result, usableUntil } = await createCachedPhotoPreviewSignedUrl(cloudStoragePath, transform);
  return result.ok && result.data && !result.stubbed ? { uri: result.data, usableUntil } : null;
}

export { cloudPhotoPreviewIsFresh };

/**
 * Audit A7 M3: a path from another device, an older install or a purged cache
 * is not a photo on this device, yet the display preferred it over the
 * preview, so photos taken on the iPhone showed blank on the iPad and the
 * reverse. A path this device cannot relocate is cleared when the device
 * confirms no file is there (or a signed URL has expired), and kept when that
 * cannot be told: a cleared path can leave this device's own file
 * unreferenced for the photo cleanup. A cleared photo keeps a cloud storage
 * path, without which the saved update would drop the photo.
 */
async function withoutMissingPhotoPath<TPhoto extends UpdatePhoto>(
  update: ProjectUpdate,
  photo: TPhoto,
): Promise<TPhoto> {
  const uri = photo.uri?.trim();
  if (!uri) return photo;
  if (!/^https?:\/\//i.test(uri) && !(await photoFileConfirmedMissing(uri))) {
    return photo;
  }
  const recoveryCopy =
    photo.cloudRecoveryStatus === 'cached' || photo.cloudRecoveryStatus === 'signed_url';
  return {
    ...photo,
    uri: '',
    cloudStoragePath: photo.cloudStoragePath || projectUpdatePhotoStoragePath(update, photo),
    ...(recoveryCopy ? { cloudRecoveryStatus: null, cloudSignedUrlExpiresAt: null } : {}),
  };
}

async function photoFileConfirmedMissing(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return true;
    return !info.isDirectory && 'size' in info && info.size === 0;
  } catch {
    return false;
  }
}

export function projectPhotoPreviewTransform(
  photo: Pick<UpdatePhoto, 'mimeType' | 'fileName' | 'cloudStoragePath'>,
): Readonly<{ width: number; quality: number; resize: 'contain' }> | undefined {
  const value = `${photo.mimeType || ''} ${photo.fileName || ''} ${photo.cloudStoragePath || ''}`
    .toLowerCase();
  return /heic|heif/.test(value)
    ? undefined
    : {
        width: PROJECT_PHOTO_PREVIEW_WIDTH,
        quality: PROJECT_PHOTO_PREVIEW_QUALITY,
        resize: 'contain',
      };
}

function photoPreviewCacheKey(
  cloudStoragePath: string,
  transform: ReturnType<typeof projectPhotoPreviewTransform>,
): string {
  return `${cloudStoragePath}|${JSON.stringify(transform || null)}`;
}

async function createCachedPhotoPreviewSignedUrl(
  cloudStoragePath: string,
  transform: ReturnType<typeof projectPhotoPreviewTransform>,
): Promise<CachedPhotoPreviewSignedUrl> {
  const cacheKey = photoPreviewCacheKey(cloudStoragePath, transform);
  const now = Date.now();
  for (const [key, cached] of photoPreviewSignedUrlCache) {
    if (cached.usableUntil <= now) photoPreviewSignedUrlCache.delete(key);
  }
  const cached = photoPreviewSignedUrlCache.get(cacheKey);
  if (cached && cached.usableUntil > now) return cached;
  const inFlight = photoPreviewSigningInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = photoPreviewSigningRunner.run(async () => {
    const result = await createPhotoSignedUrl(
      cloudStoragePath,
      600,
      PROJECT_PHOTOS_BUCKET,
      transform,
    );
    const signed = {
      result,
      usableUntil: Date.now() + PROJECT_PHOTO_PREVIEW_USABLE_MS,
    };
    if (result.ok && result.data && !result.stubbed) {
      photoPreviewSignedUrlCache.set(cacheKey, signed);
      while (photoPreviewSignedUrlCache.size > PROJECT_PHOTO_PREVIEW_CACHE_LIMIT) {
        const oldestKey = photoPreviewSignedUrlCache.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        photoPreviewSignedUrlCache.delete(oldestKey);
      }
    }
    return signed;
  });
  photoPreviewSigningInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (photoPreviewSigningInFlight.get(cacheKey) === request) {
      photoPreviewSigningInFlight.delete(cacheKey);
    }
  }
}

/** A photo not sent because the account changed (whole-app audit A1 M3); it retries under its own. */
function photoHeldForItsAccount(photo: UpdatePhoto): LocalPhotoUploadResult {
  return {
    result: 'failed',
    message: 'The account changed during sync. This photo waits for the account that saved it.',
    diagnostic: {
      bucketName: PROJECT_PHOTOS_BUCKET,
      bucketExists: 'unknown',
      uploadAttempted: false,
      uploadResult: 'skipped',
      failureCategory: null,
      httpStatus: null,
      errorCode: null,
      localFileExists: null,
      localFileReadable: null,
      fileByteSizeCategory: 'unknown',
      uploadPayloadType: 'unknown',
      contentType: photo.mimeType || 'image/jpeg',
      objectPathCategory: null,
    },
  };
}

async function uploadUpdatePhotosForSync(
  update: ProjectUpdate,
  owner: CloudOwnerBinding = currentCloudOwner(),
): Promise<Omit<
  FieldUpdateSyncWorkAttempt,
  'cloudUpdateInsertAttempted' | 'databaseUpsertResult'
> & {
  uploadedPhotoCount: number;
  missingPhotos: MissingSyncPhoto[];
  failedPhotoIds: string[];
  relocatedPhotoPaths: Record<string, string>;
}> {
  if (update.photos.length === 0) {
    return {
      photoStorageUploadAttempted: false,
      storageUploadResult: 'skipped',
      storageBucketName: null,
      storageBucketExists: 'unknown',
      storageFailureCategory: null,
      storageHttpStatus: null,
      storageErrorCode: null,
      localFileExists: null,
      localFileReadable: null,
      fileByteSizeCategory: 'unknown',
      uploadPayloadType: 'unknown',
      storageContentType: null,
      objectPathCategory: null,
      databaseSyncRanAfterUpload: false,
      errors: [],
      uploadedPhotoCount: 0,
      missingPhotos: [],
      failedPhotoIds: [],
      relocatedPhotoPaths: {},
    };
  }

  const results = await mapWithBoundedConcurrency(
    update.photos,
    PROJECT_PHOTO_NETWORK_CONCURRENCY,
    photo => cloudOwnerUnchanged(owner)
      ? uploadLocalPhotoWithDiagnostics(update, photo)
      : Promise.resolve(photoHeldForItsAccount(photo)),
  );
  const failures = results.flatMap((result, index) =>
    result.result !== 'uploaded' && result.result !== 'skipped'
      ? [{ result, photo: update.photos[index] }]
      : [],
  );
  const representativeDiagnostic =
    failures[0]?.result.diagnostic || results[0]?.diagnostic || null;

  return {
    photoStorageUploadAttempted: true,
    storageUploadResult: failures.length > 0 ? 'failed' : 'success',
    storageBucketName: representativeDiagnostic?.bucketName || null,
    storageBucketExists:
      representativeDiagnostic?.bucketExists ||
      (failures.length > 0 ? 'unknown' : 'yes'),
    storageFailureCategory:
      failures[0]?.result.diagnostic.failureCategory || null,
    storageHttpStatus: failures[0]?.result.diagnostic.httpStatus ?? null,
    storageErrorCode: failures[0]?.result.diagnostic.errorCode ?? null,
    localFileExists: representativeDiagnostic?.localFileExists ?? null,
    localFileReadable: representativeDiagnostic?.localFileReadable ?? null,
    fileByteSizeCategory:
      representativeDiagnostic?.fileByteSizeCategory || 'unknown',
    uploadPayloadType:
      representativeDiagnostic?.uploadPayloadType || 'unknown',
    storageContentType: representativeDiagnostic?.contentType || null,
    objectPathCategory: representativeDiagnostic?.objectPathCategory || null,
    databaseSyncRanAfterUpload: false,
    errors: failures.map(({ result, photo }) =>
      result.result === 'missing'
        ? `Photo “${photo.fileName || photo.id}” is missing from both this phone and cloud storage.`
        : `Photo “${photo.fileName || photo.id}” could not be synced because ${sanitizeUserFacingSyncMessage(result.message || 'Photo sync could not finish.')}`,
    ),
    uploadedPhotoCount: results.filter(result => result.result === 'uploaded').length,
    relocatedPhotoPaths: Object.fromEntries(results.flatMap((result, index) =>
      result.foundAtPath ? [[update.photos[index].id, result.foundAtPath]] : [])),
    missingPhotos: results.flatMap((result, index) =>
      result.result === 'missing'
        ? [{ updateId: update.id, photoId: update.photos[index].id }]
        : [],
    ),
    failedPhotoIds: uniquePhotoAssetIds(
      failures.map(({ photo }) => photo.id),
    ),
  };
}

function uniquePhotoAssetIds(photoIds: readonly string[]) {
  return Array.from(new Set(photoIds.map(id => id.trim()).filter(Boolean)));
}

function projectUpdateReferencedPhotoIds(updateData: unknown) {
  if (!isRecord(updateData) || !Array.isArray(updateData.photos)) return [];
  return updateData.photos.flatMap(photo =>
    isRecord(photo) && typeof photo.id === 'string' ? [photo.id] : [],
  );
}

async function isPhotoFileAvailable(uri: string): Promise<{
  exists: boolean;
  readable: boolean;
  byteSizeCategory: 'zero' | 'nonzero' | 'unknown';
}> {
  if (!uri.trim()) {
    return { exists: false, readable: false, byteSizeCategory: 'unknown' };
  }

  if (/^https?:\/\//i.test(uri)) {
    return { exists: true, readable: true, byteSizeCategory: 'unknown' };
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);

    if (!info.exists) {
      return { exists: false, readable: false, byteSizeCategory: 'unknown' };
    }

    const size =
      'size' in info && typeof info.size === 'number' && Number.isFinite(info.size)
        ? info.size
        : null;

    return {
      exists: true,
      readable: true,
      byteSizeCategory:
        size === null ? 'unknown' : size > 0 ? 'nonzero' : 'zero',
    };
  } catch {
    return { exists: true, readable: false, byteSizeCategory: 'unknown' };
  }
}

function isSyncStorageKey(key: string) {
  return /sync|admin|status|diagnostic|cloud|queue|lastSync/i.test(key);
}

function isOfflineQueueRecoveryInternalKey(key: string) {
  return (
    isOfflineQueueQuarantineKey(key) ||
    key.startsWith(SYNC_QUEUE_QUARANTINE_METADATA_KEY_PREFIX) ||
    key === SYNC_QUEUE_RECOVERY_TRANSACTION_KEY ||
    key === SYNC_QUEUE_ARCHIVE_RECOVERY_INDEX_KEY
  );
}

function sanitizeStoredSyncValue(value: string) {
  const sanitizedDirect = sanitizeUserFacingSyncMessage(value);

  try {
    const parsed = JSON.parse(value);
    const sanitizedParsed = sanitizeStoredSyncJson(parsed);
    const nextValue = JSON.stringify(sanitizedParsed);

    // Preserve the JSON envelope even when none of its nested strings changed.
    // Returning `sanitizedDirect` here can turn structured values such as `[]`
    // into user-facing prose, leaving the sync store unreadable on the next run.
    return nextValue;
  } catch {
    return sanitizedDirect;
  }
}

function cleanupSyncConflictsValue(value: string) {
  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) return '[]';

    return JSON.stringify(parsed.map(conflict => {
      if (!conflict || typeof conflict !== 'object' || Array.isArray(conflict)) {
        return conflict;
      }
      const record = conflict as Record<string, unknown>;
      return {
        ...record,
        reason: typeof record.reason === 'string'
          ? sanitizeUserFacingSyncMessage(record.reason)
          : record.reason,
      };
    }));
  } catch {
    // A non-JSON value cannot represent a recoverable conflict. Reset only this
    // derived status list; project data and the durable upload queue are separate.
    return '[]';
  }
}

function cleanupLastSyncValue(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null) return 'null';
    if (typeof parsed !== 'string') return 'null';
    return Number.isFinite(new Date(parsed).getTime()) ? value : 'null';
  } catch {
    return 'null';
  }
}

function sanitizeStoredSyncJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeUserFacingSyncMessage(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeStoredSyncJson(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeStoredSyncJson(item),
      ]),
    );
  }

  return value;
}

function countPhotos(updates: ProjectUpdate[]) {
  return updates.reduce((total, update) => total + update.photos.length, 0);
}

export function projectUpdatePhotoStoragePath(update: ProjectUpdate, photo: UpdatePhoto) {
  if (photo.cloudStoragePath?.trim()) return photo.cloudStoragePath.trim();
  const extension = mimeExtension(photo.mimeType);
  const fileName = sanitizePathSegment(
    photo.fileName || `${photo.id}.${extension}`,
  );

  return [
    sanitizePathSegment(update.projectName || 'unassigned-project'),
    sanitizePathSegment(update.id),
    `${sanitizePathSegment(photo.id)}-${fileName}`,
  ].join('/');
}

export function recoveredSignedPhotoUriIsFresh(
  photo: Pick<UpdatePhoto, 'cloudRecoveryStatus' | 'cloudSignedUrlExpiresAt'>,
  now = Date.now(),
) {
  if (photo.cloudRecoveryStatus !== 'signed_url') return true;
  const expiresAt = photo.cloudSignedUrlExpiresAt
    ? new Date(photo.cloudSignedUrlExpiresAt).getTime()
    : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/**
 * iOS gives the app a new data folder on every install, so a photo saved as
 * file:///…/Application/<old id>/Documents/project-photos/x.jpg stops loading
 * even though the file is still there under the current folder.
 */
export async function relocateLocalPhotoUri(photo: UpdatePhoto): Promise<string | null> {
  const uri = photo.uri;
  const base = FileSystem.documentDirectory;
  if (!uri || !base || /^https?:\/\//i.test(uri)) return null;
  const match = /\/Documents\/(.+)$/.exec(decodeURIComponent(uri));
  if (!match) return null;
  const candidate = `${base}${match[1]}`;
  if (candidate === uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(candidate);
    const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : null;
    return info.exists && !info.isDirectory && size !== 0 ? candidate : null;
  } catch {
    return null;
  }
}

async function hasUsablePhotoUri(photo: UpdatePhoto) {
  const uri = photo.uri;
  if (!uri) return false;
  if (/^https?:\/\//i.test(uri)) return recoveredSignedPhotoUriIsFresh(photo);
  try {
    const info = await FileSystem.getInfoAsync(uri);
    const size = info.exists && 'size' in info && typeof info.size === 'number'
      ? info.size
      : null;
    return info.exists && !info.isDirectory && size !== 0;
  } catch {
    return false;
  }
}

async function cacheRecoveredPhoto(
  signedUrl: string,
  updateId: string,
  photoId: string,
  mimeType?: string | null,
) {
  if (!FileSystem.cacheDirectory) return null;
  try {
    const directory = `${FileSystem.cacheDirectory}${RECOVERED_PHOTOS_FOLDER}/`;
    const directoryInfo = await FileSystem.getInfoAsync(directory);
    if (!directoryInfo.exists) {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    }
    const destination = `${directory}${sanitizePathSegment(updateId)}-${sanitizePathSegment(photoId)}.${mimeExtension(mimeType)}`;
    const existing = await FileSystem.getInfoAsync(destination);
    const existingSize = existing.exists && 'size' in existing && typeof existing.size === 'number'
      ? existing.size
      : null;
    if (existing.exists && !existing.isDirectory && existingSize !== 0) return destination;
    if (existing.exists) {
      await FileSystem.deleteAsync(destination, { idempotent: true });
    }
    const download = await FileSystem.downloadAsync(signedUrl, destination);
    return download.uri || destination;
  } catch {
    return null;
  }
}

function mimeExtension(mimeType: string | null | undefined) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  return 'jpg';
}

function validatePhotoStoragePath(path: string) {
  if (!path.trim()) return 'Photo storage upload failed: invalid object path.';
  if (path.includes('..') || path.includes('//')) {
    return 'Photo storage upload failed: invalid object path.';
  }
  if (/undefined|null/i.test(path)) {
    return 'Photo storage upload failed: invalid object path.';
  }

  return null;
}

function photoObjectPathCategory(path: string) {
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3) return 'project/update/photo-file';
  if (segments.length === 0) return 'empty';
  return `${segments.length}-segment-photo-path`;
}

function validatePhotoContentType(contentType: string) {
  if (/^image\/(jpeg|jpg|png|heic|heif|webp)$/i.test(contentType)) return null;

  return 'Photo storage upload failed: unsupported content type.';
}

function classifyPhotoStorageUploadFailure(
  message: string,
  status: number | null,
  code: string | null,
): PhotoStorageUploadFailureCategory {
  const combined = `${message} ${code || ''}`.toLowerCase();

  if (/bucket.*not.*found|bucket.*missing|not_found|no such bucket/.test(combined)) {
    return 'bucket_missing';
  }
  if (/row level|rls|policy|permission denied|violates row-level|42501/.test(combined)) {
    return 'rls_denied';
  }
  if (status === 401 || /jwt|token|unauthorized|auth|session/.test(combined)) {
    return 'auth_missing';
  }
  if (status === 403 || /forbidden/.test(combined)) return 'rls_denied';
  if (/invalid.*path|object.*name|path|undefined|null/.test(combined)) {
    return 'invalid_path';
  }
  if (/payload|body|arraybuffer|blob|base64|invalid.*upload/.test(combined)) {
    return 'invalid_payload';
  }
  if (/content.?type|mime|unsupported/.test(combined)) {
    return 'unsupported_content_type';
  }
  if (/readasstringasync|file|unreadable|no such file|not found|missing/.test(combined)) {
    if (/stale|no such file|not found|missing/.test(combined)) return 'stale_local_uri';
    return 'file_unreadable';
  }
  if (/offline|network|connection|fetch|timeout|unreachable|internet/.test(combined)) {
    return 'network';
  }

  return 'unknown_storage_error';
}

function sanitizePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}
