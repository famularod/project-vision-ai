import { listProjects } from './SupabaseService';
import { queueProjectCreate, uploadPendingChanges } from './SyncService';

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
