/**
 * Independent review R01 (Build 229): the photo and document files a device
 * backup restore placed were removed whenever the restore did not report
 * success. A restore whose records were partly written, and whose automatic
 * recovery also failed, keeps a journal that finishes the restore at the next
 * start: the finished records then pointed at files that had been deleted.
 *
 * The files a restore places are written down here before its records are
 * committed, and the restore then says how it ended:
 *
 *   committed          the records are on the device: the files stay.
 *   aborted            nothing was written: the files are removed.
 *   recovery_required  the records may still be written: the files stay, and
 *                      stay written down.
 *
 * What is still written down is settled after the restore journal has been
 * recovered (at the next start, or Retry Recovery): a file that a saved record
 * names stays; a file that nothing on the device names is removed. So a
 * restore that finishes later keeps its files, and one that never happened
 * does not leave them behind for good. The same settles a restore the app was
 * closed in the middle of.
 *
 * Independent review pass 2 (L8, L9b):
 * - A list that cannot be read never stops a restore and never removes a
 *   file. What of it can be read is kept; the rest is dropped, and the files
 *   it named simply stay (left behind, never lost). The next write of the
 *   list puts a readable one in its place.
 * - Nothing waiting is settled while a restore is under way: its records are
 *   about to replace the ones the files are checked against. When that
 *   restore has been committed, what waited is settled then, so the files of
 *   an earlier restore that it replaced are not left behind for good.
 *
 * Sync batch Y3, item 6 (b): the app's folder can move between two starts (an
 * iOS update does this). The list keeps each file's address as it was when
 * the file was placed. A held restore that was then rolled back had its
 * files removed at that old address, where nothing is any more: the removal
 * "worked", the list was cleared, and the files stayed for good under the new
 * address (left behind, never lost). A file nothing names is now removed
 * where it was placed AND where the same file sits under the app's folders
 * as they are now: the part of its address inside the folder is the same.
 */
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

export const RESTORED_MEDIA_LEDGER_KEY = 'projectPhotoUpdate.restoredMediaLedger.v1';

/** How a restore ended, for the files it placed. */
export type RestoredMediaOutcome = 'committed' | 'aborted' | 'recovery_required';

export type RestoredMediaLedgerStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  getAllKeys: () => Promise<readonly string[]>;
}>;

export type RestoredMediaClaim = Readonly<{
  /** Say how the restore ended. Only the first call counts. */
  settle: (outcome: RestoredMediaOutcome) => Promise<void>;
}>;

export type RestoredMediaLedger = Readonly<{
  /** Write down the files a restore placed, before its records are committed. */
  track: (uris: readonly string[]) => Promise<RestoredMediaClaim>;
  /**
   * Settle what is still written down from a restore that did not say how it
   * ended. Call only when no restore journal is waiting. Never rejects.
   */
  settlePending: () => Promise<void>;
}>;

type LedgerEntry = { id: string; uris: string[] };

/** A file name shorter than this is not treated as proof of anything: its file is kept. */
const MINIMUM_FILE_NAME_LENGTH = 8;

