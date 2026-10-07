/**
 * Review pass 1, sync, finding F1 (older; sync batch Y3, item 6b; services/RestoredMediaLedger.ts).
 *
 * The first two tests are the reviewer's own (notes/p5-sync/p5s-6b-device-removal.test.ts), unchanged; the second
 * fails on the base (a542898). The describe after them is this batch's.
 *
 * The earlier tests stood in for the device's "remove this file" with a function that quietly does nothing for an
 * address where nothing is. The device does not behave so. The app removes through expo-file-system/legacy
 * deleteAsync (services/ExpoBackupFileIO.ts: remove). On iOS that call first checks that the file's folder may be
 * written (node_modules/expo-file-system/ios/Legacy/FileSystemLegacyModule.swift, deleteAsync:
 * `try ensurePathPermission(appContext, path: url.appendingPathComponent("..").path, flag: .write)`), and
 * node_modules/expo-modules-core/ios/FileSystemUtilities/FileSystemManager.swift getPathPermissions gives a path
 * outside the app's present documents / caches / application-support folders only what FileManager says of it:
 * a folder that is no longer there is not writable, so the call THROWS ("File '...' is not writable"). Only then
 * does it remove (FileSystemHelpers.swift removeFile: nothing there is not an error when "idempotent" is asked).
 * The Android module refuses the same way ("Location '...' isn't deletable.").
 *
 * So, after the app's folder has moved, removing at the old address throws. The code tried the old address first
 * and the address under the present folders second, inside one try: the throw ended the loop, the present address
 * was never tried, the file stayed, and the list kept the entry for every later start.
 */
import { createRestoredMediaLedger, RESTORED_MEDIA_LEDGER_KEY } from '../../services/RestoredMediaLedger';

const OLD = 'file:///var/mobile/Containers/Data/Application/11111111-OLD/';
const NOW = 'file:///var/mobile/Containers/Data/Application/22222222-NOW/';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
  };
}

/** expo-file-system/legacy deleteAsync(uri, { idempotent: true }) as the iOS module is written (see the header). */
function deviceRemove(files: Set<string>, appFolders: readonly string[], calls: string[]) {
  return async (uri: string) => {
    calls.push(uri);
    const parent = uri.slice(0, uri.lastIndexOf('/') + 1);
    const insideApp = appFolders.some(folder => parent.startsWith(folder));
    // Outside the app's present folders the parent must exist and be writable; a folder that moved away is neither.
    const parentExists = [...files].some(file => file.startsWith(parent));
    if (!insideApp && !parentExists) throw new Error(`File '${parent}..' is not writable`);
    files.delete(uri); // idempotent: nothing there is not an error
  };
}

describe('Y3 (6b) on the device: a held restore, the folder moves, the restore is rolled back', () => {
  const placed = ['Documents/photos/p-aaaa1111-site.jpg', 'Documents/reference-documents/d-bbbb2222-plan.pdf', 'Library/Caches/owned/c-cccc3333-spec.pdf'];

  async function run(remove: 'as the fixer\'s test stands in for it' | 'as the device does it') {
    const storage = memoryStorage();
    // Start 1: a restore places three files and ends "Restore recovery required".
    const filesAtStart1 = new Set(placed.map(file => OLD + file));
    const first = createRestoredMediaLedger({
      storage, createId: () => 'restore-1', removeFile: async uri => { filesAtStart1.delete(uri); },
      appFolders: [`${OLD}Documents/`, `${OLD}Library/Caches/`],
    });
    await (await first.track([...filesAtStart1])).settle('recovery_required');
    expect(storage.values.has(RESTORED_MEDIA_LEDGER_KEY)).toBe(true);

    // An iOS update moves the app's folder. The restore is then rolled back: no saved record names its files.
    const files = new Set(placed.map(file => NOW + file));
    const folders = [`${NOW}Documents/`, `${NOW}Library/Caches/`];
    const calls: string[] = [];
    const second = createRestoredMediaLedger({
      storage, createId: () => 'restore-2', appFolders: folders,
      removeFile: remove === 'as the device does it' ? deviceRemove(files, folders, calls) : async uri => { calls.push(uri); files.delete(uri); },
    });
    await second.settlePending();
    return { left: [...files], listed: storage.values.has(RESTORED_MEDIA_LEDGER_KEY), calls };
  }

  it('control: with a "remove" that does nothing for an address where nothing is (the fixer\'s stand-in), no file is left', async () => {
    const result = await run('as the fixer\'s test stands in for it');
    expect(result.left).toEqual([]);
    expect(result.listed).toBe(false);
  });

  it('with the device\'s own "remove", which refuses an address outside the app\'s present folders: no file is left, and the list is cleared', async () => {
    const result = await run('as the device does it');
    // FAILS on d0b60c7: all three files are left, the list still holds them, and the present address was never tried.
    expect(result.calls.filter(uri => uri.startsWith(NOW))).toHaveLength(3);
    expect(result.left).toEqual([]);
    expect(result.listed).toBe(false);
  });
});

