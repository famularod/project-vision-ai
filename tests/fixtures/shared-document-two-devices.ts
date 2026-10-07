/**
 * Two devices and a stand-in for the cloud's shared-document table, for the
 * archived mark (owner answer Q44, 6 Oct 2026). It is the independent
 * reviewer's rig (review P5, pass 1, of D1), kept as he wrote it, with two
 * additions the fixes need: the stand-in understands "where the mark is
 * empty" (the guard on a waiting tap's write), and it can be asked for one
 * document's row. Nothing here reaches the network.
 *
 * Each device has its own storage and its own copy of
 * services/SharedDocumentArchive.ts. The stand-in answers the way the data
 * API answers: a refused request is an answer with an error in it, not a
 * thrown error, and no signal is an answer whose error says the request
 * failed.
 *
 * A test file that uses this must mock the device storage first, with the
 * maps below:
 *
 *   jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/shared-document-two-devices').mockDeviceStorageModule());
 */
export type Archive = typeof import('../../services/SharedDocumentArchive');
export type DeviceName = 'phone' | 'ipad';
type Row = { id: string; owner_id: string; archived_at: string | null };
type Answer = { data: unknown; error: { code: string; message: string } | null; status: number };

// Kept on the test's global object: each device's copy of the service is loaded in its own module registry, which
// loads its own copy of this file too, and all of them must see the same two storages.
type Shared = { storage: Record<DeviceName, Map<string, string>>; starting: { device: DeviceName } };
const shared: Shared = ((globalThis as { __sharedDocumentTwoDevices?: Shared }).__sharedDocumentTwoDevices ??= {
  storage: { phone: new Map(), ipad: new Map() }, starting: { device: 'phone' },
});
export const deviceStorage = shared.storage;
const starting = shared.starting;

/** The storage module a device's copy of the service is given when it starts: that device's own map. */
export function mockDeviceStorageModule() {
  const storage = deviceStorage[starting.device];
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => storage.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => { storage.set(key, value); }),
      removeItem: jest.fn(async (key: string) => { storage.delete(key); }),
    },
  };
}

export function createCloud() {
  const rows: Row[] = [];
  const state = {
    /** Whether the owner has pasted the database change. */
    installed: true,
    offline: { phone: false, ipad: false } as Record<DeviceName, boolean>,
    /** The next writes of the mark are answered with this error (a refusal that is not "no such column"). */
    failWritesWith: null as { code: string; message: string } | null,
    /** Writes of the mark are held until release(). */
    holdWrites: false,
    held: [] as Array<() => void>,
    signedIn: { phone: 'owner-a', ipad: 'owner-a' } as Record<DeviceName, string>,
  };
  /** Every write of the mark the cloud was sent, and what it did with it. */
  const writes: Array<{ device: DeviceName; id: unknown; archived_at: unknown; changed: number }> = [];
  /** Every question put to the table. */
  const reads: Array<{ device: DeviceName; id: unknown }> = [];
  const noSignal = (): Answer => ({ data: null, error: { code: '', message: 'TypeError: Network request failed' }, status: 0 });

  function clientFor(device: DeviceName) {
    function query() {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Record<string, unknown> | null = null;
      let idFilter: unknown = null;
      const run = async (): Promise<Answer> => {
        if (patch && state.holdWrites) await new Promise<void>(resolve => { state.held.push(resolve); });
        if (state.offline[device]) return noSignal();
        if (!state.installed) {
          return patch
            ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'archived_at' column of 'reference_documents' in the schema cache" }, status: 400 }
            : { data: null, error: { code: '42703', message: 'column reference_documents.archived_at does not exist' }, status: 400 };
        }
        const visible = rows.filter(row => row.owner_id === state.signedIn[device] && filters.every(filter => filter(row)));
        if (patch) {
          if (state.failWritesWith) {
            writes.push({ device, id: idFilter, archived_at: patch.archived_at, changed: 0 });
            return { data: null, error: state.failWritesWith, status: 503 };
          }
          writes.push({ device, id: idFilter, archived_at: patch.archived_at, changed: visible.length });
          visible.forEach(row => { row.archived_at = (patch as { archived_at: string | null }).archived_at; });
          return { data: visible.map(row => ({ id: row.id })), error: null, status: 200 };
        }
        reads.push({ device, id: idFilter });
        return { data: visible.map(row => ({ id: row.id, archived_at: row.archived_at })), error: null, status: 200 };
      };
      const chain: Record<string, unknown> = {
        select() { return chain; },
        eq(column: keyof Row, value: unknown) { if (column === 'id') idFilter = value; filters.push(row => row[column] === value); return chain; },
        not(column: keyof Row, operator: string, value: unknown) {
          if (operator === 'is' && value === null) filters.push(row => row[column] !== null && row[column] !== undefined);
          return chain;
        },
        /** "where the column is empty": the guard on a waiting tap's write. */
        is(column: keyof Row, value: unknown) {
          if (value === null) filters.push(row => row[column] === null || row[column] === undefined);
          return chain;
        },
        update(values: Record<string, unknown>) { patch = values; return chain; },
        then(resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) { return run().then(resolve, reject); },
      };
      return chain;
    }
    return {
      from: () => query(),
      auth: { getSession: async () => ({ data: { session: { user: { id: state.signedIn[device] } } } }) },
    };
  }
  return {
    rows, state, writes, reads, clientFor,
    add(id: string, ownerId = 'owner-a') { rows.push({ id, owner_id: ownerId, archived_at: null }); },
    row(id: string) { return rows.find(row => row.id === id) ?? null; },
    remove(id: string) { const at = rows.findIndex(row => row.id === id); if (at >= 0) rows.splice(at, 1); },
    release() { state.holdWrites = false; state.held.splice(0).forEach(resolve => resolve()); },
  };
}
export type Cloud = ReturnType<typeof createCloud>;

/** A device opens the app: its own storage, its own copy of the service. */
export async function start(name: DeviceName, ownerId = 'owner-a'): Promise<Archive> {
  let archive!: Archive;
  starting.device = name;
  jest.isolateModules(() => { archive = require('../../services/SharedDocumentArchive'); });
  await archive.openSharedDocumentArchive(ownerId);
  return archive;
}

export const sync = (archive: Archive, cloud: Cloud, name: DeviceName, ownerId = 'owner-a', more: Record<string, unknown> = {}) =>
  archive.syncSharedDocumentArchiveWithCloud({ client: cloud.clientFor(name) as never, ownerId, timeoutMs: 150, ...more });
export const hiddenOn = (archive: Archive) => [...archive.sharedDocumentArchiveView().archivedIds].sort();
export const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));

export function resetDevices() {
  deviceStorage.phone.clear();
  deviceStorage.ipad.clear();
}
