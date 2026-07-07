import {
  countCloudProjects,
  createProject,
  deleteProject,
  getProjectUpdateSyncMetadata,
  getSupabaseConfigurationStatus,
  listProjectUpdates,
  listProjects,
  saveProjectUpdate,
  testSupabaseConnection,
  updateProject,
  uploadPhoto,
  upsertProjectArea,
  upsertReferenceDocument,
  upsertScheduleItem,
  type CloudProject,
  type CloudProjectUpdate,
  type SupabaseConfigurationStatus,
} from './SupabaseService';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStoredJson, setStoredJson } from './StorageService';
import type {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';

export type SyncEntity = 'project' | 'project_update';
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
  lastSyncAt: string | null;
  message: string;
};

export type SyncUploadResult = {
  configured: boolean;
  uploaded: number;
  queued: number;
  conflicts: number;
  errors: string[];
};

export type CloudDownloadResult<TUpdate> = {
  configured: boolean;
  projects: CloudProject[];
  projectNames: string[];
  updates: CloudProjectUpdate<TUpdate>[];
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
  };
};

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
};

export type LocalPhotoUploadResult = {
  result: 'uploaded' | 'missing' | 'failed' | 'skipped';
  message: string | null;
  diagnostic: PhotoStorageUploadDiagnostic;
};

const PROJECT_PHOTOS_BUCKET = 'project-photos';

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

  return message;
}

export async function cleanupStoredSyncStatusMessages(): Promise<SyncStorageCleanupResult> {
  const keys = await AsyncStorage.getAllKeys();
  const syncKeys = keys.filter(isSyncStorageKey);
  let cleaned = false;
  let missingPhotosRemoved = 0;

  for (const key of syncKeys) {
    const value = await AsyncStorage.getItem(key);

    if (value === null) continue;

    if (key === SYNC_QUEUE_STORAGE_KEY) {
      const result = await cleanupSyncQueueValue(value);

      if (result.value !== value) {
        await AsyncStorage.setItem(key, result.value);
        cleaned = true;
      }

      missingPhotosRemoved += result.missingPhotosRemoved;
      continue;
    }

    const nextValue = sanitizeStoredSyncValue(value);

    if (nextValue !== value) {
      await AsyncStorage.setItem(key, nextValue);
      cleaned = true;
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
};

type ProjectDeletePayload = {
  name: string;
};

type ProjectUpdateRecordPayload<TUpdate = unknown> = {
  id: string;
  projectName?: string;
  selectedAreaName?: string | null;
  updateData: TUpdate;
};

const SYNC_QUEUE_STORAGE_KEY = 'projectVisionAI.syncQueue.v1';
const SYNC_CONFLICTS_STORAGE_KEY = 'projectVisionAI.syncConflicts.v1';
const SYNC_LAST_RUN_STORAGE_KEY = 'projectVisionAI.lastSyncAt.v1';

export async function getOfflineQueue(): Promise<SyncQueueItem[]> {
  return getStoredJson<SyncQueueItem[]>(SYNC_QUEUE_STORAGE_KEY, []);
}

export async function getSyncConflicts(): Promise<SyncConflict[]> {
  return getStoredJson<SyncConflict[]>(SYNC_CONFLICTS_STORAGE_KEY, []);
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const [queue, conflicts, lastSyncAt] = await Promise.all([
    getOfflineQueue(),
    getSyncConflicts(),
    getStoredJson<string | null>(SYNC_LAST_RUN_STORAGE_KEY, null),
  ]);
  const configuration = getSupabaseConfigurationStatus();

  return {
    configured: configuration.configured,
    queuedChanges: queue.length,
    conflicts: conflicts.length,
    lastSyncAt,
    message: buildSyncStatusMessage(configuration, queue.length, conflicts.length),
  };
}

export async function enqueuePendingChange<TPayload>(
  item: Omit<SyncQueueItem<TPayload>, 'id' | 'createdAt' | 'retryCount'> & {
    id?: string;
    createdAt?: string;
    retryCount?: number;
  },
): Promise<SyncQueueItem<TPayload>> {
  const queue = await getOfflineQueue();
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

  await setStoredJson(SYNC_QUEUE_STORAGE_KEY, [
    ...queue.filter(item => item.id !== queueItem.id),
    queueItem,
  ]);
  void uploadPendingChanges();

  return queueItem;
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
  await enqueuePendingChange<ProjectUpdatePayload>({
    entity: 'project',
    operation: 'update',
    payload,
    changedAt: new Date().toISOString(),
  });
}

export async function queueProjectDelete(name: string): Promise<void> {
  await enqueuePendingChange<ProjectDeletePayload>({
    entity: 'project',
    operation: 'delete',
    payload: { name },
    changedAt: new Date().toISOString(),
  });
}

export async function queueProjectUpdateRecord<TUpdate extends {
  id: string;
  projectName?: string;
  selectedAreaName?: string | null;
}>(update: TUpdate): Promise<void> {
  await enqueuePendingChange<ProjectUpdateRecordPayload<TUpdate>>({
    id: `project-update-${update.id}`,
    entity: 'project_update',
    operation: 'update',
    payload: {
      id: update.id,
      projectName: update.projectName,
      selectedAreaName: update.selectedAreaName,
      updateData: update,
    },
    changedAt: new Date().toISOString(),
  });
}

let uploadPendingChangesInFlight: Promise<SyncUploadResult> | null = null;
let anotherUploadPassRequested = false;

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
      void uploadPendingChanges();
    }
  }
}

