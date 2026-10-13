/**
 * P1 part C item 2 (6 Oct 2026), a closer look, tests only: "A previous
 * account's item that was already uploading during a sign-out."
 *
 * What is asked: account A's item is on its way to the cloud when A signs
 * out (Sign Out of This Device, or of All Devices) and account B then signs
 * in on the same phone. Can the item land under B, be lost, or be shown
 * to B?
 *
 * An upload of one item is several requests: checks first (the deletion
 * history, the row as the cloud has it), then the write. A pass sends one
 * account's work and looks at who is signed in BEFORE each item (whole-app
 * audit A1 M3), not between one item's requests. So the answer depends on
 * where the item was:
 *
 *  - its WRITE had left: it lands under A, with A's sign-in. Nothing more
 *    of it is sent after the sign-out. Safe.
 *  - one of its CHECKS was still waiting: when the check was answered, the
 *    pass went on and sent the write. By then B was signed in, so the write
 *    left with B's sign-in and named B as the owner: A's task was sent into
 *    B's account. That was the gap. It is closed (sync batch Y4; owner
 *    answer Q45, 6 Oct 2026: yes): every cloud call of an item is made as
 *    the account the item was queued under, or not at all, and the cases
 *    below that were named "today, ..." now say so.
 *
 * Either way, on the phone: A's item stays in A's own waiting list, set
 * aside with A's data (not lost; it goes again when A signs in), and
 * nothing of A's is written into B's storage on the phone.
 *
 * Real SyncService, SupabaseService with supabase-js and auth-js, the
 * account binding and the account storage sandbox. Stand-ins: the phone's
 * two stores (in memory) and the network (below). The stand-in cloud takes
 * whatever it is sent, so these cases show what the app SENDS and under
 * whose sign-in; whether the real database would then refuse a write is
 * not established here (no database rule is run).
 */
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecure.delete(key); }),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const api = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([k, v]) => values.set(k, v)); },
    multiRemove: async (keys: string[]) => { keys.forEach(k => values.delete(k)); },
    clear: async () => values.clear(),
  };
  return { __esModule: true, default: api, ...api };
});

