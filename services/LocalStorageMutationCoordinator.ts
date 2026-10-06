/**
 * One in-process lock registry for every AsyncStorage writer that can touch
 * the same durable domain. Reserving all keys before waiting prevents an
 * older debounced write, a transaction, a repair, and a deletion from
 * completing out of order and silently restoring stale bytes.
 */
const mutationTails = new Map<string, Promise<void>>();

export function runExclusiveLocalStorageMutation<T>(
  storageKeys: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(storageKeys.map(key => key.trim()).filter(Boolean))]
    .sort();
  if (keys.length === 0) {
    return Promise.reject(new Error('A local storage mutation requires at least one key.'));
  }

  const predecessors = keys.map(key =>
    (mutationTails.get(key) || Promise.resolve()).catch(() => undefined),
  );
  let release: () => void = () => undefined;
  const completion = new Promise<void>(resolve => { release = resolve; });
  keys.forEach(key => mutationTails.set(key, completion));

  const result = Promise.all(predecessors).then(operation);
  result.finally(() => {
    release();
    keys.forEach(key => {
      if (mutationTails.get(key) === completion) mutationTails.delete(key);
    });
  }).catch(() => undefined);
  return result;
}

/**
 * Independent review pass 4 (the restore lock): keys a waiting recovery owns.
 *
 * A device-backup restore that stopped part-way leaves its journal, and until
 * its recovery has run nothing else may save the lists it replaces: editing is
 * locked, and the only writers still moving are results of work begun before
 * the restore (a sync result, a photo result, a save already on its way), made
 * from the lists as they were before it. Each such writer asks here, under its
 * own lock, and does not write while the recovery waits.
 */
export class LocalStorageHeldForRecoveryError extends Error {
  constructor() {
    super('A device backup restore is being finished, so this was not saved. Nothing else was changed.');
    this.name = 'LocalStorageHeldForRecoveryError';
  }
}

type RecoveryHold = Readonly<{ waiting: () => Promise<boolean> }>;
/** The hold on each key: the one registered last (one restore runtime in the app). */
const recoveryHolds = new Map<string, RecoveryHold>();

/** These keys belong to a recovery while `waiting` answers true. Returns how to give them up. */
export function holdLocalStorageKeysForRecovery(storageKeys: readonly string[], waiting: () => Promise<boolean>): () => void {
  const hold: RecoveryHold = Object.freeze({ waiting });
  storageKeys.forEach(key => recoveryHolds.set(key, hold));
  return () => storageKeys.forEach(key => { if (recoveryHolds.get(key) === hold) recoveryHolds.delete(key); });
}

/**
 * Throws LocalStorageHeldForRecoveryError when a recovery is waiting for one of
 * these keys. Called by a writer inside its own lock, before it writes. When it
 * cannot be told whether one waits (storage did not answer), nothing is written
 * either: storage's own error is thrown, and the writer reports it as it reports
 * any save that failed. Only a save refused for a waiting recovery is quiet.
 */
export async function assertLocalStorageKeysNotHeldForRecovery(storageKeys: readonly string[]): Promise<void> {
  for (const hold of new Set(storageKeys.flatMap(key => recoveryHolds.get(key) ?? []))) {
    if (await hold.waiting()) throw new LocalStorageHeldForRecoveryError();
  }
}
