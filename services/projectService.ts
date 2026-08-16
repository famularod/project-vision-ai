import { listArchivedProjects, listProjects, type JsonValue } from './SupabaseService';
import type {
  ProjectCoverPhoto,
  ProjectCoverPhotoMode,
  ProjectRecord,
} from './ProjectCoverPhotoService';
import { cloudProjectCoverData, projectRecordFromCloud } from './ProjectCoverPhotoService';
import {
  canonicalProjectCoverId,
  projectCoverAuthorityFromData,
  projectCoverAuthorityFromRecord,
  projectCoverStoragePathKind,
  validProjectCoverCommitMutation,
  type ProjectCoverCommitMutation,
} from './ProjectCoverCommitAuthority';
import { startGuardedBackgroundTask } from './BackgroundTaskGuard';
import { isCanonicalProjectId } from './ProjectTombstoneAuthority';
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
  projectId: string,
  projectName: string,
  coverPhoto: ProjectCoverPhoto | null,
  coverPhotoMode: ProjectCoverPhotoMode,
  expectedRecord: ProjectRecord,
  updatedAt?: string,
) {
  const exactProjectId = canonicalProjectCoverId(projectId) &&
    projectId === projectId.trim() &&
    projectId === projectId.toLowerCase()
    ? projectId
    : '';
  const projectData = cloudProjectCoverData(
    coverPhoto,
    coverPhotoMode,
    expectedRecord.data,
    updatedAt,
  );
  const mutation: ProjectCoverCommitMutation = {
    expected: projectCoverAuthorityFromRecord(expectedRecord),
    target: {
      ...projectCoverAuthorityFromData(projectData),
      updatedAt: projectCoverAuthorityFromData(projectData).updatedAt || '',
    },
  };
  if (
    !exactProjectId ||
    expectedRecord.id !== exactProjectId ||
    expectedRecord.name.trim() !== projectName.trim() ||
    !validProjectCoverCommitMutation(exactProjectId, mutation) ||
    coverPhotoMode === 'manual' && (
      !coverPhoto?.remotePath ||
      projectCoverStoragePathKind(exactProjectId, coverPhoto.remotePath) !== 'immutable' ||
      updatedAt !== undefined && updatedAt !== coverPhoto.updatedAt
    )
  ) {
    throw new Error(
      coverPhotoMode === 'manual'
        ? 'Cover photo updates require one exact project ID and immutable cover revision.'
        : 'Cover photo updates require one exact project ID.',
    );
  }
  startProjectQueueTask(exactProjectId, 'cover_photo', () =>
    queueProjectUpdate({
      id: exactProjectId,
      previousName: projectName,
      data: projectData,
      coverPhotoCommit: mutation,
      coverPhotoUpload: coverPhotoMode === 'manual' && coverPhoto?.localUri && coverPhoto.remotePath
        ? {
          localUri: coverPhoto.localUri,
          remotePath: coverPhoto.remotePath,
          mimeType: coverPhoto.mimeType || 'image/jpeg',
          contentSha256: coverPhoto.contentSha256 || '',
          sizeBytes: coverPhoto.sizeBytes || 0,
        }
        : undefined,
    }),
  );
}

export function saveCloudProject(projectId: string, projectName: string) {
  requireExactProject(projectId, projectName);
  startProjectQueueTask(projectId, 'create', () => queueProjectCreate(projectId, projectName));
}

export function renameCloudProject(projectId: string, previousName: string, name: string) {
  requireExactProject(projectId, previousName);
  startProjectQueueTask(projectId, 'rename', () =>
    queueProjectUpdate({ id: projectId, previousName, name }),
  );
}

export function setCloudProjectArchived(projectId: string, projectName: string, archived: boolean) {
  requireExactProject(projectId, projectName);
  startProjectQueueTask(projectId, 'archive', () =>
    queueProjectUpdate({ id: projectId, previousName: projectName, archived }),
  );
}

export async function queueCloudProjectArchives(projects: readonly ProjectRecord[]) {
  for (const project of projects) {
    const projectId = project.id || '';
    requireExactProject(projectId, project.name);
    await queueProjectUpdate({ id: projectId, previousName: project.name, archived: true });
  }
}

export async function deleteCloudProject(
  projectId: string,
  projectName: string,
): Promise<void> {
  await queueProjectDelete(projectId, projectName);
}

function startProjectQueueTask(
  projectId: string,
  action: string,
  task: () => Promise<void>,
) {
  startGuardedBackgroundTask({
    key: `cloud-project-queue:${action}:${projectId}`,
    label: 'Project cloud queue',
    trigger: action,
    maxConsecutiveRuns: 2,
    task,
  });
}

function requireExactProject(projectId: string, projectName: string) {
  if (
    !isCanonicalProjectId(projectId) ||
    projectId !== projectId.trim() ||
    projectId !== projectId.toLowerCase() ||
    !projectName.trim()
  ) {
    throw new Error('Project cloud changes require one canonical project ID and display name.');
  }
}