describe('review pass 1, sync F1: each address on its own, and the safety rule as it was', () => {
  const NAME = 'p-dddd4444-site.jpg';
  const ledgerKey = RESTORED_MEDIA_LEDGER_KEY;

  /** A restore at the old folder ends "recovery required"; the folder then moves, and the next start settles. */
  async function heldThenMoved(options: {
    placed: string[];
    filesNow: string[];
    savedValue?: string;
    remove?: (files: Set<string>, folders: readonly string[], calls: string[]) => (uri: string) => Promise<void>;
    foldersNow?: readonly string[];
  }) {
    const storage = memoryStorage();
    const first = createRestoredMediaLedger({
      storage, createId: () => 'restore-1', removeFile: async () => undefined,
      appFolders: [`${OLD}Documents/`, `${OLD}Library/Caches/`],
    });
    await (await first.track(options.placed)).settle('recovery_required');
    if (options.savedValue) storage.values.set('projectPhotoUpdate.savedUpdates.v1', options.savedValue);
    const files = new Set(options.filesNow);
    const folders = options.foldersNow ?? [`${NOW}Documents/`, `${NOW}Library/Caches/`];
    const calls: string[] = [];
    const second = createRestoredMediaLedger({
      storage, createId: () => 'restore-2', appFolders: folders,
      removeFile: (options.remove ?? deviceRemove)(files, folders, calls),
    });
    await second.settlePending();
    return { left: [...files], listed: storage.values.get(ledgerKey) ?? null, calls };
  }

  it('the file is removed at its present address though the device refuses the old one, and both were asked for, in that order', async () => {
    const result = await heldThenMoved({ placed: [`${OLD}Documents/photos/${NAME}`], filesNow: [`${NOW}Documents/photos/${NAME}`] });
    expect(result.calls).toEqual([`${OLD}Documents/photos/${NAME}`, `${NOW}Documents/photos/${NAME}`]);
    expect(result.left).toEqual([]);
    expect(result.listed).toBeNull();
  });

  it('a file a saved value still names is not removed and not even asked for, by either address', async () => {
    const result = await heldThenMoved({
      placed: [`${OLD}Documents/photos/${NAME}`, `${OLD}Documents/photos/p-eeee5555-gone.jpg`],
      filesNow: [`${NOW}Documents/photos/${NAME}`, `${NOW}Documents/photos/p-eeee5555-gone.jpg`],
      savedValue: JSON.stringify([{ id: 'update-1', photos: [{ uri: `${OLD}Documents/photos/${NAME}` }] }]),
    });
    expect(result.calls.filter(uri => uri.endsWith(NAME))).toEqual([]);
    expect(result.left).toEqual([`${NOW}Documents/photos/${NAME}`]);
    expect(result.listed).toBeNull(); // settled: the named one is kept for good, the other removed
  });

  it('the device cannot remove the file at its PRESENT address (a real failure): it stays written down for the next start', async () => {
    const refusingNow = (files: Set<string>, folders: readonly string[], calls: string[]) => async (uri: string) => {
      calls.push(uri);
      if (uri.startsWith(NOW)) throw new Error(`File '${uri}' could not be deleted`);
      await deviceRemove(files, folders, [])(uri);
    };
    const result = await heldThenMoved({ placed: [`${OLD}Documents/photos/${NAME}`], filesNow: [`${NOW}Documents/photos/${NAME}`], remove: refusingNow });
    expect(result.calls).toEqual([`${OLD}Documents/photos/${NAME}`, `${NOW}Documents/photos/${NAME}`]);
    expect(result.left).toEqual([`${NOW}Documents/photos/${NAME}`]);
    expect(JSON.parse(result.listed ?? '[]')).toEqual([{ id: 'restore-1', uris: [`${OLD}Documents/photos/${NAME}`] }]);
  });

  it('a file with one address only (the app does not know its folders): a refusal there is still a failure, and it stays written down', async () => {
    const result = await heldThenMoved({ placed: [`${OLD}Documents/photos/${NAME}`], filesNow: [`${NOW}Documents/photos/${NAME}`], foldersNow: [] });
    expect(result.calls).toEqual([`${OLD}Documents/photos/${NAME}`]);
    expect(result.left).toEqual([`${NOW}Documents/photos/${NAME}`]);
    expect(JSON.parse(result.listed ?? '[]')).toEqual([{ id: 'restore-1', uris: [`${OLD}Documents/photos/${NAME}`] }]);
  });

  it('the folder has not moved: one address, removed once, as before', async () => {
    const storage = memoryStorage();
    const files = new Set([`${NOW}Documents/photos/${NAME}`]);
    const folders = [`${NOW}Documents/`, `${NOW}Library/Caches/`];
    const calls: string[] = [];
    const ledger = () => createRestoredMediaLedger({ storage, createId: () => 'restore-1', appFolders: folders, removeFile: deviceRemove(files, folders, calls) });
    await (await ledger().track([...files])).settle('recovery_required');
    await ledger().settlePending();
    expect(calls).toEqual([`${NOW}Documents/photos/${NAME}`]);
    expect([...files]).toEqual([]);
    expect(storage.values.has(ledgerKey)).toBe(false);
  });

  it('a restore rolled back at once (same start): only the address it was placed at is asked for, and a refusal keeps it written down', async () => {
    const storage = memoryStorage();
    const calls: string[] = [];
    const ledger = createRestoredMediaLedger({
      storage, createId: () => 'restore-1', appFolders: [`${NOW}Documents/`],
      removeFile: async uri => { calls.push(uri); throw new Error('not now'); },
    });
    await (await ledger.track([`${NOW}Documents/photos/${NAME}`])).settle('aborted');
    expect(calls).toEqual([`${NOW}Documents/photos/${NAME}`]);
    expect(JSON.parse(storage.values.get(ledgerKey) ?? '[]')).toEqual([{ id: 'restore-1', uris: [`${NOW}Documents/photos/${NAME}`] }]);
  });
});
