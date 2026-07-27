import {
  archiveProjectUpdate,
  countCloudProjects,
  createProject,
  createPhotoSignedUrl,
  deleteProjectUpdate,
  deleteProject,
  getProjectUpdateSyncMetadata,
  getSupabaseConfigurationStatus,
  listProjectUpdates,
  listProjectAreas,
  listProjects,
  listReferenceDocuments,
  listScheduleItems,
  purgeExpiredDAVEDeletionAudit,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStoredJson, setStoredJson } from './StorageService';
import {
  deletedDAVERecordIds,
  removeDAVETombstonedRecords,
  synchronizeDAVESyncTombstones,
  type DAVESyncTombstoneSyncResult,
} from './DAVESyncTombstones';
import { mergeDAVEProjectAreaRecoveryRecords } from './DAVEProjectAreaRecovery';
import { recoverDAVEScheduleRecords } from './DAVEScheduleRecovery';
import { mergeDAVEReferenceDocumentRecoveryRecords } from './DAVECloudRecovery';
import {
  confirmProjectUpdateCloudDeletion,
  hasProjectUpdateDeletionIntent,
  recordProjectUpdateDeletionIntent,
} from './ProjectUpdateDeletionJournal';
import { createDurableLocalTransactionRepository } from './DurableLocalTransaction';
import { startGuardedBackgroundTask } from './BackgroundTaskGuard';
import { createPendingChangesRetryController } from './PendingChangesRetryController';
import { processDAVEStorageCleanup } from './DAVEStorageCleanup';
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

export type SyncStatus = {
  configured: boolean;
  queuedChanges: number;
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
  itemOutcomes?: Record<string, SyncItemOutcome>;
  queued: number;
  conflicts: number;
  errors: string[];
};

export type SyncItemOutcome =
  | 'uploaded'
  | 'superseded'
  | 'conflict'
  | 'blocked'
  | 'failed';

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

