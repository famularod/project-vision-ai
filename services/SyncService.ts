import { classifySyncFailureText, CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE, currentDrawingProjectsKeptMessage, isSyncFailureCategory, type SyncFailureCategory } from './SyncFailureCategory';
import { syncMessageReadsAsConnectionFailure } from './SyncOfflineClassifier';
import {
  archiveProjectUpdate,
  countCloudProjects,
  createProject,
  createPhotoSignedUrl,
  deleteProjectUpdate,
  deleteProject,
  getProjectAreasByIds,
  getProjectsByIds,
  getProjectUpdateSyncMetadata,
  getScheduleItem,
  getScheduleItemsByIds,
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
  type CloudRowWriteCondition,
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
  scheduleProgressCarriedOntoCloudCopy,
} from './DAVEScheduleRecovery';
import { SCHEDULE_CARRIED_PROGRESS_FIELDS } from './ScheduleProgressSource';
import {
  cloudRecordKey, cloudRecordOf, cloudRecordsById, confirmRecordsMissingFromCloudList, sameCloudRecord, SCHEDULE_ITEM_ALREADY_IN_CLOUD,
  type CloudRecordsByIdReader,
} from './CloudListAbsenceCheck';
import { chunkSupabaseFilterValues } from './SupabaseCollectionPagination';
import { CLOUD_ROW_CHANGED_SINCE_READ, cloudRowVersionOf, withCloudRowVersion } from './CloudRowVersion';
import { scheduleItemCarriedProgressWaiting, type PendingScheduleItemEdit } from './ScheduleItemQueueRevision';
import { fieldUpdateCopyIsSettled, fieldUpdateEditAgainstCloud, fieldUpdateEditBaseKeepingOwn, fieldUpdateEditBaseOf, fieldUpdateMeaningParts, isFieldUpdateEditBase, type FieldUpdateEditBase } from './FieldUpdateEditBase';
import {
  isEditBase, scheduleItemFieldsWithOwnProgress, scheduleItemEditAgainstCloud, scheduleItemEditBase, scheduleItemEditBaseAfterLanding, scheduleItemEditBaseOf,
  scheduleItemConflictCopyKeeping, scheduleItemConflictCopyOnRow, scheduleItemConflictFields, scheduleItemEditBasesMerged, scheduleItemLaterPercentGivenBack,
  scheduleItemLaterPercentInCloud,
  scheduleItemRowAnsweringTo, scheduleItemStampAfter, scheduleItemTextAsItsTaskHasIt, scheduleItemTextEditOnRow, scheduleItemWholeCopyAgainstCloud, scheduleItemWholeCopyRestUnchanged,
  scheduleItemEditBaseOverTextBroughtForward,
  scheduleItemWholeCopyBase,
  scheduleItemWholeCopyOverCloud, SCHEDULE_PROGRESS_FIELDS, type ScheduleItemEditBase,
} from './ScheduleItemEditBase';
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
import { scheduleItemAnsweringToTaskId, scheduleTaskEarlierIds, withScheduleTaskEarlierIdsOf } from './ScheduleTaskRevisions';
import { canonicalScheduleItemJson } from './ScheduleItemCloudAcknowledgement';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from './PIEScheduleReconciliation';
import { planPendingUploadBatch } from './SyncUploadBatchPolicy';
import {
  applyFieldUpdateDocumentPatches,
  fieldUpdateDocumentPatchFor,
  fieldUpdatePatchesNotSuperseded,
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
  photoAnalysisResultStands,
  withCloudPhotoAnalysisResults,
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
    /** The task edits still waiting here with their base after this sync (owner answer Q28). */
    scheduleItemEditsWaiting?: readonly PendingScheduleItemEdit[];
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

  if (syncMessageReadsAsConnectionFailure(message)) { // by the platform's wording, without names (everyday item 6)
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
  /**
   * Keep Cloud's chosen copy (whole-app audit A7 pass 17 L-1): landing, or
   * found already in the cloud, it does not close the conflict. Keep Cloud
   * closes it once Settings has put the copy on the card (beforeClose).
   * It is the cloud's copy, never the phone's work (A4 pass 21 F1).
   */
  keepCloudChoice?: true;
  /**
   * Keep Cloud's copy only: the document changes and analysis results it
   * took in while Keep Cloud tried (whole-app audit A4 pass 21 F1), which go
   * onto the phone's work it puts back when Keep Cloud fails.
   */
  absorbedPatches?: FieldUpdateDocumentPatch[];
  /**
   * The copy David's edit started from (owner answer Q28, 2 Oct 2026): the
   * saved copy he opened as the draft, as a fingerprint of each part of its
   * meaning (FieldUpdateEditBase). Changed here and in the cloud since, the
   * update goes to Review Conflicts. Missing on a copy queued by Build 229 or
   * earlier, or by a sync attempt alone, which goes up as before.
   */
  base?: FieldUpdateEditBase;
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
   * With forceLocal (independent review pass 4): the version of the cloud's row Keep Phone read and checked against
   * the copy the screen showed. The kept copy is written only over that version, not over whatever the upload's own
   * read of the list finds later.
   */
  keptOverRowVersion?: string;
  /**
   * Its progress fields are a percent the sync merge carried to the task
   * (whole-app audit A7 pass 26 M-1): they land only while the merge's rule
   * still holds against the cloud's copy (scheduleProgressCarriedOntoCloudCopy).
   */
  carriedProgress?: boolean;
  /** The task's progress fields as they were when the merge carried the percent (A7 pass 26 M-1). */
  carriedOver?: Partial<ScheduleItem>;
  /**
   * The owner, contractor or note among its fields that the sync merge carried to the task from its earlier row
   * (review N2 P1): each only fills a blank in the cloud's row, and is never asked about.
   */
  carriedText?: Array<keyof ScheduleItem>;
  /**
   * The copy the edit started from (owner answer Q28, 2 Oct 2026): each
   * changed field's value before the edit, and that copy's stamp. The upload
   * weighs each field against it (ScheduleItemEditBase). Missing on an edit
   * queued by Build 229 or earlier, which goes up as before.
   */
  base?: ScheduleItemEditBase;
  /** On a task's conflict only (owner answer Q28): the fields changed here and on another device, which Review Conflicts shows. */
  askedFields?: string[];
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
/** The copy of each field update David last opened as the draft, per account (owner answer Q28). */
const FIELD_UPDATE_EDIT_BASES_STORAGE_KEY = 'projectVisionAI.fieldUpdateEditBases.v1';
const FIELD_UPDATE_EDIT_BASES_KEPT = 200;
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
  const queue = await serializeOfflineQueueMutation(async () =>
    (await readOfflineQueueUnsafe()).queue,
  );
  // The saved conflicts are read with it (review N2 pass 4): the refresh
  // that reads this queue to learn which cards the device still owes then
  // knows which wait for David's choice (projectUpdateUploadedSince).
  await readSyncConflictsWithQueue();
  return queue;
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
    /** The item as queued, given what was queued under this id before (owner answer Q28: the edit's base stays). */
    withExisting?: (existing: SyncQueueItem | undefined, queued: SyncQueueItem) => SyncQueueItem;
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
      item.withExisting ? item.withExisting(existingItem, queueItem as unknown as SyncQueueItem) : queueItem as unknown as SyncQueueItem,
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
    delete fullRecordPayload.carriedProgress; // a whole copy is weighed whole (A7 pass 26 M-1)
    delete fullRecordPayload.carriedOver;
    delete fullRecordPayload.base;
    // Each field keeps the copy its first waiting edit started from, as far as it is known (owner answer Q28).
    const wholeBase = scheduleItemEditBasesMerged(existingPayload, incomingPayload);
    return {
      ...incoming,
      payload: wholeBase ? { ...fullRecordPayload, base: wholeBase } : fullRecordPayload,
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

  // The progress stays a carried percent while the edits since leave it as the carry gave it (A7 pass 26 M-1).
  const carriedProgress = incomingPayload.carriedProgress === true || (existingPayload.carriedProgress === true &&
    SCHEDULE_CARRIED_PROGRESS_FIELDS.every(field =>
      JSON.stringify(itemData[field] ?? null) === JSON.stringify(existingPayload.itemData[field] ?? null)));
  const { carriedProgress: _carried, carriedOver: _over, carriedText: _text, base: _base, ...mergedPayload } = incomingPayload;
  // What the progress was before the carry: the first carry's, while this entry still holds a carry.
  const carriedOver = !carriedProgress ? undefined
    : existingPayload.carriedProgress === true ? existingPayload.carriedOver : incomingPayload.carriedOver;
  // Each field keeps the copy its first waiting edit started from (owner answer Q28).
  const base = scheduleItemEditBasesMerged(existingPayload, incomingPayload);
  // A carried owner or note David has typed over since is his edit (review N2 P1).
  const carriedText = [...new Set([...(existingPayload.carriedText ?? []).filter(field => !incomingFields.has(field)), ...(incomingPayload.carriedText ?? [])])];
  return {
    ...incoming,
    payload: {
      ...mergedPayload,
      itemData,
      changedFields: [
        ...new Set([
          ...existingPayload.changedFields,
          ...incomingPayload.changedFields,
        ]),
      ],
      ...(carriedProgress ? { carriedProgress: true } : {}),
      ...(carriedOver ? { carriedOver } : {}),
      ...(carriedText.length > 0 ? { carriedText } : {}),
      ...(base ? { base } : {}),
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
  /** The task as it was before this edit (owner answer Q28): the copy the edit started from. */
  before?: ScheduleItem | null,
): Promise<void> {
  const changedAt = item.updatedAt || item.progressConfirmedAt || new Date().toISOString();
  const base = changedFields ? scheduleItemEditBase(before, changedFields) : scheduleItemWholeCopyBase(before);
  await enqueuePendingChange<ScheduleItemRecordPayload>({
    id: scheduleItemQueueItemId(item.id),
    entity: 'schedule_item',
    operation: 'update',
    payload: {
      id: item.id,
      itemData: item,
      ...(changedFields ? { changedFields: [...changedFields] } : {}),
      ...(base ? { base } : {}),
    },
    changedAt,
    autoUpload,
  });
}

/**
 * Whole-app audit A7 pass 26 M-1 (1 Oct 2026, caused by 3035b7a): the
 * percent the sync merge carried to a task's newest row stayed on the device
 * (Full Sync carries after it uploads; a refresh uploads nothing), and as
 * David's it outranked the cloud's copy whole, so that device's next Full
 * Sync wrote its old notes, owner, dates and lookahead over the other
 * device's newer ones. The carried percent now goes up at once, as a change
 * of the task's progress alone, as Set Active sends its carried rows.
 */
export async function queueScheduleItemProgressCarried(item: ScheduleItem, before: ScheduleItem): Promise<void> {
  await enqueuePendingChange<ScheduleItemRecordPayload>({
    id: scheduleItemQueueItemId(item.id),
    entity: 'schedule_item',
    operation: 'update',
    payload: {
      id: item.id,
      itemData: item,
      changedFields: [...SCHEDULE_CARRIED_PROGRESS_FIELDS, 'updatedAt'],
      carriedProgress: true,
      carriedOver: Object.fromEntries(SCHEDULE_CARRIED_PROGRESS_FIELDS.map(field => [field, before[field] ?? null])),
    },
    changedAt: item.updatedAt || item.progressConfirmedAt || new Date().toISOString(),
  });
}

/**
 * Review N2 P1 (the carry between devices): an owner, contractor or note the sync merge carried to a task's newest row
 * from the row David typed it on (DAVEScheduleRecovery) goes up as those fields alone, like a carried percent. At the
 * upload each only fills a blank: where the cloud's row already holds a value, the cloud's stands and nothing is asked.
 */
export async function queueScheduleItemTextCarried(item: ScheduleItem, fields: readonly (keyof ScheduleItem)[]): Promise<void> {
  await enqueuePendingChange<ScheduleItemRecordPayload>({
    id: scheduleItemQueueItemId(item.id),
    entity: 'schedule_item',
    operation: 'update',
    payload: { id: item.id, itemData: item, changedFields: [...fields, 'updatedAt'], carriedText: [...fields] },
    changedAt: item.updatedAt || new Date().toISOString(),
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
  /** The task as it was before this edit (owner answer Q28). */
  before?: ScheduleItem | null,
  /**
   * The task editor sending again what it already queued (700 ms after the
   * typing stops, on Save, when the app goes to the background). Review N1
   * (High, caused by 79a5ae1): each typed change is queued with the fields it
   * changed and the copy it started from, and usually goes up at once. This
   * send then found nothing waiting and queued the task again WHOLE, with no
   * such copy. A whole copy equal to the cloud's row closed every card of the
   * task in Review Conflicts, and one that differed took the card's place:
   * the note David typed offline was then in no card, on no device and not
   * in the cloud. This send now queues nothing: what waits for the task goes
   * as it was queued, with its base, and the answer says how the task stands
   * (sent, still waiting, or waiting for his choice).
   */
  followUp = false,
): Promise<SyncUploadResult> {
  const queueItemId = scheduleItemQueueItemId(item.id);
  let effectiveChangedFields = changedFields;
  let nothingWaited = false;
  if (followUp) {
    nothingWaited = !(await getOfflineQueue()).some(candidate => candidate.id === queueItemId);
  } else {
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
    await queueScheduleItemRecord(item, false, effectiveChangedFields, before);
  }
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
  // A follow-up that found nothing waiting has nothing to send: the task's edits already went (review N1).
  const itemSucceeded =
    (itemOutcome === 'uploaded' || (nothingWaited && !itemOutcome && aggregateResult.configured)) && !remainingItem && !currentConflict;
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
  /** The tasks as this device had them before the approval (owner answer Q28): each approved row's copy it started from. */
  scheduleItemsBefore?: readonly ScheduleItem[];
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
      scheduleItemsBefore: input.scheduleItemsBefore,
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
  scheduleItemsBefore?: readonly ScheduleItem[];
}): Promise<ScheduleImportQueueStageResult> {
  const createdAt = new Date().toISOString();
  const before = new Map((input.scheduleItemsBefore ?? []).map(item => [item.id, item]));
  const candidates: SyncQueueItem[] = [
    ...input.scheduleItems.map(item => {
      // The copy the approved row started from (owner answer Q28); a row new to this device has none.
      const base = scheduleItemWholeCopyBase(before.get(item.id));
      return {
        id: scheduleItemQueueItemId(item.id),
        entity: 'schedule_item' as const,
        operation: 'update' as const,
        payload: {
          id: item.id,
          itemData: item,
          ...(base ? { base } : {}),
        } satisfies ScheduleItemRecordPayload,
        createdAt,
        changedAt: validSyncTimestampOrFallback(
          item.updatedAt || item.progressConfirmedAt,
          createdAt,
        ),
        retryCount: 0,
        lastError: null,
      };
    }),
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
  // A photo result the copy last put in the cloud holds and that stands over
  // the card's is no change of the card's (A4 pass 30 L1), as in
  // projectUpdateVersionIsInCloud: a photo re-analysing made the card read
  // as owing its own sync, so another result or a document change sent the
  // whole card, stamped now, with "analyzing", over an iPad note.
  const inCloudButForThisChange = fieldUpdateOwesNothingBeyond(lastInCloud, [patch], update) ||
    fieldUpdateOwesNothingBeyond(lastInCloud, [patch], applyFieldUpdateDocumentPatches(
      withSentCopysStandingParts(update as unknown as ProjectUpdate, lastInCloud) as object, [patch]));
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
    // Keep Cloud's copy takes it in, and keeps it (A4 pass 21 F1): a Keep
    // Cloud that fails, or the next one after a kill, puts it on the phone's work.
    const heldForReview = existing && !waitingPatches && existingPayload?.updateData && !existingPayload.keepCloudChoice &&
      isFieldUpdatePhotoAnalysisPatch(patch) && fieldUpdateCopyHeldForReview(existing, conflicts) ? existing : null;
    const carried = heldForReview ?? (waitingPatches && isRecord(existingPayload?.newerEdit) ? existingPayload!.newerEdit : null);
    const absorbed = existingPayload?.keepCloudChoice
      ? { absorbedPatches: mergeFieldUpdateDocumentPatches(existingPayload.absorbedPatches || [], patch) } : {};
    const next: SyncQueueItem = existing && !waitingPatches && existingPayload?.updateData && !heldForReview
      ? withChange({ ...existing, payload: { ...existingPayload, ...absorbed } })
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

type FieldUpdateEditBases = Record<string, Record<string, FieldUpdateEditBase>>;
let fieldUpdateEditBasesTail: Promise<void> = Promise.resolve();

function fieldUpdateEditBasesOwnerKey(): string {
  return currentCloudOwner().ownerId ?? '';
}

function mutateFieldUpdateEditBases<T>(change: (bases: Record<string, FieldUpdateEditBase>) => T): Promise<T> {
  const ownerKey = fieldUpdateEditBasesOwnerKey();
  const run = async () => {
    const stored = await getStoredJson<FieldUpdateEditBases>(FIELD_UPDATE_EDIT_BASES_STORAGE_KEY, {});
    const all: FieldUpdateEditBases = isRecord(stored) ? { ...stored } : {};
    const own: Record<string, FieldUpdateEditBase> = isRecord(all[ownerKey]) ? { ...all[ownerKey] } : {};
    const before = JSON.stringify(own);
    const result = change(own);
    if (JSON.stringify(own) !== before) {
      // The latest opened copies only: the oldest go first.
      const kept = Object.entries(own).filter(([, base]) => isFieldUpdateEditBase(base))
        .sort(([, left], [, right]) => String(right.takenAt).localeCompare(String(left.takenAt)))
        .slice(0, FIELD_UPDATE_EDIT_BASES_KEPT);
      all[ownerKey] = Object.fromEntries(kept);
      await setStoredJson(FIELD_UPDATE_EDIT_BASES_STORAGE_KEY, all);
    }
    return result;
  };
  const result = fieldUpdateEditBasesTail.then(run, run);
  fieldUpdateEditBasesTail = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Owner answer Q28 (2 Oct 2026): David opened this saved field update as the
 * draft. The copy he opened is the copy his edit starts from: kept on this
 * device for the signed-in account, so it lasts through a relaunch, and taken
 * into the update's queue record when he saves (persistProjectUpdateRecord).
 * The upload then tells an edit made here over a copy the cloud changed since
 * (Review Conflicts) from one only this device changed (sent as before).
 */
export async function noteFieldUpdateEditOpened(update: { id: string }): Promise<void> {
  if (!update || typeof update.id !== 'string' || !update.id.trim()) return;
  const base = fieldUpdateEditBaseOf(update, new Date().toISOString());
  try {
    await mutateFieldUpdateEditBases(bases => { bases[update.id] = base; });
  } catch {
    // Not kept: this edit goes up as before.
  }
}

/** The copy David opened this update from, taken off the journal: the first save's base (owner answer Q28). */
async function takeFieldUpdateEditBase(updateId: string): Promise<FieldUpdateEditBase | undefined> {
  try {
    return await mutateFieldUpdateEditBases(bases => {
      const base = bases[updateId];
      delete bases[updateId];
      // One kept for a copy the cloud settled is no copy David opened.
      return isFieldUpdateEditBase(base) && !base.settledParts ? base : undefined;
    });
  } catch {
    return undefined;
  }
}

/**
 * A field update's edit the cloud's newer copy settled with no write (owner
 * answer Q28): its base is kept again for that copy, so the waiting-update
 * sync, which still finds the card waiting, starts from it too and the copy
 * is settled again. Staged with no base, the iPad's card went up whole over
 * the phone's area.
 */
async function keepSettledFieldUpdateBase(updateId: string, base: FieldUpdateEditBase, copy: unknown): Promise<void> {
  try {
    const { settledParts: _earlier, ...plain } = base;
    await mutateFieldUpdateEditBases(bases => {
      // A draft David has open since keeps the copy he opened.
      if (bases[updateId] && !bases[updateId].settledParts) return;
      bases[updateId] = { ...plain, settledParts: fieldUpdateMeaningParts(copy) };
    });
  } catch {
    // Not kept: the next sync attempt goes as before.
  }
}

/** The base kept for this very copy after the cloud settled it (keepSettledFieldUpdateBase), if any. */
async function settledFieldUpdateBaseFor(copy: ProjectUpdate): Promise<FieldUpdateEditBase | undefined> {
  try {
    const stored = await getStoredJson<FieldUpdateEditBases>(FIELD_UPDATE_EDIT_BASES_STORAGE_KEY, {});
    const base = isRecord(stored) && isRecord(stored[fieldUpdateEditBasesOwnerKey()])
      ? stored[fieldUpdateEditBasesOwnerKey()][copy.id] : undefined;
    return isFieldUpdateEditBase(base) && fieldUpdateCopyIsSettled(base, copy) ? base : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The base a field update's whole copy keeps when it is queued again (owner
 * answer Q28): the one its queued whole copy has (none for a copy queued by
 * Build 229 or earlier), else the copy David opened, for an edit.
 */
function fieldUpdateBaseKept(existing: SyncQueueItem | undefined, opened: FieldUpdateEditBase | undefined, newer: unknown): FieldUpdateEditBase | undefined {
  const payload = existing && existing.entity === 'project_update' && existing.operation !== 'delete'
    ? existing.payload as Partial<ProjectUpdateRecordPayload> : undefined;
  const wholeCopy = Boolean(payload && !payload.archiveOnly && payload.updateData && !queuedFieldUpdateDocumentPatches(existing));
  // With what the queued copy held, where the newer one changes it again: an upload of it may have landed (review N1 finding 4).
  if (wholeCopy) return isFieldUpdateEditBase(payload!.base) ? fieldUpdateEditBaseKeepingOwn(payload!.base, payload!.updateData, newer) : undefined;
  return opened;
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
  const opened = await takeFieldUpdateEditBase(update.id); // the copy David's edit started from (owner answer Q28)
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
    withExisting: (existing, queued) => {
      const base = fieldUpdateBaseKept(existing, opened, update);
      return base ? { ...queued, payload: { ...(queued.payload as ProjectUpdateRecordPayload<TUpdate>), base } } : queued;
    },
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
  const settled = overConflict ? undefined : await settledFieldUpdateBaseFor(update);
  const inCloud = overConflict || settled || update.status === 'sent' ? undefined : await fieldUpdateCopyKnownInCloud(update);
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
    const copy = withQueuedAnalysisResults(withArchiveKept(update, existing ? [existing] : [], [queuedCopy,
      projectUpdateLastVersionInCloud.get(update.id)].find(item => isRecord(item) && item.isArchived === true)) as ProjectUpdate,
    queuedCopy);
    if (!existing && lastVersionInCloud && projectUpdateVersionIsInCloud(copy)) return unchanged;
    const patch = !overConflict && Boolean(queuedFieldUpdateDocumentPatches(existing)) && (!fieldUpdateOwesOwnSync(copy.status) ||
      fieldUpdateOwesNothingBeyond((existing!.payload as ProjectUpdateRecordPayload).updateData, [], copy));
    // A sync attempt keeps the copy the queued edit started from (owner answer Q28). With nothing queued, a Sent card is
    // the cloud's copy as this device last had it, and starts from that: Sync Now on a device that had not heard the
    // iPad's newer copy sent the card whole over it, the iPad's photo and note gone. So does a card still waiting that
    // is the very copy this device knows is in the cloud (review N2, the fault behind seed 298; see
    // noteFieldUpdateCopyInCloud). Any other card starts none.
    const base = overConflict ? undefined
      : existing ? fieldUpdateBaseKept(existing, undefined, copy)
        : settled ?? (copy.status === 'sent' ? fieldUpdateEditBaseOf(copy, now) : inCloud);
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
            ...(base ? { base } : {}),
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
 * The copy a sync attempt stages, with a result the queued copy, or the copy
 * this device last put in the cloud, holds that stands over the copy's own
 * (photoAnalysisResultStands; whole-app audit A4 pass 26 L2, pass 28 L1), as
 * the archive is kept: Keep Phone put the iPad's newer, Confirmed result into
 * the newer edit it queued, and the waiting-update sync then sent the card's
 * failed one over it; after a send of that edit failed partway, Sync Now did.
 * A photo the card is analysing again goes up with the standing result, not
 * "analyzing": over the iPad's Confirmed result, a failed re-run then went on
 * too. The card keeps showing "Analyzing" (withAnalysisResultsLastInCloud).
 */
function withQueuedAnalysisResults(copy: ProjectUpdate, queuedCopy: unknown): ProjectUpdate {
  return withPhoneAnalysisResults(copy, [queuedCopy, projectUpdateLastVersionInCloud.get(copy.id)]) as ProjectUpdate;
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
 *
 * Exactly as it was (A4 pass 22 L2, L3), for each update: the latest whole
 * copy withdrawn goes back as it was (phoneWorkToPutBack), and every change
 * taken in after it goes on top, oldest first, as any such change does
 * (queueProjectUpdatePatch). Only the later withdrawal of an id went back: a
 * document upload or analysis finishing in Keep Cloud's first upload pass,
 * after David's newer edit was withdrawn, went back alone, and Keep Phone
 * then sent his older edit. And a copy a killed app left went after this
 * one's, so its older analysis result won.
 */
async function putBackWithdrawnProjectUpdateWork(withdrawn: readonly SyncQueueItem[], queued: SyncQueueItem | null): Promise<void> {
  const chosenFor = (queued?.payload as Partial<ProjectUpdateRecordPayload> | undefined)?.overConflict;
  const plans = await mutateOfflineQueue(queue => {
    // Keep Cloud's copy goes by its mark (whole-app audit A4 pass 21 F1),
    // whatever it took in meanwhile: changed by a document upload or an
    // analysis result, it stayed, and the phone's work was not put back.
    const chosen = queued ? queue.find(item => item.id === queued.id && isKeepCloudChoice(item, chosenFor)) : undefined;
    const kept = queue.filter(item => item !== chosen);
    const queuedIds = new Set(kept.map(item => item.id));
    // None of it goes over the conflict now without a new choice (A4 pass
    // 15 H1). A copy an earlier Keep Cloud left (a kill) is not the phone's
    // work: only what it took in goes back.
    const taken = [...withdrawn, ...(chosen ? [chosen] : [])];
    const plans = [...new Set(taken.map(item => item.id))]
      .map(id => phoneWorkToPutBack(taken.filter(item => item.id === id)));
    const restored = plans.flatMap(plan => plan.restore && !queuedIds.has(plan.restore.id)
      ? [withoutChoiceOverConflict(plan.restore)] : []);
    return {
      nextQueue: [...kept, ...restored],
      result: plans,
      persist: kept.length !== queue.length || restored.length > 0,
    };
  });
  // The changes go onto the phone's work put back, as any such change does
  // (queueProjectUpdatePatch): an analysis result in a patch on the cloud's
  // copy that carries the held edit (A7 pass 14 L-2), a document change into
  // the held edit. Oldest first: a later result for a photo wins.
  for (const plan of plans) {
    if (!isRecord(plan.card)) continue;
    for (const patch of plan.changes) await queueProjectUpdatePatch(plan.card as unknown as PatchedProjectUpdate, patch);
  }
}

/**
 * What a failed Keep Cloud puts back for one update (whole-app audit A4 pass
 * 22 L2, L3), from what it took, oldest first, its own copy last:
 * - `restore`, as it was: the latest whole copy (or archive) of the phone's,
 *   which holds what came before it. With none, the first item taken when it
 *   is the phone's: a patch item, which may carry a held edit (newerEdit).
 * - `changes`, every change taken in after it, oldest first: a patch item's
 *   patches, and what a Keep Cloud copy took in (one a killed app left
 *   before this one's).
 * - `card`: the copy those changes are made on.
 *
 * A patch item that carries a whole edit (newerEdit) is a whole copy too
 * (whole-app audit A4 pass 23 L1): restored as it is, it holds that edit.
 * David saved again while Keep Cloud ran, and an analysis finishing after
 * that save turned his edit into such a patch (A7 pass 14 L-2); counted as
 * changes only, it went back onto his older edit, and the newest was lost.
 */
function phoneWorkToPutBack(taken: readonly SyncQueueItem[]): {
  restore: SyncQueueItem | null; changes: FieldUpdateDocumentPatch[]; card: unknown;
} {
  const phoneWork = (item: SyncQueueItem) => !isKeepCloudChoice(item);
  const carriesWholeEdit = (item: SyncQueueItem) => {
    const carried = (item.payload as Partial<ProjectUpdateRecordPayload>).newerEdit;
    return isRecord(carried) && !queuedFieldUpdateDocumentPatches(carried) &&
      isRecord((carried.payload as Partial<ProjectUpdateRecordPayload> | undefined)?.updateData);
  };
  const lastWhole = taken.map(item => phoneWork(item) && (!queuedFieldUpdateDocumentPatches(item) || carriesWholeEdit(item)))
    .lastIndexOf(true);
  const at = lastWhole >= 0 ? lastWhole : taken[0] && phoneWork(taken[0]) ? 0 : -1;
  const restore = at >= 0 ? taken[at] : null;
  const newestFirst = [...taken].reverse();
  const card = [restore, ...newestFirst.filter(phoneWork), ...newestFirst]
    .map(item => (item?.payload as Partial<ProjectUpdateRecordPayload> | undefined)?.updateData).find(isRecord);
  return { restore, changes: changesTakenIn(taken.slice(at + 1)), card };
}

/**
 * The changes queued work took in, oldest first (whole-app audit A4 pass
 * 22): a patch item's patches (a document change, a late analysis result),
 * and what a Keep Cloud copy took in while it was queued (absorbedPatches).
 */
function changesTakenIn(items: readonly SyncQueueItem[]): FieldUpdateDocumentPatch[] {
  return items.flatMap(item => isKeepCloudChoice(item)
    ? (item.payload as Partial<ProjectUpdateRecordPayload>).absorbedPatches ?? []
    : queuedFieldUpdateDocumentPatches(item) ?? []);
}

/**
 * Keep Cloud's chosen copy queued (whole-app audit A4 pass 22), in the write
 * that takes whatever was queued for the update since Keep Cloud's second
 * withdrawal: a patch item's changes go into the copy (it replaced that
 * item, and the change was lost), and what it took goes back if Keep Cloud
 * fails. A delete waiting stays, and the copy is not queued, as before
 * (enqueuePendingChange). The copy as queued.
 */
async function queueKeepCloudChoice(choice: SyncQueueItem): Promise<{ chosen: unknown; taken: SyncQueueItem[] }> {
  const payload = choice.payload as ProjectUpdateRecordPayload;
  return mutateOfflineQueue(queue => {
    const existing = queue.find(item => item.id === choice.id);
    if (existing?.operation === 'delete') {
      return { nextQueue: queue, result: { chosen: payload.updateData, taken: [] }, persist: false };
    }
    const taken = existing ? [existing] : [];
    const chosen = withArchiveKept(applyFieldUpdateDocumentPatches(payload.updateData as object, changesTakenIn(taken)), taken);
    return {
      nextQueue: [...queue.filter(item => item !== existing), { ...choice, payload: { ...payload, updateData: chosen } }],
      result: { chosen, taken },
    };
  });
}

/** Keep Cloud's chosen copy (A7 pass 17 L-1), over this conflict when one is named. */
function isKeepCloudChoice(item: SyncQueueItem, conflictId?: string): boolean {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload> | undefined;
  return item.entity === 'project_update' && payload?.keepCloudChoice === true &&
    (conflictId === undefined || payload.overConflict === conflictId);
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
  const conflict = openFieldUpdateConflict(await getSyncConflicts(), update.id);
  // Sent over the conflict ("Send your version?"), with the cloud copy's
  // photo results that stand over its own (A4 pass 27 L3): the phone's
  // failed result went over the iPad's retried, Confirmed one.
  const withCloudPaths = projectUpdateWithCloudPhotoPaths(update);
  const cloudRecoverableUpdate = conflict && overConflict
    ? withPhoneAnalysisResults(withCloudPaths, [conflict.remotePayload]) as ProjectUpdate : withCloudPaths;
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
  projectUpdateQueueItemsSettledByCloud.clear();
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
  const uploadContext: QueueUploadContext = {
    settledQueueItemIds: resolvedIds,
    queuedScheduleItemIds: uploadBatch.flatMap(item => item.entity === 'schedule_item' && item.operation !== 'delete' &&
      typeof (item.payload as Partial<ScheduleItemRecordPayload>).id === 'string' ? [(item.payload as ScheduleItemRecordPayload).id] : []),
    // The copy each task edit in this pass started from, by task (review N3 R3: a master's new row is weighed with it).
    queuedScheduleItemEditBases: new Map(uploadBatch.flatMap(item => (item.entity === 'schedule_item' && isEditBase((item.payload as Partial<ScheduleItemRecordPayload>).base)
      ? [[(item.payload as ScheduleItemRecordPayload).id, (item.payload as ScheduleItemRecordPayload).base as ScheduleItemEditBase] as const] : []))),
  };
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
      if (!attempted || !sameQueueRevision(item, attempted)) {
        // A newer task edit merged in while this one went up starts from what landed (owner answer Q28).
        return [attempted && itemOutcomes[item.id] === 'uploaded' ? scheduleItemQueuedAfterLanding(item, attempted) : item];
      }
      if (resolvedIds.has(item.id)) {
        if (itemOutcomes[item.id] !== 'uploaded') return [];
        // A copy the cloud's newer copy settled was not put there (owner answer Q28).
        if (!projectUpdateQueueItemsSettledByCloud.delete(item.id)) noteProjectUpdateVersionInCloud(item);
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
 * A task edit that landed settles the task's conflict, as before; a conflict
 * of the fields changed on both devices (owner answer Q28) only when the edit
 * sent those fields too: a percent entered later is no choice about the note
 * in Review Conflicts, and closing it lost that note. `sentFields`: the fields
 * the edit wrote; null for a whole copy.
 *
 * Review N1 (High, caused by 79a5ae1): a whole copy never closes such a card.
 * It closed any: the task editor's whole copy, equal to the cloud's row after
 * the phone heard its own write, closed the card holding the note David typed
 * offline, which was then nowhere. Only his choice closes it, or an edit of
 * his that sends the fields it asks about. A whole copy waiting in a card that
 * stays open takes the fields the edit wrote (`landed`), so Keep Phone does
 * not put older values over them.
 */
async function settleScheduleItemConflicts(itemId: string, sentFields: readonly string[] | null, landed?: ScheduleItem): Promise<void> {
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    let changed = false;
    const next = conflicts.flatMap(conflict => {
      if (conflict.entity !== 'schedule_item' || conflict.localId !== itemId) return [conflict];
      const payload = conflict.localPayload as Partial<ScheduleItemRecordPayload> | undefined;
      const asked = payload?.askedFields;
      const stays = Array.isArray(asked) && asked.length > 0 && (sentFields === null || !asked.every(field => sentFields.includes(field)));
      if (!stays) { changed = true; return []; }
      const written = (sentFields ?? []).filter(field => field !== 'updatedAt' && !asked.includes(field));
      if (!landed || written.length === 0 || Array.isArray(payload?.changedFields) || !isRecord(payload?.itemData)) return [conflict];
      changed = true;
      const landedFields = landed as unknown as Record<string, unknown>;
      return [{ ...conflict, localPayload: { ...payload, itemData: { ...payload.itemData, ...Object.fromEntries(written.map(field => [field, landedFields[field]])) } } }];
    });
    if (changed) await writeSyncConflicts(next);
  });
}

/**
 * A task's conflict saved with the one still open for the task (owner answer
 * Q28; review N1): what the open card holds of David's stays in the card
 * (scheduleItemConflictCopyKeeping). `sent`: the fields this upload wrote of
 * his; null for a whole copy. Saved alone, a conflict about the owner replaced
 * the one about the note, and a whole copy's conflict replaced a card of
 * fields: the phone's note was gone.
 */
async function recordScheduleItemConflict(sent: readonly string[] | null, conflict: SyncConflict): Promise<void> {
  await serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    const open = conflicts.find(item => item.entity === 'schedule_item' && item.localId === conflict.localId);
    const localPayload = scheduleItemConflictCopyKeeping(
      open?.localPayload as Record<string, unknown> | undefined, conflict.localPayload as Record<string, unknown>, sent, conflict.remotePayload);
    await writeSyncConflicts([
      ...conflicts.filter(item => item.entity !== conflict.entity || item.localId !== conflict.localId),
      localPayload === conflict.localPayload ? conflict : { ...conflict, localPayload },
    ]);
  });
}

/** A task's queued edit whose earlier part landed meanwhile: its fields' base is what landed (owner answer Q28). */
function scheduleItemQueuedAfterLanding(current: SyncQueueItem, landed: SyncQueueItem): SyncQueueItem {
  if (current.entity !== 'schedule_item' || landed.entity !== 'schedule_item') return current;
  const payload = current.payload as ScheduleItemRecordPayload;
  if (!isEditBase(payload.base)) return current;
  const base = scheduleItemEditBaseAfterLanding(payload, landed.payload as ScheduleItemRecordPayload);
  return base ? { ...current, payload: { ...payload, base } } : current;
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
  // Keep Cloud's copy goes up only while Keep Cloud sends it (A4 pass 21
  // F1): one a killed app left queued waits, and the next choice drops it.
  return Boolean(conflict) && (payload.overConflict !== conflict!.id ||
    (payload.keepCloudChoice === true && !keepCloudChoicesSending.has(conflict!.id)));
}

/** The conflicts whose Keep Cloud is sending its chosen copy now (its uploadExactQueueItem), in this launch (A4 pass 21 F1). */
const keepCloudChoicesSending = new Set<string>();

/** The conflicts whose Keep Cloud copy met a newer cloud copy while it was sent, which the conflict took (A4 pass 22 L1). */
const keepCloudChoicesMetNewerCloudCopy = new Set<string>();
const KEEP_CLOUD_CHOICE_CLOUD_COPY_CHANGED = 'The cloud copy changed while Keep Cloud was saving it.';

/**
 * Keep Cloud's copy found an iPad save newer than it (whole-app audit A4
 * pass 22 L1): the conflict it was chosen over, while open, takes that cloud
 * copy, as Review Conflicts' own read does. False when that conflict is gone.
 */
async function keepCloudChoiceMetNewerCloudCopy(
  payload: ProjectUpdateRecordPayload,
  cloud: { updatedAt?: string | null; updateData?: unknown },
): Promise<boolean> {
  const conflictId = payload.overConflict;
  if (!conflictId || !isRecord(cloud.updateData)) return false;
  return serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    if (!conflicts.some(item => item.id === conflictId)) return false;
    await writeSyncConflicts(conflicts.map(item => item.id === conflictId
      ? { ...item, remotePayload: cloud.updateData, remoteChangedAt: cloud.updatedAt ?? item.remoteChangedAt }
      : item));
    keepCloudChoicesMetNewerCloudCopy.add(conflictId);
    return true;
  });
}

/**
 * A queued copy as a conflict's phone side: never marked as Keep Cloud's
 * (whole-app audit A4 pass 22 L1). Keep Phone's copy built from such a side
 * was held while its conflict was open, and never went up.
 */
function withoutKeepCloudMarks<TPayload extends Partial<ProjectUpdateRecordPayload>>(
  payload: TPayload,
): Omit<TPayload, 'keepCloudChoice' | 'absorbedPatches'> {
  const { keepCloudChoice: _choice, absorbedPatches: _absorbed, ...rest } = payload;
  return rest;
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

/**
 * Independent review R02: the routine refresh takes a project this device holds as a cloud project, and that neither
 * cloud list returned, as deleted or renamed on another device, and removes it here. The lists are read a page at a
 * time, and the open and the closed list are two separate reads: a project closed or reopened between them is in
 * neither. Such a project is read by its id first. The answer is the projects the cloud still has, by the list each
 * belongs in; null when they could not be read, and then nothing may be removed.
 */
export async function cloudProjectsMissedByLists(
  localRecords: readonly Readonly<{ id?: string | null; name: string }>[],
  active: readonly CloudProject[],
  archived: readonly CloudProject[],
): Promise<{ active: CloudProject[]; archived: CloudProject[] } | null> {
  const listed = [...active, ...archived];
  const listedIds = new Set(listed.flatMap(project => (project.id ? [project.id] : [])));
  const listedNames = new Set(listed.map(project => project.name.trim().toLocaleLowerCase()));
  const missing = [...new Set(localRecords.flatMap(record =>
    record.id && record.id.trim() && !listedIds.has(record.id) && !listedNames.has(record.name.trim().toLocaleLowerCase())
      ? [record.id]
      : []))];
  if (missing.length === 0) return { active: [], archived: [] };
  try {
    const read = await getProjectsByIds(missing);
    if (!read.ok || read.stubbed || !Array.isArray(read.data)) return null;
    const found = read.data.filter(project => project.id && missing.includes(project.id));
    return {
      active: found.filter(project => project.archived !== true),
      archived: found.filter(project => project.archived === true),
    };
  } catch {
    return null;
  }
}

/**
 * The cloud's rows of these tasks, read by their ids (independent review R02). One task is read as a queued edit
 * already reads it; several are read together, a hundred to a request, so a large account is not read task by task.
 */
const cloudScheduleItemsByIds: CloudRecordsByIdReader<ScheduleItem> = async ids => {
  if (ids.length !== 1) return getScheduleItemsByIds(ids);
  const row = await getScheduleItem(ids[0]);
  return { ...row, data: row.ok && !row.stubbed ? (row.data ? [row.data] : []) : null };
};

const cloudProjectAreasByIds: CloudRecordsByIdReader<ProjectArea> = ids => getProjectAreasByIds(ids);

const RECORD_NOT_CHECKED_BEFORE_SENDING =
  'The cloud\'s copy could not be checked just before sending, so this device\'s copy was kept here and will be checked again at the next sync.';

function recordsNotCheckedByIdMessage(kind: 'task' | 'GPS area', count: number, reason: string | null): string {
  return `${count} ${kind}${count === 1 ? '' : 's'} that the cloud's list did not show could not be checked one by one. ` +
    `${count === 1 ? 'It was' : 'They were'} kept on this device and not sent, and will be checked again at the next sync.` +
    cloudWriteFailureReason({ error: reason || undefined });
}

/**
 * How a record may be written once it has been weighed against `row`, the cloud's copy of it (independent review
 * pass 2, item 1): only if the cloud still has no row for it; or only if the row is still the version that was
 * weighed. The condition is part of the write itself, so there is no moment between the check and the write. A row
 * whose version is not known is written as before.
 */
function cloudRowWriteConditionFor(row: unknown): [] | [CloudRowWriteCondition] {
  if (!row) return [{ onlyIfAbsent: true }];
  const version = cloudRowVersionOf(row);
  return version ? [{ ifUnchangedSince: version }] : [];
}

/** The cloud's rows of these records right now, by id; the reason when they could not be read. */
async function cloudRecordsNow<T extends { id: string }>(
  records: readonly T[],
  readByIds: CloudRecordsByIdReader<T>,
): Promise<Map<string, T> | string> {
  try {
    const read = await readByIds(records.map(record => record.id));
    if (read.ok && !read.stubbed && Array.isArray(read.data)) return cloudRecordsById(read.data);
    return read.error || read.message || 'The cloud did not answer.';
  } catch {
    return 'The cloud did not answer.';
  }
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
  // A carried percent waiting on the queue goes up as itself, not as the whole task (A7 pass 26 M-1).
  const queueBeforeUpload = await getOfflineQueue();
  // So does an edit that keeps the copy it started from, field by field, or one waiting in Review Conflicts (owner
  // answer Q28): this device's copy of the task is newer than the cloud's in its stamp alone, and went up whole over
  // the note, owner and lookahead dates another device or the web entered.
  const editsWaitingBeforeUpload = pendingScheduleItemEditsOf(queueBeforeUpload, await getSyncConflicts(), owner);
  syncableScheduleItems = syncableScheduleItems.filter(item =>
    !scheduleItemCarriedProgressWaiting(item, queueBeforeUpload) &&
    !editsWaitingBeforeUpload.some(edit => edit.id === item.id));
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
  // This device's records and the cloud's rows as what is sent below was decided from them (independent review R02).
  let localAreasAtReconciliation: readonly ProjectArea[] = [];
  let cloudAreasAtReconciliation = new Map<string, ProjectArea>();
  let localSchedulesAtReconciliation: readonly ScheduleItem[] = [];
  let cloudSchedulesAtReconciliation = new Map<string, ScheduleItem>();
  /** Tasks whose cloud row another device wrote, or added, in the moment before this device's copy was to be written. */
  let changedInCloudDuringSync = 0;

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

  // Also when the list could not be read: a captured point sent then is still weighed against the cloud's row first.
  localAreasAtReconciliation = syncableProjectAreas;
  if (
    cloudAreasBeforeUpload.ok &&
    !cloudAreasBeforeUpload.stubbed &&
    Array.isArray(cloudAreasBeforeUpload.data)
  ) {
    // An area the list did not hold is asked for by its id before it is taken as new (independent review R02).
    const areaCheck = await confirmRecordsMissingFromCloudList({
      local: syncableProjectAreas,
      listed: cloudAreasBeforeUpload.data,
      deletedIds: deletedAreaIds,
      readByIds: cloudProjectAreasByIds,
    });
    cloudAreasAtReconciliation = cloudRecordsById(areaCheck.cloud);
    syncableProjectAreas = daveProjectAreasNeedingCloudUpload({
      local: syncableProjectAreas,
      cloud: areaCheck.cloud,
      deletedIds: deletedAreaIds,
    }).filter(area => !areaCheck.unreadIds.has(area.id));
    if (areaCheck.unreadIds.size > 0) errors.push(recordsNotCheckedByIdMessage('GPS area', areaCheck.unreadIds.size, areaCheck.error));
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
    // Independent review R02: a task the list did not hold is asked for by its id before it is taken as new to the
    // cloud. The list pages by offset, newest first; a task edited on another device while it is read is left out, and
    // this device's whole copy (0%, no note) went up over that device's row (80% and a note). A row the cloud has joins
    // the list and is weighed like any listed row; one the read could not answer for is not sent.
    const scheduleCheck = await confirmRecordsMissingFromCloudList({
      local: syncableScheduleItems,
      listed: cloudSchedulesBeforeUpload.data,
      deletedIds: deletedScheduleIds,
      readByIds: cloudScheduleItemsByIds,
    });
    localSchedulesAtReconciliation = syncableScheduleItems;
    cloudSchedulesAtReconciliation = cloudRecordsById(scheduleCheck.cloud);
    syncableScheduleItems = daveScheduleItemsNeedingCloudUpload({
      local: syncableScheduleItems,
      cloud: scheduleCheck.cloud,
      deletedIds: deletedScheduleIds,
    }).filter(item => !scheduleCheck.unreadIds.has(item.id));
    if (scheduleCheck.unreadIds.size > 0) errors.push(recordsNotCheckedByIdMessage('task', scheduleCheck.unreadIds.size, scheduleCheck.error));
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

  // Independent review R02: what is sent was weighed against the cloud's rows as they were read above, and the photos
  // and queued changes since can take minutes. Another device's edit in that time was written over whole. The rows
  // are read again by id just before they are sent, a hundred to a read, and a record whose row changed is weighed
  // again against the row as it is now: what the cloud's newer row holds stays, as when the list first showed it.
  for (const areas of chunkSupabaseFilterValues(syncableProjectAreas)) {
    if (!cloudOwnerUnchanged(owner)) break;
    const cloudNow = await cloudRecordsNow(areas, cloudProjectAreasByIds);
    for (const weighed of areas) {
      if (!cloudOwnerUnchanged(owner)) break;
      if (typeof cloudNow === 'string') {
        errors.push(`GPS area “${weighed.name}” was not sent. ${RECORD_NOT_CHECKED_BEFORE_SENDING}${cloudWriteFailureReason({ error: cloudNow })}`);
        progress(`GPS area preserved: ${weighed.name}`);
        continue;
      }
      const rowNow = cloudRecordOf(cloudNow, weighed.id);
      const rowWeighed = cloudRecordOf(cloudAreasAtReconciliation, weighed.id);
      // Deleted on another device meanwhile: not sent back as new before its deletion record arrives.
      if (rowWeighed && !rowNow) {
        progress(`GPS area left for the next sync: ${weighed.name}`);
        continue;
      }
      const area = sameCloudRecord(rowWeighed, rowNow)
        ? weighed
        : daveProjectAreasNeedingCloudUpload({
          local: localAreasAtReconciliation.filter(local => local.id === weighed.id),
          cloud: rowNow ? [rowNow] : [],
          deletedIds: deletedAreaIds,
        })[0];
      if (!area) {
        progress(`GPS area already current: ${weighed.name}`);
        continue;
      }
      const result = await upsertProjectArea(area, ...cloudRowWriteConditionFor(rowNow));

      if (result.ok && !result.stubbed) {
        details.areasUploaded += 1;
      } else if (result.code === CLOUD_ROW_CHANGED_SINCE_READ) {
        errors.push(`GPS area “${area.name}” changed in the cloud while this sync was running. This device's copy was not sent over it. Sync again to compare the two.`);
      } else {
        errors.push(
          `GPS area “${area.name}” could not sync.${cloudWriteFailureReason(result)}`,
        );
      }

      progress(`GPS area synced: ${area.name}`);
    }
  }

  const operationalProjectAuthority = buildOperationalProjectIdentityAuthority(
    cloudProjectRecords,
  );

  for (const items of chunkSupabaseFilterValues(syncableScheduleItems)) {
    if (!cloudOwnerUnchanged(owner)) break;
    // One read for up to a hundred tasks, just before they are sent (independent review R02).
    const cloudNow = await cloudRecordsNow(items, cloudScheduleItemsByIds);
    // Tasks whose row changed since they were weighed are weighed again, with every task, against the rows as they are.
    const changedKeys = new Set<string>();
    // A row the cloud had when the task was weighed and has no longer was deleted on another device meanwhile; its
    // deletion record reaches this device with the next sync, and the task is not sent back as new before it does.
    const deletedKeys = new Set<string>();
    let weighedAgain = new Map<string, ScheduleItem>();
    if (typeof cloudNow !== 'string') {
      const cloudRows = new Map(cloudSchedulesAtReconciliation);
      items.forEach(item => {
        const key = cloudRecordKey(item.id);
        const rowNow = cloudNow.get(key);
        if (sameCloudRecord(cloudRows.get(key), rowNow)) return;
        if (rowNow) {
          changedKeys.add(key);
          cloudRows.set(key, rowNow);
        } else deletedKeys.add(key);
      });
      if (changedKeys.size > 0) {
        cloudSchedulesAtReconciliation = cloudRows;
        weighedAgain = cloudRecordsById(daveScheduleItemsNeedingCloudUpload({
          local: localSchedulesAtReconciliation,
          cloud: [...cloudRows.values()],
          deletedIds: deletedScheduleIds,
        }));
      }
    }
    for (const weighed of items) {
      if (!cloudOwnerUnchanged(owner)) break;
      if (typeof cloudNow === 'string') {
        errors.push(`Schedule task “${weighed.taskName}” was not sent. ${RECORD_NOT_CHECKED_BEFORE_SENDING}${cloudWriteFailureReason({ error: cloudNow })}`);
        progress(`Schedule preserved: ${weighed.taskName}`);
        continue;
      }
      const key = cloudRecordKey(weighed.id);
      if (deletedKeys.has(key)) {
        progress(`Schedule left for the next sync: ${weighed.taskName}`);
        continue;
      }
      const rowNow = cloudNow.get(key);
      const item = changedKeys.has(key) ? weighedAgain.get(key) : weighed;
      if (!item) {
        // The cloud's row as it is now already holds everything this device's copy would add.
        progress(`Schedule already current: ${weighed.taskName}`);
        continue;
      }
      const binding = resolveOperationalProjectIdentity(item, operationalProjectAuthority);
      if (!binding.ok) {
        errors.push(`Schedule task “${item.taskName}” could not sync. ${binding.error}`);
        progress(`Schedule preserved: ${item.taskName}`);
        continue;
      }
      // A task the cloud has no row for is written only if it still has none: a row another device adds in this
      // moment is never replaced by a copy sent as new.
      // And a task the cloud has a row for is written only if the row is still the one just read (pass 2, item 1).
      const bound = { ...item, projectId: binding.identity.id };
      const result = await upsertScheduleItem(bound, ...cloudRowWriteConditionFor(rowNow));

      if (result.ok && !result.stubbed) {
        details.schedulesUploaded += 1;
      } else if (result.code === SCHEDULE_ITEM_ALREADY_IN_CLOUD || result.code === CLOUD_ROW_CHANGED_SINCE_READ) {
        changedInCloudDuringSync += 1;
        progress(`Schedule left for the next sync: ${item.taskName}`);
        continue;
      } else {
        errors.push(
          `Schedule task “${item.taskName}” could not sync.${cloudWriteFailureReason(result)}`,
        );
      }

      progress(`Schedule synced: ${item.taskName}`);
    }
  }
  if (changedInCloudDuringSync > 0) {
    errors.push(
      `${changedInCloudDuringSync} ${changedInCloudDuringSync === 1 ? 'task' : 'tasks'} changed in the cloud while this sync was running. ` +
      `This device's copy was not sent over ${changedInCloudDuringSync === 1 ? 'it' : 'them'}. Sync again to compare the two.`,
    );
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
  const scheduleItemEditsWaiting = pendingScheduleItemEditsOf(queue, conflicts, owner);
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
      scheduleItemEditsWaiting,
    },
  };
}

/**
 * This account's task edits waiting on this device with the copy they started
 * from (owner answer Q28): queued, or held in Review Conflicts. A download
 * shows each over the cloud's row (scheduleItemsWithPendingEditsOverCloud).
 */
function pendingScheduleItemEditsOf(
  queue: readonly SyncQueueItem[],
  conflicts: readonly SyncConflict[],
  owner: ReturnType<typeof currentCloudOwner>,
): PendingScheduleItemEdit[] {
  const edit = (payload: Partial<ScheduleItemRecordPayload> | undefined, inConflict: boolean): PendingScheduleItemEdit[] =>
    payload && typeof payload.id === 'string' && isRecord(payload.itemData) && isEditBase(payload.base) && payload.forceLocal !== true
      ? [{
          id: payload.id, itemData: payload.itemData as ScheduleItem, base: payload.base, inConflict,
          changedFields: Array.isArray(payload.changedFields) ? payload.changedFields.map(String) : null,
        }]
      : [];
  return [
    ...conflicts.filter(conflict => conflict.entity === 'schedule_item')
      .flatMap(conflict => edit(conflict.localPayload as Partial<ScheduleItemRecordPayload> | undefined, true)),
    ...queue.filter(item => item.entity === 'schedule_item' && item.operation !== 'delete' && !heldForAnotherOwner(item.ownerId, owner))
      .flatMap(item => edit(item.payload as Partial<ScheduleItemRecordPayload>, false)),
  ];
}

/** The task edits waiting here with their base as the last startup cloud load read them (owner answer Q28). */
let scheduleItemEditsWaitingAtLoad: PendingScheduleItemEdit[] = [];

/**
 * The startup cloud load of tasks (listScheduleItems), noting the task edits
 * waiting here with their base as it reads (owner answer Q28): after a
 * relaunch, the load kept this device's whole copy of a task with a waiting
 * edit, newer in its stamp alone, over the other device's note, owner and
 * lookahead dates, until the edit went up.
 */
export async function listScheduleItemsWithEditsWaiting(): Promise<Awaited<ReturnType<typeof listScheduleItems>>> {
  const result = await listScheduleItems();
  try {
    scheduleItemEditsWaitingAtLoad = pendingScheduleItemEditsOf(await getOfflineQueue(), await getSyncConflicts(), currentCloudOwner());
  } catch {
    scheduleItemEditsWaitingAtLoad = [];
  }
  return result;
}

export function scheduleItemEditsWaitingAtLastLoad(): readonly PendingScheduleItemEdit[] {
  return scheduleItemEditsWaitingAtLoad;
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

/**
 * David's choice on a field update's conflict. While the conflict is open,
 * nothing automatic sends the update (whole-app audit A4 pass 15 H1): Keep
 * Phone sends the conflict's copy, then David's newer edit; Keep Cloud's
 * chosen copy goes up only inside Keep Cloud's own upload (A4 pass 21 F1).
 *
 * Work that arrives while Keep Cloud runs is treated one way (A4 pass 22).
 * Keep Cloud takes the update's queued work three times: before its upload
 * pass, after it (the second withdrawal), and in the write that queues its
 * chosen copy. While that copy is queued, a change goes into it
 * (absorbedPatches). Then:
 * 1. Patch items (a document change, an analysis result) are folded into
 *    the chosen copy when Keep Cloud succeeds, and re-queued onto the
 *    restored phone work, oldest first, through queueProjectUpdatePatch when
 *    it fails; so are the changes its own copy took in.
 * 2. The latest whole phone copy it took is always what the put-back
 *    restores; a patch item carrying a held edit is one (A4 pass 23 L1).
 * 3. Keep Cloud's own copy never becomes a conflict's phone side. Meeting a
 *    newer cloud copy as it goes up, it records that copy in the open
 *    conflict, nothing is sent, and David reviews again; the phone's work it
 *    withdrew goes back.
 */
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
      // With every change the work withdrawn took in (A4 pass 22, with A4
      // pass 20 L1 and A7 pass 19): a document upload or analysis finishing
      // in the upload pass above was queued on its own, and the second
      // withdrawal took it and dropped it. The cloud and the card read
      // "Analyzing", or the cloud kept a finished upload "failed". The
      // conflict's own copy is read again too: such a result went into it.
      const conflictNow = (await getSyncConflicts()).find(item => item.id === conflict.id) ?? conflict;
      chosenCloudUpdate = withArchiveKept(withPhoneAnalysisResults(
        applyFieldUpdateDocumentPatches(withDocumentChanges(cloudNow) as object,
          fieldUpdatePatchesNotSuperseded(cloudNow as object, changesTakenIn(withdrawn))),
        phoneCopiesOfFieldUpdateInConflict(conflictNow, withdrawn)), withdrawn) as TUpdate;
      const queuedAt = new Date().toISOString();
      const ownerId = currentCloudOwner().ownerId;
      queuedCloudCopy = {
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
          // Closed only after beforeClose (A7 pass 17 L-1): closed as it
          // landed, the card still held the discarded edit, and a document
          // upload or analysis result finishing then queued that edit whole.
          keepCloudChoice: true,
        } satisfies ProjectUpdateRecordPayload<TUpdate>,
        createdAt: queuedAt, changedAt: queuedAt, retryCount: 0, lastError: null,
        ...(ownerId ? { ownerId } : {}),
      };
      // Queued in the write that takes what was queued since the second
      // withdrawal (A4 pass 22): a change finishing while the cloud was read
      // again goes into the copy; replaced, it was lost.
      const queuedChoice = await queueKeepCloudChoice(queuedCloudCopy);
      withdrawn.push(...queuedChoice.taken);
      chosenCloudUpdate = queuedChoice.chosen as TUpdate;
      keepCloudChoicesSending.add(conflict.id); // its copy goes in this pass only (A4 pass 21 F1)
      keepCloudChoicesMetNewerCloudCopy.delete(conflict.id);
      const exact = await uploadExactQueueItem(projectUpdateQueueItemId(conflict.localId))
        .finally(() => keepCloudChoicesSending.delete(conflict.id));
      // An iPad save it met is in the conflict now: David reviews again (A4 pass 22 L1).
      if (!exact.landed) {
        throw new Error(keepCloudChoicesMetNewerCloudCopy.delete(conflict.id) ? 'sync_conflict_cloud_copy_changed'
          : exact.error || 'sync_conflict_save_failed');
      }
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
  // With the cloud's analysis results that stand over the phone's (A4 pass
  // 26 L2): the phone's result, failed offline, went over the iPad's retried
  // and Confirmed one.
  const cloudResults = [current.data?.updateData];
  const localUpdateData = withArchiveKept(withPhoneAnalysisResults(conflictCopy, cloudResults),
    await getOfflineQueue(), current.data?.updateData) as TUpdate;
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
  // Conflicts shows the same edit (A4 pass 15b F1). Never marked as Keep
  // Cloud's copy (A4 pass 22 L1): an earlier build recorded conflicts whose
  // phone side was that copy, and the kept copy was then held.
  const { newerEdit: _carried, ...conflictPayload } = withoutKeepCloudMarks(localPayload);
  const now = new Date().toISOString();
  const ownerId = currentCloudOwner().ownerId;
  const { written, newerEdit, before } = await mutateOfflineQueue(queue => {
    const existing = queue.find(item => item.id === queueItemId);
    const newerFound = newerPhoneEditForFieldUpdateConflict(conflict, queue, conflictCopy);
    const newer = newerFound && withCloudAnalysisResultsInQueuedCopy(
      withArchiveKeptInQueuedCopy(newerFound, localUpdateData), cloudResults);
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
 * have put them there: a result that stands over the copy's
 * (photoAnalysisResultStands: a finished one over a failed one, else the
 * later, or the same one reviewed later; any over a photo still analysing),
 * with the analysis summary of the phone copy it came from. Keep Cloud lost
 * a result taken into one of the phone's copies. "Send your version?" keeps
 * the card's this way when it sends the copy David chose (A4 pass 21 F2):
 * the card read "Analyzing" again. Keep Phone takes the cloud's this way
 * (A4 pass 26 L2).
 */
export function withPhoneAnalysisResults(copy: unknown, phoneCopies: readonly unknown[]): unknown {
  if (!isRecord(copy) || !Array.isArray(copy.photos)) return copy;
  const analysisOf = (update: unknown, photoId: string) => isRecord(update) && Array.isArray(update.photos)
    ? (update.photos as unknown[]).find(photo => isRecord(photo) && photo.id === photoId) as Record<string, unknown> | undefined
    : undefined;
  let next: object = copy;
  for (const photo of copy.photos as unknown[]) {
    if (!isRecord(photo) || typeof photo.id !== 'string') continue;
    const photoId = photo.id;
    const best = phoneCopies
      .map(phone => ({ phone, result: analysisOf(phone, photoId)?.photoIntelligence }))
      .filter(candidate => isRecord(candidate.result) && candidate.result.status !== 'analyzing')
      .reduce<{ phone: unknown; result: unknown } | null>((kept, candidate) =>
        kept && photoAnalysisResultStands(kept.result, candidate.result) ? kept : candidate, null);
    if (!best || photoAnalysisResultStands(photo.photoIntelligence, best.result)) continue;
    next = applyFieldUpdatePhotoAnalysisPatch(next, fieldUpdatePhotoAnalysisPatchFor(best.phone as object, best.phone as object, photoId));
  }
  return next;
}

/** A newer edit Keep Phone carries, with the cloud's results that stand over its own (A4 pass 26 L2). */
function withCloudAnalysisResultsInQueuedCopy(item: SyncQueueItem, cloudCopies: readonly unknown[]): SyncQueueItem {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  const updateData = withPhoneAnalysisResults(payload.updateData, cloudCopies);
  return updateData === payload.updateData ? item : { ...item, payload: { ...payload, updateData } };
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
  // Keep Cloud's copy left queued is the cloud's (A4 pass 21 F1).
  return [localPayload?.updateData, ...[...queued, ...carried]
    .filter(item => !queuedFieldUpdateDocumentPatches(item) && !isKeepCloudChoice(item))
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
 * Why a conflict choice stopped, for Settings to explain in plain words: the
 * record was deleted on another device, the cloud's copy changed since the
 * screen showed it, or a task's conflict closed by itself meanwhile (nothing
 * was sent for any of these); or a task's Keep Cloud wrote and the cloud did
 * not confirm it. Null for any other failure, which Settings reports without
 * detail (raw errors are never shown there).
 */
export function syncConflictChoiceStopReason(
  error: unknown,
): 'record_deleted' | 'cloud_copy_changed' | 'save_unconfirmed' | 'conflict_closed' | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'sync_conflict_record_deleted') return 'record_deleted';
  if (error.message === 'sync_conflict_cloud_copy_changed') return 'cloud_copy_changed';
  // A task's Keep Cloud wrote and the cloud did not answer (A7 pass 16 L-2).
  if (error.message === 'sync_conflict_save_unconfirmed') return 'save_unconfirmed';
  // A task's conflict closed while Keep Phone read the cloud (A7 pass 16 L-6).
  if (error.message === 'sync_conflict_closed') return 'conflict_closed';
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

/**
 * A whole copy of the update, queued, that is not the conflict's copy: an edit saved since (A7 pass 10 L-4).
 * Never Keep Cloud's copy (A4 pass 21 F1): Keep Phone sent it after David's edit, over it.
 */
function isNewerQueuedPhoneEdit(item: SyncQueueItem, conflictCopy: unknown): boolean {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  return item.entity === 'project_update' && item.operation !== 'delete' && !payload.archiveOnly && !isKeepCloudChoice(item) &&
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
  // Not an analysis result the copy holds a later one for, or the same one
  // (A4 pass 25 L1): Keep Cloud put the phone's result, finished offline, over
  // the iPad's retried, Confirmed one.
  return copy => {
    if (!isRecord(copy)) return copy;
    const shown = withDeviceDocumentUploadState(copy, deviceDocuments, undefined, removed);
    return applyFieldUpdateDocumentPatches(shown, fieldUpdatePatchesNotSuperseded(shown, waiting));
  };
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
    // The record of what the row took from its task is undone with the text it describes (TASK_TEXT_TAKEN_RECORD).
    return fields.filter(field => (field === TASK_TEXT_TAKEN_RECORD || !TASK_FIELDS_ASIDE_IN_CONFLICT_CHECK.has(field)) &&
      taskFieldValue(row, field) === taskFieldValue(payload.itemData, field) &&
      taskFieldValue(row, field) !== taskFieldValue(shown, field));
  }))];
}

/**
 * The record of what a task's new row took from the task, and from which row (review N3 R3): bookkeeping, never an
 * edit of David's and never shown on a card. Independent review pass 4: a write that changed it alone between the
 * screen's read and his tap made Keep Phone say "The cloud copy changed" with nothing different to see. It is no
 * longer a change of the cloud's copy. Keep Cloud's undo still takes it back with a whole copy of this phone's that
 * landed: it describes the owner, contractor and note that copy put in the row, and left behind it would say the row
 * took this phone's values while the row holds the cloud's again.
 */
const TASK_TEXT_TAKEN_RECORD = 'textFromTask';

/**
 * Identity, stamps, and the ids Keep Phone keeps from both copies: no edit of
 * David's (whole-app audit A7 pass 15). With the row a later import gave the
 * task, which Keep Phone keeps from the copy that knows that import (32a2187):
 * a re-homing revision on another device made Keep Phone ask David to review
 * again (A5 pass 20 P3). And the record of what the row took from its task.
 */
const TASK_FIELDS_ASIDE_IN_CONFLICT_CHECK: ReadonlySet<string> = new Set([
  'id', 'projectId', 'updatedAt', 'cloudUpdatedAt', 'revisedFromTaskIds', 'alsoImportedInBatchIds', 'alsoImportedSourceRow',
  TASK_TEXT_TAKEN_RECORD,
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

/**
 * A task copy with this phone's newer edits of it over it, oldest first
 * (whole-app audit A7 pass 16 L-4): each edit's own fields, or all of a
 * whole copy. A delete is no edit of the copy.
 */
function withNewerPhoneTaskEdits(copy: ScheduleItem, edits: readonly SyncQueueItem[]): ScheduleItem {
  return edits.reduce<ScheduleItem>((next, edit) => {
    const payload = edit.payload as Partial<ScheduleItemRecordPayload>;
    if (edit.entity !== 'schedule_item' || edit.operation === 'delete' || !isRecord(payload.itemData)) return next;
    const itemData = payload.itemData;
    if (!Array.isArray(payload.changedFields)) return itemData;
    return payload.changedFields.reduce<ScheduleItem>((merged, field) => ({ ...merged, [field]: itemData[field] }), next);
  }, copy);
}

/** Two copies of a task alike in every field but identity, stamps, earlier task ids, import memberships and the record of what the row took. */
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
 * it changed and the conflict was saved with it; not when the conflict is
 * gone (A7 pass 16 L-6: Keep Phone said "review again" over an empty list).
 */
async function recordTaskCloudCopyIfChanged(
  conflict: SyncConflict,
  row: ScheduleItem,
  phoneCopies: readonly unknown[],
  seen: unknown = conflict.remotePayload,
): Promise<boolean> {
  if (sameTaskContent(row, seen) || phoneCopies.some(copy => sameTaskContent(row, copy))) return false;
  return serializeSyncConflictMutation(async () => {
    const conflicts = await readSyncConflictsUnsafe();
    if (!conflicts.some(item => item.id === conflict.id)) return false;
    await writeSyncConflicts(conflicts.map(item => item.id === conflict.id
      ? { ...item, remotePayload: row, remoteChangedAt: row.updatedAt ?? item.remoteChangedAt }
      : item));
    return true;
  });
}

/**
 * Review N1 finding 2 (Medium, caused by 79a5ae1): a card of the fields
 * changed on both devices follows its task. Next week's master moved the task
 * to a new row and hid the old one, with the card still on it: Keep Phone
 * wrote David's note to the hidden row and closed the card, and every device
 * went on showing the cloud's note. Each such card whose row is no longer
 * shown now moves to the shown row that answers to it (the task's earlier
 * ids, as a field update's task is found, ScheduleTaskRevisions), with this
 * device's values of the fields asked about and that row as the cloud's copy;
 * one whose fields the row already holds is closed. A card whose row is still
 * shown stays. Run when Review Conflicts opens and before a choice. The id
 * each moved card has now (null: closed), by the id it had.
 */
async function moveScheduleItemConflictsWithTheirTasks(): Promise<Map<string, string | null>> {
  const moved = new Map<string, string | null>();
  const fieldCards = (await getSyncConflicts())
    .filter(conflict => conflict.entity === 'schedule_item' && scheduleItemConflictFields(conflict.localPayload).length > 0);
  if (fieldCards.length === 0) return moved;
  // The tasks shown, as the web desktop works them out: the cloud's rows under the cloud's schedules.
  const [list, documents, tombstoneSync] = await Promise.all([listScheduleItems(), listReferenceDocuments(), synchronizeDAVESyncTombstones()]);
  if (!list.ok || list.stubbed || !Array.isArray(list.data) || !documents.ok || documents.stubbed || !Array.isArray(documents.data) ||
    !tombstoneSync.cloudAuthoritative) return moved;
  const deletedIds = (entity: 'schedule_item' | 'reference_document') =>
    new Set(deletedDAVERecordIds(tombstoneSync.tombstones, entity).map(id => id.trim().toLowerCase()));
  const deletedRows = deletedIds('schedule_item');
  const deletedDocuments = deletedIds('reference_document');
  const rows = list.data.filter(row => !deletedRows.has(row.id.trim().toLowerCase()));
  const schedules = documents.data.filter(document => !deletedDocuments.has(document.id.trim().toLowerCase()) && scheduleDocumentIsScheduleLike(document));
  const shown = schedules.length > 0 ? selectAuthoritativeScheduleItems({ scheduleItems: rows, scheduleDocuments: schedules }) : null;
  const shownIds = new Set((shown ?? []).map(row => row.id));
  /** The row the task of this row is shown on now, when not this one; as the cloud saves it (the shown copy can carry display dates). */
  const rowNow = (taskId: string): ScheduleItem | null => {
    // A cloud with no schedule file: by the rows alone.
    if (!shown) return scheduleItemRowAnsweringTo(taskId, rows);
    if (shownIds.has(taskId)) return null;
    const answering = scheduleItemAnsweringToTaskId(shown, taskId, {}, rows);
    return (answering && rows.find(row => row.id === answering.id && row.id !== taskId)) || null;
  };
  await serializeSyncConflictMutation(async () => {
    let conflicts = await readSyncConflictsUnsafe();
    const before = conflicts;
    for (const conflict of before) {
      if (conflict.entity !== 'schedule_item' || scheduleItemConflictFields(conflict.localPayload).length === 0) continue;
      const row = rowNow(conflict.localId);
      if (!row || !conflicts.includes(conflict)) continue;
      const copy = scheduleItemConflictCopyOnRow(conflict.localPayload as Record<string, unknown>, row);
      const others = conflicts.filter(item => item !== conflict);
      if (!copy) {
        conflicts = others;
        moved.set(conflict.id, null);
        continue;
      }
      // With what a card already on that row holds.
      const onRow = others.find(item => item.entity === 'schedule_item' && item.localId === row.id);
      const next: SyncConflict = {
        ...conflict,
        id: createQueueId('schedule_item_conflict', new Date().toISOString()),
        localId: row.id,
        remoteChangedAt: row.updatedAt || null,
        localPayload: onRow ? scheduleItemConflictCopyKeeping(onRow.localPayload as Record<string, unknown>, copy, null, row) : copy,
        remotePayload: row,
      };
      conflicts = [...others.filter(item => item !== onRow), next];
      moved.set(conflict.id, next.id);
    }
    if (conflicts !== before) await writeSyncConflicts(conflicts);
  });
  return moved;
}

/**
 * The cloud's row of each task in conflict, read again when Review Conflicts
 * opens (whole-app audit A7 pass 15 L-3, as field updates are): the "Cloud:"
 * line showed the copy saved when the conflict was found, after the web set
 * the task to 50%. One that cannot be read, or is gone, stays as it is. The
 * conflicts, as saved now.
 */
export async function refreshScheduleItemConflictCloudCopies(): Promise<SyncConflict[]> {
  await moveScheduleItemConflictsWithTheirTasks().catch(() => undefined); // each card on the row its task lives on now (review N1 finding 2)
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
  { cloudCopyShown, refusedBefore = 0 }: {
    cloudCopyShown?: unknown;
    /** Keep Phone's own count of the times its copy was refused in this choice (independent review pass 3); not for callers. */
    refusedBefore?: number;
  } = {},
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
  // A card of fields whose task a newer master moved since is chosen on the row the task lives on now (review N1
  // finding 2): the same choice, when that row holds what the card showed for those fields; else David reviews the
  // card again, with that row. With none of its fields left to ask about, it has closed.
  const askedFields = scheduleItemConflictFields(conflict.localPayload);
  const movedTo = askedFields.length > 0 ? (await moveScheduleItemConflictsWithTheirTasks()).get(conflict.id) : undefined;
  if (movedTo !== undefined) {
    const now = movedTo ? (await getSyncConflicts()).find(item => item.id === movedTo) : undefined;
    if (!now) throw new Error('sync_conflict_closed');
    const value = (copy: unknown, field: string) => JSON.stringify(isRecord(copy) ? copy[field] ?? null : null);
    if (!askedFields.every(field => value(shown, field) === value(now.remotePayload, field))) throw new Error('sync_conflict_cloud_copy_changed');
    return resolveScheduleItemSyncConflict(now.id, resolution, { cloudCopyShown: now.remotePayload, refusedBefore });
  }
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
    const phoneEdits = [...(localPayload.withdrawnEdits ?? []), ...waitingEdits, ...withdrawn];
    // An edit of this phone's can be in the cloud only when one landed during
    // this choice (a landing closes the conflict) or during an earlier Keep
    // Cloud that could not finish (its edits wait on the conflict) (A7 pass
    // 16 L-1). Edits found in the row by value alone were undone when none
    // had landed: a progress edit still waiting and the web's 60% share
    // status and progressSource, so the 60% went back as "Not Started".
    const closedDuringChoice =
      !(await getSyncConflicts()).some(item => item.entity === 'schedule_item' && item.localId === conflict.localId);
    const phoneEditMayHaveLanded = Boolean(localPayload.withdrawnEdits?.length) || closedDuringChoice;
    // Still open: only an edit waiting on the conflict can be in the row (A7
    // pass 17 L-2). Every edit was undone by value, a progress edit that
    // never left the phone too, and the web's 60% went back as "Not Started".
    const editsThatMayHaveLanded = closedDuringChoice ? phoneEdits : localPayload.withdrawnEdits ?? [];
    // Read again now: an edit from another device that landed meanwhile is
    // the cloud's too.
    const reread = await currentCloudScheduleItem(conflict.localId).catch(() => undefined);
    if (reread === null) {
      await clearScheduleItemSyncConflicts(conflict.localId);
      throw new Error('sync_conflict_record_deleted');
    }
    // None landed: the cloud's row is kept as it is, and nothing is written.
    // The first read stands in when this one fails.
    if (!phoneEditMayHaveLanded) {
      await clearResolvedConflict(conflict.id);
      return reread ?? cloudItem;
    }
    try {
      // One may have landed and the cloud cannot be read again (A7 pass 15
      // L-1): nothing is decided, and nothing changes.
      if (reread === undefined) {
        throw new Error('sync_conflict_cloud_copy_unreadable');
      }
      let cloudNow = reread;
      for (let refused = 0; ; refused += 1) {
        // The cloud already holds its own copy, so nothing is written back,
        // unless it holds an edit of this phone's that David discarded: an
        // upload under way when he chose landed it, before Keep Cloud read the
        // cloud or after. It is undone, back to the copy the screen showed
        // (A7 pass 15 L-1: only a landing between the two reads was undone).
        const phoneFields = taskFieldsHoldingPhoneEdits(cloudNow, shown, editsThatMayHaveLanded);
        if (phoneFields.length === 0) {
          await clearResolvedConflict(conflict.id);
          return cloudNow;
        }
        const restored = withPhoneEditsUndone(cloudNow, phoneFields, cloudItem, shown);
        // A write that fails may still have landed (its answer lost on weak
        // signal), so Settings does not say "Neither copy was changed" (A7
        // pass 16 L-2). Chosen again, Keep Cloud finds the restore there, or
        // writes it.
        // Independent review pass 3 (P3-2): the undo is written only over the row it was worked out on. An edit
        // another device made in the instant after that row was read was replaced, with no card (and a task deleted
        // in that instant was written back). Refused, nothing was written: the row is read again and the undo worked
        // out on it, as a queued edit is weighed again; a row that keeps changing leaves the choice to be made again.
        const restore = await upsertScheduleItem(restored, ...cloudRowWriteConditionFor(cloudNow)).catch(() => null);
        if (restore?.ok && !restore.stubbed) {
          await clearResolvedConflict(conflict.id);
          return restored;
        }
        if (restore?.code !== CLOUD_ROW_CHANGED_SINCE_READ) throw new Error('sync_conflict_save_unconfirmed');
        if (refused >= QUEUED_RECORD_WEIGH_AGAIN_LIMIT) throw new Error('sync_conflict_cloud_copy_changed');
        const rowNow = await currentCloudScheduleItem(conflict.localId);
        if (!rowNow) break; // deleted on another device in that instant: closed below, and not written back
        cloudNow = rowNow;
      }
    } catch (error) {
      await putBackTaskConflictAsItWas(conflict, phoneEdits);
      throw error;
    }
    await clearScheduleItemSyncConflicts(conflict.localId);
    throw new Error('sync_conflict_record_deleted');
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
  // The conflict closed meanwhile (whole-app audit A7 pass 16 L-6): an edit
  // of this phone's already under way landed while the cloud was read. There
  // is nothing to choose, and the copy saved with the conflict, older than
  // that edit, is not sent over it. Matched by the task, as Keep Cloud
  // does (A7 pass 17 L-3): a whole copy of the task that went up meanwhile
  // and conflicted again replaced it under a new id, and Keep Phone said it
  // closed by itself. Then the task is still in conflict: review again.
  const openForTask = (await getSyncConflicts())
    .find(item => item.entity === 'schedule_item' && item.localId === conflict.localId);
  if (!openForTask) throw new Error('sync_conflict_closed');
  if (openForTask.id !== conflict.id) throw new Error('sync_conflict_cloud_copy_changed');

  const queueItemId = scheduleItemQueueItemId(localItem.id);
  const ownerId = currentCloudOwner().ownerId;
  const checkedVersion = cloudRowVersionOf(cloudNow);
  // The kept copy takes the place of what waited for the task, which is kept
  // to put back if the choice fails (A7 pass 16 L-3, as for field updates).
  const { keptItem, before } = await mutateOfflineQueue(queue => {
    const existing = queue.find(item => item.id === queueItemId) ?? null;
    // The phone's copy with this phone's newer edits of the task (A7 pass 16
    // L-4, as Keep Phone keeps a field update's, A7 pass 10 L-4): any a Keep
    // Cloud that could not finish left on the conflict, then the one still
    // waiting. The kept copy replaced a newer offline note, and the phone's
    // task then took the kept copy: the note was gone everywhere.
    // Still in every revision the cloud copy was re-homed into (whole-app
    // audit A5 pass 3 F6) and answering to every earlier task id the cloud
    // copy names (A8 pass 10 L2: a delete on another device wrote one): the
    // cloud's row as it is now, not the copy saved with the conflict (A7
    // pass 15 L-3). The upload adds any newer ones.
    const keptItem = withScheduleTaskEarlierIdsOf(
      withScheduleImportMembershipOf(
        withNewerPhoneTaskEdits(localItem, [...(localPayload.withdrawnEdits ?? []), ...(existing ? [existing] : [])]),
        cloudNow,
      ),
      cloudNow,
    );
    if (existing?.operation === 'delete') {
      return { nextQueue: queue, result: { keptItem, before: existing }, persist: false };
    }
    // A conflict of the fields changed on both (owner answer Q28) keeps the phone's values of those fields, and of
    // its newer edits, over the cloud's row: the phone's whole copy would put its old values of every other field
    // over the other device's. A whole copy among them goes whole, as before.
    const scopes = [localPayload, ...(localPayload.withdrawnEdits ?? []), ...(existing ? [existing] : [])]
      .map(entry => ('payload' in entry ? (entry as SyncQueueItem).payload : entry) as Partial<ScheduleItemRecordPayload>);
    const keptFields = isEditBase(localPayload.base) && scopes.every(scope => Array.isArray(scope.changedFields))
      ? [...new Set(scopes.flatMap(scope => (scope.changedFields as string[]).map(String)))] as Array<keyof ScheduleItem>
      : null;
    const now = new Date().toISOString();
    const kept: SyncQueueItem = {
      id: queueItemId,
      entity: 'schedule_item',
      operation: 'update',
      payload: {
        id: localItem.id, itemData: keptItem, forceLocal: true, ...(keptFields ? { changedFields: keptFields } : {}),
        // Written only over the row checked above (independent review pass 4): the upload reads the task list again
        // before it writes, and a note another device retyped between the two reads was the row "as listed", so the
        // kept copy went over it though the screen had never shown it.
        ...(checkedVersion ? { keptOverRowVersion: checkedVersion } : {}),
      },
      createdAt: now,
      changedAt: now,
      retryCount: 0,
      lastError: null,
      ...(ownerId ? { ownerId } : {}),
    };
    return { nextQueue: [...queue.filter(item => item.id !== queueItemId), kept], result: { keptItem, before: existing } };
  });
  keptTaskCopiesRefused.delete(localItem.id);
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
    // The queue as it was before the choice (whole-app audit A7 pass 16 L-3,
    // as for field updates, A4 pass 16 L1): the kept copy stayed queued, and
    // with no hold for tasks the next automatic pass wrote it over a later
    // web edit and closed the conflict, while Settings said "Neither copy
    // was changed". What waited for the task waits again, as it was; an edit
    // saved since (which took the kept copy's place) stays.
    await mutateOfflineQueue(queue => {
      const current = queue.find(item => item.id === queueItemId);
      if (current ? (current.payload as Partial<ScheduleItemRecordPayload>).forceLocal !== true : !before) {
        return { nextQueue: queue, result: undefined, persist: false };
      }
      const others = queue.filter(item => item.id !== queueItemId);
      return { nextQueue: before ? [...others, before] : others, result: undefined };
    });
    // Independent review pass 3: the kept copy is written only over the row Keep Phone checked. Refused (another
    // device wrote the task in the moment after that check), nothing was sent: the row is read once more and, as when
    // it had changed before the choice, the conflict is saved with it and David reviews again. A task deleted in that
    // moment is not written back, and its conflict is closed. A row written again that still says what the screen
    // showed has the choice made on it again, here, twice at most. Any other failure is reported as before.
    if (keptTaskCopiesRefused.delete(localItem.id)) {
      const rowAfter = await currentCloudScheduleItem(conflict.localId).catch(() => undefined);
      if (rowAfter === null) {
        await clearScheduleItemSyncConflicts(conflict.localId);
        throw new Error('sync_conflict_record_deleted');
      }
      if (rowAfter && await recordTaskCloudCopyIfChanged(conflict, rowAfter, phoneCopiesOfTaskInConflict(conflict, await getOfflineQueue()), shown)) {
        throw new Error('sync_conflict_cloud_copy_changed');
      }
      if (rowAfter && refusedBefore < QUEUED_RECORD_WEIGH_AGAIN_LIMIT) {
        return resolveScheduleItemSyncConflict(conflictId, resolution, { cloudCopyShown, refusedBefore: refusedBefore + 1 });
      }
    }
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
  /** The ids of the tasks this pass has queued (independent review R02): the ones the list did not hold are read together. */
  queuedScheduleItemIds?: readonly string[];
  queuedScheduleItemEditBases?: ReadonlyMap<string, ScheduleItemEditBase>;
  /** Those tasks' rows as read by id: the row, or null when the cloud has none. */
  scheduleItemsReadById?: Map<string, ScheduleItem | null>;
  /** Why that read failed; the tasks it was for stay queued. */
  scheduleItemsReadByIdError?: string;
  /** Queued records read again and weighed again after a refused write, and how many times (pass 2, item 1). */
  recordsWeighedAgain?: Map<string, number>;
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

/**
 * The cloud's copy with a queued carried percent and any edits queued with it
 * (A7 pass 26 M-1), or 'unchanged' when nothing would change. The percent's
 * fields come from the carry weighed against this copy, and only while it
 * still stands (a percent David entered since, a file's higher percent or a
 * newer lookahead's stated percent stays); the copy's notes, owner, dates and
 * lookahead note stay unless an edit queued with it changed them. Stamped the
 * later of the two copies' times when only the percent changes, so the
 * device's copy and the cloud's then match.
 */
function scheduleItemCarriedOntoCloudCopy(
  payload: ScheduleItemRecordPayload,
  changedFields: readonly (keyof ScheduleItem)[],
  remote: ScheduleItem,
): ScheduleItem | 'unchanged' {
  const carried = scheduleProgressCarriedOntoCloudCopy(payload.itemData, remote, payload.carriedOver);
  const progressFields = new Set<keyof ScheduleItem>(SCHEDULE_CARRIED_PROGRESS_FIELDS);
  const edited = changedFields.filter(field => field !== 'updatedAt' && !progressFields.has(field));
  const next = edited.reduce<ScheduleItem>((merged, field) => field === 'projectControls' &&
    payload.itemData.projectControls && remote.projectControls
    ? { ...merged, projectControls: mergeProjectControlsRevisions(payload.itemData.projectControls, remote.projectControls) }
    : { ...merged, [field]: payload.itemData[field] },
  carried
    ? SCHEDULE_CARRIED_PROGRESS_FIELDS.reduce<ScheduleItem>((merged, field) => ({ ...merged, [field]: carried[field] }), remote)
    : remote);
  if (JSON.stringify(next) === JSON.stringify(remote)) return 'unchanged';
  const later = timestampOf(payload.itemData.updatedAt) > timestampOf(remote.updatedAt) ? payload.itemData.updatedAt : remote.updatedAt;
  return { ...next, updatedAt: edited.length > 0 || !later ? new Date().toISOString() : later };
}

/** A queued carry with nothing of David's queued with it: only the carried progress and its stamp (A7 pass 27 L1). */
function scheduleItemCarryOnly(changedFields: readonly (keyof ScheduleItem)[], carriedText: readonly string[] = []): boolean {
  const progressFields = new Set<keyof ScheduleItem>(SCHEDULE_CARRIED_PROGRESS_FIELDS);
  // (A carried owner, contractor or note is the sync's as well: review N2 P1.)
  return changedFields.every(field => field === 'updatedAt' || progressFields.has(field) || carriedText.includes(field));
}

function timestampOf(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A queued task's cloud row when the list did not hold it: the row, null when the cloud has none, or why it could not
 * be read (the task then stays queued). A7 pass 16 L-5 read a field edit's row so; independent review R02 reads every
 * queued task's. The queued tasks the list did not hold are read together, a hundred to a request, the first time one
 * is needed (an approved schedule queues hundreds of new rows); a single one is read alone, as before.
 */
async function cloudScheduleItemMissedByList(
  id: string,
  context: QueueUploadContext,
): Promise<ScheduleItem | null | string> {
  if (!context.scheduleItemsReadById) {
    context.scheduleItemsReadById = new Map();
    const unlisted = [...new Set(context.queuedScheduleItemIds ?? [])].filter(queuedId => !context.scheduleItemsById?.has(queuedId));
    if (unlisted.length > 1) {
      const read = await cloudRecordsNow<Pick<ScheduleItem, 'id'>>(unlisted.map(queuedId => ({ id: queuedId })), getScheduleItemsByIds);
      if (typeof read === 'string') context.scheduleItemsReadByIdError = read || 'Task authority could not be checked.';
      else unlisted.forEach(queuedId => context.scheduleItemsReadById!.set(queuedId, (cloudRecordOf(read, queuedId) as ScheduleItem | undefined) ?? null));
    }
  }
  if (context.scheduleItemsReadById.has(id)) return context.scheduleItemsReadById.get(id) ?? null;
  if (context.scheduleItemsReadByIdError && context.queuedScheduleItemIds?.includes(id)) return context.scheduleItemsReadByIdError;
  let row: Awaited<ReturnType<typeof getScheduleItem>> | null = null;
  try {
    row = await getScheduleItem(id);
  } catch {
    row = null;
  }
  if (!row?.ok || row.stubbed) return row?.error || row?.message || 'Task authority could not be checked.';
  return row.data ?? null;
}

/** How many times one queued record is read again and weighed again in a pass after its write was refused. */
const QUEUED_RECORD_WEIGH_AGAIN_LIMIT = 2;

/**
 * The tasks whose Keep Phone copy the cloud refused in the upload just run, because the row was no longer the one it
 * was to be written over (independent review pass 3). Keep Phone reads it there, and looks at the row again.
 */
const keptTaskCopiesRefused = new Set<string>();

/**
 * After a write was refused because the cloud's row was no longer the one weighed (independent review pass 2, item
 * 1): the row as it is now, read by its id, to weigh the queued record against once more. Null when the record
 * should wait for the next pass instead: the row is gone (deleted on another device: its deletion record retires the
 * queued record at the next pass, and it is not sent back as new), the read failed, or it has been weighed again
 * twice already in this pass.
 */
async function cloudRowToWeighAgain<T extends { id: string }>(
  context: QueueUploadContext,
  key: string,
  id: string,
  readByIds: CloudRecordsByIdReader<T>,
): Promise<T | null> {
  const weighedAgain = (context.recordsWeighedAgain ??= new Map<string, number>());
  const times = weighedAgain.get(key) ?? 0;
  if (times >= QUEUED_RECORD_WEIGH_AGAIN_LIMIT) return null;
  const rows = await cloudRecordsNow<Pick<T, 'id'>>([{ id }], readByIds);
  const row = typeof rows === 'string' ? undefined : cloudRecordOf(rows, id) as T | undefined;
  if (!row) return null;
  weighedAgain.set(key, times + 1);
  return row;
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
    let remote = context.projectAreasById.get(payload.id);
    // An area the list did not hold is asked for by its id before this device's copy goes up as new (independent
    // review R02): the list pages by offset, and a row another device changed while it was read can be left out.
    if (!remote) {
      const row = await cloudRecordsNow<Pick<ProjectArea, 'id'>>([{ id: payload.id }], getProjectAreasByIds);
      if (typeof row === 'string') return row || 'GPS area authority could not be checked.';
      remote = cloudRecordOf(row, payload.id) as ProjectArea | undefined;
      if (remote) context.projectAreasById.set(payload.id, remote);
    }
    const authoritative = remote
      ? mergeDAVEProjectAreaRecoveryRecords({
          local: [payload.areaData],
          cloud: [remote],
        })[0]
      : payload.areaData;
    if (remote && JSON.stringify(authoritative) === JSON.stringify(remote)) {
      return 'uploaded';
    }
    // Independent review pass 2 (item 1): written only if the cloud's row is still the one this was weighed against
    // (or there is still none). The list is read once for the whole pass; a point another device captured since
    // then was written over. Refused, the row is read again by its id and the area weighed again.
    const result = await upsertProjectArea(authoritative, ...cloudRowWriteConditionFor(remote));
    if (result.ok && !result.stubbed) {
      context.projectAreasById.set(payload.id, withCloudRowVersion(authoritative, cloudRowVersionOf(result.data)));
      return 'uploaded';
    }
    if (result.code === CLOUD_ROW_CHANGED_SINCE_READ) {
      const rowNow = await cloudRowToWeighAgain(context, `project_area:${payload.id}`, payload.id, cloudProjectAreasByIds);
      if (rowNow) {
        context.projectAreasById.set(payload.id, rowNow);
        return uploadQueueItem(item, context);
      }
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
    let remote = context.scheduleItemsById.get(payload.id);
    const queuedFields = Array.isArray(payload.changedFields)
      ? payload.changedFields
      : null;
    // A field edit's row the list missed (whole-app audit A7 pass 16 L-5):
    // the list pages by offset, newest first, so a row edited elsewhere
    // while it is read can be skipped, as can one past its last page. With
    // no row the phone's whole copy went up: a notes-only edit put 0% over
    // the web's 50%. The row is read by its id first; a read that fails
    // leaves the edit queued, and no row means the task really has none.
    // Independent review R02: a whole copy too (an approved schedule's row, a deleted lookahead's, Keep Phone's). It
    // went up over the row the list had missed, as the field edit did.
    if (!remote) {
      const row = await cloudScheduleItemMissedByList(payload.id, context);
      if (typeof row === 'string') return row;
      if (row) {
        remote = row;
        context.scheduleItemsById.set(payload.id, row);
      }
    }
    // The cloud had no row for this task when it was read by its id.
    const newToCloud = !remote;
    // Review N3 R3 (Medium, caused by 14b3569): a master's new row first goes up with his owner, contractor and note
    // as the cloud's row of the task has them now, where the copy the approving device took them from was behind
    // (scheduleItemTextAsItsTaskHasIt). That row is read by its id when the list did not hold it; when it cannot be
    // read the new row waits here, as any task whose cloud copy cannot be checked does.
    const takenFromId = newToCloud ? payload.itemData.textFromTask?.taskId : undefined;
    const takenFrom = takenFromId ? context.scheduleItemsById.get(takenFromId) ?? await cloudScheduleItemMissedByList(takenFromId, context) : null;
    if (typeof takenFrom === 'string') return takenFrom;
    // His own percent goes up with who stated it when the cloud's row shows a file's percent over his earlier one
    // (schedule review N1 M3): sent as the percent alone, it read as the file's, and the next lookahead lowered it.
    // On a row a newer master has replaced as well: the sync's merge then carries it to the task's newest row as his.
    const ownFields = remote && queuedFields ? scheduleItemFieldsWithOwnProgress(payload.itemData, queuedFields, remote) : queuedFields;
    // A carried owner, contractor or note only fills a blank in the cloud's row (review N2 P1): over a value the cloud
    // holds, the cloud's stands, with nothing asked and, when that leaves nothing to send, nothing written.
    const carriedText = remote && ownFields ? (payload.carriedText ?? []) as string[] : [];
    const changedFields = ownFields && carriedText.length > 0
      ? ownFields.filter(field => !carriedText.includes(field) || !String((remote as unknown as Record<string, unknown>)[field] ?? '').trim())
      : ownFields;
    if (carriedText.length > 0 && changedFields!.every(field => field === 'updatedAt')) return 'uploaded';
    // Review N3 R3 (Medium, caused by c3899ef): his owner, contractor or note typed on a row a newer master has since
    // replaced (this device had not heard of that master) stayed on the hidden row unless the new row was blank. It
    // also goes to the row the task lives on now, as his edit, weighed there by the same rules: over the copy it
    // started from it lands, over something else typed there Review Conflicts asks (scheduleItemTextEditOnRow). Only
    // a field that has the copy it started from (so never a carried one, which is the sync's), and not a field asked
    // about on this row itself (that card moves to the task's row when Review Conflicts opens).
    // To each row that answers to this one and that no other such row answers to: the master's own, and the row of a
    // schedule uploaded on the web and not made current yet (seed 1281: only the later imported of the two got it).
    // Not to a row in between (he missed two masters): it is hidden, and a card about it would ask the same twice.
    // What those rows hold tells a value that came down untouched from one typed on the way.
    if (remote && changedFields) {
      const answering = [...context.scheduleItemsById.values()].filter(row => row.id !== payload.id && scheduleTaskEarlierIds(row).includes(payload.id));
      const rowsNow = answering.filter(row => !answering.some(other => other !== row && scheduleTaskEarlierIds(other).includes(row.id)));
      const askedHere = rowsNow.length > 0 ? scheduleItemEditAgainstCloud(payload.itemData, changedFields, payload.base, remote).asked : [];
      for (const rowNow of rowsNow) {
        const onRowNow = scheduleItemTextEditOnRow(payload, changedFields.filter(field => !askedHere.includes(field)), rowNow,
          answering.filter(row => row !== rowNow && scheduleTaskEarlierIds(rowNow).includes(row.id)));
        if (!onRowNow) continue;
        const followed = await uploadQueueItem({ ...item, payload: onRowNow as unknown as ScheduleItemRecordPayload }, context);
        if (followed !== 'uploaded' && followed !== 'conflict') return followed;
      }
    }
    // Owner answer Q28 (2 Oct 2026): an edit that keeps the copy it started from is weighed field by field against the
    // cloud's row. A field only this device changed goes up; a field another device changed and this one left as it was
    // stays the cloud's; one changed on both to different values is asked about in Review Conflicts, while the edit's
    // other fields go up now. The progress keeps its own rules. A whole copy (a schedule approved, a lookahead deleted,
    // a percent carried) is merged as before, then weighed so on what David types about a task (its note, owner...):
    // the iPad's master, approved offline, put its old note over the phone's newer one. An edit queued without it
    // (Build 229 and earlier) and Keep Phone's chosen copy go up as before.
    // (Text the carry brought forward to the cloud's row since he typed over a blank is not another edit: review N3 R2.)
    const weighed = remote && changedFields && !payload.forceLocal && isEditBase(payload.base)
      ? scheduleItemEditAgainstCloud(payload.itemData, changedFields, scheduleItemEditBaseOverTextBroughtForward(payload.base, changedFields, remote,
        scheduleTaskEarlierIds(remote).flatMap(id => context.scheduleItemsById!.get(id) ?? [])), remote)
      : null;
    // A later percent of David's own in the cloud stands over the edit's older one (owner answer Q28): the progress is
    // not sent. Otherwise it goes as before.
    const laterPercentInCloud = Boolean(weighed && remote && scheduleItemLaterPercentInCloud(payload.itemData, changedFields!, payload.base, remote));
    const sentFields = weighed && changedFields
      ? changedFields.filter(field => !weighed.asked.includes(field) && !weighed.keptFromCloud.includes(field) && !weighed.held.includes(field) &&
        !(laterPercentInCloud && SCHEDULE_PROGRESS_FIELDS.includes(field)))
      : changedFields;
    // That later percent, confirmed again just after this device's older entry when this device's is the later
    // confirmed (review N1 finding 6): the device kept its entry, and its next Full Sync sent it whole over the cloud's.
    const laterPercentGivenBack = laterPercentInCloud && remote ? scheduleItemLaterPercentGivenBack(payload.itemData, remote) : null;
    const sent: ScheduleItemRecordPayload = weighed ? { ...payload, itemData: weighed.itemData } : payload;
    // A whole copy the cloud's row has changed under only in what David types about the task stands for the rest
    // (review N1 finding 3): a note typed on another device had stamped the row newer, and the merge took it whole,
    // dropping the dates of a lookahead approved offline.
    const restUnchanged = Boolean(remote && !changedFields && !payload.forceLocal && scheduleItemWholeCopyRestUnchanged(payload.base, remote));
    const recovered = remote && !changedFields && !payload.forceLocal
      ? restUnchanged ? payload.itemData : recoverDAVEScheduleRecords({
          local: [payload.itemData],
          cloud: [remote],
          allowCloudOnly: true,
        }).find(candidate => candidate.id === payload.id) || payload.itemData
      : null;
    const wholeWeighed = recovered && remote && isEditBase(payload.base)
      ? scheduleItemWholeCopyAgainstCloud(recovered, payload.itemData, payload.base, remote)
      : null;
    const asked = weighed?.asked ?? wholeWeighed?.asked ?? [];
    // What this upload decides for the task's open conflicts: the fields an edit sends of this device's own (owner
    // answer Q28). A whole copy decides none of a card's fields (review N1): null.
    const settles: readonly string[] | null = sentFields;
    const askAbout = async (row: ScheduleItem): Promise<'conflict'> => {
      const detectedAt = new Date().toISOString();
      await recordScheduleItemConflict(settles, {
        id: createQueueId('schedule_item_conflict', detectedAt),
        entity: 'schedule_item',
        localId: payload.id,
        localChangedAt: item.changedAt,
        remoteChangedAt: row.updatedAt || null,
        reason: 'This task changed on this device and on another device in the same place.',
        detectedAt,
        localPayload: {
          id: payload.id,
          itemData: payload.itemData,
          changedFields: [...asked, ...(weighed?.held ?? []), 'updatedAt'] as Array<keyof ScheduleItem>,
          base: scheduleItemEditBaseOf(payload.base as ScheduleItemEditBase, asked),
          askedFields: asked,
        } satisfies ScheduleItemRecordPayload,
        remotePayload: row,
      });
      return 'conflict';
    };
    // A whole copy that stands for the rest and, weighed, is the cloud's row but for its stamp has nothing to write.
    if (remote && restUnchanged && wholeWeighed &&
      canonicalScheduleItemJson({ ...wholeWeighed.itemData, updatedAt: remote.updatedAt }) === canonicalScheduleItemJson(remote)) {
      if (asked.length > 0) return askAbout(remote);
      await settleScheduleItemConflicts(payload.id, settles);
      return 'uploaded';
    }
    // A carried percent lands only while the merge's rule holds against this copy (A7 pass 26 M-1).
    const carriedOnto = remote && sentFields && sent.carriedProgress === true
      ? scheduleItemCarriedOntoCloudCopy(sent, sentFields, remote)
      : null;
    // Whole-app audit A7 pass 27 L1 (Low, caused by 30170fc): a carried percent sent on its own is the sync's, not an
    // edit of David's, so it never settles a conflict on the task waiting for Review Conflicts (Keep Phone then said the
    // conflict had closed by itself). Queued with an edit of his, the edit settles it, as any edit does.
    const carryOnly = (carriedOnto !== null || carriedText.length > 0) && scheduleItemCarryOnly(changedFields || [], carriedText);
    if (carriedOnto === 'unchanged') {
      if (asked.length > 0) return askAbout(remote!);
      if (!carryOnly) await settleScheduleItemConflicts(payload.id, settles);
      return 'uploaded';
    }
    const authoritative = carriedOnto
      ? carriedOnto
      : remote && sentFields
      ? {
          ...sentFields.reduce<ScheduleItem>(
            (merged, field) => field === 'projectControls' &&
              sent.itemData.projectControls &&
              remote.projectControls
              ? {
                  ...merged,
                  projectControls: mergeProjectControlsRevisions(
                    sent.itemData.projectControls,
                    remote.projectControls,
                  ),
                }
              : {
                  ...merged,
                  [field]: sent.itemData[field],
                },
            remote,
          ),
          ...(laterPercentGivenBack ?? {}),
          updatedAt: new Date().toISOString(),
        }
      : recovered
        // Stamped anew when it keeps a value of the cloud's over this device's copy: this device's copy, newer in its
        // stamp alone, then outranked it again in the next merge (owner answer Q28). Just after the later of the two
        // copies, not with the time of the upload (review N1 finding 3): the older of two lookaheads approved offline,
        // uploaded first, then outranked the newer one.
        // Independent review pass 2 (schedule F1, Medium, caused by d0bdf4f): a copy that stands whole and keeps nothing
        // of the cloud's is stamped only to outrank a stamp there is. With no stamp on either copy (a task never edited
        // by hand) the stamp was the time of the upload: a master that only listed the task unchanged stamped its row
        // "just now", and a lookahead approved earlier with no signal then lost its dates and percent to that row.
        ? wholeWeighed && (JSON.stringify(wholeWeighed.itemData) !== JSON.stringify(recovered) ||
          (restUnchanged && Boolean(payload.itemData.updatedAt || remote!.updatedAt)))
          ? { ...wholeWeighed.itemData, updatedAt: scheduleItemStampAfter(payload.itemData.updatedAt, remote!.updatedAt) }
          : recovered
        // Keep Phone keeps the cloud's import memberships (whole-app audit A5 pass 3 F6)
        // and earlier task ids (A8 pass 10 L2).
        : withScheduleTaskEarlierIdsOf(withScheduleImportMembershipOf(
          scheduleItemTextAsItsTaskHasIt(payload.itemData, takenFrom, takenFromId ? context.queuedScheduleItemEditBases?.get(takenFromId) : null, true), remote), remote);
    if (remote && JSON.stringify(authoritative) === JSON.stringify(remote)) {
      if (asked.length > 0) return askAbout(remote);
      if (
        changedFields ||
        payload.forceLocal ||
        JSON.stringify(payload.itemData) === JSON.stringify(remote) ||
        // A whole copy that differs from the cloud's row only where it is the copy it started from has nothing to ask
        // about (owner answer Q28): the cloud's row stands, as its other device left it.
        (isEditBase(payload.base) && JSON.stringify(scheduleItemWholeCopyOverCloud(payload.itemData, payload.base, remote)) === JSON.stringify(remote))
      ) {
        await settleScheduleItemConflicts(payload.id, settles);
        return 'uploaded';
      }

      // With what a card of fields already open for the task holds (review N1): this conflict took its place.
      await recordScheduleItemConflict(null, {
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
    // A task the cloud has no row for is written only if it still has none (independent review R02): a row another
    // device adds meanwhile is left as it is.
    // Independent review pass 2 (item 1): and a task the cloud has a row for is written only if that row is still
    // the one this edit was weighed against. The list is read once for the whole pass: while this device wrote one
    // queued task, another device set the next one's owner, and that task then went up as "the row as listed, with
    // this device's note": the owner was erased everywhere, with no card. Refused either way, nothing is written; the
    // row is read again by its id and the edit weighed again against it, by the same rules.
    // Independent review pass 4: Keep Phone's copy is written only over the row version Keep Phone itself checked
    // (keptOverRowVersion), whatever this pass listed since: a row another device wrote between Keep Phone's read and
    // this pass's read of the list is then not the row it names, and the write is refused, as above. Never as new:
    // Keep Phone saw a row, so none now means it was deleted.
    const result = await upsertScheduleItem(authoritative, ...(payload.forceLocal && payload.keptOverRowVersion
      ? [{ ifUnchangedSince: payload.keptOverRowVersion }]
      : newToCloud ? [{ onlyIfAbsent: true }] : cloudRowWriteConditionFor(remote)));
    if (result.ok && !result.stubbed) {
      context.scheduleItemsById.set(payload.id, withCloudRowVersion(authoritative, cloudRowVersionOf(result.data)));
      if (asked.length > 0) return askAbout(authoritative);
      if (!carryOnly) await settleScheduleItemConflicts(payload.id, settles, authoritative);
      return 'uploaded';
    }
    if (result.code === SCHEDULE_ITEM_ALREADY_IN_CLOUD || result.code === CLOUD_ROW_CHANGED_SINCE_READ) {
      // Keep Phone's copy is not read again and sent (independent review pass 3): it is not weighed, it stands, so it
      // went whole over what another device wrote in the moment after Keep Phone had checked the row. It is left
      // unsent, and Keep Phone looks at the row as it is now (resolveScheduleItemSyncConflict).
      if (payload.forceLocal) keptTaskCopiesRefused.add(payload.id);
      const rowNow = payload.forceLocal ? null
        : await cloudRowToWeighAgain(context, `schedule_item:${payload.id}`, payload.id, cloudScheduleItemsByIds);
      if (rowNow) {
        context.scheduleItemsById.set(payload.id, rowNow);
        return uploadQueueItem(item, context);
      }
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
  // Not an analysis result the cloud's copy holds a later one for, or the
  // same one (A4 pass 25 L1): the phone's result, finished offline, went over
  // the iPad's retried result and David's Confirmed mark on it.
  const patchesToApply = cloudCopy?.updateData
    ? fieldUpdatePatchesNotSuperseded(cloudCopy.updateData as object, documentPatches || []) : [];
  const patchedCloudCopy = cloudCopy?.updateData
    ? applyFieldUpdateDocumentPatches(cloudCopy.updateData as object, patchesToApply)
    : null;
  // An archive has no copy of its own to send (A4 pass 11 O2).
  if (payload.archiveOnly && !patchedCloudCopy) return 'uploaded';
  // A document change settles no conflict: the phone's own edit waits for
  // review, with its Keep Phone choice (whole-app audit A4 pass 9 L1).
  if (cloudCopy && patchedCloudCopy === cloudCopy.updateData) {
    // Nothing was written. A result left out for the cloud's own is not this
    // phone's copy in the cloud (A7 pass 22 L-1): recorded, a refresh kept
    // the card's older result, shown as Sent.
    if (patchesToApply.length === (documentPatches || []).length) recordProjectUpdateUpload(payload.id);
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
  // Review N2 L6 (Low, an older rule, in Build 229): an edit that keeps the copy it started from is judged by owner
  // answer Q28's weighing alone (below). The check here ran first, by the two times alone, and raised cards Q28 says
  // should not exist: two copies that read the same in every part, a card when the other device had only added a
  // late photo result (Keep Cloud there dropped David's edit), a card when the cloud already held all he had changed.
  // It stays for an edit with no such copy (one queued by Build 229), where it is all there is, and for his choices.
  const cloudUpdateData = remoteMetadata.ok && !remoteMetadata.stubbed ? remoteMetadata.data?.updateData : undefined;
  const judgedByStartingCopy = !patchedCloudCopy && Boolean(cloudUpdateData) && isFieldUpdateEditBase(payload.base) &&
    !payload.overConflict && !payload.keepCloudChoice;
  if (
    !patchedCloudCopy &&
    !ownPatchesSinceEdit &&
    !judgedByStartingCopy &&
    remoteMetadata.ok &&
    remoteMetadata.data?.updatedAt &&
    isRemoteNewer(remoteMetadata.data.updatedAt, item.changedAt)
  ) {
    if (projectUpdatePayloadsMatch(payload.updateData, remoteMetadata.data.updateData)) {
      await clearConflictsForLocalRecord('project_update', payload.id);
      recordProjectUpdateUpload(payload.id);
      return 'uploaded';
    }
    // Keep Cloud's own copy meeting a newer cloud copy is no new conflict
    // (whole-app audit A4 pass 22 L1): its phone side was then that copy,
    // still marked as Keep Cloud's, which is held, and every Keep Phone said
    // "Conflict not resolved". The conflict it was chosen over takes the
    // cloud's copy, and Keep Cloud asks David to review again; the copy stays
    // queued for Keep Cloud's put-back, which takes it off by its mark.
    if (payload.keepCloudChoice && await keepCloudChoiceMetNewerCloudCopy(payload, remoteMetadata.data)) {
      return KEEP_CLOUD_CHOICE_CLOUD_COPY_CHANGED;
    }

    await recordConflict({
      id: createQueueId('project_update_conflict', new Date().toISOString()),
      entity: 'project_update',
      localId: payload.id,
      localChangedAt: item.changedAt,
      remoteChangedAt: remoteMetadata.data.updatedAt,
      reason: 'Remote update changed after the local pending change.',
      detectedAt: new Date().toISOString(),
      localPayload: withoutKeepCloudMarks(payload), // the phone's side is never Keep Cloud's copy (A4 pass 22 L1)
      remotePayload: remoteMetadata.data.updateData,
    });

    return 'conflict';
  }

  // Owner answer Q28 (2 Oct 2026; A4 pass 16, older than the audit: "last save wins"): an edit that keeps the copy it
  // started from is weighed against the cloud's copy. The iPad changed the note while the phone, offline, changed the
  // area: the phone's copy went up whole and the iPad's note was gone, with no conflict shown. Changed on both since,
  // and different, it goes to Review Conflicts, as an older edit does (above), and nothing automatic sends it until
  // David chooses. Changed only here: sent as before. Where the two differ only by the cloud's changes (this device's
  // own are in the cloud already, or it made none): nothing of this device's is sent over them, and the card takes the
  // cloud's copy. David's own choices (Keep Phone, Keep Cloud, a Retry he confirmed) go as before.
  // Review N2 M1 (Medium, a gap in 79a5ae1): an edit over a cloud copy newer by this device's own patches alone was
  // not weighed. The copy the phone's late photo result went onto already held the iPad's note, and the phone's edit
  // of the area then went over that note with no card. It is weighed like any other: what its own patches changed is
  // its own change (fieldUpdateEditBaseWithOwnWrites), and it still goes up with them, as before (below).
  // Review N2 L7 (Low, a gap in 79a5ae1): nor is what a choice of his wrote another device's change, to an edit begun
  // before that choice. After Keep Phone, the newer edit it sends next came back at once as a second card, naming
  // "another device" for the parts his choice had just written (fieldUpdateChoiceWrittenAfter).
  const weighedBase = judgedByStartingCopy
    ? fieldUpdateEditBaseWithOwnWrites(payload.base as FieldUpdateEditBase, cloudUpdateData, {
        patchedFrom: ownPatchesSinceEdit?.ontoParts,
        chosen: await fieldUpdateChoiceWrittenAfter(payload.id, payload.base as FieldUpdateEditBase),
      })
    : null;
  const againstCloud = weighedBase ? fieldUpdateEditAgainstCloud(weighedBase, payload.updateData, cloudUpdateData) : 'as-before';
  // Review N2 L6: the older check had been stopping these sends, so what the weighing decides must lose no photo
  // result. A copy the cloud's newer copy settles still puts a photo result of its own that stands over the cloud's
  // (a late result it took in while it waited) onto the cloud's copy, as that result's own patch would have: settled
  // and never sent, the result was on no device.
  const settledCopy = againstCloud === 'cloud' ? withPhoneAnalysisResults(cloudUpdateData, [payload.updateData]) : null;
  const settledByCloud = async (): Promise<'uploaded'> => {
    projectUpdateQueueItemsSettledByCloud.add(item.id);
    await keepSettledFieldUpdateBase(payload.id, payload.base as FieldUpdateEditBase, payload.updateData);
    return 'uploaded';
  };
  if (againstCloud !== 'as-before') {
    if (againstCloud === 'conflict') {
      await recordConflict({
        id: createQueueId('project_update_conflict', new Date().toISOString()),
        entity: 'project_update',
        localId: payload.id,
        localChangedAt: item.changedAt,
        remoteChangedAt: remoteMetadata.data?.updatedAt || null,
        reason: 'This update changed on this device and on another device since this edit began.',
        detectedAt: new Date().toISOString(),
        localPayload: { ...withoutKeepCloudMarks(payload), base: weighedBase! }, // Review Conflicts names the other device's changes only
        remotePayload: cloudUpdateData,
      });
      return 'conflict';
    }
    if (settledCopy === cloudUpdateData) return settledByCloud();
  }

  // Review N2 L6: nothing of this copy is left to send when the cloud's copy is this copy with photo results that
  // stand over its own: two copies that read the same, which the older check made a card of. Sent whole, it took the
  // other device's late result off the cloud's copy. David's choices go as they are.
  if (!patchedCloudCopy && !settledCopy && !ownPatchesSinceEdit && cloudUpdateData && !payload.overConflict && !payload.keepCloudChoice &&
    daveProjectUpdateMatchesCloudReceipt(withCloudPhotoAnalysisResults(payload.updateData, cloudUpdateData, { unorderedStaysClouds: true }), cloudUpdateData)) {
    await clearConflictsForLocalRecord('project_update', payload.id);
    recordProjectUpdateUpload(payload.id);
    return 'uploaded';
  }

  // Review N2 L6: an edit the older check used to stop goes up over a cloud copy stamped later than it is. It goes
  // stamped as that copy is: the cloud's copy does not read older than it was to an edit still judged by the two
  // times.
  const newerCloudStamp = judgedByStartingCopy && !ownPatchesSinceEdit && remoteMetadata.data?.updatedAt &&
    isRemoteNewer(remoteMetadata.data.updatedAt, item.changedAt) ? remoteMetadata.data.updatedAt : null;
  const record = settledCopy ? projectUpdateRecordOnCloudCopy(remoteMetadata.data!, payload, settledCopy)
    : cloudCopy && patchedCloudCopy ? projectUpdateRecordOnCloudCopy(cloudCopy, payload, patchedCloudCopy) : {
    projectId: payload.projectId || '',
    projectName: payload.projectName || 'Unassigned Project',
    areaName: payload.selectedAreaName || '',
    idempotencyKey: projectUpdateIdempotencyKey(payload.updateData, payload.id),
    // Review N2 (recorded in pass 2 as L9a): every whole copy goes up with the cloud's photo results that sending it
    // would take off (withCloudPhotoAnalysisResults). A device that had not heard the other device's late result sent
    // its copy without it, and the result was gone from the cloud's copy. A copy David chose goes the same way. Two
    // results that cannot be put in order stay as they went before: the cloud's for an edit older than the cloud's
    // copy (review N2 L6), else this copy's.
    updateData: withCloudPhotoAnalysisResults(ownPatchesSinceEdit
      ? applyFieldUpdateDocumentPatches(payload.updateData as object,
        fieldUpdatePatchesNotSuperseded(payload.updateData as object, ownPatchesSinceEdit.patches)) as unknown
      : payload.updateData, cloudUpdateData, { unorderedStaysClouds: Boolean(newerCloudStamp) }),
    // The later of the two (whole-app audit A7 pass 13 L-1): Keep Phone's
    // copy and a confirmed Retry's are stamped now, after the patches, and
    // went up stamped back to the last patch's time; an iPad edit saved
    // offline in between then read newer, and went over the chosen copy.
    updatedAt: ownPatchesSinceEdit && isRemoteNewer(ownPatchesSinceEdit.at, item.changedAt)
      ? ownPatchesSinceEdit.at : newerCloudStamp ?? item.changedAt,
  };
  const result = await saveProjectUpdate({ id: payload.id, ...record });

  if (result.ok && !result.stubbed) {
    if (settledCopy) return settledByCloud(); // only its own photo result went up, onto the cloud's copy
    // A retry after a conflict put the phone's copy in the cloud: that
    // conflict is settled, as when the cloud already matched (audit A4 pass 5).
    // Keep Cloud's copy leaves it to Keep Cloud (A7 pass 17 L-1).
    if (!documentPatches && !payload.keepCloudChoice) await clearConflictsForLocalRecord('project_update', payload.id);
    if (cloudCopy && patchedCloudCopy) {
      noteProjectUpdatePatchesLanded(payload.id, cloudCopy.updatedAt, { updatedAt: record.updatedAt, updateData: patchedCloudCopy }, documentPatches || [], cloudCopy.updateData);
    }
    else projectUpdatePatchesLanded.delete(payload.id);
    // The copy a choice of his put in the cloud is his own write, to the edits he saved before it (review N2 L7).
    if (!documentPatches && payload.overConflict && !payload.keepCloudChoice) await noteFieldUpdateChoiceWritten(payload.id, record.updateData);
    // Review N2 (found explaining seed 298; older than owner answer Q28): the copy now in the cloud is the copy its
    // card starts from, as a Sent card's is. When a pass other than the card's own sync lands it (the upload retry,
    // after the card's own write failed), the card goes on reading "Waiting to Sync"; the waiting-update sync then
    // staged it again with no copy to start from, and it went up whole, stamped now, over an edit the iPad had made
    // since, with no card. Remembered (noteFieldUpdateCopyInCloud), the copy staged again is weighed.
    if (!cloudCopy) await noteFieldUpdateCopyInCloud(payload.id, record.updateData);
    recordProjectUpdateUpload(payload.id);
    return 'uploaded';
  }

  return result.error
    ? `Project update database upsert failed: ${result.error}`
    : result.message || 'Project update sync is waiting for Supabase.';
}

/**
 * Review N2 L7 (Low, a gap in 79a5ae1, owner answer Q28): the copy of a field
 * update a choice of David's put in the cloud (Keep Phone's, or a Retry he
 * confirmed over the conflict), as its parts and when: kept beside the copies
 * he opened, on this device, for the signed-in account, through a relaunch.
 * Keep Cloud's copy is the other device's work, and is not kept.
 *
 * Keep Phone sends the card's own copy and then the newer edit he saved while
 * the card waited (newerEditQueuedAfter). That edit is weighed against the
 * cloud's copy, now the one his choice wrote, by the copy it started from.
 * When it had not started from the card's own copy (he had saved more than
 * once and a late photo result came in between, so the last save started
 * from the card showing his earlier unsent save), each part his choice wrote
 * read as changed on another device, and a second card came up at once.
 *
 * Review N2 pass 4 (observation): this is right only of an edit begun from a
 * copy of his own, which holds everything his choice keeps or his own later
 * word for it. An edit begun from the cloud's copy would go up the same way,
 * with no card, and put the cloud's older parts over the ones Keep Phone had
 * just kept. No such edit can begin. While his copy waits in Review
 * Conflicts its card keeps his copy (projectUpdateUploadedSince: a refresh
 * used to put the cloud's copy there), and a card that does show the cloud's
 * copy reads Sent, which opens read-only and is never retried by itself
 * (App.tsx openSavedUpdate; review-n2-field-update-review-card-reopened.test.ts).
 */
const fieldUpdateChoiceKey = (updateId: string) => `${updateId}\nchoice`;

async function noteFieldUpdateChoiceWritten(updateId: string, written: unknown): Promise<void> {
  try {
    const choice = fieldUpdateEditBaseOf(written, new Date().toISOString());
    await mutateFieldUpdateEditBases(bases => { bases[fieldUpdateChoiceKey(updateId)] = choice; });
  } catch {
    // Not kept: a later edit is weighed as before.
  }
}

/**
 * The parts of the copy his choice put in the cloud, for an edit that began
 * before it (its base is no later). An edit begun afterwards started from
 * what the device showed then, and is weighed by that alone: a part another
 * device has since put back to what his choice wrote is that device's change.
 */
async function fieldUpdateChoiceWrittenAfter(updateId: string, base: FieldUpdateEditBase): Promise<Readonly<Record<string, string>> | null> {
  try {
    const choice = await mutateFieldUpdateEditBases(bases => bases[fieldUpdateChoiceKey(updateId)]);
    return isFieldUpdateEditBase(choice) && Date.parse(base.takenAt) <= Date.parse(choice.takenAt) ? choice.fields : null;
  } catch {
    return null;
  }
}

/**
 * Review N2 (the fault behind seed 298; older than owner answer Q28): the
 * whole copy of a field update this device knows is in the cloud, because it
 * put it there or found it there (the cloud receipt), while its card still
 * owes its own sync: kept on this device, for the signed-in account, through
 * a relaunch, under its own entry beside the copies he opened.
 *
 * The pass that sends a record does not tell its card. When the card's own
 * sync was not the one that sent it (its write failed and the upload retry
 * landed it, or it landed with its answer lost and the retry found it in the
 * cloud), the card goes on reading "Waiting to Sync" with nothing queued.
 * The waiting-update sync then staged that card with no copy to start from,
 * stamped now, and it went up whole over an edit the other device had made
 * since, with no card. A card that is, part for part, this copy starts from
 * it, as a Sent card starts from itself (writeStagedProjectUpdateRecord), so
 * it is weighed (owner answer Q28) and the other device's edit stays.
 *
 * Its own entry: kept with the copies he opened, an update he had opened and
 * not saved since kept that copy instead, and the card again started from
 * none. Only for a copy whose card owes a sync: Sync Now finds every Sent
 * card's copy in the cloud, and those need no entry.
 */
const fieldUpdateInCloudKey = (updateId: string) => `${updateId}\nin cloud`;

async function noteFieldUpdateCopyInCloud(updateId: string, copy: unknown): Promise<void> {
  if (!isRecord(copy) || !fieldUpdateOwesOwnSync(copy.status)) return;
  try {
    const inCloud = fieldUpdateEditBaseOf(copy, new Date().toISOString());
    await mutateFieldUpdateEditBases(bases => { bases[fieldUpdateInCloudKey(updateId)] = { ...inCloud, settledParts: inCloud.fields }; });
  } catch {
    // Not kept: a card still waiting is staged as before.
  }
}

/** The copy this device knows is in the cloud, when this card is that copy part for part: the copy it starts from. */
async function fieldUpdateCopyKnownInCloud(card: ProjectUpdate): Promise<FieldUpdateEditBase | undefined> {
  try {
    const inCloud = await mutateFieldUpdateEditBases(bases => bases[fieldUpdateInCloudKey(card.id)]);
    return isFieldUpdateEditBase(inCloud) && fieldUpdateCopyIsSettled(inCloud, card) ? inCloud : undefined;
  } catch {
    return undefined;
  }
}

/** The record that puts a changed copy of the cloud's own copy of a field update in its place, stamped now (a patch on it). */
function projectUpdateRecordOnCloudCopy(
  cloud: { projectId?: string | null; projectName?: string | null; areaName?: string | null; updateData?: unknown },
  payload: ProjectUpdateRecordPayload,
  updateData: unknown,
) {
  return {
    projectId: cloud.projectId || payload.projectId || '',
    projectName: cloud.projectName || payload.projectName || 'Unassigned Project',
    areaName: cloud.areaName ?? payload.selectedAreaName ?? '',
    idempotencyKey: projectUpdateIdempotencyKey(cloud.updateData, payload.id),
    updateData,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The base for weighing an edit against a cloud copy that holds this device's
 * own writes (review N2, 5 Oct 2026), beside the earlier values of the queued
 * copy itself (FieldUpdateEditBase `own`): a part the cloud holds as one of
 * them left it is this device's own change, not another device's.
 * - `patchedFrom` (M1, a gap in 79a5ae1): the parts of the copy this device's
 *   own patches went onto (a document taken off, a finished document upload,
 *   a late photo result), while the cloud's copy is still the one they left.
 *   "Newer only by this device's own patches" skipped the weighing, and the
 *   copy the patch went onto already held the iPad's note: the phone's edit
 *   of the area went over it with no card. The edit is weighed all the same,
 *   and only a part that copy held as the base has it, and the cloud holds
 *   differently now, is the patches' doing.
 * - `chosen` (L7, a gap in 79a5ae1): the parts of the copy a choice of
 *   David's put in the cloud after this edit began (Keep Phone's, a Retry he
 *   confirmed). Keep Phone sends the card's copy and then the newer edit he
 *   saved while the card waited; that edit had started from another copy
 *   of his own (the card showing an earlier unsent save), so every part his
 *   choice had just written read as another device's change, and a second
 *   card came up at once. A part the cloud still holds as his choice wrote
 *   it is his own write (of an edit begun from a copy of his own, the only
 *   kind there is while his copy waits: noteFieldUpdateChoiceWritten).
 */
function fieldUpdateEditBaseWithOwnWrites(
  base: FieldUpdateEditBase,
  cloud: unknown,
  { patchedFrom, chosen }: {
    patchedFrom?: Readonly<Record<string, string>> | null;
    chosen?: Readonly<Record<string, string>> | null;
  },
): FieldUpdateEditBase {
  if (!patchedFrom && !chosen) return base;
  const theirs = fieldUpdateMeaningParts(cloud);
  const own: Record<string, readonly string[]> = { ...(base.own ?? {}) };
  let added = false;
  [...new Set([...Object.keys(theirs), ...Object.keys(base.fields)])].forEach(part => {
    const mark = theirs[part] ?? '';
    const started = base.fields[part] ?? '';
    if (mark === started || (own[part] ?? []).includes(mark)) return;
    const patched = Boolean(patchedFrom) && (patchedFrom![part] ?? '') === started;
    const chose = Boolean(chosen) && (chosen![part] ?? '') === mark;
    if (!patched && !chose) return;
    own[part] = [...(own[part] ?? []), mark];
    added = true;
  });
  return added ? { ...base, own } : base;
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
 *
 * `ontoParts`: the parts of the copy they went onto (review N2 M1). An edit
 * that keeps the copy it started from is weighed against the cloud's copy
 * all the same (owner answer Q28): the copy they went onto may hold another
 * device's change, which this device's own patches do not excuse.
 */
const projectUpdatePatchesLanded = new Map<string, {
  onto: string; ontoParts: Record<string, string>; at: string; copy: unknown; patches: FieldUpdateDocumentPatch[];
}>();

function noteProjectUpdatePatchesLanded(
  updateId: string,
  onto: string | null | undefined,
  left: { updatedAt: string; updateData: unknown },
  patches: readonly FieldUpdateDocumentPatch[],
  ontoCopy: unknown,
): void {
  const earlier = projectUpdatePatchesLanded.get(updateId);
  if (!onto || !Number.isFinite(Date.parse(onto))) {
    projectUpdatePatchesLanded.delete(updateId);
    return;
  }
  // One after another: the first went onto the copy before them all.
  const chained = earlier && sameCloudTime(earlier.at, onto);
  projectUpdatePatchesLanded.set(updateId, {
    onto: chained ? earlier.onto : onto, ontoParts: chained ? earlier.ontoParts : fieldUpdateMeaningParts(ontoCopy),
    at: left.updatedAt, copy: left.updateData,
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

/** Queue records of field updates settled by the cloud's newer copy without a write (owner answer Q28), in this pass. */
const projectUpdateQueueItemsSettledByCloud = new Set<string>();

function noteProjectUpdateVersionInCloud(item: SyncQueueItem) {
  const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
  if (item.entity !== 'project_update' || item.operation === 'delete' || payload.archiveOnly || !payload.id) return;
  if (payload.updateData && typeof payload.updateData === 'object') {
    projectUpdateLastVersionInCloud.set(payload.id, payload.updateData as ProjectUpdate);
  }
}

/**
 * Its archive aside when that copy is archived and this one not (A4 pass 17
 * L2): nothing un-archives an update. So is a photo result that copy holds
 * and that stands over this one's (A4 pass 29 L1), as staging takes it
 * (withQueuedAnalysisResults): a card analysing a photo again, its record
 * already in the cloud, read as owing a send, its photos went up again, and
 * the card turned "Sync failed · Photo upload issue" with nothing to retry.
 */
function projectUpdateVersionIsInCloud(update: ProjectUpdate): boolean {
  const sent = projectUpdateLastVersionInCloud.get(update.id);
  return Boolean(sent) && sameProjectUpdateContent(sent, withSentCopysStandingParts(update, sent) as ProjectUpdate);
}

/**
 * The copy with the archive and the photo results of the copy this device
 * last put in the cloud, where those stand over its own
 * (photoAnalysisResultStands; A4 pass 27 L1).
 */
function withSentCopysStandingParts(update: ProjectUpdate, sent: ProjectUpdate | undefined): unknown {
  return withPhoneAnalysisResults(withArchiveKept(update, [], sent), sent ? [sent] : []);
}

/**
 * The card as a sync attempt leaves it (whole-app audit A4 pass 27 L2): with
 * the photo results of the copy this device last put in the cloud where they
 * stand over its own. A sync attempt keeps a result its queued copy holds
 * (withQueuedAnalysisResults), and the card read Sent with "Retry needed"
 * while the cloud held the iPad's Confirmed result.
 */
export function withAnalysisResultsLastInCloud<TUpdate extends ProjectUpdate>(update: TUpdate): TUpdate {
  const sent = projectUpdateLastVersionInCloud.get(update.id);
  if (!isRecord(sent) || !Array.isArray(sent.photos)) return update;
  // A photo the card is analysing again keeps "Analyzing" (A7 pass 24 L-1): its run lands on the card.
  const analysing = new Set((update.photos || [])
    .filter(photo => (photo.photoIntelligence as { status?: unknown } | undefined)?.status === 'analyzing')
    .map(photo => photo.id));
  const others = { ...sent, photos: (sent.photos as unknown[]).filter(photo => !isRecord(photo) || !analysing.has(photo.id as string)) };
  return withPhoneAnalysisResults(update, [others]) as TUpdate;
}

/**
 * Whether this copy of a field update is, in content, the one this device
 * last put in the cloud (its documents' upload state and a Retry's stamps
 * aside): as Keep Phone leaves it (whole-app audit A7 pass 9 L1). An archive
 * that copy carries and this one does not is aside too (A4 pass 17 L2): the
 * card is not archived when Keep Phone keeps an archive made on the iPad,
 * and Settings took it for a newer edit, which left it Waiting to Sync.
 * So is a photo result it holds that stands over this one's (A4 pass 27
 * L1): Keep Phone sent the iPad's Confirmed result, Settings took the card's
 * failed one for a newer edit and sent the card whole over it.
 */
export function projectUpdateCopyIsLastInCloud(update: ProjectUpdate): boolean {
  const sent = projectUpdateLastVersionInCloud.get(update.id);
  return fieldUpdateOwesNothingBeyond(sent, [], withSentCopysStandingParts(update, sent) as object);
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
  syncConflictsAsOfQueueRead = [];
  projectUpdatePatchesLanded.clear();
  removedDocumentsRequeuedThisLaunch.clear();
  resetDocumentsResentThisLaunchForTests();
}

function recordProjectUpdateUpload(updateId: string) {
  projectUpdateUploadedAt.set(updateId, Date.now());
}

/**
 * Whether the refresh leaves this device's card of a field update as it is,
 * though no copy of it is queued: its own upload landed after the list was
 * read (audit A7 M5), or a copy of it waits in Review Conflicts (review N2
 * pass 4, Low; in Build 229, the rule unchanged since 80f5eb6).
 *
 * A conflict takes the update's record off the queue, and the refresh keeps
 * a card over the cloud's copy only while a copy of it is queued
 * (refreshKeepsLocalProjectUpdate). At the next refresh or relaunch the card
 * showed the iPad's copy and was Sent underneath, with David's edit still
 * waiting for his choice in Settings: his own copy was nowhere on the card,
 * its Retry and its way back into the editor were gone, and anything saved
 * on it later started from the iPad's copy. The card now stays as it was,
 * "Needs Review" with his copy, through a refresh and a relaunch, until he
 * chooses; a realtime echo leaves it too (fieldUpdateWaitsInReviewConflicts).
 * Whatever its status: a card an earlier build had already turned to the
 * cloud's copy stays so, and Keep Phone puts his copy back on it.
 */
export function projectUpdateUploadedSince(updateId: string, since: number): boolean {
  return (projectUpdateUploadedAt.get(updateId) ?? Number.NEGATIVE_INFINITY) >= since ||
    Boolean(openFieldUpdateConflict(syncConflictsAsOfQueueRead, updateId));
}

/**
 * The saved conflicts as of this device's last read of its queue (review N2
 * pass 4). The refresh reads the queue and then decides card by card without
 * waiting again, so they are read with the queue (getOfflineQueue) and held
 * here for that decision: after a relaunch nothing else has read them yet.
 * Read as they are stored, not behind a conflict write under way: the queue
 * is read from many places, and none of them waits on those. A conflict is
 * saved before its record leaves the queue, so a queue read that no longer
 * holds the record is followed by a read that holds its conflict. When they
 * cannot be read, as last read.
 */
let syncConflictsAsOfQueueRead: readonly SyncConflict[] = [];

async function readSyncConflictsWithQueue(): Promise<void> {
  syncConflictsAsOfQueueRead = await readSyncConflictsUnsafe().catch(() => syncConflictsAsOfQueueRead);
}

/**
 * Whether a copy of this field update waits in Review Conflicts on this
 * device now, read from its saved conflicts (review N2 pass 4): a realtime
 * echo of the iPad's save leaves its card as the refresh does.
 */
export async function fieldUpdateWaitsInReviewConflicts(updateId: string): Promise<boolean> {
  return Boolean(openFieldUpdateConflict(await getSyncConflicts(), updateId));
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
  // waits in the conflict (whole-app audit A4 pass 15 H1). Nor does Keep
  // Cloud's own copy: Keep Cloud closes it (A7 pass 17 L-1).
  if (!queuedFieldUpdateDocumentPatches(item) && !payload.keepCloudChoice) {
    await clearConflictsForLocalRecord('project_update', payload.id);
  }
  // A whole copy found in the cloud is the copy its card starts from, as one this pass put there is (review N2, the
  // fault behind seed 298): its write had landed with the answer lost, and its card still reads "Waiting to Sync".
  if (!queuedFieldUpdateDocumentPatches(item)) await noteFieldUpdateCopyInCloud(payload.id, payload.updateData);
  // The copy a choice of his put in the cloud is his own write also when it is found there (review N2 L7): Keep
  // Phone's write landed with its answer lost, Settings said "Conflict not resolved", and Keep Phone again met its own
  // copy in the cloud. Not remembered, the newer edit it sends next came back as the second card.
  if (!queuedFieldUpdateDocumentPatches(item) && payload.overConflict && !payload.keepCloudChoice) {
    await noteFieldUpdateChoiceWritten(payload.id, payload.updateData);
  }
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
