/**
 * Whole-app audit A1 M3 (owner-approved 30 Sep 2026): an upload pass that
 * began for one account kept going through a sign-out and another account's
 * sign-in, and sent the rest of the first account's work with the new
 * session, into the new account. Queued work is now bound to the account it
 * was queued under: a pass stops at the account change, writes nothing back,
 * and items queued under another account are held, never sent as this one.
 * Real SupabaseService (supabase-js/auth-js, SecureStore adapter),
 * SyncService queue, FieldNoteMobileSync; fetch emulates the auth and REST
 * server locally and nothing leaves the process. (Field-note scenario from
 * the audit reviewer's proof test.)
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

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://bound-uploads.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'a1-anon-key-not-a-secret';
jest.setTimeout(60_000);

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const nowSec = () => Math.floor(Date.now() / 1000);
const userFor = (id: string) => ({
  id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.com`,
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z',
});
const sessionFor = (id: string) => ({
  access_token: `token-${id}`, refresh_token: `refresh-${id}`, token_type: 'bearer',
  expires_in: 3600, expires_at: nowSec() + 3600, user: userFor(id),
});
function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
}
function header(init: { headers?: unknown } | undefined, name: string): string {
  const headers = init?.headers as { get?: (n: string) => string | null } | Record<string, string> | undefined;
  if (!headers) return '';
  if (typeof (headers as { get?: unknown }).get === 'function') return (headers as { get: (n: string) => string | null }).get(name) || '';
  const entry = Object.entries(headers as Record<string, string>).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return entry ? entry[1] : '';
}

/** Every cloud write: whose row it claimed to be, and whose session sent it. */
const writes: { table: string; rowOwner: string; tokenOwner: string; id: string }[] = [];
let holdNextWrite = false;
let releaseHeldWrite: () => void = () => undefined;
let heldWriteSeen = false;

(global as { fetch?: unknown }).fetch = jest.fn(async (input: unknown, init?: { method?: string; body?: string; headers?: unknown }) => {
  const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
  const method = init?.method || 'GET';
  const token = header(init, 'authorization').replace(/^Bearer\s+/i, '');
  const tokenOwner = token.startsWith('token-') ? token.slice('token-'.length) : 'anon';
  if (url.pathname === '/auth/v1/user') return respond(200, userFor(tokenOwner));
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const { email } = JSON.parse(init?.body || '{}');
    return respond(200, sessionFor(String(email).split('@')[0]));
  }
  if (url.pathname === '/rest/v1/rpc/dave_is_app_owner') return respond(200, true);
  const table = url.pathname.replace('/rest/v1/', '');
  if (method === 'POST' || method === 'PATCH') {
    const parsed = JSON.parse(init?.body || '{}');
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (holdNextWrite) {
      holdNextWrite = false;
      heldWriteSeen = true;
      await new Promise<void>(resolve => { releaseHeldWrite = resolve; });
    }
    writes.push({ table, rowOwner: row.owner_id, tokenOwner, id: row.id });
    return respond(201, table === 'schedule_items' ? { id: row.id, item_data: row.item_data } : row);
  }
  if (table === 'projects') {
    const archived = url.searchParams.get('archived') === 'eq.true';
    return respond(200, archived ? [] : [{
      id: PROJECT_ID, owner_id: tokenOwner, name: 'Canopy B', archived: false,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    }], { 'content-range': archived ? '*/0' : '0-0/1' });
  }
  return respond(200, [], { 'content-range': '*/0' });
});

async function signedInAs(owner: string) {
  const service = require('../../services/SupabaseService');
  const { currentCloudOwner } = require('../../services/CloudOwnerBinding');
  if (currentCloudOwner().ownerId && currentCloudOwner().ownerId !== owner) {
    await switchAccount(service, owner);
  } else {
    const { supabaseSecureAuthStorage } = require('../../services/SupabaseAuthStorage');
    await supabaseSecureAuthStorage.setItem('sb-bound-uploads-auth-token', JSON.stringify(sessionFor(owner)));
    await service.getCurrentSessionUser();
  }
  for (let i = 0; i < 100 && currentCloudOwner().ownerId !== owner; i += 1) await new Promise(r => setTimeout(r, 10));
  expect(currentCloudOwner().ownerId).toBe(owner);
  return service;
}
async function switchAccount(service: { signOut: () => Promise<{ ok: boolean }>; signIn: (p: unknown) => Promise<{ ok: boolean }> }, to: string) {
  expect((await service.signOut()).ok).toBe(true);
  expect((await service.signIn({ email: `${to}@example.com`, password: 'not-a-real-password' })).ok).toBe(true);
}
const task = (id: string) => ({
  id, projectName: 'Canopy B', locationName: '', taskName: `Task ${id}`, startDate: '',
  finishDate: '2026-10-02', milestone: '', owner: 'A', contractor: '', percentComplete: 40,
  priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-30T08:05:00.000Z',
});

