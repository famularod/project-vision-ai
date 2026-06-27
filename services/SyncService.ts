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

  await setStoredJson(SYNC_QUEUE_STORAGE_KEY, [...queue, queueItem]);
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

export async function uploadPendingChanges(): Promise<SyncUploadResult> {
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

  const remaining: SyncQueueItem[] = [];
  const errors: string[] = [];
  let uploaded = 0;

  for (const item of queue) {
    const result = await uploadQueueItem(item);

    if (result === 'uploaded') {
      uploaded += 1;
      continue;
    }

    if (result === 'conflict') {
      continue;
    }

    remaining.push({
      ...item,
      retryCount: item.retryCount + 1,
      lastError: result,
    });
    errors.push(result);
  }

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
      } else if (result) {
        errors.push(result);
      }

      progress(`Photo synced: ${photo.caption || photo.id}`);
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
    details,
  };
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

async function uploadLocalPhoto(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): Promise<'uploaded' | string | null> {
  if (!photo.uri) return null;

  const result = await uploadPhoto({
    path: photoUploadPath(update, photo),
    uri: photo.uri,
    contentType: photo.mimeType || 'image/jpeg',
    upsert: true,
  });

  if (result.ok && !result.stubbed) return 'uploaded';

  return result.error || result.message || `Photo sync failed: ${photo.id}`;
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

function sanitizePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}
