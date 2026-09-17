import { createOwnerStorageSandbox } from '../../services/OwnerStorageSandbox';
import { cleanupProjectPhotoDirectory } from '../../services/PhotoDirectoryCleanupPolicy';

const DIRECTORY = 'file:///documents/project-photos/';
const NOW = Date.parse('2026-09-17T12:00:00.000Z');

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => Array.from(values.keys()),
    multiGet: async (keys: readonly string[]) =>
      keys.map(key => [key, values.get(key) ?? null] as const),
    multiSet: async (entries: readonly (readonly [string, string])[]) => {
      entries.forEach(([key, value]) => values.set(key, value));
    },
    multiRemove: async (keys: readonly string[]) => {
      keys.forEach(key => values.delete(key));
    },
  };
}

function memoryFileSystem(files: Record<string, number>) {
  const values = new Map(Object.entries(files));
  return {
    values,
    getInfoAsync: async (uri: string) => uri === DIRECTORY
      ? { exists: true }
      : values.has(uri)
        ? { exists: true, modificationTime: values.get(uri)! / 1_000 }
        : { exists: false },
    readDirectoryAsync: async () =>
      Array.from(values.keys()).map(uri => uri.slice(DIRECTORY.length)),
    deleteAsync: async (uri: string) => { values.delete(uri); },
  };
}

function storedUpdate(uri: string) {
  return JSON.stringify([{ id: 'update-1', photos: [{ id: 'photo-1', uri }] }]);
}

function queuedUpdate(uri: string) {
  return JSON.stringify([{
    id: 'project-update-update-1',
    entity: 'project_update',
    operation: 'update',
    payload: { updateData: { id: 'update-1', photos: [{ id: 'photo-1', uri }] } },
  }]);
}

async function runCleanup(
  storage: ReturnType<typeof memoryStorage>,
  fileSystem: ReturnType<typeof memoryFileSystem>,
  ownerId: string | null,
) {
  await cleanupProjectPhotoDirectory({
    directoryUri: DIRECTORY,
    folderName: 'project-photos',
    currentOwnerId: ownerId,
    referencedUris: new Set(),
    storage,
    fileSystem,
    now: () => NOW,
  });
}