// The stand-in network. Every request is kept with the sign-in it carried.
// One request can be held, as a slow connection holds it, and then answered
// or failed.
type Call = { method: string; path: string; signIn: string; body: string; when: 'before' | 'during' | 'after' };
const network = {
  calls: [] as Call[],
  phase: 'before' as Call['when'],
  hold: null as ((call: Call) => boolean) | null,
  held: null as Call | null,
  answer: (() => undefined) as (how: 'answer' | 'fail') => void,
};
const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
});
const sessionFor = (owner: 'a' | 'b') => ({
  access_token: `sign-in-of-${owner}`, refresh_token: `refresh-${owner}`, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3000,
  user: {
    id: `owner-${owner}`, aud: 'authenticated', role: 'authenticated', email: `owner-${owner}@example.com`,
    app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z',
  },
});
(global as { fetch?: unknown }).fetch = jest.fn(async (input: unknown, init?: { method?: string; body?: unknown; headers?: unknown }) => {
  const request = typeof input === 'string' ? null : input as { url: string; method?: string; headers?: unknown };
  const url = new URL(String(request ? request.url : input));
  const headers = new Headers((init?.headers as never) || (request?.headers as never) || {});
  const call: Call = {
    method: init?.method || request?.method || 'GET',
    path: url.pathname + url.search,
    signIn: (headers.get('authorization') || '').replace(/^Bearer /, ''),
    body: typeof init?.body === 'string' ? init.body : '',
    when: network.phase,
  };
  network.calls.push(call);
  if (network.hold?.(call)) {
    network.hold = null;
    network.held = call;
    const how = await new Promise<'answer' | 'fail'>(resolve => { network.answer = resolve; });
    if (how === 'fail') throw new TypeError('Network request failed');
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  if (url.pathname === '/auth/v1/token') {
    // The stand-in sign-in server: whoever asks is let in (no real account, no real password).
    return json(200, sessionFor(call.body.includes('owner-a@example.com') ? 'a' : 'b'));
  }
  if (url.pathname.startsWith('/auth/v1/')) return json(200, {});
  if (url.pathname === '/rest/v1/projects' && call.method === 'GET') {
    // The cloud's projects of whoever asks: A has Canopy B; B has none.
    return json(200, call.signIn === 'sign-in-of-a'
      ? [{ id: PROJECT_A, owner_id: 'owner-a', name: 'Canopy B', archived: false, data: {}, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }]
      : []);
  }
  if (call.method === 'GET' || call.method === 'HEAD') return json(200, []);
  let sent: unknown = [];
  try { sent = JSON.parse(call.body || '[]'); } catch { sent = []; }
  return json(call.method === 'POST' ? 201 : 200, Array.isArray(sent) ? sent : [sent]);
});
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://isolation-p1.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'p1-anon-key-not-a-secret';
jest.setTimeout(60_000);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { currentCloudOwner } from '../../services/CloudOwnerBinding';
import { createOwnerStorageSandbox, isOwnerSensitiveCanonicalStorageKey } from '../../services/OwnerStorageSandbox';

// Required, not imported: these load SupabaseService, which would create the
// client before the project settings above are set.
const SyncService = require('../../services/SyncService') as typeof import('../../services/SyncService');
const Supabase = require('../../services/SupabaseService') as typeof import('../../services/SupabaseService');

const storage = AsyncStorage as unknown as Parameters<typeof createOwnerStorageSandbox>[0]['storage'];
const QUEUE = 'projectVisionAI.syncQueue.v1';
const setAsideFor = (owner: string, key: string) =>
  `@vitruvius/owner-storage-sandbox/owner/${owner}/value/${encodeURIComponent(key)}`;

const task = {
  id: 'task-of-a', projectName: 'Canopy B', locationName: '', taskName: 'Pour slab', startDate: '',
  finishDate: '2026-10-02', milestone: '', owner: 'A', contractor: '', percentComplete: 40,
  priority: 'Medium', status: 'In Progress', notes: 'Rebar inspection first', createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-30T08:05:00.000Z',
};

const isTaskWrite = (call: Call) => call.path.startsWith('/rest/v1/schedule_items') && call.method !== 'GET';
const isLastCheckBeforeTheWrite = (call: Call) =>
  call.method === 'GET' && call.path.startsWith('/rest/v1/schedule_items') && call.path.includes('id=eq.task-of-a');
const taskWrites = () => network.calls.filter(isTaskWrite).map(call => ({
  when: call.when,
  signIn: call.signIn,
  ownerNamed: (JSON.parse(call.body) as { owner_id?: string }).owner_id,
  task: (JSON.parse(call.body) as { id?: string }).id,
}));
const waitingListOf = async (key: string) =>
  (JSON.parse((await AsyncStorage.getItem(key)) || '[]') as { id: string; ownerId?: string }[])
    .map(item => `${item.id} (queued by ${item.ownerId})`);
/** Account data in the storage the signed-in account reads. */
const openAccountData = async () => (await AsyncStorage.getAllKeys()).filter(isOwnerSensitiveCanonicalStorageKey).sort();

type SignOut = 'This Device' | 'All Devices';
/** Typed into the stand-in sign-in server only; it lets anyone in. */
const STAND_IN_PASSWORD = 'stand-in, not a real password';

/**
 * A is signed in with one task waiting to go up. Its upload starts and is
 * held at `holdAt`. A signs out, B signs in, and only then is the held
 * request answered (or failed). Returns what the upload pass reported.
 */
async function signOutAndInWhileUploading(input: {
  signOut: SignOut;
  holdAt: (call: Call) => boolean;
  then: 'answer' | 'fail';
}) {
  const sandbox = createOwnerStorageSandbox({ storage });
  await sandbox.activateOwner(null);
  // A signs in. The app learns who is signed in from the sign-in events.
  expect((await Supabase.signIn({ email: 'owner-a@example.com', password: STAND_IN_PASSWORD })).ok).toBe(true);
  expect(currentCloudOwner().ownerId).toBe('owner-a');
  await sandbox.activateOwner('owner-a');
  await SyncService.queueScheduleItemRecord(task as never, false);
  expect(await waitingListOf(QUEUE)).toEqual(['schedule-item-task-of-a (queued by owner-a)']);

  network.calls.length = 0;
  network.phase = 'before';
  network.held = null;
  network.hold = input.holdAt;
  const pass = SyncService.uploadPendingChanges();
  for (let i = 0; i < 300 && !network.held; i += 1) await new Promise(r => setTimeout(r, 10));
  expect(network.held).not.toBeNull();

  // A signs out, as Settings does, and the phone puts A's data aside.
  network.phase = 'during';
  const signedOut = await Supabase.signOut(input.signOut === 'All Devices' ? 'global' : 'local');
  expect(signedOut.ok).toBe(true);
  expect(network.calls.some(call => call.path === `/auth/v1/logout?scope=${input.signOut === 'All Devices' ? 'global' : 'local'}`)).toBe(true);
  expect(currentCloudOwner().ownerId).toBeNull();
  await sandbox.activateOwner(null);

  // B signs in on the same phone.
  const signedIn = await Supabase.signIn({ email: 'owner-b@example.com', password: STAND_IN_PASSWORD });
  expect(signedIn.ok).toBe(true);
  expect(currentCloudOwner().ownerId).toBe('owner-b');
  await sandbox.activateOwner('owner-b');

  // Only now does the slow connection answer.
  network.phase = 'after';
  network.answer(input.then);
  const result = await pass;
  await new Promise(resolve => setTimeout(resolve, 100));
  return result;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  network.calls.length = 0;
});
afterEach(async () => {
  // Leave no sign-in behind for the next case.
  await Supabase.signOut('local');
});