export function createRestoredMediaLedger({
  storage,
  removeFile,
  createId,
  priorityKeys = [],
  appFolders = [],
}: Readonly<{
  storage: RestoredMediaLedgerStorage;
  removeFile: (uri: string) => Promise<void>;
  createId: () => string;
  /** Read first when looking for a file's name: where a restore's records are kept. */
  priorityKeys?: readonly string[];
  /** The app's own folders as they are now (its documents folder, its caches folder): see restoredFileAddresses. */
  appFolders?: readonly (string | null | undefined)[];
}>): RestoredMediaLedger {
  const active = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };

  /** The list as far as it can be read; `damaged` when some of the stored value could not be. */
  const readList = async (): Promise<{ entries: LedgerEntry[]; damaged: boolean }> => {
    const raw = await storage.getItem(RESTORED_MEDIA_LEDGER_KEY);
    return raw === null ? { entries: [], damaged: false } : readableEntries(raw);
  };
  const readEntries = async (): Promise<LedgerEntry[]> => (await readList()).entries;

  const writeEntries = async (entries: readonly LedgerEntry[]) => {
    if (entries.length === 0) {
      await storage.removeItem(RESTORED_MEDIA_LEDGER_KEY);
      if (await storage.getItem(RESTORED_MEDIA_LEDGER_KEY) !== null) {
        throw new Error('The restored file list could not be cleared.');
      }
      return;
    }
    const raw = JSON.stringify(entries);
    await storage.setItem(RESTORED_MEDIA_LEDGER_KEY, raw);
    if (await storage.getItem(RESTORED_MEDIA_LEDGER_KEY) !== raw) {
      throw new Error('The restored file list could not be saved.');
    }
  };

  /**
   * Remove the files; the ones that could not be removed are returned, under the address they were placed at.
   * `whereverTheyAreNow`: also under the app's folders as they are now, for a list settled at a later start.
   */
  const removeFiles = async (uris: readonly string[], whereverTheyAreNow = false): Promise<string[]> => {
    const left: string[] = [];
    for (const uri of uris) {
      try {
        for (const address of whereverTheyAreNow ? restoredFileAddresses(uri, appFolders) : [uri]) await removeFile(address);
      } catch {
        left.push(uri);
      }
    }
    return left;
  };

  const forget = (id: string, left: readonly string[] = []) => serialize(async () => {
    const entries = await readEntries();
    await writeEntries(entries.flatMap(entry => entry.id !== id
      ? [entry]
      : left.length > 0 ? [{ id, uris: [...left] }] : []));
  });

  const track = async (uris: readonly string[]): Promise<RestoredMediaClaim> => {
    const files = [...new Set(uris.filter(uri => typeof uri === 'string' && uri.trim()))];
    // A restore that placed no file has nothing to keep or to remove.
    if (files.length === 0) return Object.freeze({ settle: async () => undefined });

    const id = createId();
    active.add(id);
    try {
      await serialize(async () => writeEntries([...(await readEntries()), { id, uris: files }]));
    } catch (cause) {
      active.delete(id);
      // Only when this device's storage would not read or keep the list (a list that is merely unreadable is replaced).
      const error = new Error(
        'The restore could not record the files it placed on this device, so nothing was changed. Try again. If it keeps happening, free some storage on this device.',
      );
      (error as Error & { cause?: unknown }).cause = cause;
      throw error;
    }

    let settled = false;
    return Object.freeze({
      settle: async (outcome: RestoredMediaOutcome) => {
        if (settled) return;
        settled = true;
        try {
          if (outcome === 'recovery_required') return;
          // A list that cannot be cleared now is settled later, by what the saved records name.
          const left = outcome === 'aborted' ? await removeFiles(files) : [];
          await forget(id, left).catch(() => undefined);
        } finally {
          active.delete(id);
        }
        // This restore's records are on the device and its journal is finished: what waited from an earlier restore
        // (one held for recovery, then replaced by this one without a restart) is settled now (review pass 2, L9b).
        // The records are held still while the saved values are read, as they are when the app starts.
        if (outcome === 'committed') {
          await runExclusiveLocalStorageMutation([RESTORED_MEDIA_LEDGER_KEY, ...priorityKeys], settlePending).catch(() => undefined);
        }
      },
    });
  };

  const settlePending = () => serialize(async () => {
    try {
      // While a restore is under way nothing is settled (review pass 2, L9b): its own files are not named by any
      // record yet, and the records the waiting files would be checked against are about to be replaced by it.
      if (active.size > 0) return;
      const { entries, damaged } = await readList();
      const underWay: LedgerEntry[] = [];
      const waiting: LedgerEntry[] = [];
      entries.forEach(entry => (active.has(entry.id) ? underWay : waiting).push(entry));
      // A stored value that could not be read (wholly or in part) is replaced by what could (review pass 2, L8).
      if (waiting.length === 0) {
        if (damaged) await writeEntries(underWay);
        return;
      }

      const named = await fileNamesInStorage(
        storage,
        priorityKeys,
        waiting.flatMap(entry => entry.uris.map(fileNameOf)),
      );
      const next = [...underWay];
      for (const entry of waiting) {
        const unnamed = entry.uris.filter(uri => {
          const name = fileNameOf(uri);
          return isSearchableFileName(name) && !named.has(name);
        });
        const left = await removeFiles(unnamed, true);
        if (left.length > 0) next.push({ id: entry.id, uris: left });
      }
      await writeEntries(next);
    } catch {
      // What could not be read or settled now stays written down, with its files, for the next start.
    }
  });

  return Object.freeze({ track, settlePending });
}

/**
 * The entries of a stored list that can be read (independent review pass 2,
 * L8). A value that is not a list at all (half written, `null`, `{}`, empty)
 * has none; an entry of the wrong shape is left out. Nothing is ever removed
 * for what could not be read: the files it named stay on the device.
 */
