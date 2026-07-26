import {
  listDAVEStorageCleanupIntents,
  recordDAVEStorageCleanupAttempt,
  removeProtectedStorageObject,
  type DAVEStorageCleanupIntent,
} from './SupabaseService';

export type DAVEStorageCleanupResult = Readonly<{
  attempted: number;
  completed: number;
  failed: number;
  remaining: number;
  errors: readonly string[];
}>;

export type DAVEStorageCleanupDependencies = Readonly<{
  list: (limit: number) => Promise<Readonly<{
    ok: boolean;
    intents: readonly DAVEStorageCleanupIntent[];
    error?: string;
  }>>;
  remove: (intent: DAVEStorageCleanupIntent) => Promise<Readonly<{
    ok: boolean;
    error?: string;
  }>>;
  record: (
    intent: DAVEStorageCleanupIntent,
    completed: boolean,
    errorMessage: string | null,
  ) => Promise<Readonly<{ ok: boolean; error?: string }>>;
}>;

const DEFAULT_BATCH_LIMIT = 100;
const STORAGE_REMOVAL_ERROR =
  'A deleted project file is waiting for protected cloud cleanup.';
const CLEANUP_RECEIPT_ERROR =
  'A protected file cleanup receipt could not be saved and will be retried.';

export async function processDAVEStorageCleanup(
  dependencies: DAVEStorageCleanupDependencies = defaultDependencies,
  limit = DEFAULT_BATCH_LIMIT,
): Promise<DAVEStorageCleanupResult> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const listed = await dependencies.list(safeLimit);
  if (!listed.ok) {
    return {
      attempted: 0,
      completed: 0,
      failed: 0,
      remaining: 1,
      errors: [listed.error || 'Protected file cleanup is temporarily unavailable.'],
    };
  }

  let completed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const intent of listed.intents) {
    const removal = await dependencies.remove(intent);
    if (!removal.ok) {
      failed += 1;
      const receipt = await dependencies.record(
        intent,
        false,
        STORAGE_REMOVAL_ERROR,
      );
      errors.push(STORAGE_REMOVAL_ERROR);
      if (!receipt.ok) errors.push(CLEANUP_RECEIPT_ERROR);
      continue;
    }

    const receipt = await dependencies.record(intent, true, null);
    if (!receipt.ok) {
      failed += 1;
      errors.push(CLEANUP_RECEIPT_ERROR);
      continue;
    }
    completed += 1;
  }

  const moreMayExist = listed.intents.length === safeLimit ? 1 : 0;
  return {
    attempted: listed.intents.length,
    completed,
    failed,
    remaining: failed + moreMayExist,
    errors: [...new Set(errors)],
  };
}

const defaultDependencies: DAVEStorageCleanupDependencies = {
  async list(limit) {
    const result = await listDAVEStorageCleanupIntents(limit);
    return {
      ok: result.ok && !result.stubbed,
      intents: result.data || [],
      error: result.error || result.message,
    };
  },
  async remove(intent) {
    const result = await removeProtectedStorageObject({
      bucket: intent.bucket,
      path: intent.objectPath,
    });
    return {
      ok: result.ok && !result.stubbed,
      error: result.error || result.message,
    };
  },
  async record(intent, completed, errorMessage) {
    const result = await recordDAVEStorageCleanupAttempt({
      intent,
      completed,
      errorMessage,
    });
    return {
      ok: result.ok && !result.stubbed,
      error: result.error || result.message,
    };
  },
};
