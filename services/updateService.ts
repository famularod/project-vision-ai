import { listProjectUpdates } from './SupabaseService';
import { queueProjectUpdateRecord, uploadPendingChanges } from './SyncService';

type ProjectUpdateLike = {
  id: string;
  projectName?: string;
  selectedAreaName?: string | null;
};

export async function loadCloudUpdates<TUpdate>(): Promise<TUpdate[]> {
  void uploadPendingChanges();

  const result = await listProjectUpdates<TUpdate>();

  if (!result.ok || !result.data) {
    return [];
  }

  return result.data
    .map(row => row.updateData)
    .filter((update): update is TUpdate => Boolean(update));
}

export async function saveCloudUpdate<TUpdate extends ProjectUpdateLike>(
  update: TUpdate,
): Promise<void> {
  if (!update.id) return;

  await queueProjectUpdateRecord(update);
}
