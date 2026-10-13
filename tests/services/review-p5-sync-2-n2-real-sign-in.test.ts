/**
 * Second review of sync (review p5-sync, pass 2), finding N2, and the reviewer's own second look at G5.
 *
 * The first part of this file is the reviewer's own (notes/p5-sync/p5s2-g5-real-sign-in.test.ts), with ONE LINE
 * changed. His test of N2 ("ONE account, which once signed out while something was still finishing") first states
 * the cause, "the boundary's question answers yes", and then what should be true. The coordinator's decision removes
 * the cause: a record of data set aside while signed out is not another account. So that one line now expects "no";
 * what the test says should be true is untouched, and it fails on a00b815 as he found. The tests after his are this
 * batch's own.
 *
 * His words on the file:
 * G5 (the deletion history across a change of account), with NOTHING of the app's stood in. The only way the
 * account can change here is the way it changes on a phone:
 *   - REAL services/SupabaseService.ts with supabase-js and auth-js: a sign-out and a sign-in are the library's own,
 *     and the app hears of them through the library's own events;
 *   - REAL services/CloudOwnerBinding.ts, fed by those events only (this file never calls noteSignedInOwner);
 *   - REAL services/OwnerStorageSandbox.ts, switched by those events as entry.ts switches it;
 *   - REAL services/DAVESyncTombstones.ts.
 * Stand-ins: the phone's two stores (in memory), and the network: one deletion history per account, answered by
 * the account whose sign-in a request carries, as the cloud answers. No real account, no password, no cloud call.
 *
 * Part 2: the records an older build left on a phone, with the same real parts.
 */
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecure.delete(key); }),
}));
const mockPhone = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => mockPhone.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockPhone.set(key, value); },
    removeItem: async (key: string) => { mockPhone.delete(key); },
    getAllKeys: async () => [...mockPhone.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, mockPhone.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([k, v]) => mockPhone.set(k, v)); },
    multiRemove: async (keys: string[]) => { keys.forEach(k => mockPhone.delete(k)); },
    clear: async () => mockPhone.clear(),
  };
  return { __esModule: true, default: api, ...api };
});

