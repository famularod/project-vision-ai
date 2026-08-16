import {
  createDurableLocalTransactionRepository,
  type DurableLocalTransactionOperation,
  type DurableLocalTransactionStorage,
} from './DurableLocalTransaction';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

export type FieldUpdatePersistenceKeys = Readonly<{
  journal: string;
  updates: string;
  tombstones: string;
  draft: string;
}>;

export type FieldUpdatePersistenceSnapshot<TUpdate, TTombstone> = Readonly<{
  persistedUpdates: TUpdate[];
  persistedTombstones: TTombstone[];
  persistedDraft: string | null;
}>;

export class FieldUpdatePersistenceBlockedError extends Error {
  readonly stage: 'recovery' | 'read';
  readonly cause: unknown;

  constructor(stage: 'recovery' | 'read', cause: unknown) {
    super(stage === 'recovery'
      ? 'A pending field update save could not be recovered.'
      : 'Saved field update data could not be read safely.');
    this.name = 'FieldUpdatePersistenceBlockedError';
    this.stage = stage;
    this.cause = cause;
  }
}

export type FieldUpdateLocalPersistence<TUpdate, TTombstone> = Readonly<{
  recoverBeforeStartupReads: () => Promise<void>;
  commit<TResult>(
    prepare: (
      snapshot: FieldUpdatePersistenceSnapshot<TUpdate, TTombstone>,
    ) => Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }> | Promise<Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }>>,
  ): Promise<TResult>;
}>;

type IdentifiedUpdate = Readonly<{ id: string }>;
type IdentifiedTombstone = Readonly<{ updateId: string }>;
type MergeVisibleUpdates<TUpdate, TTombstone> = (input: Readonly<{
  localUpdates: TUpdate[];
  cloudUpdates: TUpdate[];
  tombstones: TTombstone[];
}>) => TUpdate[];

export function prepareQueuedFieldUpdateSave<
  TUpdate extends IdentifiedUpdate,
  TTombstone extends IdentifiedTombstone,
>({
  snapshot,
  queuedUpdate,
  currentUpdates,
  currentTombstones,
  keys,
  mergeVisibleUpdates,
}: Readonly<{
  snapshot: FieldUpdatePersistenceSnapshot<TUpdate, TTombstone>;
  queuedUpdate: TUpdate;
  currentUpdates: readonly TUpdate[];
  currentTombstones: readonly TTombstone[];
  keys: FieldUpdatePersistenceKeys;
  mergeVisibleUpdates: MergeVisibleUpdates<TUpdate, TTombstone>;
}>) {
  const nextTombstones = mergeRecordsByStableKey(
    [...currentTombstones, ...snapshot.persistedTombstones], item => item.updateId,
  );
  const nextUpdates = mergeVisibleUpdates({
    localUpdates: mergeRecordsByStableKey(
      [queuedUpdate, ...currentUpdates, ...snapshot.persistedUpdates], item => item.id,
    ),
    cloudUpdates: [],
    tombstones: nextTombstones,
  });
  return { operations: [
    { kind: 'set' as const, key: keys.updates, value: JSON.stringify(nextUpdates) },
    { kind: 'set' as const, key: keys.tombstones, value: JSON.stringify(nextTombstones) },
    { kind: 'remove_if_unchanged' as const, key: keys.draft, expectedValue: snapshot.persistedDraft },
  ], result: { nextUpdates, nextTombstones } };
}

export function prepareFieldUpdateStatusSave<
  TUpdate extends IdentifiedUpdate,
  TTombstone extends IdentifiedTombstone,
