import { listProjects } from './SupabaseService';
import {
  queueProjectCreate,
  queueProjectDelete,
  queueProjectUpdate,
  uploadPendingChanges,
} from './SyncService';

export async function loadCloudProjects() {
  void uploadPendingChanges();

  const result = await listProjects();

  if (!result.ok || !result.data) {
    return [];
  }

  return result.data
    .map(item => item.name)
    .filter(name => typeof name === 'string' && name.trim());
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

export function deleteCloudProject(projectName: string) {
  void queueProjectDelete(projectName);
}