function readableEntries(raw: string): { entries: LedgerEntry[]; damaged: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], damaged: true };
  }
  if (!Array.isArray(parsed)) return { entries: [], damaged: true };
  const entries = parsed.flatMap(value => {
    const entry = value as Partial<LedgerEntry> | null;
    return entry && typeof entry.id === 'string' && entry.id &&
      Array.isArray(entry.uris) && entry.uris.every(uri => typeof uri === 'string')
      ? [{ id: entry.id, uris: [...entry.uris] }]
      : [];
  });
  return { entries, damaged: entries.length !== parsed.length };
}

/** The file's own name: the part of its address that stays the same when the app's folder moves. */
export function fileNameOf(uri: string): string {
  const path = uri.split(/[?#]/)[0].replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Where a placed file may be now: the address it was placed at, and the same file under each of the app's folders
 * as they are now. The folder's own name ("Documents", "Caches") is found in the old address, and what follows it
 * is put under the folder as it is today. An address that does not pass through a folder of that name has only
 * itself. With the app's folder where it was, both are the same address, once.
 */
export function restoredFileAddresses(uri: string, appFolders: readonly (string | null | undefined)[]): string[] {
  const addresses = [uri];
  for (const folder of appFolders) {
    const root = typeof folder === 'string' ? folder.replace(/\/+$/, '') : '';
    const name = root.slice(root.lastIndexOf('/') + 1);
    const inside = name ? uri.indexOf(`/${name}/`) : -1;
    if (inside < 0) continue;
    const now = `${root}/${uri.slice(inside + name.length + 2)}`;
    // Only ever the same file: never the folder itself, whatever the old address looked like.
    if (!fileNameOf(uri) || fileNameOf(now) !== fileNameOf(uri) || now.endsWith('/')) continue;
    if (!addresses.includes(now)) addresses.push(now);
  }
  return addresses;
}

/**
 * A name that reads the same inside saved JSON as it does in the file's
 * address, and is long enough to be one file's alone. A file whose name is
 * not is kept: its absence from the saved records could not be trusted.
 */
function isSearchableFileName(name: string): boolean {
  return name.length >= MINIMUM_FILE_NAME_LENGTH && JSON.stringify(name) === `"${name}"`;
}

/**
 * Which of the file names appear anywhere in what the device has saved. Every
 * saved value is read, not only the restore's own records: a restored photo
 * may since have been moved to a kept draft or a waiting upload.
 */
async function fileNamesInStorage(
  storage: RestoredMediaLedgerStorage,
  priorityKeys: readonly string[],
  fileNames: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(fileNames.filter(isSearchableFileName))];
  const found = new Set<string>();
  if (wanted.length === 0) return found;

  const search = createNameSearch(wanted);
  const keys = [...new Set([...priorityKeys, ...(await storage.getAllKeys())])]
    .filter(key => key !== RESTORED_MEDIA_LEDGER_KEY);
  for (const key of keys) {
    if (found.size === wanted.length) break;
    const value = await storage.getItem(key);
    if (value) search(value, found);
  }
  return found;
}

/**
 * Finds every wanted name inside a text in one pass over the text, however
 * many names there are (a restore can place hundreds of files, and the saved
 * values run to megabytes). A rolling hash of the names' first characters
 * picks the places worth comparing; each is then compared in full, so the
 * answer is exactly `text.includes(name)` for every name.
 */
export function createNameSearch(names: readonly string[]): (text: string, found: Set<string>) => void {
  const width = Math.min(...names.map(name => name.length));
  const byHash = new Map<number, string[]>();
  const maybe = new Uint8Array(1 << 16);
  const hashOf = (text: string, start: number) => {
    let hash = 0;
    for (let index = start; index < start + width; index += 1) {
      hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
    }
    return hash;
  };
  names.forEach(name => {
    const hash = hashOf(name, 0);
    byHash.set(hash, [...(byHash.get(hash) || []), name]);
    maybe[hash & 0xffff] = 1;
  });
  // 31 to the power (width - 1): what the character leaving the window was multiplied by.
  let leading = 1;
  for (let index = 1; index < width; index += 1) leading = Math.imul(leading, 31);

  return (text, found) => {
    if (text.length < width) return;
    let hash = hashOf(text, 0);
    for (let start = 0; ; start += 1) {
      if (maybe[hash & 0xffff] === 1) {
        byHash.get(hash)?.forEach(name => {
          if (!found.has(name) && text.startsWith(name, start)) found.add(name);
        });
      }
      if (start + width >= text.length) return;
      hash = (Math.imul(hash - Math.imul(text.charCodeAt(start), leading), 31) + text.charCodeAt(start + width)) | 0;
    }
  };
}