>({
  snapshot,
  update,
  expectedUpdate,
  currentUpdates,
  currentTombstones,
  keys,
  mergeVisibleUpdates,
  reconcile,
}: Readonly<{
  snapshot: FieldUpdatePersistenceSnapshot<TUpdate, TTombstone>;
  update: TUpdate;
  expectedUpdate: TUpdate;
  currentUpdates: readonly TUpdate[];
  currentTombstones: readonly TTombstone[];
  keys: FieldUpdatePersistenceKeys;
  mergeVisibleUpdates: MergeVisibleUpdates<TUpdate, TTombstone>;
  reconcile: (
    current: readonly TUpdate[],
    expected: TUpdate,
    result: TUpdate,
  ) => Readonly<{ updates: TUpdate[]; applied: boolean }>;
}>) {
  const nextTombstones = mergeRecordsByStableKey(
    [...currentTombstones, ...snapshot.persistedTombstones], item => item.updateId,
  );
  const current = mergeRecordsByStableKey(
    [...currentUpdates, ...snapshot.persistedUpdates], item => item.id,
  );
  const reconciliation = reconcile(current, expectedUpdate, update);
  const nextUpdates = mergeVisibleUpdates({
    localUpdates: reconciliation.updates,
    cloudUpdates: [],
    tombstones: nextTombstones,
  });
  const applied = reconciliation.applied && nextUpdates.some(item => item.id === update.id);
  return { operations: applied ? [
    { kind: 'set' as const, key: keys.updates, value: JSON.stringify(nextUpdates) },
    { kind: 'set' as const, key: keys.tombstones, value: JSON.stringify(nextTombstones) },
  ] : [], result: { applied, nextUpdates, nextTombstones } };
}

/**
 * Recovers the previous journal before taking a new snapshot. This ordering is
 * deliberate: a later save must merge the bytes restored by an earlier,
 * partially applied save instead of overwriting them with stale React state.
 */
export function createFieldUpdateLocalPersistence<TUpdate, TTombstone>({
  storage,
  keys,
  createTransactionId,
  now,
  parseUpdate,
  parseTombstone,
}: Readonly<{
  storage: DurableLocalTransactionStorage;
  keys: FieldUpdatePersistenceKeys;
  createTransactionId: () => string;
  now: () => string;
  parseUpdate: (value: unknown) => TUpdate;
  parseTombstone: (value: unknown) => TTombstone;
}>): FieldUpdateLocalPersistence<TUpdate, TTombstone> {
  const transaction = createDurableLocalTransactionRepository({
    storage,
    journalKey: keys.journal,
    createTransactionId,
    now,
  });
  const lockKeys = [keys.journal, keys.updates, keys.tombstones, keys.draft];

  const recoverBeforeStartupReads = () => runExclusiveLocalStorageMutation(
    lockKeys,
    async () => {
      try {
        await transaction.recover();
      } catch (cause) {
        throw new FieldUpdatePersistenceBlockedError('recovery', cause);
      }
    },
  );

  const commit = <TResult>(
    prepare: (
      snapshot: FieldUpdatePersistenceSnapshot<TUpdate, TTombstone>,
    ) => Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }> | Promise<Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }>>,
  ) => runExclusiveLocalStorageMutation(lockKeys, async () => {
    try {
      await transaction.recover();
    } catch (cause) {
      throw new FieldUpdatePersistenceBlockedError('recovery', cause);
    }

    let snapshot: FieldUpdatePersistenceSnapshot<TUpdate, TTombstone>;
    try {
      const [persistedUpdates, persistedTombstones, persistedDraft] = await Promise.all([
        readStrictArray(storage, keys.updates, parseUpdate),
        readStrictArray(storage, keys.tombstones, parseTombstone),
        storage.getItem(keys.draft),
      ]);
      snapshot = { persistedUpdates, persistedTombstones, persistedDraft };
    } catch (cause) {
      throw new FieldUpdatePersistenceBlockedError('read', cause);
    }

    const prepared = await prepare(snapshot);
    if (prepared.operations.length > 0) {
      try {
        await transaction.commit(prepared.operations);
      } catch (commitCause) {
        let recovered;
        try {
          recovered = await transaction.recover();
        } catch (recoveryCause) {
          throw new FieldUpdatePersistenceBlockedError('recovery', recoveryCause);
        }
        if (!recovered) throw commitCause;
      }
    }
    return prepared.result;
  });

  return Object.freeze({ recoverBeforeStartupReads, commit });
}

export function mergeRecordsByStableKey<T>(
  records: readonly T[],
  keyFor: (record: T) => string,
): T[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = keyFor(record).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readStrictArray<T>(
  storage: DurableLocalTransactionStorage,
  storageKey: string,
  parseRecord: (value: unknown) => T,
): Promise<T[]> {
  const raw = await storage.getItem(storageKey);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${storageKey} contains invalid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${storageKey} must contain an array.`);
  return parsed.map(parseRecord);
}