describe.each<SignOut>(['This Device', 'All Devices'])('Sign Out of %s, then another account signs in, while a task is uploading', signOut => {
  describe('the task\'s write had already left', () => {
    it('it lands under the account that made it, and nothing more of it is sent', async () => {
      const result = await signOutAndInWhileUploading({ signOut, holdAt: isTaskWrite, then: 'answer' });

      // One write, sent before the sign-out, with A's sign-in, naming A.
      expect(taskWrites()).toEqual([{ when: 'before', signIn: 'sign-in-of-a', ownerNamed: 'owner-a', task: 'task-of-a' }]);
      // After B signed in the pass asked the cloud for nothing at all.
      expect(network.calls.filter(call => call.when === 'after')).toEqual([]);
      expect(result.errors).toEqual(['The account changed during sync. Work not yet sent waits for the account that saved it.']);
    });

    it('on the phone: it stays in A\'s waiting list, set aside with A\'s data; B\'s storage holds nothing of A\'s', async () => {
      await signOutAndInWhileUploading({ signOut, holdAt: isTaskWrite, then: 'answer' });

      expect(await openAccountData()).toEqual([]);
      expect(await waitingListOf(QUEUE)).toEqual([]);
      // Not lost, though it did land: it goes again when A signs in (the same row, written again).
      expect(await waitingListOf(setAsideFor('owner-a', QUEUE))).toEqual(['schedule-item-task-of-a (queued by owner-a)']);
    });
  });

  describe('the task\'s write had not left yet: one of its checks was still waiting', () => {
    // THE GAP, CLOSED (sync batch Y4; owner answer Q45, 6 Oct 2026: yes). These cases were named "today, ..." and
    // held the gap as it was: the write then left with B's sign-in and named B as the owner, so A's task (its name,
    // its note, A's project) was sent into B's account, and the pass counted it as sent.
    it('the write is not sent at all: nothing of A\'s task goes out with B\'s sign-in, and nothing names B as its owner', async () => {
      const result = await signOutAndInWhileUploading({ signOut, holdAt: isLastCheckBeforeTheWrite, then: 'answer' });

      expect(taskWrites()).toEqual([]);
      // After B signed in the pass asked the cloud for nothing at all: no further check either.
      expect(network.calls.filter(call => call.when === 'after')).toEqual([]);
      // Nothing that was sent, before or after, carried B's sign-in.
      expect(network.calls.filter(call => call.path.startsWith('/rest/v1/') && call.signIn !== 'sign-in-of-a')).toEqual([]);
      // The pass does not count it as sent, and says the account changed.
      expect(result.itemOutcomes).toEqual({ 'schedule-item-task-of-a': 'failed' });
      expect(result.uploaded).toBe(0);
      expect(result.errors).toContain('The account changed during sync. Work not yet sent waits for the account that saved it.');
    });

    it('on the phone: it stays in A\'s waiting list, set aside with A\'s data; B\'s storage holds nothing of A\'s', async () => {
      await signOutAndInWhileUploading({ signOut, holdAt: isLastCheckBeforeTheWrite, then: 'answer' });

      expect(await openAccountData()).toEqual([]);
      expect(await waitingListOf(QUEUE)).toEqual([]);
      expect(await waitingListOf(setAsideFor('owner-a', QUEUE))).toEqual(['schedule-item-task-of-a (queued by owner-a)']);
    });
  });

  describe('the connection drops instead of answering', () => {
    it('held at its write: nothing is sent as B, and the task waits for A', async () => {
      await signOutAndInWhileUploading({ signOut, holdAt: isTaskWrite, then: 'fail' });

      expect(taskWrites()).toEqual([{ when: 'before', signIn: 'sign-in-of-a', ownerNamed: 'owner-a', task: 'task-of-a' }]);
      expect(network.calls.filter(call => call.when === 'after')).toEqual([]);
      expect(await openAccountData()).toEqual([]);
      expect(await waitingListOf(setAsideFor('owner-a', QUEUE))).toEqual(['schedule-item-task-of-a (queued by owner-a)']);
    });

    // THE GAP again, CLOSED: a check that fails is tried again by the cloud library itself, a second later, with
    // whichever sign-in is there by then. It was tried again as B, and the write followed as B.
    it('held at one of its checks: the check is not tried again as B, and no write follows', async () => {
      const result = await signOutAndInWhileUploading({ signOut, holdAt: isLastCheckBeforeTheWrite, then: 'fail' });

      expect(taskWrites()).toEqual([]);
      // The further try names A as the owner of what it asks for, and B is signed in: it is not sent.
      expect(network.calls.filter(call => call.when === 'after')).toEqual([]);
      expect(result.uploaded).toBe(0);
      // On the phone, as in every case: nothing of A's in B's storage, and A's task still waits for A.
      expect(await openAccountData()).toEqual([]);
      expect(await waitingListOf(setAsideFor('owner-a', QUEUE))).toEqual(['schedule-item-task-of-a (queued by owner-a)']);
    });
  });
});
