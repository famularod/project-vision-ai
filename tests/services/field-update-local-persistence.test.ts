import {
  createFieldUpdateLocalPersistence,
  FieldUpdatePersistenceBlockedError,
  mergeRecordsByStableKey,
} from '../../services/FieldUpdateLocalPersistence';

type Update = { id: string; status: string };
type Tombstone = { updateId: string };

const keys = {
  journal: 'field-journal',
  updates: 'updates',
  tombstones: 'tombstones',
  draft: 'draft',
};

function parser<T extends Update | Tombstone>(requiredKey: keyof T) {
  return (value: unknown): T => {
    if (!value || typeof value !== 'object' ||
        typeof (value as Record<string, unknown>)[requiredKey as string] !== 'string') {
      throw new Error('invalid persisted record');
    }
    return value as T;
  };
}

describe('field update same-session journal replay', () => {
  it('recovers a one-time partial Save A before publishing it and retains it in Save B', async () => {
    const values = new Map<string, string>([[keys.tombstones, '[]']]);
    let failTombstoneWriteOnce = true;
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (key === keys.tombstones && failTombstoneWriteOnce) {
          failTombstoneWriteOnce = false;
          throw new Error('simulated interruption between target writes');
        }
        values.set(key, value);
      },
      removeItem: async (key: string) => { values.delete(key); },
    };
    let transactionNumber = 0;
    const persistence = createFieldUpdateLocalPersistence<Update, Tombstone>({
      storage,
      keys,
      createTransactionId: () => `field-save-${++transactionNumber}`,
      now: () => '2026-07-18T12:00:00.000Z',
      parseUpdate: parser<Update>('id'),
      parseTombstone: parser<Tombstone>('updateId'),
    });
    const save = (update: Update, inMemoryUpdates: Update[]) =>
      persistence.commit(snapshot => {
        const updates = mergeRecordsByStableKey(
          [update, ...inMemoryUpdates, ...snapshot.persistedUpdates], item => item.id,
        );
        return { operations: [
          { kind: 'set' as const, key: keys.updates, value: JSON.stringify(updates) },
          { kind: 'set' as const, key: keys.tombstones, value: JSON.stringify(snapshot.persistedTombstones) },
        ], result: updates };
      });

    const saveA = await save({ id: 'save-a', status: 'queued' }, []);
    expect(saveA.map(update => update.id)).toEqual(['save-a']);
    expect(values.has(keys.journal)).toBe(false);

    const saveB = await save({ id: 'save-b', status: 'queued' }, saveA);
    expect(saveB.map(update => update.id)).toEqual(['save-b', 'save-a']);
    expect(JSON.parse(values.get(keys.updates) || '[]')).toEqual(saveB);
    expect(values.has(keys.journal)).toBe(false);
  });

  it('re-reads persisted records before a status-only save', async () => {
    const values = new Map<string, string>([
      [keys.updates, JSON.stringify([
        { id: 'target', status: 'queued' },
        { id: 'other', status: 'queued' },
      ])],
      [keys.tombstones, '[]'],
    ]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const persistence = createFieldUpdateLocalPersistence<Update, Tombstone>({
      storage,
      keys,
      createTransactionId: () => 'status-save',
      now: () => '2026-07-18T12:00:00.000Z',
      parseUpdate: parser<Update>('id'),
      parseTombstone: parser<Tombstone>('updateId'),
    });

    const result = await persistence.commit(snapshot => {
      const updates = mergeRecordsByStableKey([
        { id: 'target', status: 'sent' },
        ...snapshot.persistedUpdates,
      ], item => item.id);
      return { operations: [
        { kind: 'set' as const, key: keys.updates, value: JSON.stringify(updates) },
      ], result: updates };
    });

    expect(result).toEqual([
      { id: 'target', status: 'sent' },
      { id: 'other', status: 'queued' },
    ]);
  });

  it('fails closed when a pending save cannot be recovered', async () => {
    const values = new Map<string, string>([[keys.tombstones, '[]']]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (key === keys.tombstones) throw new Error('persistent write failure');
        values.set(key, value);
      },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const persistence = createFieldUpdateLocalPersistence<Update, Tombstone>({
      storage,
      keys,
      createTransactionId: () => 'blocked-save',
      now: () => '2026-07-18T12:00:00.000Z',
      parseUpdate: parser<Update>('id'),
      parseTombstone: parser<Tombstone>('updateId'),
    });
    const prepare = () => ({ operations: [
      { kind: 'set' as const, key: keys.updates, value: '[{"id":"save-a","status":"queued"}]' },
      { kind: 'set' as const, key: keys.tombstones, value: '[]' },
    ], result: undefined });

    await expect(persistence.commit(prepare)).rejects.toBeInstanceOf(
      FieldUpdatePersistenceBlockedError,
    );
    expect(values.has(keys.journal)).toBe(true);
    await expect(persistence.recoverBeforeStartupReads()).rejects.toBeInstanceOf(
      FieldUpdatePersistenceBlockedError,
    );
  });

  it('preserves an ordinary save error when no recovery journal was created', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (key === keys.journal) throw new Error('journal unavailable');
        values.set(key, value);
      },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const persistence = createFieldUpdateLocalPersistence<Update, Tombstone>({
      storage,
      keys,
      createTransactionId: () => 'journal-failure',
      now: () => '2026-07-18T12:00:00.000Z',
      parseUpdate: parser<Update>('id'),
      parseTombstone: parser<Tombstone>('updateId'),
    });

    await expect(persistence.commit(() => ({ operations: [
      { kind: 'set' as const, key: keys.updates, value: '[]' },
    ], result: undefined }))).rejects.toMatchObject({ code: 'journal_write_failed' });
    expect(values.has(keys.journal)).toBe(false);
  });
});