export function sanitizeUserFacingSyncMessage(message: string): string {
  if (!message.trim()) return message;

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
  projectName?: string;
  selectedAreaName?: string | null;
  updateData?: TUpdate;
  pendingPhotoAssetIds?: string[];
  archiveOnly?: boolean;
  archivedAt?: string;
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
      await setStoredJson(SYNC_CONFLICTS_STORAGE_KEY, reconciled);
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
  },
): Promise<SyncQueueItem<TPayload>> {
  const createdAt = item.createdAt ?? new Date().toISOString();
  const queueItem: SyncQueueItem<TPayload> = {
    id: item.id ?? createQueueId(item.entity, createdAt),
    entity: item.entity,
    operation: item.operation,
    payload: item.payload,
    createdAt,
    changedAt: item.changedAt,
    retryCount: item.retryCount ?? 0,
    lastError: null,
  };

  await mutateOfflineQueue(queue => {
    const existingDelete = queue.find(existing =>
      existing.id === queueItem.id && existing.operation === 'delete',
    );
    if (existingDelete && queueItem.operation !== 'delete') {
      return { nextQueue: queue, result: undefined, persist: false };
    }
    const existingItem = queue.find(existing => existing.id === queueItem.id);
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

  return {
    ...incoming,
    payload: {
      ...incomingPayload,
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
  };
}

export async function queueReferenceDocumentRecord(
  document: ReferenceDocument,
): Promise<void> {
  const changedAt = document.updatedAt || document.importedAt || new Date().toISOString();
  await enqueuePendingChange<ReferenceDocumentRecordPayload>({
    id: `reference-document-${encodeURIComponent(document.id)}`,
    entity: 'reference_document',
    operation: 'update',
    payload: { id: document.id, documentData: document },
    changedAt,
  });
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
  projectName?: string;
  selectedAreaName?: string | null;
}>(
  update: TUpdate,
  autoUpload: boolean,
  pendingPhotoAssetIds: readonly string[],
) {
  if (await hasProjectUpdateDeletionIntent(update.id)) return;
  const pendingPhotos = uniquePhotoAssetIds(pendingPhotoAssetIds);
  await enqueuePendingChange<ProjectUpdateRecordPayload<TUpdate>>({
    id: projectUpdateQueueItemId(update.id),
    entity: 'project_update',
    operation: 'update',
    payload: {
      id: update.id,
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

export async function removeProjectUpdateFromSyncQueue(updateId: string): Promise<number> {
  if (!updateId.trim()) return 0;

  return mutateOfflineQueue(queue => {
    const nextQueue = queue.filter(item => {
      if (item.entity !== 'project_update') return true;
      if (item.operation === 'delete') return true;

      const payload = item.payload as Partial<ProjectUpdateRecordPayload>;
      return payload.id !== updateId;
    });
    const removed = queue.length - nextQueue.length;
    return {
      nextQueue,
      result: removed,
      persist: removed > 0,
    };
  });
}

export async function stageProjectUpdateForSync(
  update: ProjectUpdate,
): Promise<StagedProjectUpdateSync> {
  const cloudRecoverableUpdate = projectUpdateWithCloudPhotoPaths(update);
  await queueProjectUpdateRecord(cloudRecoverableUpdate, false);
  const photoAttempt = await uploadUpdatePhotosForSync(cloudRecoverableUpdate);
  await persistProjectUpdateRecord(
    cloudRecoverableUpdate,
    false,
    photoAttempt.failedPhotoIds,
  );

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
  };
}

export async function runFieldUpdateCloudSync(
  update: ProjectUpdate,
): Promise<{
  syncResult: SyncUploadResult;
  workAttempt: FieldUpdateSyncWorkAttempt;
  missingPhotos: MissingSyncPhoto[];
}> {
  const staged = await stageProjectUpdateForSync(update);
  const workAttempt = staged.workAttempt;
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
  const itemOutcome = aggregateResult.itemOutcomes?.[queueItemId];
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
  const archiveRecovery = await stageMisclassifiedArchiveOnlyQuarantines();
  const queue = await getOfflineQueue();

  if (!configuration.configured) {
    return {
      configured: false,
      uploaded: 0,
      queued: queue.length,
      conflicts: (await getSyncConflicts()).length,
      errors: [configuration.message],
    };
  }

  const operationalQueueItems = queue.filter(item =>
    queueEntityUsesDAVESyncTombstones(item.entity),
  );
  let operationalTombstoneGate: DAVESyncTombstoneSyncResult | null = null;
  if (operationalQueueItems.length > 0) {
    try {
      operationalTombstoneGate = await synchronizeDAVESyncTombstones();
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

  const resolvedIds = new Set<string>();
  const retriedItemsById = new Map<string, SyncQueueItem>();
  const attemptedItemsById = new Map(queue.map(item => [item.id, item]));
  const itemOutcomes: Record<string, SyncItemOutcome> = {};
  const errors: string[] = [];
  let uploaded = 0;
  const uploadedByEntity: Record<SyncEntity, number> = {
    project: 0,
    project_update: 0,
    project_area: 0,
    schedule_item: 0,
    reference_document: 0,
  };

  for (const item of queue) {
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
      });
      errors.push(formatQueueItemFailure(item, sanitizedResult));
      continue;
    }

    const result = await uploadQueueItem(item);

    if (result === 'uploaded') {
      itemOutcomes[item.id] = 'uploaded';
      uploaded += 1;
      uploadedByEntity[item.entity] += 1;
      resolvedIds.add(item.id);
      continue;
    }

    if (result === 'conflict') {
      itemOutcomes[item.id] = 'conflict';
      resolvedIds.add(item.id);
      continue;
    }

    if (result === PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS) {
      itemOutcomes[item.id] = 'blocked';
      continue;
    }

    const sanitizedResult = sanitizeUserFacingSyncMessage(result);
    itemOutcomes[item.id] = 'failed';

    retriedItemsById.set(item.id, {
      ...item,
      retryCount: item.retryCount + 1,
      lastError: sanitizedResult,
    });
    errors.push(formatQueueItemFailure(item, sanitizedResult));
  }

  // Reconcile against the queue as it stands right now, not the snapshot
  // read at the top of this function - anything enqueued while the uploads
  // above were in flight needs to survive this write.
  const remaining = await mutateOfflineQueue(currentQueue => {
    const nextQueue = currentQueue.flatMap(item => {
      const attempted = attemptedItemsById.get(item.id);
      if (!attempted || !sameQueueRevision(item, attempted)) return [item];
      if (resolvedIds.has(item.id)) return [];
      return [retriedItemsById.get(item.id) ?? item];
    });
    return { nextQueue, result: nextQueue };
  });

  await resolveUploadedArchiveOnlyQuarantines(archiveRecovery, itemOutcomes);

  let storageCleanupRemaining = 0;
  let storageCleanupCompleted = 0;
  try {
    const storageCleanup = await processDAVEStorageCleanup();
    storageCleanupRemaining = storageCleanup.remaining;
    storageCleanupCompleted = storageCleanup.completed;
    errors.push(
      ...storageCleanup.errors.map(error => sanitizeUserFacingSyncMessage(error)),
    );
  } catch {
    storageCleanupRemaining = 1;
    errors.push('Protected file cleanup is temporarily unavailable.');
  }

  // Deletion markers remain permanent. Only metadata-only deletion receipts
  // whose one-year retention window has elapsed are purged, and the existing
  // RPC still enforces the signed-in owner's authorization boundary.
  try {
    await purgeExpiredDAVEDeletionAudit();
  } catch {
    // Retention maintenance must never make otherwise-safe project sync look
    // unsuccessful. The production health check reports overdue receipts.
  }

  if (uploaded > 0 || storageCleanupCompleted > 0) {
    await setStoredJson(SYNC_LAST_RUN_STORAGE_KEY, new Date().toISOString());
  }

  return {
    configured: true,
    uploaded,
    uploadedByEntity,
    itemOutcomes,
    queued: remaining.length + storageCleanupRemaining,
    conflicts: (await getSyncConflicts()).length,
    errors,
  };
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
  const payload = item.payload as { id?: unknown; name?: unknown };
  const recordId = String(
    item.entity === 'project' ? payload.name : payload.id,
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
        `Full cloud sync stopped because DAVE could not verify cross-device deletion history. No local records were uploaded.${
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
  const [cloudAreasBeforeUpload, cloudSchedulesBeforeUpload, cloudDocumentsBeforeUpload] = await Promise.all([
    listProjectAreas(),
    listScheduleItems(),
    listReferenceDocuments(),
  ]);
  const deletedAreaIds = deletedDAVERecordIds(tombstoneSync.tombstones, 'project_area');
  const deletedScheduleIds = deletedDAVERecordIds(tombstoneSync.tombstones, 'schedule_item');
  const deletedDocumentIds = deletedDAVERecordIds(tombstoneSync.tombstones, 'reference_document');

  if (
    cloudAreasBeforeUpload.ok &&
    !cloudAreasBeforeUpload.stubbed &&
    Array.isArray(cloudAreasBeforeUpload.data)
  ) {
    syncableProjectAreas = mergeDAVEProjectAreaRecoveryRecords({
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
    syncableScheduleItems = recoverDAVEScheduleRecords({
      local: syncableScheduleItems,
      cloud: cloudSchedulesBeforeUpload.data,
      deletedIds: deletedScheduleIds,
      allowCloudOnly: true,
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
    syncableReferenceDocuments = mergeDAVEReferenceDocumentRecoveryRecords({
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
  const existingProjectNames = new Set(
    cloudProjects.data?.map(project => project.name.toLowerCase()) ?? [],
  );

  for (const projectName of syncableProjects) {
    const normalizedName = projectName.trim();

    if (!normalizedName) {
      progress('Empty project skipped');
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
    } else {
      errors.push(`Project “${normalizedName}” could not sync.`);
    }

    progress(`Project synced: ${normalizedName}`);
  }

  for (const update of syncableUpdates) {
    const staged = await stageProjectUpdateForSync(update);
    details.photosUploaded += staged.uploadedPhotoCount;
    missingPhotos.push(...staged.missingPhotos);
    errors.push(...staged.workAttempt.errors.map(error =>
      `Field update for “${update.projectName || 'Unassigned Project'}”: ${error}`,
    ));
    progress(`Update staged: ${update.projectName}`);

    const missingPhotoIds = new Set(staged.missingPhotos.map(photo => photo.photoId));
    update.photos.forEach(photo => {
      progress(
        missingPhotoIds.has(photo.id)
          ? 'Photo skipped: unavailable'
          : 'Photo synced',
      );
    });
  }

  const stagedUpdateUpload = await uploadPendingChanges();
  details.updatesUploaded = stagedUpdateUpload.uploadedByEntity?.project_update || 0;
  errors.push(...stagedUpdateUpload.errors);

  for (const area of syncableProjectAreas) {
    const result = await upsertProjectArea(area);

    if (result.ok && !result.stubbed) {
      details.areasUploaded += 1;
    } else {
      errors.push(`GPS area “${area.name}” could not sync.`);
    }

    progress(`GPS area synced: ${area.name}`);
  }

  for (const item of syncableScheduleItems) {
    const result = await upsertScheduleItem(item);

    if (result.ok && !result.stubbed) {
      details.schedulesUploaded += 1;
    } else {
      errors.push(`Schedule task “${item.taskName}” could not sync.`);
    }

    progress(`Schedule synced: ${item.taskName}`);
  }

  for (const document of syncableReferenceDocuments) {
    const result = await upsertReferenceDocument(document);

    if (result.ok && !result.stubbed) {
      details.documentsUploaded += 1;
    } else {
      errors.push(`Document “${document.name}” could not sync.`);
    }

    progress(`Document synced: ${document.name}`);
  }

  progress('Downloading cloud changes');
  const download = await downloadCloudChanges<ProjectUpdate>(tombstoneSync);
  const recoveredUpdates = await Promise.all(
    download.updates.map(row => hydrateRecoveredProjectUpdatePhotos(row.updateData)),
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
    await setStoredJson(
      SYNC_CONFLICTS_STORAGE_KEY,
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
): Promise<TUpdate> {
  const conflicts = await getSyncConflicts();
  const conflict = conflicts.find(item => item.id === conflictId);

  if (!conflict || conflict.entity !== 'project_update') {
    throw new Error('sync_conflict_not_found');
  }

  const localPayload = conflict.localPayload as ProjectUpdateRecordPayload<TUpdate>;

  if (resolution === 'keep_cloud') {
    if (!isRecord(conflict.remotePayload)) {
      throw new Error('sync_conflict_cloud_copy_missing');
    }

    await clearResolvedConflict(conflict.id);
    return conflict.remotePayload as TUpdate;
  }

  const localUpdateData = localPayload.updateData;
  if (localUpdateData === undefined) {
    throw new Error('sync_conflict_local_copy_missing');
  }
  await enqueuePendingChange<ProjectUpdateRecordPayload<TUpdate>>({
    id: `project-update-${localPayload.id}`,
    entity: 'project_update',
    operation: 'update',
    payload: localPayload,
    changedAt: new Date().toISOString(),
    autoUpload: false,
  });
  const result = await uploadPendingChanges();

  if (result.queued > 0 || result.errors.length > 0) {
    throw new Error(result.errors[0] || 'sync_conflict_save_failed');
  }

  await clearResolvedConflict(conflict.id);
  return localUpdateData;
}

export async function resolveScheduleItemSyncConflict(
  conflictId: string,
  resolution: 'keep_local' | 'keep_cloud',
): Promise<ScheduleItem> {
  const conflicts = await getSyncConflicts();
  const conflict = conflicts.find(item => item.id === conflictId);

  if (!conflict || conflict.entity !== 'schedule_item') {
    throw new Error('sync_conflict_not_found');
  }

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
    if (!isRecord(conflict.remotePayload)) {
      throw new Error('sync_conflict_cloud_copy_missing');
    }

    const cloudItem = conflict.remotePayload as ScheduleItem;
    // Remove both the conflict-era edit and any newer queued local revision.
    // Waiting for the active uploader before restoring the selected cloud copy
    // prevents an older in-flight task snapshot from winning afterward.
    await removeOperationalRecordFromSyncQueue(
      'schedule_item',
      conflict.localId,
    );
    await uploadPendingChanges();
    await removeOperationalRecordFromSyncQueue(
      'schedule_item',
      conflict.localId,
    );
    const restore = await upsertScheduleItem(cloudItem);
    if (!restore.ok || restore.stubbed) {
      throw new Error(
        restore.error || restore.message || 'sync_conflict_save_failed',
      );
    }
    await clearResolvedConflict(conflict.id);
    return cloudItem;
  }

  if (!localItem || typeof localItem.id !== 'string') {
    throw new Error('sync_conflict_local_copy_missing');
  }

  const queueItemId = scheduleItemQueueItemId(localItem.id);
  await enqueuePendingChange<ScheduleItemRecordPayload>({
    id: queueItemId,
    entity: 'schedule_item',
    operation: 'update',
    payload: {
      id: localItem.id,
      itemData: localItem,
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
  return localItem;
}

async function uploadQueueItem(
  item: SyncQueueItem,
): Promise<'uploaded' | 'conflict' | string> {
  if (item.entity === 'project') {
    return uploadProjectQueueItem(item);
  }

  if (item.entity === 'project_update') {
    return uploadProjectUpdateQueueItem(item);
  }

  if (item.entity === 'project_area') {
    const payload = item.payload as ProjectAreaRecordPayload;
    const cloud = await listProjectAreas();
    if (!cloud.ok || cloud.stubbed || !Array.isArray(cloud.data)) {
      return cloud.error || cloud.message || 'GPS area authority could not be checked.';
    }
    const remote = cloud.data.find(area => area.id === payload.id);
    const authoritative = remote
      ? mergeDAVEProjectAreaRecoveryRecords({
          local: [payload.areaData],
          cloud: [remote],
        })[0]
      : payload.areaData;
    const result = await upsertProjectArea(authoritative);
    return result.ok && !result.stubbed
      ? 'uploaded'
      : result.error || result.message || 'GPS area sync is waiting for Supabase.';
  }

  if (item.entity === 'schedule_item') {
    const payload = item.payload as ScheduleItemRecordPayload;
    const cloud = await listScheduleItems();
    if (!cloud.ok || cloud.stubbed || !Array.isArray(cloud.data)) {
      return cloud.error || cloud.message || 'Task authority could not be checked.';
    }
    const remote = cloud.data.find(candidate => candidate.id === payload.id);
    const changedFields = Array.isArray(payload.changedFields)
      ? payload.changedFields
      : null;
    const authoritative = remote && changedFields
      ? {
          ...changedFields.reduce<ScheduleItem>(
            (merged, field) => ({
              ...merged,
              [field]: payload.itemData[field],
            }),
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
        : payload.itemData;
    if (remote && JSON.stringify(authoritative) === JSON.stringify(remote)) {
      if (
        changedFields ||
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
      await clearConflictsForLocalRecord('schedule_item', payload.id);
      return 'uploaded';
    }
    return result.error || result.message || 'Task sync is waiting for Supabase.';
  }

  if (item.entity === 'reference_document') {
    const payload = item.payload as ReferenceDocumentRecordPayload;
    const cloud = await listReferenceDocuments();
    if (!cloud.ok || cloud.stubbed || !Array.isArray(cloud.data)) {
      return cloud.error || cloud.message || 'Document authority could not be checked.';
    }
    const remote = cloud.data.find(candidate => candidate.id === payload.id);
    const authoritative = remote
      ? mergeDAVEReferenceDocumentRecoveryRecords({
          local: [payload.documentData],
          cloud: [remote],
        }).find(candidate => candidate.id === payload.id) || payload.documentData
      : payload.documentData;
    if (remote && JSON.stringify(authoritative) === JSON.stringify(remote)) {
      return 'uploaded';
    }
    const result = await upsertReferenceDocument(authoritative);
    return result.ok && !result.stubbed
      ? 'uploaded'
      : result.error || result.message || 'Document sync is waiting for Supabase.';
  }

  return `Unsupported sync entity: ${item.entity}`;
}

async function uploadProjectQueueItem(
  item: SyncQueueItem,
): Promise<'uploaded' | string> {
  const payload = item.payload as ProjectCreatePayload &
    ProjectUpdatePayload &
    ProjectDeletePayload;
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
  const result =
    item.operation === 'create'
      ? await createProject({ name: payload.name || 'Untitled Project' })
      : item.operation === 'delete'
        ? await deleteProject({ name: payload.name || payload.previousName || '' })
        : await updateProject(payload);

  if (result.ok && !result.stubbed) return 'uploaded';

  return result.error || result.message || 'Project sync is waiting for Supabase.';
}

async function uploadProjectUpdateQueueItem(
  item: SyncQueueItem,
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
    });
    return result.ok && !result.stubbed
      ? 'uploaded'
      : result.error || result.message || 'Field update archive is waiting for cloud sync.';
  }
  if (!payload.updateData) return 'Project update database payload is missing.';
  const pendingPhotoAssetIds = Array.isArray(payload.pendingPhotoAssetIds)
    ? payload.pendingPhotoAssetIds
    : projectUpdateReferencedPhotoIds(payload.updateData);
  if (uniquePhotoAssetIds(pendingPhotoAssetIds).length > 0) {
    return PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS;
  }
  const remoteMetadata = await getProjectUpdateSyncMetadata(payload.id);

  if (!remoteMetadata.ok && remoteMetadata.error) {
    return `Project update database select failed: ${remoteMetadata.error}`;
  }

  if (
    remoteMetadata.ok &&
    remoteMetadata.data?.updatedAt &&
    isRemoteNewer(remoteMetadata.data.updatedAt, item.changedAt)
  ) {
    if (projectUpdatePayloadsMatch(payload.updateData, remoteMetadata.data.updateData)) {
      await clearConflictsForLocalRecord('project_update', payload.id);
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

  const result = await saveProjectUpdate({
    id: payload.id,
    projectName: payload.projectName || 'Unassigned Project',
    areaName: payload.selectedAreaName || '',
    idempotencyKey: projectUpdateIdempotencyKey(payload.updateData, payload.id),
    updateData: payload.updateData,
    updatedAt: item.changedAt,
  });

  if (result.ok && !result.stubbed) return 'uploaded';

  return result.error
    ? `Project update database upsert failed: ${result.error}`
    : result.message || 'Project update sync is waiting for Supabase.';
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
    await setStoredJson(SYNC_CONFLICTS_STORAGE_KEY, [...nextConflicts, conflict]);
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
      await setStoredJson(SYNC_CONFLICTS_STORAGE_KEY, nextConflicts);
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
  return JSON.stringify(normalizeProjectUpdateForConflict(left)) ===
    JSON.stringify(normalizeProjectUpdateForConflict(right));
}

function normalizeProjectUpdateForConflict(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeProjectUpdateForConflict);
  }

  if (!isRecord(value)) return value;

  const ignoredKeys = new Set([
    'status',
    'syncDiagnostics',
    'sendAttempts',
    'lastSendAttemptAt',
    'stableSendId',
    'idempotencyKey',
  ]);
  const normalized: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    if (ignoredKeys.has(key)) continue;

    if (key === 'workflowTimestamps' && isRecord(value[key])) {
      const timestamps = { ...value[key] };
      delete timestamps.sendResolvedAt;
      normalized[key] = normalizeProjectUpdateForConflict(timestamps);
      continue;
    }

    normalized[key] = normalizeProjectUpdateForConflict(value[key]);
  }

  return normalized;
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

export async function hydrateRecoveredProjectUpdatePhotos<TUpdate extends ProjectUpdate>(
  update: TUpdate,
): Promise<TUpdate> {
  const photos = await Promise.all(update.photos.map(async photo => {
    if (await hasUsablePhotoUri(photo)) return photo;
    const cloudStoragePath =
      photo.cloudStoragePath || projectUpdatePhotoStoragePath(update, photo);
    const signed = await createPhotoSignedUrl(
      cloudStoragePath,
      600,
      PROJECT_PHOTOS_BUCKET,
    );
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

async function uploadUpdatePhotosForSync(
  update: ProjectUpdate,
): Promise<Omit<
  FieldUpdateSyncWorkAttempt,
  'cloudUpdateInsertAttempted' | 'databaseUpsertResult'
> & {
  uploadedPhotoCount: number;
  missingPhotos: MissingSyncPhoto[];
  failedPhotoIds: string[];
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
    };
  }

  const results = await Promise.all(
    update.photos.map(photo => uploadLocalPhotoWithDiagnostics(update, photo)),
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