afterEach(() => {
  require('../../services/SupabaseService').getSupabaseClient()?.auth.stopAutoRefresh();
});

test('field notes syncing when the account changes stay with their account; none go into the new one', async () => {
  const service = await signedInAs('owner-a');
  const { mobileFieldNoteDataSource } = require('../../services/FieldNoteMobileSync');
  const { localFieldNoteRepository, createFieldNote } = require('../../services/FieldNoteRepository');
  for (const id of ['note-a1', 'note-a2', 'note-a3']) {
    await localFieldNoteRepository.save('owner-a', createFieldNote({ id, text: `A private note ${id}` }));
  }

  holdNextWrite = true;
  const pass = mobileFieldNoteDataSource.retryPending('owner-a');
  for (let i = 0; i < 300 && !heldWriteSeen; i += 1) await new Promise(r => setTimeout(r, 10));
  expect(heldWriteSeen).toBe(true);
  await switchAccount(service, 'owner-b');
  releaseHeldWrite();
  const afterPass = await pass;

  const notes = writes.filter(write => write.table === 'field_notes');
  expect(notes).toHaveLength(1); // the insert already on the wire, as owner-a
  expect(notes[0]).toMatchObject({ rowOwner: 'owner-a', tokenOwner: 'owner-a' });
  expect(afterPass.filter((note: { syncState: string }) => note.syncState === 'pending').map((note: { id: string }) => note.id).sort())
    .toEqual(['note-a1', 'note-a2', 'note-a3'].filter(id => id !== notes[0].id).sort());

  // owner-b's own note still syncs, as owner-b.
  await mobileFieldNoteDataSource.save('owner-b', createFieldNote({ id: 'note-b1', text: 'B note' }));
  expect(writes.filter(write => write.table === 'field_notes').slice(1))
    .toEqual([{ table: 'field_notes', rowOwner: 'owner-b', tokenOwner: 'owner-b', id: 'note-b1' }]);
});

test('a queue pass stops at the account change, and the new account never sends the old one\'s queue', async () => {
  const service = await signedInAs('owner-a');
  const SyncService = require('../../services/SyncService');
  for (const id of ['task-1', 'task-2', 'task-3']) await SyncService.queueScheduleItemRecord(task(id), false);
  const queued = await SyncService.getOfflineQueue();
  expect(queued.map((item: { ownerId?: string }) => item.ownerId)).toEqual(['owner-a', 'owner-a', 'owner-a']);

  writes.length = 0;
  heldWriteSeen = false;
  holdNextWrite = true;
  const pass = SyncService.uploadPendingChanges();
  for (let i = 0; i < 300 && !heldWriteSeen; i += 1) await new Promise(r => setTimeout(r, 10));
  expect(heldWriteSeen).toBe(true);
  await switchAccount(service, 'owner-b');
  releaseHeldWrite();
  const result = await pass;

  // Only the write already on the wire went out, as owner-a; nothing as owner-b.
  expect(writes.map(write => [write.rowOwner, write.tokenOwner])).toEqual([['owner-a', 'owner-a']]);
  expect(result.errors.join(' ')).toMatch(/account changed during sync/);
  // Nothing written back: every item is still queued for owner-a.
  expect((await SyncService.getOfflineQueue()).map((item: { id: string }) => item.id))
    .toEqual(queued.map((item: { id: string }) => item.id));

  // owner-b's own pass holds owner-a's items and sends none of them.
  writes.length = 0;
  const next = await SyncService.uploadPendingChanges();
  // (Its own cloud maintenance call is owner-b's business.)
  expect(writes.filter(write => !write.table.startsWith('rpc/'))).toEqual([]);
  expect(next.uploaded).toBe(0);
  expect((await SyncService.getOfflineQueue())).toHaveLength(3);
});
