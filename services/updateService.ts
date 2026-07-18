import { listProjectUpdates } from './SupabaseService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hydrateRecoveredProjectUpdatePhotos,
  queueProjectUpdateDelete,
  queueProjectUpdateRecord,
  removeProjectUpdateFromSyncQueue,
  runFieldUpdateCloudSync,
  uploadPendingChanges,
} from './SyncService';
import type { ProjectUpdate } from '../types';
import type { PersistedFieldUpdateStatus } from './FieldUpdateLifecycle';

type ProjectUpdateLike = {
  id: string;
  projectName?: string;
  selectedAreaName?: string | null;
};

export type FieldUpdateDeleteDiagnostics = {
  updateId: string;
  localId: string;
  cloudIdPresent: boolean;
  lifecycleStatus: PersistedFieldUpdateStatus;
  pendingSync: boolean;
  tombstoned: boolean;
  deletedAt: string | null;
  sourceAfterReload: 'local' | 'cloud' | 'pending' | 'orphaned-photo' | 'unknown';
  mergeDecision: 'included' | 'excluded' | 'tombstoned';
  orphanedPhotoCountIgnored: number;
};

export type DeletedUpdateTombstone = FieldUpdateDeleteDiagnostics & {
  action:
    | 'delete_failed_update'
    | 'delete_update_everywhere'
    | 'remove_from_device'
    | 'archive_sent_update'
    | 'hide_cloud_update';
};

let projectUpdateDeletionMutationTail: Promise<void> = Promise.resolve();

export async function persistAndQueueProjectUpdateDeletion<
  TTombstone extends { updateId: string },
>({
  update,
  tombstone,
  getCurrentUpdates,
  getCurrentTombstones,
  updatesStorageKey,
  tombstonesStorageKey,
}: {
  update: ProjectUpdate;
  tombstone: TTombstone;
  getCurrentUpdates: () => ProjectUpdate[];
  getCurrentTombstones: () => TTombstone[];
  updatesStorageKey: string;
  tombstonesStorageKey: string;
}): Promise<{ remainingUpdates: ProjectUpdate[]; nextTombstones: TTombstone[] }> {
  const operation = projectUpdateDeletionMutationTail.then(async () => {
    const deletionState = async () => {
      const [storedUpdates, storedTombstones] = await Promise.all([
        readStoredArray<ProjectUpdate>(updatesStorageKey),
        readStoredArray<TTombstone>(tombstonesStorageKey),
      ]);
      const nextTombstones = uniqueByUpdateId([
        tombstone,
        ...getCurrentTombstones(),
        ...storedTombstones,
      ]);
      const deletedIds = new Set(nextTombstones.map(item => item.updateId));
      const updatesById = new Map(storedUpdates.map(item => [item.id, item]));
      getCurrentUpdates().forEach(item => updatesById.set(item.id, item));
      return {
        remainingUpdates: [...updatesById.values()].filter(
          item => !deletedIds.has(item.id),
        ),
        nextTombstones,
      };
    };

    const initial = await deletionState();
    await AsyncStorage.setItem(
      tombstonesStorageKey,
      JSON.stringify(initial.nextTombstones),
    );
    await AsyncStorage.setItem(
      updatesStorageKey,
      JSON.stringify(initial.remainingUpdates),
    ).catch(() => undefined);
    await queueProjectUpdateDelete(update).catch(() => undefined);
    const latest = await deletionState();
    await Promise.allSettled([
      AsyncStorage.setItem(updatesStorageKey, JSON.stringify(latest.remainingUpdates)),
      AsyncStorage.setItem(tombstonesStorageKey, JSON.stringify(latest.nextTombstones)),
    ]);
    return latest;
  });
  projectUpdateDeletionMutationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export async function reconcileProjectUpdateDeletionJournal(
  tombstones: readonly Pick<DeletedUpdateTombstone, 'updateId' | 'action'>[],
): Promise<void> {
  await Promise.allSettled(tombstones.map(async tombstone => {
    await removeProjectUpdateFromSyncQueue(tombstone.updateId);
    if (tombstone.action === 'delete_update_everywhere') {
      await queueProjectUpdateDelete({ id: tombstone.updateId });
    }
  }));
}

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

async function readStoredArray<T>(storageKey: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function uniqueByUpdateId<T extends { updateId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.updateId || seen.has(item.updateId)) return false;
    seen.add(item.updateId);
    return true;
  });
}