async function runUploadPendingChanges(): Promise<SyncUploadResult> {
  const configuration = getSupabaseConfigurationStatus();
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

  const resolvedIds = new Set<string>();
  const retriedItemsById = new Map<string, SyncQueueItem>();
  const errors: string[] = [];
  let uploaded = 0;

  for (const item of queue) {
    const result = await uploadQueueItem(item);

    if (result === 'uploaded') {
      uploaded += 1;
      resolvedIds.add(item.id);
      continue;
    }

    if (result === 'conflict') {
      resolvedIds.add(item.id);
      continue;
    }

    const sanitizedResult = sanitizeUserFacingSyncMessage(result);

    retriedItemsById.set(item.id, {
      ...item,
      retryCount: item.retryCount + 1,
      lastError: sanitizedResult,
    });
    errors.push(sanitizedResult);
  }

  // Reconcile against the queue as it stands right now, not the snapshot
  // read at the top of this function - anything enqueued while the uploads
  // above were in flight needs to survive this write.
  const currentQueue = await getOfflineQueue();
  const remaining = currentQueue
    .filter(item => !resolvedIds.has(item.id))
    .map(item => retriedItemsById.get(item.id) ?? item);

  await setStoredJson(SYNC_QUEUE_STORAGE_KEY, remaining);

  if (uploaded > 0) {
    await setStoredJson(SYNC_LAST_RUN_STORAGE_KEY, new Date().toISOString());
  }

  return {
    configured: true,
    uploaded,
    queued: remaining.length,
    conflicts: (await getSyncConflicts()).length,
    errors,
  };
}

export async function downloadCloudChanges<TUpdate>(): Promise<
  CloudDownloadResult<TUpdate>
