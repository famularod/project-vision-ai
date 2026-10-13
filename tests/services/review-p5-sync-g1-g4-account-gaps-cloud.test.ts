/**
 * Review pass 1, sync, findings G1 and G4 (older; owner answer Q45 (6 Oct)): what still left the phone under the
 * next sign-in after sync batch Y4.
 *
 * The first four tests are the reviewer's own (notes/p5-sync/p5s-account-gaps-cloud.test.ts), unchanged in what they
 * do and say; two of them fail on the base (a542898). His rig is the earlier fixer's real-layer rig
 * (tests/services/sync-batch-y4-account-boundary-cloud.test.ts): real SupabaseService with supabase-js and auth-js,
 * the real account binding, a stand-in network and stand-in stores. No real account, no password, no cloud call.
 * Added to the rig by this batch: the file can also be held while it is read or hashed, a file can be large (it then
 * goes up in pieces, by a stand-in), and the stand-in network notes every header a request carries.
 *
 *   G1  a PHOTO's file (and a project's cover photo) left under the next sign-in when the account changed while
 *       the file was being measured: services/SupabaseService.ts uploadPhoto asked who was signed in once, first.
 *   G4  after a document's RECORD had gone up as its own account, the document's search index (its page text) was
 *       sent as whoever was signed in by then, in a request that named no account.
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

/**
 * The file a call measures before sending: held while `hold` is set, as a large file on a slow phone is.
 * (Added by this batch: `holdAt`, which of the three waits is held, and `sizeBytes`, how large the file is.)
 */
const mockFile = {
  hold: false, measuring: false, release: (() => undefined) as () => void,
  holdAt: 'measuring' as 'measuring' | 'reading' | 'hashing', sizeBytes: 2048,
};
const mockHeldWhile = async (step: 'measuring' | 'reading' | 'hashing') => {
  if (!mockFile.hold || mockFile.holdAt !== step) return;
  mockFile.hold = false;
  mockFile.measuring = true;
  await new Promise<void>(resolve => { mockFile.release = resolve; });
  mockFile.measuring = false;
};
jest.mock('../../services/FileSizePreflight', () => ({
  ...jest.requireActual('../../services/FileSizePreflight'),
  preflightExpoFileRead: jest.fn(async () => {
    await mockHeldWhile('measuring');
    return { sizeBytes: mockFile.sizeBytes };
  }),
  prepareExpoFileUploadPayload: jest.fn(async () => {
    await mockHeldWhile('reading');
    return { data: new ArrayBuffer(16), sizeBytes: 16 };
  }),
  hashExpoFileSha256: jest.fn(async () => {
    await mockHeldWhile('hashing');
    return { sha256: 'b'.repeat(64), sizeBytes: mockFile.sizeBytes };
  }),
}));
/** A large file goes up in pieces, with the sign-in it is handed: seen here, sent nowhere. */
const mockLargeFilesSent: Array<{ path: string; signIn: string }> = [];
jest.mock('../../services/ResumableStorageUpload', () => ({
  ...jest.requireActual('../../services/ResumableStorageUpload'),
  uploadFileResumably: jest.fn(async (input: { path: string; accessToken: string }) => {
    mockLargeFilesSent.push({ path: input.path, signIn: input.accessToken });
    return { path: input.path, uploadUrl: null };
  }),
}));

type Call = { method: string; path: string; signIn: string; body: string; headers: string[] };
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
    headers: [...headers.keys()].map(name => name.toLowerCase()),
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
  if (url.pathname.startsWith('/storage/v1/object/')) return json(200, { Key: url.pathname.replace('/storage/v1/object/', ''), Id: 'object-1' });
  if (call.method === 'GET' || call.method === 'HEAD') return json(200, []);
  let sent: unknown = [];
  try { sent = JSON.parse(call.body || '[]'); } catch { sent = []; }
  return json(call.method === 'POST' ? 201 : 200, Array.isArray(sent) ? sent : [sent]);
});
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://isolation-p5s.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'p5s-anon-key-not-a-secret';
jest.setTimeout(60_000);

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as CloudOwnerBinding from '../../services/CloudOwnerBinding';

const { currentCloudOwner } = CloudOwnerBinding;
// As in the fixer's file: so that this also runs on a tree from before the change (594a71d), where a call could not
// be made "as" an account.
const callAsCloudOwner: typeof CloudOwnerBinding.callAsCloudOwner =
  (CloudOwnerBinding as Partial<typeof CloudOwnerBinding>).callAsCloudOwner ?? ((_ownerId, call) => call());

const Supabase = require('../../services/SupabaseService') as typeof import('../../services/SupabaseService');

