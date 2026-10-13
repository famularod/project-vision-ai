/**
 * Sync batch Y4, the account boundary of an upload under way (owner answer Q45, 6 Oct 2026: yes): the cloud layer.
 *
 * The upload makes each cloud call of an item "as" the account the item was queued under (callAsCloudOwner). Here:
 * what the cloud layer does with that.
 *  - every write the upload makes, made as another account than the one signed in, is refused and sends nothing;
 *  - made as the account that is signed in, or with no account named, it goes out as it always did;
 *  - an archive, which reads and then writes, keeps its account for the write;
 *  - a request that names one account is not sent with another account's sign-in (the last look before it leaves).
 *
 * Real SupabaseService with supabase-js and auth-js, and the real account binding. Stand-ins, as in
 * p1-upload-in-flight-at-sign-out.test.ts: the phone's two stores (in memory) and the network (below). No real
 * account, no real password, no cloud call. The sign-in tokens here are made up in this file.
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

type Call = { method: string; path: string; signIn: string; body: string };
const network = {
  calls: [] as Call[],
  hold: null as ((call: Call) => boolean) | null,
  held: null as Call | null,
  answer: (() => undefined) as () => void,
};
const PROJECT = '11111111-1111-4111-8111-111111111111';
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
  };
  network.calls.push(call);
  if (network.hold?.(call)) {
    network.hold = null;
    network.held = call;
    await new Promise<void>(resolve => { network.answer = resolve; });
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  if (url.pathname === '/auth/v1/token') return json(200, sessionFor(call.body.includes('owner-a@example.com') ? 'a' : 'b'));
  if (url.pathname.startsWith('/auth/v1/')) return json(200, {});
  if (url.pathname === '/rest/v1/project_updates' && call.method === 'GET') {
    // The cloud's copy of one field update, for whoever asks.
    const row = { id: 'update-1', project_id: PROJECT, project_name: 'Canopy B', area_name: '', updated_at: '2026-10-01T08:00:00.000Z', update_data: { id: 'update-1', projectId: PROJECT, projectName: 'Canopy B', notes: 'Crack at C4' } };
    return json(200, headers.get('accept')?.includes('vnd.pgrst.object') ? row : [row]);
  }
  if (call.method === 'GET' || call.method === 'HEAD') return json(200, []);
  let sent: unknown = [];
  try { sent = JSON.parse(call.body || '[]'); } catch { sent = []; }
  return json(call.method === 'POST' ? 201 : 200, Array.isArray(sent) ? sent : [sent]);
});
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://isolation-y4.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'y4-anon-key-not-a-secret';
jest.setTimeout(60_000);

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as CloudOwnerBinding from '../../services/CloudOwnerBinding';

const { currentCloudOwner } = CloudOwnerBinding;
// (Looked up this way so that the file also runs, and fails for the right reason, on a tree from before this change,
// where a call could not be made "as" an account: it was made as whoever was signed in.)
const callAsCloudOwner: typeof CloudOwnerBinding.callAsCloudOwner =
  (CloudOwnerBinding as Partial<typeof CloudOwnerBinding>).callAsCloudOwner ?? ((_ownerId, call) => call());

// Required, not imported: it would create the client before the project settings above are set.
const Supabase = require('../../services/SupabaseService') as typeof import('../../services/SupabaseService');

/** Typed into the stand-in sign-in server only; it lets anyone in. */
const STAND_IN_PASSWORD = 'stand-in, not a real password';
async function signIn(owner: 'a' | 'b') {
  expect((await Supabase.signIn({ email: `owner-${owner}@example.com`, password: STAND_IN_PASSWORD })).ok).toBe(true);
  expect(currentCloudOwner().ownerId).toBe(`owner-${owner}`);
  network.calls.length = 0;
}
const ACCOUNT_CHANGED = 'The account changed during sync. Work not yet sent waits for the account that saved it.';
/** Everything sent that could change the cloud: a write to the database, or anything at all to file storage. */
const sentToChangeTheCloud = () => network.calls.filter(call =>
  (call.path.startsWith('/rest/v1/') && call.method !== 'GET' && call.method !== 'HEAD') || call.path.startsWith('/storage/v1/'));

const task = {
  id: 'task-1', itemType: 'Task', projectId: PROJECT, projectName: 'Canopy B', locationName: '', taskName: 'Pour slab', startDate: '', finishDate: '',
  milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', activity: [],
  createdAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z',
};
const area = { id: 'area-1', projectId: PROJECT, projectName: 'Canopy B', name: 'North lot', latitude: 1, longitude: 1, radiusMeters: 30 };
const document = { id: 'document-1', name: 'Permit', category: 'Permit', projectId: PROJECT, projectName: 'Canopy B', projectNames: ['Canopy B'], uri: '' };
const update = { id: 'update-1', projectId: PROJECT, projectName: 'Canopy B', areaName: '', updateData: { id: 'update-1', projectId: PROJECT, projectName: 'Canopy B', notes: 'Crack at C4' } };

