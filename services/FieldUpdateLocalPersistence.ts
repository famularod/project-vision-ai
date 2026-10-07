import {
  createDurableLocalTransactionRepository,
  type DurableLocalTransactionOperation,
  type DurableLocalTransactionStorage,
} from './DurableLocalTransaction';
import { assertLocalStorageKeysNotHeldForRecovery, runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

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
  // A deletion barrier for this id (the update was deleted while it was open
  // as the draft, on this device or another) drops the queued update from
  // the visible list. Nothing is written then: the draft stays persisted and
  // the caller keeps it instead of reporting a save (whole-app audit A4,
  // 29 Sep 2026; mirrors prepareFieldUpdateStatusSave).
  const applied = nextUpdates.some(item => item.id === queuedUpdate.id);
  // Which barrier dropped it: a cloud archive is told apart from a deletion.
  const barrier = applied ? undefined : nextTombstones.find(item => item.updateId === queuedUpdate.id);
  const barrierRecord = barrier as unknown as { action?: unknown } | undefined;
  const barrierAction = typeof barrierRecord?.action === 'string' ? barrierRecord.action : null;
  return { operations: applied ? [
    { kind: 'set' as const, key: keys.updates, value: JSON.stringify(nextUpdates) },
    { kind: 'set' as const, key: keys.tombstones, value: JSON.stringify(nextTombstones) },
    { kind: 'remove_if_unchanged' as const, key: keys.draft, expectedValue: snapshot.persistedDraft },
  ] : [], result: { applied, barrierAction, nextUpdates, nextTombstones } };
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

  /**
   * Sync batch Y4, item 1. A waiting save whose record cannot be read at all stopped the app at every start. It is
   * set aside (kept under another name), the app starts on the lists as they are, and he is told once
   * (services/RecoveryRecordNotices.ts). Nothing of his goes with it: a save removes the draft last, and only the
   * draft it read, so at whatever step the save stopped the update is in the saved list or still open as the draft;
   * and a result that was not written leaves the update waiting to be sent, which the app sends again. Only at a
   * start (or Retry Recovery), and only a record that cannot be read: one that can be is finished or stops as before,
   * and a save made while one waits is blocked as before.
   */
  const recoverBeforeStartupReads = () => runExclusiveLocalStorageMutation(
    lockKeys,
    async () => {
      try {
        await transaction.recover();
      } catch (cause) {
        let setAside = null;
        try {
          setAside = await transaction.setAsideIfUnreadable();
        } catch {
          // The device could not keep the copy: nothing was removed, and this start is blocked as before.
        }
        if (!setAside) throw new FieldUpdatePersistenceBlockedError('recovery', cause);
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
      // Independent review pass 4 (the restore lock): not while a held device-backup restore waits to be finished.
      // A field update's sync result, already on its way when the restore stopped, saved the updates list the restore
      // had written, and the restore's recovery then failed at every start. The save is blocked, as by a pending
      // save of its own.
      await assertLocalStorageKeysNotHeldForRecovery(lockKeys);
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
