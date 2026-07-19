import { listProjectUpdates } from './SupabaseService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hydrateRecoveredProjectUpdatePhotos,
  queueProjectUpdateArchive,
  queueProjectUpdateDelete,
  queueProjectUpdateRecord,
  removeProjectUpdateFromSyncQueue,
  requestPendingChangesUpload,
  runFieldUpdateCloudSync,
} from './SyncService';
import type { ProjectUpdate } from '../types';
import type { PersistedFieldUpdateStatus } from './FieldUpdateLifecycle';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';

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
}): Promise<{
  remainingUpdates: ProjectUpdate[];
  nextTombstones: TTombstone[];
  phase: 'complete' | 'barrier_committed';
}> {
  const operation = projectUpdateDeletionMutationTail.then(() =>
    runExclusiveLocalStorageMutation(
      [updatesStorageKey, tombstonesStorageKey],
      async () => {
        const deletionState = async () => {
          const [storedUpdates, storedTombstones] = await Promise.all([
            readStoredArray<ProjectUpdate>(
              updatesStorageKey,
              isStoredProjectUpdate,
              'saved field updates',
            ),
            readStoredArray<TTombstone>(
              tombstonesStorageKey,
              isStoredUpdateTombstone,
              'deleted field update records',
            ),
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
        // The verified tombstone is the safety barrier. Even if later byte
        // cleanup fails, a restart cannot legally restore this update.
        await setStoredJsonVerified(tombstonesStorageKey, initial.nextTombstones);
        let latest = initial;
        try {
          try {
            await setStoredJsonVerified(updatesStorageKey, latest.remainingUpdates);
          } catch {
            // Re-read behind the durable barrier and roll forward once. This
            // covers a one-time interruption between the two local writes.
            latest = await deletionState();
            await setStoredJsonVerified(updatesStorageKey, latest.remainingUpdates);
          }
          await queueProjectUpdateDelete(update).catch(() => undefined);
          latest = await deletionState();
          await setStoredJsonVerified(updatesStorageKey, latest.remainingUpdates);
          await setStoredJsonVerified(tombstonesStorageKey, latest.nextTombstones);
          return { ...latest, phase: 'complete' as const };
        } catch {
          // The barrier is already verified. Return its truthful projected
          // state so the UI removes the update instead of claiming nothing
          // happened; byte cleanup will be retried from the tombstone.
          return { ...latest, phase: 'barrier_committed' as const };
        }
      },
    ),
  );
  projectUpdateDeletionMutationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export async function reconcileProjectUpdateDeletionJournal(
  tombstones: readonly Pick<
    DeletedUpdateTombstone,
    'updateId' | 'action' | 'deletedAt' | 'cloudIdPresent'
  >[],
): Promise<void> {
  await Promise.allSettled(tombstones.map(async tombstone => {
    await removeProjectUpdateFromSyncQueue(tombstone.updateId);
    if (tombstone.action === 'delete_update_everywhere') {
      await queueProjectUpdateDelete({ id: tombstone.updateId });
    } else if (
      tombstone.action === 'archive_sent_update' ||
      (tombstone.action === 'remove_from_device' && tombstone.cloudIdPresent)
    ) {
      await queueProjectUpdateArchive(
        tombstone.updateId,
        tombstone.deletedAt || new Date().toISOString(),
      );
    }
  }));
}

export async function loadCloudUpdates<TUpdate>(): Promise<TUpdate[]> {
  requestPendingChangesUpload('cloud_update_loader');

  const result = await listProjectUpdates<TUpdate>();

  if (!result.ok || result.stubbed || !result.data) {
    throw new Error(
      result.error || result.message || 'Cloud field updates could not be read.',
    );
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

async function readStoredArray<T>(
  storageKey: string,
  isValidRecord: (value: unknown) => value is T,
  label: string,
): Promise<T[]> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const records = Array.isArray(parsed) ? parsed : [];
  const valid = records.filter(isValidRecord);
  if (Array.isArray(parsed) && valid.length === records.length) return valid;

  const recovery = await quarantineCorruptLocalValue({
    storage: AsyncStorage,
    storageKey,
    quarantineKeyPrefix: `${storageKey}.corrupt.`,
    raw,
    replacementRaw: JSON.stringify(valid),
  });
  throw localCorruptionRecoveryError({
    label,
    recovery,
    salvagedRecords: valid.length,
  });
}

async function setStoredJsonVerified(storageKey: string, value: unknown) {
  const raw = JSON.stringify(value);
  await AsyncStorage.setItem(storageKey, raw);
  if (await AsyncStorage.getItem(storageKey) !== raw) {
    throw new Error(`Local deletion write verification failed for ${storageKey}.`);
  }
}

function isStoredProjectUpdate(value: unknown): value is ProjectUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<ProjectUpdate>;
  return Boolean(
    typeof record.id === 'string' && record.id.trim() &&
    typeof record.projectName === 'string' && record.projectName.trim() &&
    typeof record.notes === 'string' &&
    Array.isArray(record.photos),
  );
}

function isStoredUpdateTombstone<T extends { updateId: string }>(
  value: unknown,
): value is T {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { updateId?: unknown }).updateId === 'string' &&
    (value as { updateId: string }).updateId.trim(),
  );
}

function uniqueByUpdateId<T extends { updateId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.updateId || seen.has(item.updateId)) return false;
    seen.add(item.updateId);
    return true;
  });
}
