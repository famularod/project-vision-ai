import { optionalString } from './RecordValues';
import type { PhotoStorageUploadFailureCategory } from './SyncService';

// Moved out of App.tsx unchanged (30 Sep 2026) to keep the app shell within its line budget.

export type FieldUpdateSyncFailureCategory =
  | 'offline'
  | 'signed_out'
  | 'auth'
  | 'rls_denied'
  | 'storage_upload_failed'
  | 'database_insert_failed'
  | 'malformed_payload'
  | 'unknown';
export type FieldUpdateSyncStepResult = 'success' | 'failed' | 'skipped';
export type FieldUpdateSyncDiagnostics = {
  networkState: 'online' | 'offline' | 'unknown';
  connectionType: 'wifi' | 'cellular' | 'none' | 'unknown';
  sessionTokenPresent: boolean | null;
  lastSyncAttemptAt: string | null;
  lastSyncResult: 'success' | 'failed' | 'skipped' | null;
  lastSyncFailureCategory: FieldUpdateSyncFailureCategory | null;
  cloudUpdateInsertAttempted: boolean;
  photoStorageUploadAttempted: boolean;
  storageUploadResult: FieldUpdateSyncStepResult;
  databaseUpsertResult: FieldUpdateSyncStepResult;
  rlsOrAuthFailureDetected: boolean;
  retryAvailable: boolean;
  storageBucketName: string | null;
  storageBucketExists: 'yes' | 'no' | 'unknown';
  storageFailureCategory: PhotoStorageUploadFailureCategory | null;
  storageHttpStatus: number | null;
  storageErrorCode: string | null;
  retryAttemptNumber: number | null;
  localFileExists: boolean | null;
  localFileReadable: boolean | null;
  fileByteSizeCategory: 'zero' | 'nonzero' | 'unknown';
  uploadPayloadType: 'ArrayBuffer' | 'Blob' | 'base64' | 'unknown';
  storageContentType: string | null;
  objectPathCategory: string | null;
  databaseSyncRanAfterUpload: boolean | null;
  failedOperationName: string | null;
  failedLogicalTarget: string | null;
  rlsDenied: boolean;
  authenticatedUserIdPresent: boolean | null;
  projectIdPresent: boolean | null;
  organizationIdPresent: boolean | null;
  membershipCheckResult:
    | 'present'
    | 'missing_or_denied'
    | 'not_checked'
    | 'unavailable'
    | null;
  queuedUpdateCount: number;
  projectRollupsIncludeQueuedUpdates: boolean;
  projectCardWorkspaceSameSource: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

export function normalizeFieldUpdateSyncDiagnostics(value: unknown): FieldUpdateSyncDiagnostics | null {
  if (!isRecord(value)) return null;
  const failureCategory =
    value.lastSyncFailureCategory === 'offline' ||
    value.lastSyncFailureCategory === 'signed_out' ||
    value.lastSyncFailureCategory === 'auth' ||
    value.lastSyncFailureCategory === 'rls_denied' ||
    value.lastSyncFailureCategory === 'storage_upload_failed' ||
    value.lastSyncFailureCategory === 'database_insert_failed' ||
    value.lastSyncFailureCategory === 'malformed_payload' ||
    value.lastSyncFailureCategory === 'unknown'
      ? value.lastSyncFailureCategory
      : null;

  return {
    networkState:
      value.networkState === 'online' ||
      value.networkState === 'offline' ||
      value.networkState === 'unknown'
        ? value.networkState
        : 'unknown',
    connectionType:
      value.connectionType === 'wifi' ||
      value.connectionType === 'cellular' ||
      value.connectionType === 'none' ||
      value.connectionType === 'unknown'
        ? value.connectionType
        : 'unknown',
    sessionTokenPresent:
      typeof value.sessionTokenPresent === 'boolean'
        ? value.sessionTokenPresent
        : null,
    lastSyncAttemptAt: optionalString(value.lastSyncAttemptAt),
    lastSyncResult:
      value.lastSyncResult === 'success' ||
      value.lastSyncResult === 'failed' ||
      value.lastSyncResult === 'skipped'
        ? value.lastSyncResult
        : null,
    lastSyncFailureCategory: failureCategory,
    cloudUpdateInsertAttempted: value.cloudUpdateInsertAttempted === true,
    photoStorageUploadAttempted: value.photoStorageUploadAttempted === true,
    storageUploadResult:
      value.storageUploadResult === 'success' ||
      value.storageUploadResult === 'failed' ||
      value.storageUploadResult === 'skipped'
        ? value.storageUploadResult
        : 'skipped',
    databaseUpsertResult:
      value.databaseUpsertResult === 'success' ||
      value.databaseUpsertResult === 'failed' ||
      value.databaseUpsertResult === 'skipped'
        ? value.databaseUpsertResult
        : 'skipped',
    rlsOrAuthFailureDetected: value.rlsOrAuthFailureDetected === true,
    retryAvailable: value.retryAvailable !== false,
    storageBucketName: optionalString(value.storageBucketName),
    storageBucketExists:
      value.storageBucketExists === 'yes' ||
      value.storageBucketExists === 'no' ||
      value.storageBucketExists === 'unknown'
        ? value.storageBucketExists
        : 'unknown',
    storageFailureCategory:
      value.storageFailureCategory === 'bucket_missing' ||
      value.storageFailureCategory === 'rls_denied' ||
      value.storageFailureCategory === 'auth_missing' ||
      value.storageFailureCategory === 'invalid_path' ||
      value.storageFailureCategory === 'invalid_payload' ||
      value.storageFailureCategory === 'unsupported_content_type' ||
      value.storageFailureCategory === 'file_unreadable' ||
      value.storageFailureCategory === 'stale_local_uri' ||
      value.storageFailureCategory === 'network' ||
      value.storageFailureCategory === 'unknown_storage_error'
        ? value.storageFailureCategory
        : null,
    storageHttpStatus:
      typeof value.storageHttpStatus === 'number' &&
      Number.isFinite(value.storageHttpStatus)
        ? value.storageHttpStatus
        : null,
    storageErrorCode: optionalString(value.storageErrorCode),
    retryAttemptNumber:
      typeof value.retryAttemptNumber === 'number' &&
      Number.isFinite(value.retryAttemptNumber)
        ? value.retryAttemptNumber
        : null,
    localFileExists:
      typeof value.localFileExists === 'boolean'
        ? value.localFileExists
        : null,
    localFileReadable:
      typeof value.localFileReadable === 'boolean'
        ? value.localFileReadable
        : null,
    fileByteSizeCategory:
      value.fileByteSizeCategory === 'zero' ||
      value.fileByteSizeCategory === 'nonzero' ||
      value.fileByteSizeCategory === 'unknown'
        ? value.fileByteSizeCategory
        : 'unknown',
    uploadPayloadType:
      value.uploadPayloadType === 'ArrayBuffer' ||
      value.uploadPayloadType === 'Blob' ||
      value.uploadPayloadType === 'base64' ||
      value.uploadPayloadType === 'unknown'
        ? value.uploadPayloadType
        : 'unknown',
    storageContentType: optionalString(value.storageContentType),
    objectPathCategory: optionalString(value.objectPathCategory),
    databaseSyncRanAfterUpload:
      typeof value.databaseSyncRanAfterUpload === 'boolean'
        ? value.databaseSyncRanAfterUpload
        : null,
    failedOperationName: optionalString(value.failedOperationName),
    failedLogicalTarget: optionalString(value.failedLogicalTarget),
    rlsDenied: value.rlsDenied === true,
    authenticatedUserIdPresent:
      typeof value.authenticatedUserIdPresent === 'boolean'
        ? value.authenticatedUserIdPresent
        : null,
    projectIdPresent:
      typeof value.projectIdPresent === 'boolean'
        ? value.projectIdPresent
        : null,
    organizationIdPresent:
      typeof value.organizationIdPresent === 'boolean'
        ? value.organizationIdPresent
        : null,
    membershipCheckResult:
      value.membershipCheckResult === 'present' ||
      value.membershipCheckResult === 'missing_or_denied' ||
      value.membershipCheckResult === 'not_checked' ||
      value.membershipCheckResult === 'unavailable'
        ? value.membershipCheckResult
        : null,
    queuedUpdateCount:
      typeof value.queuedUpdateCount === 'number' &&
      Number.isFinite(value.queuedUpdateCount)
        ? value.queuedUpdateCount
        : 0,
    projectRollupsIncludeQueuedUpdates: value.projectRollupsIncludeQueuedUpdates !== false,
    projectCardWorkspaceSameSource: value.projectCardWorkspaceSameSource !== false,
  };
}
