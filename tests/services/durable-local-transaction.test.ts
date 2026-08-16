import {
  DurableLocalTransactionError,
  createDurableLocalTransactionRepository,
  type DurableLocalTransactionStorage,
} from '../../services/DurableLocalTransaction';

const JOURNAL_KEY = '@dave/transaction-journal/v1';

class FailureStorage implements DurableLocalTransactionStorage {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  failSetAt: number | null = null;
  failRemoveFor = new Set<string>();
  setCount = 0;

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.setCount += 1;
    if (this.failSetAt === this.setCount) throw new Error('injected set failure');
    this.values.set(key, value);
    this.writes.push(key);
  }

  async removeItem(key: string) {
    if (this.failRemoveFor.has(key)) throw new Error('injected remove failure');
    this.values.delete(key);
  }
}

function repository(storage: FailureStorage, ids = ['transaction-0001']) {
  let index = 0;
  return createDurableLocalTransactionRepository({
    storage,
    journalKey: JOURNAL_KEY,
    createTransactionId: () => ids[index++] || `transaction-${String(index).padStart(4, '0')}`,
    now: () => '2026-07-18T12:00:00.000Z',
  });
}

describe('DurableLocalTransaction', () => {
  it('verifies related writes before returning success and removes the journal', async () => {
    const storage = new FailureStorage();
    const result = await repository(storage).commit([
      { kind: 'set', key: 'updates', value: '[{"id":"update-1"}]' },
      { kind: 'set', key: 'tombstones', value: '[]' },
    ]);

    expect(result).toMatchObject({
      transactionId: 'transaction-0001',
      appliedOperationIndexes: [0, 1],
      skippedOperationIndexes: [],
      recovered: false,
    });
    expect(storage.values.get('updates')).toContain('update-1');
    expect(storage.values.has(JOURNAL_KEY)).toBe(false);
  });

  it('writes no target data when journal preparation fails', async () => {
    const storage = new FailureStorage();
    storage.failSetAt = 1;

    await expect(repository(storage).commit([
      { kind: 'set', key: 'updates', value: 'new' },
    ])).rejects.toMatchObject({ code: 'journal_write_failed' });

    expect(storage.values.has('updates')).toBe(false);
  });

  it('recovers a partially applied transaction after a simulated process kill', async () => {
    const storage = new FailureStorage();
    // prepared journal, applying journal, first target, first progress journal,
    // then fail while writing the second target.
    storage.failSetAt = 5;
    await expect(repository(storage).commit([
      { kind: 'set', key: 'updates', value: 'new-updates' },
      { kind: 'set', key: 'draft', value: 'new-draft' },
    ])).rejects.toMatchObject({ code: 'operation_failed' });
    expect(storage.values.get('updates')).toBe('new-updates');
    expect(storage.values.has(JOURNAL_KEY)).toBe(true);

    storage.failSetAt = null;
    const recovered = await repository(storage).recover();
    expect(recovered).toMatchObject({ recovered: true, appliedOperationIndexes: [0, 1] });
    expect(storage.values.get('draft')).toBe('new-draft');
    expect(storage.values.has(JOURNAL_KEY)).toBe(false);
  });

  it('preserves a newer draft when its conditional clear no longer matches', async () => {
    const storage = new FailureStorage();
    storage.values.set('draft', 'generation-2');

    const result = await repository(storage).commit([
      { kind: 'set', key: 'updates', value: 'saved-update' },
      { kind: 'remove_if_unchanged', key: 'draft', expectedValue: 'generation-1' },
    ]);

    expect(result.skippedOperationIndexes).toEqual([1]);
    expect(storage.values.get('draft')).toBe('generation-2');
    expect(storage.values.get('updates')).toBe('saved-update');
  });

  it('serializes double submissions without interleaving transaction journals', async () => {
    const storage = new FailureStorage();
    const repo = repository(storage, ['transaction-0001', 'transaction-0002']);

    const [first, second] = await Promise.all([
      repo.commit([{ kind: 'set', key: 'updates', value: 'first' }]),
      repo.commit([{ kind: 'set', key: 'updates', value: 'second' }]),
    ]);

    expect(first.transactionId).toBe('transaction-0001');
    expect(second.transactionId).toBe('transaction-0002');
    expect(storage.values.get('updates')).toBe('second');
    expect(storage.values.has(JOURNAL_KEY)).toBe(false);
  });

  it('blocks every target write when the recovery journal is corrupt', async () => {
    const storage = new FailureStorage();
    storage.values.set(JOURNAL_KEY, '{not-json');

    await expect(repository(storage).commit([
      { kind: 'set', key: 'updates', value: 'must-not-write' },
    ])).rejects.toMatchObject({
      code: 'journal_corrupt',
      recoverable: false,
    });
    expect(storage.values.has('updates')).toBe(false);
    expect(storage.values.get(JOURNAL_KEY)).toBe('{not-json');
  });

  it('keeps a committed journal recoverable when cleanup fails', async () => {
    const storage = new FailureStorage();
    storage.failRemoveFor.add(JOURNAL_KEY);

    await expect(repository(storage).commit([
      { kind: 'set', key: 'updates', value: 'durable' },
    ])).rejects.toMatchObject({
      code: 'journal_cleanup_failed',
      recoverable: true,
    });
    expect(storage.values.get('updates')).toBe('durable');
    expect(JSON.parse(storage.values.get(JOURNAL_KEY) || '{}').phase).toBe('committed');

    storage.failRemoveFor.clear();
    await expect(repository(storage).recover()).resolves.toMatchObject({ recovered: true });
    expect(storage.values.has(JOURNAL_KEY)).toBe(false);
  });

  it.each([
    { operations: [] },
    { operations: [{ kind: 'set', key: JOURNAL_KEY, value: 'forbidden' }] },
    {
      operations: [
        { kind: 'set', key: 'updates', value: 'one' },
        { kind: 'set', key: 'updates', value: 'two' },
      ],
    },
  ])('rejects invalid transaction operations without writes', async ({ operations }) => {
    const storage = new FailureStorage();
    await expect(repository(storage).commit(operations as never))
      .rejects.toBeInstanceOf(DurableLocalTransactionError);
    expect(storage.writes).toEqual([]);
  });
});
