import { listProjectUpdates } from './SupabaseService';
import {
  hydrateRecoveredProjectUpdatePhotos,
  queueProjectUpdateRecord,
  runFieldUpdateCloudSync,
  uploadPendingChanges,
} from './SyncService';
import type { ProjectUpdate } from '../types';

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

  const updates = result.data
    .map(row => row.updateData)
    .filter((update): update is TUpdate => Boolean(update));
  return Promise.all(updates.map(async update => {
    if (!isProjectUpdateWithPhotos(update)) return update;
    return await hydrateRecoveredProjectUpdatePhotos(update) as unknown as TUpdate;
  }));
}

export async function saveCloudUpdate<TUpdate extends ProjectUpdateLike>(
  update: TUpdate,
): Promise<void> {
  if (!update.id) return;

  if (isProjectUpdateWithPhotos(update)) {
    await runFieldUpdateCloudSync(update);
    return;
  }
  await queueProjectUpdateRecord(update);
}

function isProjectUpdateWithPhotos(value: unknown): value is ProjectUpdate {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as ProjectUpdate).id === 'string' &&
    typeof (value as ProjectUpdate).projectName === 'string' &&
    Array.isArray((value as ProjectUpdate).photos),
  );
}