> {
  const [projectsResult, updatesResult] = await Promise.all([
    listProjects(),
    listProjectUpdates<TUpdate>(),
  ]);

  const projects = projectsResult.ok && projectsResult.data ? projectsResult.data : [];
  const updates = updatesResult.ok && updatesResult.data ? updatesResult.data : [];

  return {
    configured: projectsResult.configured || updatesResult.configured,
    projects,
    projectNames: projects
      .map(project => project.name)
      .filter(name => typeof name === 'string' && name.trim()),
    updates,
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
  };
  const total =
    3 +
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
      uploaded: 0,
      downloaded: 0,
      queued: (await getOfflineQueue()).length,
      conflicts: (await getSyncConflicts()).length,
      cloudProjectCount: null,
      lastSyncAt: null,
      errors: [configuration.message],
      missingPhotos,
      details,
    };
  }

  progress('Testing Supabase connection');
  const connection = await testSupabaseConnection();

  if (!connection.connected) {
    return {
      configured: true,
      connected: false,
      uploaded: 0,
      downloaded: 0,
      queued: (await getOfflineQueue()).length,
      conflicts: (await getSyncConflicts()).length,
      cloudProjectCount: connection.projectCount,
      lastSyncAt: null,
      errors: [connection.error || 'Supabase connection failed.'],
      missingPhotos,
      details,
    };
  }

  progress('Uploading queued changes');
  const queuedUpload = await uploadPendingChanges();
  details.queuedUploads = queuedUpload.uploaded;
  errors.push(...queuedUpload.errors);

  const cloudProjects = await listProjects();
  const existingProjectNames = new Set(
    cloudProjects.data?.map(project => project.name.toLowerCase()) ?? [],
  );

  for (const projectName of payload.projects) {
    const normalizedName = projectName.trim();

    if (!normalizedName || existingProjectNames.has(normalizedName.toLowerCase())) {
      continue;
    }

    const result = await createProject({ name: normalizedName });

    if (result.ok && !result.stubbed) {
      details.projectsUploaded += 1;
      existingProjectNames.add(normalizedName.toLowerCase());
    } else {
      errors.push(
        result.error || result.message || `Project sync failed: ${normalizedName}`,
      );
    }

    progress(`Project synced: ${normalizedName}`);
  }

  for (const update of payload.savedUpdates) {
    const result = await saveProjectUpdate({
      id: update.id,
      projectName: update.projectName,
      areaName: update.selectedAreaName || '',
      updateData: update,
      updatedAt: update.date || new Date().toISOString(),
    });

    if (result.ok && !result.stubbed) {
      details.updatesUploaded += 1;
    } else {
      errors.push(
        result.error || result.message || `Update sync failed: ${update.id}`,
      );
    }

    progress(`Update synced: ${update.projectName}`);
  }

  for (const update of payload.savedUpdates) {
    for (const photo of update.photos) {
      const result = await uploadLocalPhoto(update, photo);

      if (result === 'uploaded') {
        details.photosUploaded += 1;
      } else if (result === 'missing') {
        missingPhotos.push({
          updateId: update.id,
          photoId: photo.id,
        });
      } else if (result) {
        errors.push(sanitizeSyncError(result));
      }

      progress(result === 'missing' ? 'Photo skipped: unavailable' : 'Photo synced');
    }
  }

  for (const area of payload.projectAreas) {
    const result = await upsertProjectArea(area);

    if (result.ok && !result.stubbed) {
      details.areasUploaded += 1;
    } else {
      errors.push(
        result.error || result.message || `Area sync failed: ${area.name}`,
      );
    }

    progress(`GPS area synced: ${area.name}`);
  }

  for (const item of payload.scheduleItems) {
    const result = await upsertScheduleItem(item);

    if (result.ok && !result.stubbed) {
      details.schedulesUploaded += 1;
    } else {
      errors.push(
        result.error || result.message || `Schedule sync failed: ${item.taskName}`,
      );
    }

    progress(`Schedule synced: ${item.taskName}`);
  }

  for (const document of payload.referenceDocuments) {
    const result = await upsertReferenceDocument(document);

    if (result.ok && !result.stubbed) {
      details.documentsUploaded += 1;
    } else {
      errors.push(
        result.error || result.message || `Document sync failed: ${document.name}`,
      );
    }

    progress(`Document synced: ${document.name}`);
  }

  progress('Downloading cloud changes');
  const download = await downloadCloudChanges<ProjectUpdate>();
  details.cloudProjectsDownloaded = download.projects.length;
  details.cloudUpdatesDownloaded = download.updates.length;

  const cloudCount = await countCloudProjects();
  const lastSyncAt = new Date().toISOString();
  await setStoredJson(SYNC_LAST_RUN_STORAGE_KEY, lastSyncAt);
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
    details.cloudProjectsDownloaded + details.cloudUpdatesDownloaded;

  return {
    configured: true,
    connected: true,
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
  };
}

export async function removeMissingPhotosFromSyncQueue(
  missingPhotos: MissingSyncPhoto[],
): Promise<void> {
  if (missingPhotos.length === 0) return;

  const missingPhotoIds = new Set(
    missingPhotos.map(photo => photo.photoId),
  );
  const queue = await getOfflineQueue();
  const nextQueue = queue
    .filter(item => {
      const entity = (item as SyncQueueItem & { entity: string }).entity;

      return String(entity) !== 'photo' || !missingPhotoIds.has(item.id);
    })
    .map(item => {
      if (item.entity !== 'project_update') return item;

      const payload = item.payload as ProjectUpdateRecordPayload<ProjectUpdate>;
      const updateData = payload.updateData;

      if (!Array.isArray(updateData?.photos)) return item;

      const nextPhotos = updateData.photos.filter(
        photo => !missingPhotoIds.has(photo.id),
      );

      return {
        ...item,
        payload: {
          ...payload,
          updateData: {
            ...updateData,
            photos: nextPhotos,
          },
        },
        lastError: null,
      };
    });

  await setStoredJson(SYNC_QUEUE_STORAGE_KEY, nextQueue);
}

async function cleanupSyncQueueValue(value: string) {
  try {
    const queue = JSON.parse(value) as SyncQueueItem[];

    if (!Array.isArray(queue)) {
      return {
        value: sanitizeStoredSyncValue(value),
        missingPhotosRemoved: 0,
      };
    }

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
          const nextPhotos: UpdatePhoto[] = [];

          for (const photo of updateData.photos) {
            const available = photo.uri
              ? await isPhotoFileAvailable(photo.uri)
              : false;

            if (!available) {
              missingPhotosRemoved += 1;
              continue;
            }

            nextPhotos.push(photo);
          }

          nextItem = {
            ...nextItem,
            payload: {
              ...payload,
              updateData: {
                ...updateData,
                photos: nextPhotos,
              },
            },
            lastError:
              nextPhotos.length === updateData.photos.length
                ? nextItem.lastError
                : null,
          };
        }
      }

      nextQueue.push(nextItem);
    }

    return {
      value: JSON.stringify(nextQueue),
      missingPhotosRemoved,
    };
  } catch {
    return {
      value: sanitizeStoredSyncValue(value),
      missingPhotosRemoved: 0,
    };
  }
}

