import { listArchivedProjects, listProjects, type JsonValue } from './SupabaseService';
import type {
  ProjectCoverPhoto,
  ProjectCoverPhotoMode,
  ProjectRecord,
} from './ProjectCoverPhotoService';
import { cloudProjectCoverData, projectRecordFromCloud } from './ProjectCoverPhotoService';
import { startGuardedBackgroundTask } from './BackgroundTaskGuard';
import {
  queueProjectCreate,
  queueProjectDelete,
  queueProjectUpdate,
  requestPendingChangesUpload,
} from './SyncService';

export async function loadCloudProjects() {
  return (await loadCloudProjectRecords()).map(project => project.name);
}

export async function loadCloudProjectRecords(): Promise<ProjectRecord[]> {
  requestPendingChangesUpload('cloud_project_loader');

  const result = await listProjects();

  if (!result.ok || result.stubbed || !result.data) {
    throw new Error(result.error || result.message || 'Cloud projects could not be read.');
  }

  return result.data
    .filter(item => typeof item.name === 'string' && item.name.trim())
    .map(projectRecordFromCloud);
}

export async function loadCloudArchivedProjectNames(): Promise<string[]> {
  const result = await listArchivedProjects();

  if (!result.ok || result.stubbed || !result.data) {
    throw new Error(result.error || result.message || 'Archived cloud projects could not be read.');
  }

  return result.data
    .map(project => project.name.trim())
    .filter(Boolean);
}

export function saveCloudProjectCoverPhoto(
  projectName: string,
  coverPhoto: ProjectCoverPhoto | null,
  coverPhotoMode: ProjectCoverPhotoMode,
  existingData?: JsonValue | null,
  updatedAt?: string,
) {
  startProjectQueueTask(projectName, 'cover_photo', () =>
    queueProjectUpdate({
      previousName: projectName,
      data: cloudProjectCoverData(coverPhoto, coverPhotoMode, existingData, updatedAt),
      coverPhotoUpload: coverPhoto?.localUri && coverPhoto.remotePath
        ? {
            localUri: coverPhoto.localUri,
            remotePath: coverPhoto.remotePath,
            mimeType: coverPhoto.mimeType || 'image/jpeg',
          }
        : undefined,
    }),
  );
}

export function saveCloudProject(projectName: string) {
  startProjectQueueTask(projectName, 'create', () => queueProjectCreate(projectName));
}

export function renameCloudProject(previousName: string, name: string) {
  startProjectQueueTask(previousName, 'rename', () =>
    queueProjectUpdate({ previousName, name }),
  );
}

export function setCloudProjectArchived(projectName: string, archived: boolean) {
  startProjectQueueTask(projectName, 'archive', () =>
    queueProjectUpdate({ previousName: projectName, archived }),
  );
}

export async function queueCloudProjectArchives(projectNames: readonly string[]) {
  for (const projectName of projectNames) {
    await queueProjectUpdate({ previousName: projectName, archived: true });
  }
}

export async function deleteCloudProject(projectName: string): Promise<void> {
  await queueProjectDelete(projectName);
}

function startProjectQueueTask(
  projectName: string,
  action: string,
  task: () => Promise<void>,
) {
  startGuardedBackgroundTask({
    key: `cloud-project-queue:${action}:${projectName.trim().toLowerCase()}`,
    label: 'Project cloud queue',
    trigger: action,
    maxConsecutiveRuns: 2,
    task,
  });
}
