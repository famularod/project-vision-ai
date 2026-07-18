import AsyncStorage from '@react-native-async-storage/async-storage';

const PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY =
  'projectPhotoUpdate.deletionJournal.v1';

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
  return (await readDeletionJournal()).some(
    intent => intent.updateId === normalizedId,
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
  const result = deletionJournalMutationTail.then(mutation, mutation);
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

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeDeletionIntent)
      .filter((intent): intent is ProjectUpdateDeletionIntent => Boolean(intent));
  } catch {
    return [];
  }
}

async function persistDeletionJournal(
  intents: readonly ProjectUpdateDeletionIntent[],
): Promise<void> {
  await AsyncStorage.setItem(
    PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY,
    JSON.stringify(intents),
  );
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