/** Typed into the stand-in sign-in server only; it lets anyone in. */
const STAND_IN_PASSWORD = 'stand-in, not a real password';
async function signIn(owner: 'a' | 'b') {
  expect((await Supabase.signIn({ email: `owner-${owner}@example.com`, password: STAND_IN_PASSWORD })).ok).toBe(true);
  expect(currentCloudOwner().ownerId).toBe(`owner-${owner}`);
  network.calls.length = 0;
}
/** Account A signs out and account B signs in, on this phone. */
async function accountChangesToB() {
  expect((await Supabase.signOut('local')).ok).toBe(true);
  expect((await Supabase.signIn({ email: 'owner-b@example.com', password: STAND_IN_PASSWORD })).ok).toBe(true);
  expect(currentCloudOwner().ownerId).toBe('owner-b');
  network.calls.length = 0;
}
const waitFor = async (ready: () => boolean) => {
  for (let i = 0; i < 300 && !ready(); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  expect(ready()).toBe(true);
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  network.calls.length = 0;
  network.hold = null;
  network.held = null;
  mockFile.hold = false;
  mockFile.measuring = false;
  mockFile.holdAt = 'measuring';
  mockFile.sizeBytes = 2048;
  mockLargeFilesSent.length = 0;
});
afterEach(async () => {
  await Supabase.signOut('local');
});

describe('G1: a photo\'s file, and the account changes while the file is being measured', () => {
  it('control: no change of account. The file goes out with account A\'s sign-in', async () => {
    await signIn('a');
    const result = await callAsCloudOwner('owner-a', () => Supabase.uploadPhoto({ path: 'canopy-b/update-1/p1.jpg', uri: 'file:///phone/p1.jpg' } as never));
    expect(result.ok).toBe(true);
    expect(network.calls.filter(call => call.path.startsWith('/storage/v1/')).map(call => call.signIn)).toEqual(['sign-in-of-a']);
  });

  it('account A signs out and B signs in while A\'s photo is being measured: the file is not sent with B\'s sign-in', async () => {
    await signIn('a');
    mockFile.hold = true;
    const upload = callAsCloudOwner('owner-a', () => Supabase.uploadPhoto({ path: 'canopy-b/update-1/p1.jpg', uri: 'file:///phone/p1.jpg' } as never));
    await waitFor(() => mockFile.measuring);
    await accountChangesToB();
    mockFile.release();

    const result = await upload;

    // FAILS on d0b60c7 (and on 594a71d): account A's photo file leaves with account B's sign-in, and is answered "ok".
    expect(network.calls.filter(call => call.path.startsWith('/storage/v1/')).map(call => [call.method, call.path, call.signIn])).toEqual([]);
    expect(result.ok).toBe(false);
  });
});