export async function clearResolvedConflict(conflictId: string): Promise<void> {
  const conflicts = await getSyncConflicts();

  await setStoredJson(
    SYNC_CONFLICTS_STORAGE_KEY,
    conflicts.filter(conflict => conflict.id !== conflictId),
  );
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

  return `Unsupported sync entity: ${item.entity}`;
}

async function uploadProjectQueueItem(
  item: SyncQueueItem,
): Promise<'uploaded' | string> {
  const payload = item.payload as ProjectCreatePayload &
    ProjectUpdatePayload &
    ProjectDeletePayload;
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
  const payload = item.payload as ProjectUpdateRecordPayload;
  const remoteMetadata = await getProjectUpdateSyncMetadata(payload.id);

  if (
    remoteMetadata.ok &&
    remoteMetadata.data?.updatedAt &&
    isRemoteNewer(remoteMetadata.data.updatedAt, item.changedAt)
  ) {
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

  return result.error || result.message || 'Project update sync is waiting for Supabase.';
}

async function recordConflict(conflict: SyncConflict): Promise<void> {
  const conflicts = await getSyncConflicts();
  const existingConflict = conflicts.some(item => item.id === conflict.id);

  if (existingConflict) return;

  await setStoredJson(SYNC_CONFLICTS_STORAGE_KEY, [...conflicts, conflict]);
}

function buildSyncStatusMessage(
  configuration: SupabaseConfigurationStatus,
  queuedChanges: number,
  conflicts: number,
): string {
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

function createQueueId(entity: string, createdAt: string): string {
  return `${entity}-${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
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

export async function uploadLocalPhotoWithDiagnostics(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): Promise<LocalPhotoUploadResult> {
  const diagnosticBase: PhotoStorageUploadDiagnostic = {
    bucketName: PROJECT_PHOTOS_BUCKET,
    bucketExists: 'unknown',
    uploadAttempted: false,
    uploadResult: 'skipped',
    failureCategory: null,
    httpStatus: null,
    errorCode: null,
  };

  if (!photo.uri) {
    return {
      result: 'skipped',
      message: null,
      diagnostic: diagnosticBase,
    };
  }

  const available = await isPhotoFileAvailable(photo.uri);

  if (!available) {
    return {
      result: 'missing',
      message: 'Photo storage upload failed: photo file unreadable.',
      diagnostic: {
        ...diagnosticBase,
        uploadResult: 'failed',
        failureCategory: 'file_unreadable',
      },
    };
  }

  try {
    const path = photoUploadPath(update, photo);
    const contentType = photo.mimeType || 'image/jpeg';
    const invalidPath = validatePhotoStoragePath(path);
    const unsupportedContentType = validatePhotoContentType(contentType);

    if (invalidPath) {
      return {
        result: 'failed',
        message: invalidPath,
        diagnostic: {
          ...diagnosticBase,
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
          uploadAttempted: false,
          uploadResult: 'failed',
          failureCategory: 'unsupported_content_type',
        },
      };
    }

    const result = await uploadPhoto({
      bucket: PROJECT_PHOTOS_BUCKET,
      path,
      uri: photo.uri,
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
        uploadAttempted: true,
        uploadResult: 'failed',
        failureCategory: classifyPhotoStorageUploadFailure(message, null, null),
      },
    };
  }
}

async function isPhotoFileAvailable(uri: string): Promise<boolean> {
  if (!uri.trim()) return false;
  if (/^https?:\/\//i.test(uri)) return true;

  try {
    const info = await FileSystem.getInfoAsync(uri);

    return info.exists;
  } catch {
    return false;
  }
}

function sanitizeSyncError(value: string) {
  if (
    /readAsStringAsync|file:|\/var\/|\/data\/|stack|internal|exception|documentDirectory|cacheDirectory/i.test(value)
  ) {
    return sanitizeUserFacingSyncMessage(value);
  }

  return sanitizeUserFacingSyncMessage(value);
}

function isSyncStorageKey(key: string) {
  return /sync|admin|status|diagnostic|cloud|queue|lastSync/i.test(key);
}

function sanitizeStoredSyncValue(value: string) {
  const sanitizedDirect = sanitizeUserFacingSyncMessage(value);

  try {
    const parsed = JSON.parse(value);
    const sanitizedParsed = sanitizeStoredSyncJson(parsed);
    const nextValue = JSON.stringify(sanitizedParsed);

    return nextValue === value ? sanitizedDirect : nextValue;
  } catch {
    return sanitizedDirect;
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

function photoUploadPath(update: ProjectUpdate, photo: UpdatePhoto) {
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
