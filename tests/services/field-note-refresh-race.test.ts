import { createFieldNote, createFieldNoteRepository, markFieldNoteSynced } from '../../services/FieldNoteRepository';
import { createMobileFieldNoteDataSource, mergeFieldNoteCollections } from '../../services/FieldNoteMobileSync';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('a delayed cloud acknowledgement preserves a newer local edit', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
  const local = createFieldNoteRepository(storage);
  const entered = deferred<void>();
  const release = deferred<void>();
  const original = createFieldNote({ id: 'delayed', text: 'Original observation' });
  const source = createMobileFieldNoteDataSource({
    localRepository: local,
    cloudGateway: {
      list: async () => [],
      create: async note => { entered.resolve(); await release.promise; return markFieldNoteSynced(note, 1, new Date().toISOString()); },
      update: async note => note,
      subscribe: async () => () => undefined,
    },
  });
  const saving = source.save('owner', original);
  await entered.promise;
  const edited = { ...original, originalText: 'Newer observation', syncState: 'pending' as const };
  await local.replace('owner', edited);
  release.resolve();
  await saving;
  expect(await createFieldNoteRepository(storage).list('owner')).toEqual([edited]);
});

test('an older cloud revision cannot downgrade a synchronized local note, even with matching text', () => {
  const note = createFieldNote({ id: 'revision', text: 'Same observation' });
  const latest = markFieldNoteSynced(note, 3, new Date().toISOString());
  const older = markFieldNoteSynced(note, 2, new Date().toISOString());
  expect(mergeFieldNoteCollections([latest], [older])).toEqual([latest]);
});

test('a refresh snapshot cannot erase a note saved while refresh is writing', async () => {
  const values = new Map<string, string>();
  const entered = deferred<void>();
  const release = deferred<void>();
  let blockRefresh = true;
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (blockRefresh && value.includes('cloud-existing')) {
        blockRefresh = false;
        entered.resolve();
        await release.promise;
      }
      values.set(key, value);
    },
    removeItem: async (key: string) => { values.delete(key); },
  };
  const local = createFieldNoteRepository(storage);
  const cloud = markFieldNoteSynced(createFieldNote({ id: 'cloud-existing', text: 'Existing cloud note' }), 1, new Date().toISOString());
  const source = createMobileFieldNoteDataSource({
    localRepository: local,
    cloudGateway: { list: async () => [cloud], create: async note => note, update: async note => note, subscribe: async () => () => undefined },
  });
  const refresh = source.list('owner');
  await entered.promise;
  const saved = local.save('owner', createFieldNote({ id: 'offline-new', text: 'New offline note' }));
  await turn();
  release.resolve();
  await Promise.all([refresh, saved]);
  // Recreate the repository, as reopening does; do not assert only UI state.
  expect((await createFieldNoteRepository(storage).list('owner')).map(note => note.id))
    .toEqual(expect.arrayContaining(['offline-new', 'cloud-existing']));
});

test('concurrent verified local saves both survive repository reopening', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
  const one = createFieldNoteRepository(storage);
  const two = createFieldNoteRepository(storage);
  const results = await Promise.allSettled([
    one.save('owner', createFieldNote({ id: 'one', text: 'First' })),
    two.save('owner', createFieldNote({ id: 'two', text: 'Second' })),
  ]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  expect((await createFieldNoteRepository(storage).list('owner')).map(note => note.id).sort()).toEqual(['one', 'two']);
});