describe('G4: a document\'s search index, sent after its record', () => {
  const documentOfA = {
    id: 'document-1', name: 'Permit', category: 'Permit', projectId: PROJECT, projectName: 'Canopy B', projectNames: ['Canopy B'], uri: '',
    contentSha256: 'a'.repeat(64), extractionMethod: 'embedded_text',
    extractedPages: [{ pageNumber: 1, text: 'PAGE TEXT OF ACCOUNT A' }],
  };

  it('control: no change of account. The record and then the index go out with account A\'s sign-in', async () => {
    await signIn('a');
    await callAsCloudOwner('owner-a', () => Supabase.upsertReferenceDocument(documentOfA as never));
    const index = network.calls.filter(call => call.path.startsWith('/rest/v1/rpc/ecos_'));
    expect(index.map(call => call.signIn)).toEqual(index.map(() => 'sign-in-of-a'));
    expect(index.some(call => call.body.includes('PAGE TEXT OF ACCOUNT A'))).toBe(true);
  });

  it('account A signs out and B signs in while the document\'s record is going up: A\'s page text is not sent with B\'s sign-in', async () => {
    await signIn('a');
    network.hold = call => call.path.startsWith('/rest/v1/reference_documents') && call.method !== 'GET' && call.method !== 'HEAD';
    const write = callAsCloudOwner('owner-a', () => Supabase.upsertReferenceDocument(documentOfA as never));
    await waitFor(() => network.held !== null);
    expect(network.held!.signIn).toBe('sign-in-of-a'); // the record itself left as account A, and lands as A's
    await accountChangesToB();
    network.answer();

    await write;

    // FAILS on d0b60c7 (and on 594a71d): the index request, with account A's page text in it, leaves as account B.
    const asB = network.calls.filter(call => call.path.startsWith('/rest/v1/') && call.signIn === 'sign-in-of-b');
    expect(asB.map(call => [call.path, call.body.includes('PAGE TEXT OF ACCOUNT A') ? 'carries account A\'s page text' : 'no page text'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// This batch's own tests.
// ---------------------------------------------------------------------------------------------------------------
const { CLOUD_ACCOUNT_CHANGED_MESSAGE, noteSignedInOwner } = CloudOwnerBinding;
const SENT_FOR = (CloudOwnerBinding as { CLOUD_REQUEST_ACCOUNT_HEADER?: string }).CLOUD_REQUEST_ACCOUNT_HEADER ?? 'x-vitruvius-sent-for-account';
const storageCalls = () => network.calls.filter(call => call.path.startsWith('/storage/v1/'));
const photoOfA = { path: 'canopy-b/update-1/p1.jpg', uri: 'file:///phone/p1.jpg' } as never;

describe('G1: every wait between "who is signed in" and the file leaving', () => {
  it.each(['measuring', 'reading'] as const)('the account changes while the file is being held at "%s": it is not sent, and the answer says the account changed', async step => {
    await signIn('a');
    mockFile.hold = true;
    mockFile.holdAt = step;
    const upload = callAsCloudOwner('owner-a', () => Supabase.uploadPhoto(photoOfA));
    await waitFor(() => mockFile.measuring);
    await accountChangesToB();
    mockFile.release();
    await expect(upload).resolves.toMatchObject({ ok: false, error: CLOUD_ACCOUNT_CHANGED_MESSAGE });
    expect(storageCalls()).toEqual([]);
  });

  it('a large file (sent in pieces): the account changes while it is being hashed, and no piece is sent', async () => {
    await signIn('a');
    mockFile.sizeBytes = 20 * 1024 * 1024;
    mockFile.hold = true;
    mockFile.holdAt = 'hashing';
    const upload = callAsCloudOwner('owner-a', () => Supabase.uploadPhoto(photoOfA));
    await waitFor(() => mockFile.measuring);
    await accountChangesToB();
    mockFile.release();
    await expect(upload).resolves.toMatchObject({ ok: false, error: CLOUD_ACCOUNT_CHANGED_MESSAGE });
    expect(mockLargeFilesSent).toEqual([]);
  });

  it('a large file: the account changes while it is being measured, and the next account\'s sign-in is never taken for it', async () => {
    await signIn('a');
    mockFile.sizeBytes = 20 * 1024 * 1024;
    mockFile.hold = true;
    const upload = callAsCloudOwner('owner-a', () => Supabase.uploadPhoto(photoOfA));
    await waitFor(() => mockFile.measuring);
    await accountChangesToB();
    mockFile.release();
    await expect(upload).resolves.toMatchObject({ ok: false, error: CLOUD_ACCOUNT_CHANGED_MESSAGE });
    expect(mockLargeFilesSent).toEqual([]);
  });

  it('a large file with no change of account goes up with its own account\'s sign-in', async () => {
    await signIn('a');
    mockFile.sizeBytes = 20 * 1024 * 1024;
    await expect(callAsCloudOwner('owner-a', () => Supabase.uploadPhoto(photoOfA))).resolves.toMatchObject({ ok: true });
    expect(mockLargeFilesSent).toEqual([{ path: 'canopy-b/update-1/p1.jpg', signIn: 'sign-in-of-a' }]);
  });

  it('the last look: the request says which account the file is sent for, and is refused under any other, even when every earlier look passed', async () => {
    await signIn('a');
    // The app learns of the next account in the very instant before the request is built (after the last "who is
    // signed in" was asked): only the request's own account can stop it now.
    const upload = callAsCloudOwner('owner-a', () => Supabase.uploadPhoto({
      path: 'canopy-b/update-1/p1.jpg', uri: 'file:///phone/p1.jpg',
      onProgress: (fraction: number) => { if (fraction === 0) { noteSignedInOwner(null); noteSignedInOwner('owner-b'); } },
    } as never));
    await expect(upload).resolves.toMatchObject({ ok: false });
    expect(storageCalls()).toEqual([]);
    noteSignedInOwner('owner-a'); // as the sign-in really is, for the sign-out that ends the test
  });

  it('what the request says of its account never leaves the phone, and a file sent for no named account is sent as it always was', async () => {
    await signIn('a');
    await expect(callAsCloudOwner('owner-a', () => Supabase.uploadPhoto(photoOfA))).resolves.toMatchObject({ ok: true });
    await expect(Supabase.uploadPhoto(photoOfA)).resolves.toMatchObject({ ok: true }); // no account named
    expect(storageCalls().map(call => [call.signIn, call.headers.includes(SENT_FOR)])).toEqual([['sign-in-of-a', false], ['sign-in-of-a', false]]);
    expect(Supabase.cloudRequestNamesAnotherAccount('https://x.supabase.co/storage/v1/object/project-photos/p1.jpg', null, { [SENT_FOR]: 'owner-a' }, 'owner-b'))
      .toEqual({ named: 'owner-a', signedIn: 'owner-b' });
    expect(Supabase.cloudRequestNamesAnotherAccount('https://x.supabase.co/storage/v1/object/project-photos/p1.jpg', null, new Headers({ [SENT_FOR]: 'owner-a' }), 'owner-a')).toBeNull();
    expect(Supabase.cloudRequestNamesAnotherAccount('https://x.supabase.co/storage/v1/object/project-photos/p1.jpg', null, {}, 'owner-b')).toBeNull();
  });

  it('one account only: the same account signs out and in again while the file is measured: refused once (its sign-in was gone), and the next try sends it', async () => {
    await signIn('a');
    mockFile.hold = true;
    const upload = callAsCloudOwner('owner-a', () => Supabase.uploadPhoto(photoOfA));
    await waitFor(() => mockFile.measuring);
    expect((await Supabase.signOut('local')).ok).toBe(true);
    mockFile.release();
    await expect(upload).resolves.toMatchObject({ ok: false });
    expect(storageCalls()).toEqual([]);
    await signIn('a');
    await expect(callAsCloudOwner('owner-a', () => Supabase.uploadPhoto(photoOfA))).resolves.toMatchObject({ ok: true });
    expect(storageCalls().map(call => call.signIn)).toEqual(['sign-in-of-a']);
  });
});

describe('G4: the search index is the document\'s account\'s, like its record', () => {
  const documentOfA = {
    id: 'document-1', name: 'Permit', category: 'Permit', projectId: PROJECT, projectName: 'Canopy B', projectNames: ['Canopy B'], uri: '',
    contentSha256: 'a'.repeat(64), extractionMethod: 'embedded_text',
    extractedPages: [{ pageNumber: 1, text: 'PAGE TEXT OF ACCOUNT A' }],
  };
  const indexCalls = () => network.calls.filter(call => call.path.startsWith('/rest/v1/rpc/ecos_'));

  it('the account changes while the record is going up: the answer says so, so the document stays waiting for its own account', async () => {
    await signIn('a');
    network.hold = call => call.path.startsWith('/rest/v1/reference_documents') && call.method !== 'GET' && call.method !== 'HEAD';
    const write = callAsCloudOwner('owner-a', () => Supabase.upsertReferenceDocument(documentOfA as never));
    await waitFor(() => network.held !== null);
    await accountChangesToB();
    network.answer();
    await expect(write).resolves.toMatchObject({ ok: false, error: CLOUD_ACCOUNT_CHANGED_MESSAGE });
    expect(indexCalls()).toEqual([]);
  });

  it('the account changes while the page text is going up: the request to prepare the index is not sent as B (the last look)', async () => {
    await signIn('a');
    network.hold = call => call.path.startsWith('/rest/v1/rpc/ecos_replace_document_index');
    const write = callAsCloudOwner('owner-a', () => Supabase.upsertReferenceDocument(documentOfA as never));
    await waitFor(() => network.held !== null);
    expect(network.held!.signIn).toBe('sign-in-of-a');
    await accountChangesToB();
    network.answer();
    await write;
    expect(network.calls.filter(call => call.path.startsWith('/rest/v1/') && call.signIn === 'sign-in-of-b')).toEqual([]);
  });

  it('what the two index requests say of their account never leaves the phone', async () => {
    await signIn('a');
    await expect(callAsCloudOwner('owner-a', () => Supabase.upsertReferenceDocument(documentOfA as never))).resolves.toMatchObject({ ok: true });
    expect(indexCalls().map(call => [call.path, call.signIn, call.headers.includes(SENT_FOR)])).toEqual([
      ['/rest/v1/rpc/ecos_replace_document_index', 'sign-in-of-a', false],
      ['/rest/v1/rpc/ecos_enqueue_hosted_index', 'sign-in-of-a', false],
    ]);
    expect(Supabase.cloudRequestNamesAnotherAccount('https://x.supabase.co/rest/v1/rpc/ecos_replace_document_index', '{"p_document_id":"document-1"}', new Headers({ [SENT_FOR]: 'owner-a' }), 'owner-b'))
      .toEqual({ named: 'owner-a', signedIn: 'owner-b' });
  });

  it('a document sent for no named account (every caller but the upload queue and Sync Now): record and index as they always were', async () => {
    await signIn('a');
    await expect(Supabase.upsertReferenceDocument(documentOfA as never)).resolves.toMatchObject({ ok: true });
    expect(indexCalls().map(call => [call.signIn, call.headers.includes(SENT_FOR)])).toEqual([['sign-in-of-a', false], ['sign-in-of-a', false]]);
  });
});