/** Every write the upload makes. */
const WRITES: Array<[string, () => Promise<{ ok: boolean; error?: string; code?: string }>]> = [
  ['a task', () => Supabase.upsertScheduleItem(task as never)],
  ['a task, only if the cloud has none', () => Supabase.upsertScheduleItem(task as never, { onlyIfAbsent: true })],
  ['a task, only over the version it was weighed against', () => Supabase.upsertScheduleItem(task as never, { ifUnchangedSince: '2026-10-01T08:00:00.000Z' })],
  ['a GPS area', () => Supabase.upsertProjectArea(area as never)],
  ['a GPS area, only if the cloud has none', () => Supabase.upsertProjectArea(area as never, { onlyIfAbsent: true })],
  ['a document the cloud has not got', () => Supabase.upsertReferenceDocument(document as never)],
  ['a document the cloud has', () => Supabase.upsertReferenceDocument(document as never, { existing: true })],
  ['a field update', () => Supabase.saveProjectUpdate(update as never)],
  ['a field update\'s archive', () => Supabase.archiveProjectUpdate({ id: 'update-1', archivedAt: '2026-10-02T08:00:00.000Z', projectId: PROJECT })],
  ['a field update\'s deletion', () => Supabase.deleteProjectUpdate({ id: 'update-1' })],
  ['a new project', () => Supabase.createProject({ name: 'Lot 9' })],
  ['a project\'s change', () => Supabase.updateProject({ previousName: 'Canopy B', archived: true } as never)],
  ['a project\'s deletion', () => Supabase.deleteProject({ name: 'Canopy B' })],
  ['a photo\'s file', () => Supabase.uploadPhoto({ path: 'canopy-b/update-1/p1.jpg', uri: 'file:///phone/p1.jpg' } as never)],
];

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  network.calls.length = 0;
  network.hold = null;
  network.held = null;
});
afterEach(async () => {
  await Supabase.signOut('local');
});

describe('sync batch Y4: a cloud write made as one account while another is signed in', () => {
  it.each(WRITES)('%s: refused, saying the account changed, and nothing is sent', async (_what, write) => {
    await signIn('b');

    const result = await callAsCloudOwner('owner-a', write);

    expect(result.ok).toBe(false);
    expect(result.error).toBe(ACCOUNT_CHANGED);
    expect(sentToChangeTheCloud()).toEqual([]);
    // Nothing at all left the phone naming account A or its record.
    expect(network.calls.filter(call => call.path.startsWith('/rest/v1/') || call.path.startsWith('/storage/v1/'))).toEqual([]);
  });

  it.each(WRITES.filter(([what]) => !/photo|archive/.test(what)))('%s, made as the account that IS signed in: sent with that sign-in, as before', async (_what, write) => {
    await signIn('b');

    await callAsCloudOwner('owner-b', write);

    const sent = sentToChangeTheCloud();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(call => call.signIn === 'sign-in-of-b')).toBe(true);
    // Whatever names an owner names the account that is signed in.
    sent.forEach(call => {
      const named = /"owner_id":"([^"]+)"/.exec(call.body)?.[1] ?? /owner_id=eq\.([^&]+)/.exec(call.path)?.[1];
      expect(named ?? 'owner-b').toBe('owner-b');
    });
  });

  it('with no account named (every caller but the upload): made as whoever is signed in, as it always was', async () => {
    await signIn('b');

    await Supabase.upsertScheduleItem(task as never);

    // (What was sent is what is looked at: the stand-in cloud does not answer as the real one does.)
    expect(sentToChangeTheCloud().map(call => [call.signIn, (JSON.parse(call.body) as { owner_id?: string }).owner_id])).toEqual([['sign-in-of-b', 'owner-b']]);
  });

  it('naming an account is for that one call only: the next call, with none named, is not held to it', async () => {
    await signIn('b');
    await callAsCloudOwner('owner-a', () => Supabase.upsertScheduleItem(task as never));
    expect(sentToChangeTheCloud()).toEqual([]);

    await Supabase.upsertScheduleItem(task as never);
    expect(sentToChangeTheCloud().map(call => call.signIn)).toEqual(['sign-in-of-b']);
    // Nor a call started beside it, in the same moment, by something else.
    network.calls.length = 0;
    const [refused] = await Promise.all([
      callAsCloudOwner('owner-a', () => Supabase.upsertProjectArea(area as never)),
      Supabase.upsertProjectArea(area as never),
    ]);
    expect([refused.ok, refused.error]).toEqual([false, ACCOUNT_CHANGED]);
    expect(sentToChangeTheCloud().map(call => [call.signIn, /"owner_id":"([^"]+)"/.exec(call.body)?.[1]])).toEqual([['sign-in-of-b', 'owner-b']]);
  });

  it('an archive reads, then writes: the account changes between the two, and the write is not sent', async () => {
    await signIn('a');
    network.hold = call => call.method === 'GET' && call.path.startsWith('/rest/v1/project_updates');
    const archive = callAsCloudOwner('owner-a', () => Supabase.archiveProjectUpdate({ id: 'update-1', archivedAt: '2026-10-02T08:00:00.000Z', projectId: PROJECT }));
    for (let i = 0; i < 300 && !network.held; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    expect(network.held).not.toBeNull();
    // A signs out and B signs in while the archive's read is still waiting.
    expect((await Supabase.signOut('local')).ok).toBe(true);
    expect((await Supabase.signIn({ email: 'owner-b@example.com', password: STAND_IN_PASSWORD })).ok).toBe(true);
    network.calls.length = 0;
    network.answer();

    const result = await archive;

    // It went out with B's sign-in, naming B: A's field update, archived, written into B's account.
    expect(result.ok).toBe(false);
    expect(result.error).toBe(ACCOUNT_CHANGED);
    expect(sentToChangeTheCloud()).toEqual([]);
  });
});