type Row = { entity_type: string; record_id: string; deleted_at: string; owner_id?: string };
type Call = { method: string; path: string; signIn: string; body: string };
const cloud = {
  /** The cloud's deletion history, per account. */
  history: { 'owner-a': [] as Row[], 'owner-b': [] as Row[] } as Record<string, Row[]>,
  calls: [] as Call[],
  hold: null as ((call: Call) => boolean) | null,
  held: null as Call | null,
  answer: (() => undefined) as () => void,
  /** Every write of deletion records that reached the cloud: under whose sign-in, naming which owner, which records. */
  writes: [] as Array<{ signIn: string; names: string; records: string[] }>,
  online: true,
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const sessionFor = (owner: 'a' | 'b') => ({
  access_token: `sign-in-of-${owner}`, refresh_token: `refresh-${owner}`, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3000,
  user: {
    id: `owner-${owner}`, aud: 'authenticated', role: 'authenticated', email: `owner-${owner}@example.com`,
    app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z',
  },
});
const accountOf = (signIn: string) => (signIn === 'sign-in-of-a' ? 'owner-a' : signIn === 'sign-in-of-b' ? 'owner-b' : null);
(global as { fetch?: unknown }).fetch = jest.fn(async (input: unknown, init?: { method?: string; body?: unknown; headers?: unknown }) => {
  const request = typeof input === 'string' ? null : input as { url: string; method?: string; headers?: unknown };
  const url = new URL(String(request ? request.url : input));
  const headers = new Headers((init?.headers as never) || (request?.headers as never) || {});
  const call: Call = {
    method: init?.method || request?.method || 'GET',
    path: url.pathname + url.search,
    signIn: (headers.get('authorization') || '').replace(/^Bearer /, ''),
    body: typeof init?.body === 'string' ? init.body : '',
  };
  cloud.calls.push(call);
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  if (url.pathname === '/auth/v1/token') return json(200, sessionFor(call.body.includes('owner-a@example.com') ? 'a' : 'b'));
  if (url.pathname.startsWith('/auth/v1/')) return json(200, {});
  if (!cloud.online) throw new TypeError('Network request failed');
  // The answer is fixed as the request arrives (it is the account's whose sign-in it carries), then it may wait.
  const account = accountOf(call.signIn);
  let answer: Response;
  if (url.pathname === '/rest/v1/dave_sync_tombstones' && call.method === 'GET') {
    const rows = account ? cloud.history[account].map(({ owner_id: _owner, ...row }) => row) : [];
    answer = json(200, rows, { 'content-range': rows.length > 0 ? `0-${rows.length - 1}/${rows.length}` : '*/0' });
  } else if (url.pathname === '/rest/v1/dave_sync_tombstones') {
    const rows = JSON.parse(call.body || '[]') as Row[];
    cloud.writes.push({ signIn: call.signIn, names: [...new Set(rows.map(row => String(row.owner_id)))].join(','), records: rows.map(row => `${row.entity_type}:${row.record_id}`) });
    if (account) rows.forEach(row => { if (!cloud.history[account].some(held => held.entity_type === row.entity_type && held.record_id === row.record_id)) cloud.history[account].push(row); });
    answer = json(201, rows);
  } else if (call.method === 'GET' || call.method === 'HEAD') answer = json(200, []);
  else answer = json(200, []);
  if (cloud.hold?.(call)) {
    cloud.hold = null;
    cloud.held = call;
    await new Promise<void>(resolve => { cloud.answer = resolve; });
  }
  return answer;
});
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://isolation-p5s2g5.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'p5s2g5-anon-key-not-a-secret';
jest.setTimeout(120_000);

import * as CloudOwnerBinding from '../../services/CloudOwnerBinding';
import * as Sandbox from '../../services/OwnerStorageSandbox';
import { ownerWorkspaceAuthDecision } from '../../services/OwnerWorkspaceAuthDecision';

const Supabase = require('../../services/SupabaseService') as typeof import('../../services/SupabaseService');
const Tombstones = require('../../services/DAVESyncTombstones') as typeof import('../../services/DAVESyncTombstones');
const AsyncStorage = (require('@react-native-async-storage/async-storage') as { default: never }).default;

const LIST = Tombstones.DAVE_SYNC_TOMBSTONES_STORAGE_KEY;
const sandbox = Sandbox.createOwnerStorageSandbox({ storage: AsyncStorage });
/** The phone's storage is switched on the library's own sign-in events, one switch after another, as entry.ts does. */
let switching: Promise<unknown> = Promise.resolve();
Supabase.subscribeToAuthStateChange((event, session) => {
  const decision = ownerWorkspaceAuthDecision(event, session?.user?.id);
  if (decision.action !== 'activate') return;
  switching = switching.then(() => sandbox.activateOwner(decision.ownerId)).catch(() => undefined);
});
/** Typed into the stand-in sign-in server only; it lets anyone in. */
const STAND_IN_PASSWORD = 'stand-in, not a real password';
async function signIn(owner: 'a' | 'b') {
  expect((await Supabase.signIn({ email: `owner-${owner}@example.com`, password: STAND_IN_PASSWORD })).ok).toBe(true);
  await switching;
  expect(CloudOwnerBinding.currentCloudOwner().ownerId).toBe(`owner-${owner}`);
  expect(await sandbox.activeOwnerId()).toBe(`owner-${owner}`);
}
async function signOut() {
  expect((await Supabase.signOut('local')).ok).toBe(true);
  await switching;
  expect(await sandbox.activeOwnerId()).toBeNull();
}
const row = (kind: string, id: string, at = '2026-10-01T10:00:00.000Z'): Row => ({ entity_type: kind, record_id: id, deleted_at: at });
const record = (kind: string, id: string, at = '2026-10-01T10:00:00.000Z') => ({ entityType: kind, recordId: id, deletedAt: at });
const onPhone = () => (JSON.parse(mockPhone.get(LIST) ?? '[]') as Array<{ entityType: string; recordId: string }>).map(item => `${item.entityType}:${item.recordId}`).sort();
const inCloud = (owner: 'owner-a' | 'owner-b') => cloud.history[owner].map(item => `${item.entity_type}:${item.record_id}`).sort();
const waitFor = async (ready: () => boolean) => {
  for (let i = 0; i < 400 && !ready(); i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  expect(ready()).toBe(true);
};
const isHistoryRead = (call: Call) => call.method === 'GET' && call.path.startsWith('/rest/v1/dave_sync_tombstones');
const isHistoryWrite = (call: Call) => call.method !== 'GET' && call.path.startsWith('/rest/v1/dave_sync_tombstones');

beforeEach(async () => {
  await Supabase.signOut('local').catch(() => undefined);
  await switching;
  mockPhone.clear();
  mockSecure.clear();
  cloud.history['owner-a'] = [];
  cloud.history['owner-b'] = [];
  cloud.calls.length = 0;
  cloud.writes.length = 0;
  cloud.hold = null;
  cloud.held = null;
  cloud.online = true;
});

describe('G5 with the real sign-in: the account changes the way it changes on a phone', () => {
  it('control: one account. Its history is read, saved on the phone, and uploaded as itself', async () => {
    cloud.history['owner-a'] = [row('project', 'Lot 9'), row('schedule_item', 'task-of-a')];
    await signIn('a');
    const answer = await Tombstones.synchronizeDAVESyncTombstones();
    expect(answer.cloudAuthoritative).toBe(true);
    expect(onPhone()).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
    expect(cloud.writes.every(write => write.signIn === 'sign-in-of-a' && write.names === 'owner-a')).toBe(true);
  });

  it('A signs out and B signs in while A\'s history is being read: none of A\'s records reaches B\'s storage or B\'s cloud history, and A has them again', async () => {
    cloud.history['owner-a'] = [row('project', 'Lot 9'), row('schedule_item', 'task-of-a')];
    await signIn('a');
    cloud.hold = isHistoryRead;
    const sync = Tombstones.synchronizeDAVESyncTombstones();
    await waitFor(() => cloud.held !== null);
    expect(cloud.held!.signIn).toBe('sign-in-of-a'); // the read left as A: its answer is A's history

    await signOut();
    await signIn('b');
    cloud.answer();
    const answer = await sync;

    expect(answer.tombstones).toEqual([]);
    expect(answer.cloudAuthoritative).toBe(false);
    expect(onPhone()).toEqual([]); // B's list on the phone
    expect(cloud.writes.filter(write => write.signIn === 'sign-in-of-b')).toEqual([]);
    expect(inCloud('owner-b')).toEqual([]);
    // B's own sync finds nothing of A's either.
    await Tombstones.synchronizeDAVESyncTombstones();
    expect(onPhone()).toEqual([]);
    expect(inCloud('owner-b')).toEqual([]);
    // And A, signed in again, has its own.
    await signOut();
    await signIn('a');
    await Tombstones.synchronizeDAVESyncTombstones();
    expect(onPhone()).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
    expect(inCloud('owner-a')).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
  });

  it('A\'s own 150 records go up a hundred at a time: he changes account while the first hundred go up, and the rest are not written as B', async () => {
    await signIn('a');
    const own = Array.from({ length: 150 }, (_, index) => record(index === 149 ? 'project' : 'schedule_item', index === 149 ? 'Main St' : `task-${index}`, '2026-10-05T10:00:00.000Z'));
    mockPhone.set(LIST, JSON.stringify(own)); // made on this phone as A, with no signal at the time
    cloud.hold = isHistoryWrite;
    const sync = Tombstones.synchronizeDAVESyncTombstones();
    await waitFor(() => cloud.held !== null);

    await signOut();
    await signIn('b');
    cloud.answer();
    await sync;

    expect(cloud.writes.filter(write => write.signIn === 'sign-in-of-b')).toEqual([]);
    expect(cloud.writes.filter(write => write.names !== 'owner-a')).toEqual([]);
    expect(inCloud('owner-b')).toEqual([]);
    expect(onPhone()).toEqual([]);
    // A signs in again: all 150 are still its own on the phone, and the rest go up as A.
    await signOut();
    await signIn('a');
    await Tombstones.synchronizeDAVESyncTombstones();
    expect(onPhone()).toHaveLength(150);
    expect(inCloud('owner-a')).toHaveLength(150);
    expect(inCloud('owner-b')).toEqual([]);
  });

  it('B signs in with no sign-out in between (the library allows it) while A\'s history is being read: the same', async () => {
    cloud.history['owner-a'] = [row('project', 'Lot 9')];
    await signIn('a');
    cloud.hold = isHistoryRead;
    const sync = Tombstones.synchronizeDAVESyncTombstones();
    await waitFor(() => cloud.held !== null);

    await signIn('b');
    cloud.answer();
    const answer = await sync;

    expect(answer.tombstones).toEqual([]);
    expect(onPhone()).toEqual([]);
    expect(cloud.writes.filter(write => write.signIn === 'sign-in-of-b')).toEqual([]);
    expect(inCloud('owner-b')).toEqual([]);
  });

  it('a deletion A makes on the phone as he signs out: saved under A or not at all, never uploaded as B', async () => {
    await signIn('a');
    cloud.hold = isHistoryWrite;
    const made = Tombstones.recordDAVESyncTombstones([{ entityType: 'schedule_item', recordId: 'task-a-1' }] as never);
    await waitFor(() => cloud.held !== null); // saved on the phone as A; its upload is on its way, as A
    expect(cloud.held!.signIn).toBe('sign-in-of-a');
    await signOut();
    await signIn('b');
    cloud.answer();
    await made.catch(() => undefined);
    expect(onPhone()).toEqual([]);
    expect(cloud.writes.filter(write => write.signIn === 'sign-in-of-b')).toEqual([]);
    await signOut();
    await signIn('a');
    expect(onPhone()).toEqual(['schedule_item:task-a-1']);
  });
});

describe('one account only, with the real sign-in', () => {
  it('the same account signs out and in again while its history is being read: that read answers "the account changed" once, nothing is lost, and the next sync has everything', async () => {
    cloud.history['owner-a'] = [row('project', 'Lot 9')];
    await signIn('a');
    mockPhone.set(LIST, JSON.stringify([record('schedule_item', 'made-with-no-signal', '2026-10-06T09:00:00.000Z')]));
    cloud.hold = isHistoryRead;
    const sync = Tombstones.synchronizeDAVESyncTombstones();
    await waitFor(() => cloud.held !== null);
    await signOut();
    await signIn('a');
    cloud.answer();
    const cut = await sync;
    expect(cut.cloudAuthoritative).toBe(false);
    expect(cut.cloudError).toBe('The account changed during sync. Work not yet sent waits for the account that saved it.');
    expect(onPhone()).toEqual(['schedule_item:made-with-no-signal']); // his own list is as it was

    const next = await Tombstones.synchronizeDAVESyncTombstones();
    expect(next.cloudAuthoritative).toBe(true);
    expect(next.tombstones.map(item => item.recordId).sort()).toEqual(['Lot 9', 'made-with-no-signal']);
    expect(onPhone()).toEqual(['project:Lot 9', 'schedule_item:made-with-no-signal']);
    expect(inCloud('owner-a')).toEqual(['project:Lot 9', 'schedule_item:made-with-no-signal']);
    expect(cloud.writes.every(write => write.signIn === 'sign-in-of-a' && write.names === 'owner-a')).toBe(true);
  });
});

describe('records an older build left on a phone', () => {
  const asked = (Sandbox as { anotherAccountHasUsedThisPhone?: (storage: never, ownerId: string) => Promise<boolean> }).anotherAccountHasUsedThisPhone;
  const OLD = [record('schedule_item', 'deleted-offline-on-the-old-build', '2026-10-06T09:00:00.000Z'), record('schedule_item', 'already-in-the-cloud', '2026-10-02T09:00:00.000Z')];

  it('a phone that has only ever had one account: both are its own; the one the cloud lacks is uploaded, and both are in the answer', async () => {
    await signIn('a');
    cloud.history['owner-a'] = [row('schedule_item', 'already-in-the-cloud', '2026-10-02T09:00:00.000Z')];
    mockPhone.set(LIST, JSON.stringify(OLD));
    if (asked) expect(await asked(AsyncStorage, 'owner-a')).toBe(false);
    const answer = await Tombstones.synchronizeDAVESyncTombstones();
    expect(answer.tombstones.map(item => item.recordId).sort()).toEqual(['already-in-the-cloud', 'deleted-offline-on-the-old-build']);
    expect(inCloud('owner-a')).toEqual(['schedule_item:already-in-the-cloud', 'schedule_item:deleted-offline-on-the-old-build']);
  });

  it('a phone that has had two accounts: the one the signed-in account\'s cloud lacks is kept, is in no answer and is uploaded as nobody; the other is its own', async () => {
    await signIn('a');
    await signOut();
    await signIn('b');
    cloud.history['owner-b'] = [row('schedule_item', 'already-in-the-cloud', '2026-10-02T09:00:00.000Z')];
    mockPhone.set(LIST, JSON.stringify(OLD));
    if (asked) expect(await asked(AsyncStorage, 'owner-b')).toBe(true);
    const answer = await Tombstones.synchronizeDAVESyncTombstones();
    expect(answer.tombstones.map(item => item.recordId)).toEqual(['already-in-the-cloud']);
    expect(onPhone()).toEqual(['schedule_item:already-in-the-cloud', 'schedule_item:deleted-offline-on-the-old-build']); // kept
    expect(inCloud('owner-b')).toEqual(['schedule_item:already-in-the-cloud']);
    // Nor at any later sync, nor after a relaunch would it be: the mark is saved.
    await Tombstones.synchronizeDAVESyncTombstones();
    expect(inCloud('owner-b')).toEqual(['schedule_item:already-in-the-cloud']);
  });

  /**
   * FINDING N2 (caused by e3efb15). The owner's own case can be a "two-account" phone without a second account.
   * The boundary sets aside, for good, whatever account data it finds on the phone while nobody is signed in
   * (whole-app audit A1 H2: "a sync finishing after a sign-out left data"). That record is there after ONE account
   * has signed out and in again with something still finishing; the new rule counts it as "another account".
   * Then a deletion he made on the last build with no signal, not yet in the cloud when this build first runs, is
   * marked "account not known": never uploaded, in no answer. What he deleted is still in the cloud and comes back.
   * FAILS on a00b815. Passes on a542898 (the record is uploaded and counts).
   */
  it('ONE account, which once signed out while something was still finishing: a deletion made offline on the old build still counts and still goes up', async () => {
    await signIn('a');
    await signOut();
    // Something of the first session finishes after the sign-out and saves (a sync's time stamp, here).
    mockPhone.set('projectVisionAI.lastSyncAt.v1', JSON.stringify('2026-10-06T08:00:00.000Z'));
    await signIn('a');
    expect([...mockPhone.keys()].some(key => key.startsWith(Sandbox.OWNER_STORAGE_QUARANTINE_PREFIX))).toBe(true); // set aside by the boundary
    // (The one line changed: he wrote toBe(true) here, "...and counted as another account", which was the cause.)
    if (asked) expect(await asked(AsyncStorage, 'owner-a')).toBe(false);
    cloud.history['owner-a'] = [row('schedule_item', 'already-in-the-cloud', '2026-10-02T09:00:00.000Z')];
    mockPhone.set(LIST, JSON.stringify(OLD)); // as the old build left it

    const answer = await Tombstones.synchronizeDAVESyncTombstones();

    expect(answer.tombstones.map(item => item.recordId).sort()).toEqual(['already-in-the-cloud', 'deleted-offline-on-the-old-build']);
    expect(inCloud('owner-a')).toEqual(['schedule_item:already-in-the-cloud', 'schedule_item:deleted-offline-on-the-old-build']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Second review, sync N2 (caused by the G5 fix): this batch's own tests, with the same real parts.
// ---------------------------------------------------------------------------------------------------------------
describe('second review, sync N2: data set aside while signed out is not another account', () => {
  const asked = Sandbox.anotherAccountHasUsedThisPhone;
  const MARKS = Tombstones.DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY;
  /** The saved list of records whose account is not known: null before this build has looked at the list. */
  const marks = () => JSON.parse(mockPhone.get(MARKS) ?? 'null') as string[] | null;
  const setAside = () => [...mockPhone.keys()].filter(key => key.startsWith(Sandbox.OWNER_STORAGE_QUARANTINE_PREFIX));
  const ids = (records: ReadonlyArray<{ recordId: string }>) => records.map(item => item.recordId).sort();
  const OFFLINE = 'deleted-offline-on-the-old-build';
  const HELD = 'already-in-the-cloud';
  const OLD = [record('schedule_item', OFFLINE, '2026-10-06T09:00:00.000Z'), record('schedule_item', HELD, '2026-10-02T09:00:00.000Z')];
  /** He signs out; something of that session finishes afterwards and saves; he signs in: the boundary sets it aside. */
  async function outAndInWithSomethingStillFinishing(owner: 'a' | 'b', nth: number) {
    await signOut();
    mockPhone.set('projectVisionAI.lastSyncAt.v1', JSON.stringify(`2026-10-06T08:0${nth}:00.000Z`));
    await signIn(owner);
  }

  it('one account, out and in again five times with something still finishing each time, with signal and with none: no record is ever marked, the deletion made offline on the old build counts at once, and it goes up when the signal is back', async () => {
    await signIn('a');
    for (let nth = 1; nth <= 3; nth += 1) await outAndInWithSomethingStillFinishing('a', nth);
    expect(setAside()).toHaveLength(3);
    expect(await asked(AsyncStorage, 'owner-a')).toBe(false);
    cloud.history['owner-a'] = [row('schedule_item', HELD, '2026-10-02T09:00:00.000Z')];
    mockPhone.set(LIST, JSON.stringify(OLD)); // as the old build left it

    // This build's first start is with no signal: his own list still protects, as on the last build.
    cloud.online = false;
    const offline = await Tombstones.synchronizeDAVESyncTombstones();
    expect(offline.cloudAuthoritative).toBe(false);
    expect(ids(offline.tombstones)).toEqual([HELD, OFFLINE]);
    expect(marks()).toEqual([]);
    // Out and in twice more, still with no signal (the sign-in itself reaches the stand-in sign-in server).
    for (let nth = 4; nth <= 5; nth += 1) await outAndInWithSomethingStillFinishing('a', nth);
    expect(setAside()).toHaveLength(5);
    expect(await asked(AsyncStorage, 'owner-a')).toBe(false);
    expect(marks()).toEqual([]);
    expect(ids(await Tombstones.loadDAVESyncTombstones())).toEqual([HELD, OFFLINE]);
    expect(ids((await Tombstones.loadDAVEOperationalTombstones()).tombstones)).toEqual([HELD, OFFLINE]);
    expect(inCloud('owner-a')).toEqual([`schedule_item:${HELD}`]); // nothing could go up yet

    cloud.online = true;
    const answer = await Tombstones.synchronizeDAVESyncTombstones();
    expect(answer).toMatchObject({ cloudAuthoritative: true, uploadFailures: 0 });
    expect(ids(answer.tombstones)).toEqual([HELD, OFFLINE]);
    expect(onPhone()).toEqual([`schedule_item:${HELD}`, `schedule_item:${OFFLINE}`]);
    expect(inCloud('owner-a')).toEqual([`schedule_item:${HELD}`, `schedule_item:${OFFLINE}`]);
    expect(marks()).toEqual([]);
    expect(cloud.writes.length).toBeGreaterThan(0);
    expect(cloud.writes.every(write => write.signIn === 'sign-in-of-a' && write.names === 'owner-a')).toBe(true);
  });

  it('the boundary\'s own question, by what each trace names: a set-aside record that names this account, names nobody or cannot be read is not another account; one that names another account is', async () => {
    await signIn('a');
    const key = (name: string) => `${Sandbox.OWNER_STORAGE_QUARANTINE_PREFIX}${name}`;
    const setAsideFor = (suspectedOwnerId: string | null) => JSON.stringify({ version: 1, id: 'set-aside', suspectedOwnerId, snapshot: {}, createdAt: '2026-10-06T08:00:00.000Z' });
    expect(await asked(AsyncStorage, 'owner-a')).toBe(false);
    mockPhone.set(key('its-own'), setAsideFor('owner-a'));
    mockPhone.set(key('origin-not-known'), setAsideFor(null));
    mockPhone.set(key('no-name-at-all'), '{}');
    mockPhone.set(key('cannot-be-read'), '{cut off');
    expect(await asked(AsyncStorage, 'owner-a')).toBe(false);
    mockPhone.set(key('names-another-account'), setAsideFor('owner-b'));
    expect(await asked(AsyncStorage, 'owner-a')).toBe(true);
    expect(await asked(AsyncStorage, 'owner-b')).toBe(true); // to B the phone has had A, whatever is set aside
  });

  it('a phone on which a second, different account really signed in: the older build\'s records that the cloud does not hold are marked as before, for either account, with a set-aside record on the phone as well', async () => {
    await signIn('a');
    await outAndInWithSomethingStillFinishing('a', 1);
    await signOut();
    await signIn('b');
    expect(await asked(AsyncStorage, 'owner-b')).toBe(true);
    cloud.history['owner-b'] = [row('schedule_item', HELD, '2026-10-02T09:00:00.000Z')];
    mockPhone.set(LIST, JSON.stringify(OLD));

    const forB = await Tombstones.synchronizeDAVESyncTombstones();
    expect(ids(forB.tombstones)).toEqual([HELD]);
    expect(marks()).toEqual([`schedule_item:${OFFLINE}|2026-10-06T09:00:00.000Z`]);
    expect(onPhone()).toEqual([`schedule_item:${HELD}`, `schedule_item:${OFFLINE}`]); // kept, byte for byte
    expect(inCloud('owner-b')).toEqual([`schedule_item:${HELD}`]);

    // And the first account, signed in again on that phone: the second account's stored data names another account.
    await signOut();
    await signIn('a');
    expect(await asked(AsyncStorage, 'owner-a')).toBe(true);
    mockPhone.set(LIST, JSON.stringify(OLD));
    const forA = await Tombstones.synchronizeDAVESyncTombstones();
    expect(forA.cloudAuthoritative).toBe(true);
    expect(forA.tombstones).toEqual([]);
    expect(marks()).toHaveLength(2);
    expect(inCloud('owner-a')).toEqual([]);
    expect(cloud.writes.filter(write => write.signIn === 'sign-in-of-a')).toEqual([]);
    expect(cloud.writes.filter(write => write.names !== 'owner-b')).toEqual([]);
  });
});