describe('project photo directory cleanup data-loss guard', () => {
  test('preserves owner A queued photo across sign-out and return', async () => {
    const x = `${DIRECTORY}x.jpg`;
    const storage = memoryStorage({ 'projectVisionAI.syncQueue.v1': queuedUpdate(x) });
    const files = memoryFileSystem({ [x]: NOW - 30 * 86_400_000 });
    const sandbox = createOwnerStorageSandbox({ storage });

    await sandbox.activateOwner('owner-a');
    await runCleanup(storage, files, 'owner-a');
    await sandbox.activateOwner(null);
    await runCleanup(storage, files, null);
    await sandbox.activateOwner('owner-a');
    await runCleanup(storage, files, 'owner-a');

    expect(files.values.has(x)).toBe(true);
  });

  test('preserves photos belonging to owner A and owner B across account switches', async () => {
    const x = `${DIRECTORY}owner-a.jpg`;
    const y = `${DIRECTORY}owner-b.jpg`;
    const storage = memoryStorage({ 'projectPhotoUpdates.v2': storedUpdate(x) });
    const files = memoryFileSystem({
      [x]: NOW - 30 * 86_400_000,
      [y]: NOW - 30 * 86_400_000,
    });
    const sandbox = createOwnerStorageSandbox({ storage });

    await sandbox.activateOwner('owner-a');
    await sandbox.activateOwner('owner-b');
    await storage.setItem('projectPhotoUpdates.v2', storedUpdate(y));
    await runCleanup(storage, files, 'owner-b');
    await sandbox.activateOwner('owner-a');
    await runCleanup(storage, files, 'owner-a');

    expect(Array.from(files.values.keys()).sort()).toEqual([x, y].sort());
  });

  test('does not clean while quarantined startup data exists', async () => {
    const z = `${DIRECTORY}quarantined.jpg`;
    const storage = memoryStorage({
      'projectPhotoUpdates.v2.corrupt.snapshot': storedUpdate(z),
    });
    const files = memoryFileSystem({ [z]: NOW - 30 * 86_400_000 });

    await runCleanup(storage, files, 'owner-a');

    expect(files.values.has(z)).toBe(true);
  });

  test('deletes only unreferenced files at least 14 days old', async () => {
    const old = `${DIRECTORY}old.jpg`;
    const young = `${DIRECTORY}young.jpg`;
    // One real reference exists, so the "cannot prove anything" guard is not what keeps files.
    const kept = `${DIRECTORY}kept.jpg`;
    const storage = memoryStorage({ 'projectPhotoUpdates.v2': storedUpdate(kept) });
    const files = memoryFileSystem({
      [kept]: NOW - 30 * 86_400_000,
      [old]: NOW - 14 * 86_400_000,
      [young]: NOW - 13 * 86_400_000,
    });

    await runCleanup(storage, files, 'owner-a');

    expect(files.values.has(old)).toBe(false);
    expect(files.values.has(young)).toBe(true);
    expect(files.values.has(kept)).toBe(true);
  });

  const OLD_CONTAINER = 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/project-photos/';
  const AGED = NOW - 20 * 86_400_000;

  test('protects a photo whose saved URI carries an older app-container prefix', async () => {
    const current = `${DIRECTORY}a.jpg`;
    const orphan = `${DIRECTORY}orphan.jpg`;
    const storage = memoryStorage({ 'projectPhotoUpdates.v2': storedUpdate(`${OLD_CONTAINER}a.jpg`) });
    const files = memoryFileSystem({ [current]: AGED, [orphan]: AGED });
    await runCleanup(storage, files, 'owner-a');
    expect(files.values.has(current)).toBe(true);
    expect(files.values.has(orphan)).toBe(false);
  });

  test('protects a percent-encoded reference and an encoded file name', async () => {
    const current = `${DIRECTORY}site photo 1.jpg`;
    const storage = memoryStorage({
      'projectPhotoUpdates.v2': storedUpdate('file:%2F%2F%2Fold%2FDocuments%2Fproject-photos%2Fsite%20photo%201.jpg'),
    });
    const files = memoryFileSystem({ [current]: AGED });
    await runCleanup(storage, files, 'owner-a');
    expect(files.values.has(current)).toBe(true);
  });

  test('protects a reference nested inside a JSON string (owner-switch journal shape)', async () => {
    const current = `${DIRECTORY}b.jpg`;
    const orphan = `${DIRECTORY}orphan.jpg`;
    const storage = memoryStorage({
      journal: JSON.stringify({ sourceSnapshot: { 'projectPhotoUpdates.v2': storedUpdate(current) } }),
    });
    const files = memoryFileSystem({ [current]: AGED, [orphan]: AGED });
    await runCleanup(storage, files, 'owner-a');
    expect(files.values.has(current)).toBe(true);
    expect(files.values.has(orphan)).toBe(false);
  });

  test('protects a doubly nested, backslash-escaped reference', async () => {
    const current = `${DIRECTORY}c.jpg`;
    const storage = memoryStorage({
      journal: JSON.stringify({ outer: JSON.stringify({ inner: storedUpdate(current) }) }).replace(/\//g, '\\/'),
    });
    const files = memoryFileSystem({ [current]: AGED });
    await runCleanup(storage, files, 'owner-a');
    expect(files.values.has(current)).toBe(true);
  });

  test('deletes nothing when storage cannot be read', async () => {
    const orphan = `${DIRECTORY}orphan.jpg`;
    const storage = { ...memoryStorage(), multiGet: async () => { throw new Error('storage unavailable'); } };
    const files = memoryFileSystem({ [orphan]: AGED });
    await runCleanup(storage as ReturnType<typeof memoryStorage>, files, 'owner-a');
    expect(files.values.has(orphan)).toBe(true);
  });

  test('deletes nothing when files exist but no reference to the folder can be found anywhere', async () => {
    const orphan = `${DIRECTORY}orphan.jpg`;
    const files = memoryFileSystem({ [orphan]: AGED });
    await runCleanup(memoryStorage({ unrelated: '{"a":1}' }), files, 'owner-a');
    expect(files.values.has(orphan)).toBe(true);
  });

  test('a reference passed in by the app under an old prefix also protects the current file', async () => {
    const current = `${DIRECTORY}d.jpg`;
    const files = memoryFileSystem({ [current]: AGED });
    await cleanupProjectPhotoDirectory({
      directoryUri: DIRECTORY, folderName: 'project-photos', currentOwnerId: 'owner-a',
      referencedUris: new Set([`${OLD_CONTAINER}d.jpg`]), storage: memoryStorage(), fileSystem: files, now: () => NOW,
    });
    expect(files.values.has(current)).toBe(true);
  });
});
