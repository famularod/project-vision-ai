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
