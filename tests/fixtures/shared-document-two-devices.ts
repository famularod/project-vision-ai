/**
 * Two devices and a stand-in for the cloud's shared-document table, for the
 * archived mark (owner answer Q44, 6 Oct 2026). It is the independent
 * reviewer's rig (review P5 of D1, passes 1 and 2), kept as he wrote it.
 * Nothing here reaches the network.
 *
 * Each device has its own storage and its own copy of
 * services/SharedDocumentArchive.ts. The stand-in answers the way the data
 * API answers: a refused request is an answer with an error in it, not a
 * thrown error, and no signal is an answer whose error says the request
 * failed. Since his second pass it is stricter, the way the real cloud is:
 *   - it gives a mark back the way the data API writes a time
 *     ("2026-10-06T18:00:00.5+00:00"), not the way the device wrote it;
 *   - "where the mark equals" compares moments, as the database does;
 *   - a write can land while its answer is lost on the way back.
 * It understands "where the mark is empty" (the condition on a waiting
 * tap's write) and can be asked for one document's row.
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

/** A time as the data API prints it: no trailing zeros in the fraction, and "+00:00". */
export function apiTime(iso: string): string {
  const date = new Date(iso);
  const ms = date.getUTCMilliseconds();
  const fraction = ms ? `.${String(ms).padStart(3, '0').replace(/0+$/, '')}` : '';
  return `${date.toISOString().slice(0, 19)}${fraction}+00:00`;
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
    /** The next write lands and its answer is lost on the way back. */
    loseNextWriteAnswer: false,
    held: [] as Array<() => void>,
    signedIn: { phone: 'owner-a', ipad: 'owner-a' } as Record<DeviceName, string>,
  };
  /** Every write of the mark the cloud was sent, and what it did with it. */
  const writes: Array<{ device: DeviceName; id: unknown; archived_at: unknown; changed: number }> = [];
  /** Every question put to the table. */
  const reads: Array<{ device: DeviceName; id: unknown }> = [];
  const noSignal = (): Answer => ({ data: null, error: { code: '', message: 'TypeError: Network request failed' }, status: 0 });
  const sameMoment = (one: unknown, other: unknown) => typeof one === 'string' && typeof other === 'string' && Date.parse(one) === Date.parse(other);

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
          if (state.loseNextWriteAnswer) { state.loseNextWriteAnswer = false; return noSignal(); }
          return { data: visible.map(row => ({ id: row.id })), error: null, status: 200 };
        }
        reads.push({ device, id: idFilter });
        return { data: visible.map(row => ({ id: row.id, archived_at: row.archived_at === null ? null : apiTime(row.archived_at) })), error: null, status: 200 };
      };
      const chain: Record<string, unknown> = {
        select() { return chain; },
        eq(column: keyof Row, value: unknown) {
          if (column === 'id') idFilter = value;
          filters.push(row => (column === 'archived_at' ? sameMoment(row.archived_at, value) : row[column] === value));
          return chain;
        },
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

/**
 * The reviewer's random sequences on two devices (his second pass), step for
 * step and seed for seed. The owner's taps are numbered in the order he made
 * them. Each device only offers the tap its own screen would offer (Archive
 * on the phone, which holds the card, when it lists the document; Restore
 * where "Archived (n)" lists it). Each device has had an answer from the
 * cloud before the first tap (a tap before that is the device's own: the
 * coordinator's decision on L9).
 *
 * `clockOffsetMinutes`: how far each device's clock is from the true time.
 * A tap's time is taken from the device that made it.
 *
 * What comes back:
 * - `differs`: the documents that did not end as his LAST TAP (by the true
 *   order) left them, each with whether a line told him, and on which device;
 * - `endState`: how it ended, with nothing in it that is a device's clock
 *   (the marks' own times are left out): the steps taken, what the cloud and
 *   each device hold, the lines shown, what still waits, and every write the
 *   cloud was sent, in order.
 */
export function randomTapSource(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

export async function runRandomTaps(seed: number, options: { signalDrops: boolean; clockOffsetMinutes?: Partial<Record<DeviceName, number>> }) {
  resetDevices();
  const world = createCloud();
  const docs = ['doc-1', 'doc-2'];
  docs.forEach(id => world.add(id));
  const next = randomTapSource(seed);
  const devices: Record<DeviceName, Archive> = { phone: await start('phone'), ipad: await start('ipad') };
  /** The phone's own cards (the iPad has none): archived? */
  const card: Record<string, boolean> = { 'doc-1': false, 'doc-2': false };
  const lastTap: Record<string, { tap: 'archive' | 'restore'; on: DeviceName } | null> = { 'doc-1': null, 'doc-2': null };
  const log: string[] = [];
  let trueClock = Date.parse('2026-10-06T08:00:00.000Z');
  const tapTime = (name: DeviceName) => new Date((trueClock += 60_000) + (options.clockOffsetMinutes?.[name] ?? 0) * 60_000).toISOString();

  const heard = async (name: DeviceName) => {
    // What the hook does with what the device has learned.
    const view = devices[name].sharedDocumentArchiveView();
    if (name === 'phone') {
      view.restoredElsewhere.forEach(id => { if (id in card) card[id] = false; }); // the card is put back
      docs.forEach(id => { if (devices.phone.sharedDocumentArchiveView().archivedIds.has(id)) card[id] = true; }); // and cards follow the mark
    }
    if (view.restoredElsewhere.length) await devices[name].consumeSharedDocumentsRestoredElsewhere(view.restoredElsewhere);
  };
  const reach = async (name: DeviceName) => {
    if (world.state.offline[name]) return;
    await sync(devices[name], world, name);
    await heard(name);
  };
  const archivedOn = (name: DeviceName, id: string) =>
    devices[name].sharedDocumentArchiveView().archivedIds.has(id) || (name === 'phone' && card[id]);

  await reach('phone');
  await reach('ipad');
  for (let step = 0; step < 14; step += 1) {
    const name: DeviceName = next() < 0.5 ? 'phone' : 'ipad';
    const id = docs[Math.floor(next() * docs.length)];
    const roll = next();
    if (options.signalDrops && roll < 0.25) {
      world.state.offline[name] = !world.state.offline[name];
      log.push(`${name} ${world.state.offline[name] ? 'loses signal' : 'has signal again'}`);
      await reach(name);
    } else if (roll < 0.4) {
      await devices[name].sharedDocumentArchiveSettled();
      devices[name] = await start(name);
      log.push(`${name} is closed and opened`);
      await reach(name);
    } else if (archivedOn(name, id)) {
      if (name === 'phone') card[id] = false;
      await devices[name].requestSharedDocumentArchive(id, false, tapTime(name));
      lastTap[id] = { tap: 'restore', on: name };
      log.push(`${name} Restore ${id}`);
      await reach(name);
    } else if (name === 'phone') {
      card[id] = true;
      await devices[name].requestSharedDocumentArchive(id, true, tapTime(name));
      lastTap[id] = { tap: 'archive', on: name };
      log.push(`phone Archive ${id}`);
      await reach(name);
    } else {
      log.push('ipad opens Documents');
      await reach(name);
    }
  }
  // Everything has signal again and each device is opened three times.
  world.state.offline.phone = false;
  world.state.offline.ipad = false;
  for (const name of ['phone', 'ipad', 'phone', 'ipad', 'phone', 'ipad'] as const) await reach(name);
  await devices.phone.sharedDocumentArchiveSettled();
  await devices.ipad.sharedDocumentArchiveSettled();

  const linesOn = (name: DeviceName) => devices[name].sharedDocumentArchiveView().notices;
  const differs = docs.flatMap(id => {
    const last = lastTap[id];
    if (last === null) return [];
    const want = last.tap === 'archive';
    const got = { cloud: Boolean(world.row(id)?.archived_at), phone: archivedOn('phone', id), ipad: archivedOn('ipad', id) };
    if (got.cloud === want && got.phone === want && got.ipad === want) return [];
    const told = [...linesOn('phone'), ...linesOn('ipad')].some(notice => notice.documentId === id);
    // The line that matters is the one on the device whose tap did not take effect, about that tap.
    const toldWhereHeTapped = linesOn(last.on).some(notice => notice.documentId === id && notice.tap === last.tap);
    return [{
      id, told, toldWhereHeTapped,
      text: `${id}: his last tap was ${last.tap} on the ${last.on}; cloud archived=${got.cloud}, phone hides it=${got.phone}, iPad hides it=${got.ipad}${told ? ' (a line told him)' : ' (NO line told him)'}`,
    }];
  });
  const waitingOn = (name: DeviceName) => {
    const raw = [...deviceStorage[name].values()][0];
    const list = (raw ? JSON.parse(raw).owners?.['owner-a']?.waiting ?? [] : []) as Array<{ documentId: string; archived: boolean }>;
    return list.map(item => `${item.documentId}/${item.archived ? 'archive' : 'restore'}`);
  };
  const endState = JSON.stringify({
    log,
    documents: docs.map(id => ({ id, cloud: Boolean(world.row(id)?.archived_at), phone: archivedOn('phone', id), ipad: archivedOn('ipad', id), card: card[id] })),
    lines: { phone: linesOn('phone').map(notice => `${notice.documentId}/${notice.tap}/${notice.why}`), ipad: linesOn('ipad').map(notice => `${notice.documentId}/${notice.tap}/${notice.why}`) },
    waiting: { phone: waitingOn('phone'), ipad: waitingOn('ipad') },
    writes: world.writes.map(write => `${write.device}/${write.id}/${write.archived_at === null ? 'restore' : 'archive'}/${write.changed}`),
  });
  /** Every device shows what the cloud holds, and nothing is left waiting. */
  const settled = docs.every(id => Boolean(world.row(id)?.archived_at) === archivedOn('phone', id) && archivedOn('phone', id) === archivedOn('ipad', id)) &&
    waitingOn('phone').length + waitingOn('ipad').length === 0;
  return { differs, endState, settled, log };
}
