import { listArchivedProjects, listProjects, type JsonValue } from './SupabaseService';
import type {
  ProjectCoverPhoto,
  ProjectCoverPhotoMode,
  ProjectRecord,
} from './ProjectCoverPhotoService';
import { cloudProjectCoverData, projectRecordFromCloud } from './ProjectCoverPhotoService';
import {
  queueProjectCreate,
  queueProjectDelete,
  queueProjectUpdate,
  uploadPendingChanges,
} from './SyncService';

export async function loadCloudProjects() {
  return (await loadCloudProjectRecords()).map(project => project.name);
}

export async function loadCloudProjectRecords(): Promise<ProjectRecord[]> {
  void uploadPendingChanges();

  const result = await listProjects();

  if (!result.ok || !result.data) {
    return [];
  }

  return result.data
    .filter(item => typeof item.name === 'string' && item.name.trim())
    .map(projectRecordFromCloud);
}

export async function loadCloudArchivedProjectNames(): Promise<string[]> {
  const result = await listArchivedProjects();

  if (!result.ok || !result.data) return [];

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
  void queueProjectUpdate({
    previousName: projectName,
    data: cloudProjectCoverData(coverPhoto, coverPhotoMode, existingData, updatedAt),
    coverPhotoUpload: coverPhoto?.localUri && coverPhoto.remotePath
      ? {
          localUri: coverPhoto.localUri,
          remotePath: coverPhoto.remotePath,
          mimeType: coverPhoto.mimeType || 'image/jpeg',
        }
      : undefined,
  });
}

export function saveCloudProject(projectName: string) {
  void queueProjectCreate(projectName);
}

export function renameCloudProject(previousName: string, name: string) {
  void queueProjectUpdate({ previousName, name });
}

export function setCloudProjectArchived(projectName: string, archived: boolean) {
  void queueProjectUpdate({ previousName: projectName, archived });
}

export async function deleteCloudProject(projectName: string): Promise<void> {
  await queueProjectDelete(projectName);
}
