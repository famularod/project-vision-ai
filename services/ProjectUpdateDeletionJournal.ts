import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

export const PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY =
  'projectPhotoUpdate.deletionJournal.v1';
export const PROJECT_UPDATE_DELETION_JOURNAL_QUARANTINE_PREFIX =
  'projectPhotoUpdate.deletionJournal.quarantine.v1/';

export type ProjectUpdateDeletionIntent = {
  updateId: string;
  projectName?: string;
  requestedAt: string;
  cloudDeleteConfirmedAt: string | null;
};

let deletionJournalMutationTail: Promise<void> = Promise.resolve();

export async function recordProjectUpdateDeletionIntent(update: {
  id: string;
  projectName?: string;
}): Promise<ProjectUpdateDeletionIntent> {
  const updateId = update.id.trim();
  if (!updateId) throw new Error('A valid update id is required for deletion.');

  return serializeDeletionJournalMutation(async () => {
    const current = await readDeletionJournal();
    const existing = current.find(intent => intent.updateId === updateId);
    const intent: ProjectUpdateDeletionIntent = existing
      ? {
          ...existing,
          projectName: update.projectName || existing.projectName,
        }
      : {
          updateId,
          projectName: update.projectName,
          requestedAt: new Date().toISOString(),
          cloudDeleteConfirmedAt: null,
        };
    await persistDeletionJournal([
      intent,
      ...current.filter(candidate => candidate.updateId !== updateId),
    ]);
    return intent;
  });
}

export async function hasProjectUpdateDeletionIntent(
  updateId: string,
): Promise<boolean> {
  await deletionJournalMutationTail;
  const normalizedId = updateId.trim();
  if (!normalizedId) return false;
  return runExclusiveLocalStorageMutation(
    [PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY],
    async () => (await readDeletionJournal()).some(
      intent => intent.updateId === normalizedId,
    ),
  );
}

export async function confirmProjectUpdateCloudDeletion(
  updateId: string,
): Promise<void> {
  const normalizedId = updateId.trim();
  if (!normalizedId) return;

  await serializeDeletionJournalMutation(async () => {
    const current = await readDeletionJournal();
    const existing = current.find(intent => intent.updateId === normalizedId);
    if (!existing || existing.cloudDeleteConfirmedAt) return;
    await persistDeletionJournal([
      {
        ...existing,
        cloudDeleteConfirmedAt: new Date().toISOString(),
      },
      ...current.filter(intent => intent.updateId !== normalizedId),
    ]);
  });
}

function serializeDeletionJournalMutation<T>(
  mutation: () => Promise<T>,
): Promise<T> {
  const guardedMutation = () => runExclusiveLocalStorageMutation(
    [PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY],
    mutation,
  );
  const result = deletionJournalMutationTail.then(guardedMutation, guardedMutation);
  deletionJournalMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readDeletionJournal(): Promise<ProjectUpdateDeletionIntent[]> {
  const raw = await AsyncStorage.getItem(
    PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY,
  );
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await quarantineInvalidDeletionJournal(raw, []);
    throw new Error('Unreachable after corrupt deletion journal quarantine.');
  }

  if (!Array.isArray(parsed)) {
    await quarantineInvalidDeletionJournal(raw, []);
    throw new Error('Unreachable after invalid deletion journal quarantine.');
  }

  const normalized = parsed.map(normalizeDeletionIntent);
  const valid = normalized.filter(
    (intent): intent is ProjectUpdateDeletionIntent => Boolean(intent),
  );
  if (valid.length !== parsed.length) {
    await quarantineInvalidDeletionJournal(raw, valid);
    throw new Error('Unreachable after partial deletion journal recovery.');
  }
  return valid;
}

async function quarantineInvalidDeletionJournal(
  raw: string,
  valid: readonly ProjectUpdateDeletionIntent[],
): Promise<never> {
  const recovery = await quarantineCorruptLocalValue({
    storage: AsyncStorage,
    storageKey: PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY,
    quarantineKeyPrefix: PROJECT_UPDATE_DELETION_JOURNAL_QUARANTINE_PREFIX,
    raw,
    replacementRaw: valid.length > 0 ? JSON.stringify(valid) : null,
  });
  throw localCorruptionRecoveryError({
    label: 'The project update deletion journal',
    recovery,
    salvagedRecords: valid.length,
  });
}

async function persistDeletionJournal(
  intents: readonly ProjectUpdateDeletionIntent[],
): Promise<void> {
  const raw = JSON.stringify(intents);
  await AsyncStorage.setItem(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY, raw);
  if (await AsyncStorage.getItem(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY) !== raw) {
    throw new Error('The project update deletion journal write could not be verified.');
  }
}

function normalizeDeletionIntent(
  value: unknown,
): ProjectUpdateDeletionIntent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ProjectUpdateDeletionIntent>;
  const updateId = String(record.updateId || '').trim();
  const requestedAt = normalizeTimestamp(record.requestedAt);
  if (!updateId || !requestedAt) return null;

  return {
    updateId,
    projectName: typeof record.projectName === 'string'
      ? record.projectName
      : undefined,
    requestedAt,
    cloudDeleteConfirmedAt: normalizeTimestamp(record.cloudDeleteConfirmedAt),
  };
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