describe('sync batch Y4: the last look before a request leaves', () => {
  /** A token shaped as the cloud's are: the account is in its middle part. Made up here; it opens nothing. */
  const tokenOf = (account: string | null) => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `Bearer ${part({ alg: 'none' })}.${part(account ? { sub: account, role: 'authenticated' } : { role: 'anon' })}.made-up`;
  };
  const REST = 'https://isolation-y4.supabase.co/rest/v1';
  const check: typeof Supabase.cloudRequestNamesAnotherAccount =
    (Supabase as Partial<typeof Supabase>).cloudRequestNamesAnotherAccount ?? (() => null);

  it('a request that names one account and carries another account\'s sign-in is refused, whichever way it names it', () => {
    const asB = { Authorization: tokenOf('owner-b') };
    // In its filter (a read, an update, a delete).
    expect(check(`${REST}/schedule_items?select=*&owner_id=eq.owner-a&id=eq.task-1`, undefined, asB, 'owner-b')).toEqual({ named: 'owner-a', signedIn: 'owner-b' });
    // In the row it writes, or the first of several.
    expect(check(`${REST}/schedule_items?on_conflict=id`, JSON.stringify({ id: 'task-1', owner_id: 'owner-a' }), asB, 'owner-b')).toEqual({ named: 'owner-a', signedIn: 'owner-b' });
    expect(check(`${REST}/project_areas`, JSON.stringify([{ id: 'area-1', owner_id: 'owner-a' }]), asB, 'owner-b')).toEqual({ named: 'owner-a', signedIn: 'owner-b' });
    // The sign-in is read from the request itself: what the app believes does not excuse it.
    expect(check(`${REST}/schedule_items?owner_id=eq.owner-a`, undefined, new Headers(asB), 'owner-a')).toEqual({ named: 'owner-a', signedIn: 'owner-b' });
  });

  it('a request that names the account whose sign-in it carries goes out, and so does one that names no account', () => {
    const asA = { Authorization: tokenOf('owner-a') };
    expect(check(`${REST}/schedule_items?owner_id=eq.owner-a`, undefined, asA, 'owner-a')).toBeNull();
    expect(check(`${REST}/schedule_items`, JSON.stringify({ id: 'task-1', owner_id: 'owner-a' }), asA, null)).toBeNull();
    expect(check(`${REST}/rpc/dave_delete_project_update_atomically`, JSON.stringify({ p_update_id: 'update-1' }), { Authorization: tokenOf('owner-b') }, 'owner-b')).toBeNull();
    // Not a request to the database: sign-in, file storage. Not looked at.
    expect(check('https://isolation-y4.supabase.co/auth/v1/token?grant_type=password', JSON.stringify({ owner_id: 'owner-a' }), { Authorization: tokenOf('owner-b') }, 'owner-b')).toBeNull();
    expect(check('https://isolation-y4.supabase.co/storage/v1/object/project-photos/owner_id=eq.owner-a', undefined, { Authorization: tokenOf('owner-b') }, 'owner-b')).toBeNull();
  });

  it('a sign-in that names no account (nobody signed in, or a token it cannot read) is judged by the account the app knows, and only when it knows one', () => {
    const named = `${REST}/schedule_items?owner_id=eq.owner-a`;
    expect(check(named, undefined, { Authorization: tokenOf(null) }, 'owner-b')).toEqual({ named: 'owner-a', signedIn: 'owner-b' });
    expect(check(named, undefined, { Authorization: 'Bearer sign-in-of-b' }, 'owner-b')).toEqual({ named: 'owner-a', signedIn: 'owner-b' });
    expect(check(named, undefined, { Authorization: 'Bearer sign-in-of-a' }, 'owner-a')).toBeNull();
    // Not known: nothing is refused on a guess. The cloud's own rules still stand.
    expect(check(named, undefined, { Authorization: tokenOf(null) }, undefined)).toBeNull();
    expect(check(named, undefined, { Authorization: tokenOf(null) }, null)).toBeNull();
    expect(check(named, undefined, undefined, undefined)).toBeNull();
  });

  it('through the app\'s own client: a read that names the account signed in goes out; nothing is refused that was sent before', async () => {
    await signIn('b');

    await expect(Supabase.getScheduleItem('task-1')).resolves.toMatchObject({ ok: true });

    expect(network.calls.filter(call => call.path.startsWith('/rest/v1/schedule_items')).map(call => [call.signIn, /owner_id=eq\.([^&]+)/.exec(call.path)?.[1]]))
      .toEqual([['sign-in-of-b', 'owner-b']]);
  });
});
