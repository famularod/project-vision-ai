/**
 * Second review of sync (review p5-sync, pass 2), finding N4 (left from pass 1's G1 / G2; older; owner answer Q45
 * (6 Oct)): the phone's own upload of a document attached to a project or an update.
 *
 * The pass-1 fix made a file leave only as the account it is sent for, but only when its upload is begun "as" an
 * account. The upload queue and Sync Now do that. The phone's own upload of a project document (App.tsx,
 * retryProjectDocumentUpload) called the cloud layer with no account: it looked at the account before the call and
 * after it, not when the file leaves. So a document's file was measured, read and then sent as whoever was signed in
 * by then.
 *
 * The reviewer's two tests of N4 (notes/p5-sync/p5s2-header-never-leaves.test.ts, its last describe) with his stand-ins
 * (the phone's two stores, the measuring of the file, and the network, which writes down every request it is handed).
 * REAL services/SupabaseService.ts with the real supabase-js, storage-js and auth-js, and the real account binding fed
 * by the library's own sign-in events. Two things are changed from his file, and said here:
 *   - his first test asked App.tsx for the text "await uploadPhoto({" inside a wrapper. The call is now handed to the
 *     upload's own account in one line, "sameAccount.asItsAccount(uploadPhoto, {", so that App.tsx gains no line; the
 *     test reads that line;
 *   - his second test made "exactly App.tsx's call", which was the bare call. It now makes App.tsx's call as it is on
 *     the tree it runs on: through the upload's own account where the tree has that, bare where it has not (so the
 *     same test shows the fault on a00b815).
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
/** The file a call measures before sending: held while `hold` is set, as a large file on a slow phone is. */
const mockFile = { hold: false, measuring: false, release: (() => undefined) as () => void };
jest.mock('../../services/FileSizePreflight', () => ({
  ...jest.requireActual('../../services/FileSizePreflight'),
  preflightExpoFileRead: jest.fn(async () => {
    if (mockFile.hold) {
      mockFile.hold = false;
      mockFile.measuring = true;
      await new Promise<void>(resolve => { mockFile.release = resolve; });
      mockFile.measuring = false;
    }
    return { sizeBytes: 2048 };
  }),
  prepareExpoFileUploadPayload: jest.fn(async () => ({ data: new ArrayBuffer(16), sizeBytes: 16 })),
}));

type Sent = { method: string; path: string; headers: Record<string, string> };
const network = { sent: [] as Sent[] };
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
/** Every header of a request, whatever shape it was given in. */
function everyHeader(input: unknown, init?: { headers?: unknown }): Record<string, string> {
  const found: Record<string, string> = {};
  const take = (headers: unknown) => {
    if (!headers) return;
    if (typeof (headers as Headers).forEach === 'function' && typeof (headers as Headers).get === 'function') {
      (headers as Headers).forEach((value, name) => { found[name.toLowerCase()] = value; });
    } else if (Array.isArray(headers)) {
      headers.forEach(pair => { if (Array.isArray(pair)) found[String(pair[0]).toLowerCase()] = String(pair[1]); });
    } else if (typeof headers === 'object') {
      Object.entries(headers as Record<string, unknown>).forEach(([name, value]) => { found[name.toLowerCase()] = String(value); });
    }
  };
  if (input && typeof input === 'object') take((input as { headers?: unknown }).headers);
  take(init?.headers);
  return found;
}
(global as { fetch?: unknown }).fetch = jest.fn(async (input: unknown, init?: { method?: string; body?: unknown; headers?: unknown }) => {
  const request = typeof input === 'string' ? null : input as { url: string; method?: string };
  const url = new URL(String(request ? request.url : input));
  const body = typeof init?.body === 'string' ? init.body : '';
  network.sent.push({ method: init?.method || request?.method || 'GET', path: url.pathname + url.search, headers: everyHeader(input, init) });
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  if (url.pathname === '/auth/v1/token') return json(200, sessionFor(body.includes('owner-a@example.com') ? 'a' : 'b'));
  if (url.pathname.startsWith('/auth/v1/')) return json(200, {});
  if (url.pathname.startsWith('/storage/v1/object/')) return json(200, { Key: url.pathname.replace('/storage/v1/object/', ''), Id: 'object-1' });
  return json(200, []);
});
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://isolation-y6n4.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'y6n4-anon-key-not-a-secret';
jest.setTimeout(120_000);

import * as fs from 'fs';
import * as path from 'path';
import * as CloudOwnerBinding from '../../services/CloudOwnerBinding';
import { bindProjectDocumentUploadToAccount } from '../../services/ProjectDocumentUploadRetry';

const Supabase = require('../../services/SupabaseService') as typeof import('../../services/SupabaseService');
const HEADER = ((CloudOwnerBinding as { CLOUD_REQUEST_ACCOUNT_HEADER?: string }).CLOUD_REQUEST_ACCOUNT_HEADER ?? 'x-vitruvius-sent-for-account').toLowerCase();
/** Typed into the stand-in sign-in server only; it lets anyone in. */
const STAND_IN_PASSWORD = 'stand-in, not a real password';
async function signIn(owner: 'a' | 'b') {
  expect((await Supabase.signIn({ email: `owner-${owner}@example.com`, password: STAND_IN_PASSWORD })).ok).toBe(true);
  expect(CloudOwnerBinding.currentCloudOwner().ownerId).toBe(`owner-${owner}`);
  network.sent.length = 0;
}
const THE_DOCUMENT = {
  bucket: 'project-documents', path: 'documents/project-1/document-9/site-plan.pdf', uri: 'file:///phone/site-plan.pdf',
  contentType: 'application/pdf', upsert: true, reportedSizeBytes: 2048, maxBytes: 50 * 1024 * 1024,
};
type Upload = typeof Supabase.uploadPhoto;
/**
 * App.tsx's own call for a project document's file, as it is on this tree: the upload is bound to the account
 * signed in when it begins (bindProjectDocumentUploadToAccount, as App.tsx binds it), and the file is sent through
 * that binding. On a tree from before this change the binding cannot send anything, and App.tsx's call is the bare one.
 */
function appSendsTheDocumentsFile() {
  const sameAccount = bindProjectDocumentUploadToAccount() as (() => boolean) & { asItsAccount?: (call: Upload, params: Parameters<Upload>[0]) => ReturnType<Upload> };
  return sameAccount.asItsAccount
    ? sameAccount.asItsAccount(Supabase.uploadPhoto, THE_DOCUMENT as never)
    : Supabase.uploadPhoto(THE_DOCUMENT as never);
}
const toStorage = () => network.sent.filter(request => request.path.startsWith('/storage/v1/'));

beforeEach(async () => {
  await Supabase.signOut('local').catch(() => undefined);
  mockSecure.clear();
  network.sent.length = 0;
  mockFile.hold = false;
});

describe('second review, sync N4: the phone\'s own upload of a project document names the account its upload began under', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

  it('App.tsx sends that file through the upload\'s own account, in the line that sent it bare', () => {
    const at = app.indexOf('bucket: PROJECT_DOCUMENT_UPLOAD_FOLDER');
    expect(at).toBeGreaterThan(0);
    const endOfTheLineBefore = app.lastIndexOf('\n', at);
    const line = app.slice(app.lastIndexOf('\n', endOfTheLineBefore - 1) + 1, endOfTheLineBefore).trim();
    // Before: "const result = await uploadPhoto({": nothing named the account (the queue's and Sync Now's uploads are
    // made as their account; this one was not).
    expect(line).toBe('const result = await sameAccount.asItsAccount(uploadPhoto, {');
    // And it is the binding made as the upload begins, a few lines above in the same function.
    const began = app.lastIndexOf('const sameAccount = bindProjectDocumentUploadToAccount();', at);
    expect(began).toBeGreaterThan(app.lastIndexOf('async function retryProjectDocumentUpload(', at));
    // No other place in App.tsx sends a file of that folder.
    expect(app.split('bucket: PROJECT_DOCUMENT_UPLOAD_FOLDER')).toHaveLength(2);
  });

  it('account A signs out and B signs in while that file is being measured: it is not sent with B\'s sign-in, and the upload answers that it was not made', async () => {
    await signIn('a');
    mockFile.hold = true;
    const upload = appSendsTheDocumentsFile();
    for (let i = 0; i < 300 && !mockFile.measuring; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockFile.measuring).toBe(true);
    expect((await Supabase.signOut('local')).ok).toBe(true);
    expect((await Supabase.signIn({ email: 'owner-b@example.com', password: STAND_IN_PASSWORD })).ok).toBe(true);
    network.sent.length = 0;
    mockFile.release();

    const result = await upload;

    // Before (a00b815 and a542898): account A's document left with account B's sign-in.
    expect(toStorage().map(request => [request.path, request.headers.authorization])).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it('account A only signs out while that file is being measured: nothing is sent at all', async () => {
    await signIn('a');
    mockFile.hold = true;
    const upload = appSendsTheDocumentsFile();
    for (let i = 0; i < 300 && !mockFile.measuring; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    expect((await Supabase.signOut('local')).ok).toBe(true);
    network.sent.length = 0;
    mockFile.release();

    const result = await upload;

    expect(toStorage()).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it('one account only: the file goes up as before, with that account\'s own sign-in, and what names the account never reaches the network', async () => {
    await signIn('a');
    mockFile.hold = true; // a slow phone: the file takes a while to measure, and nothing else happens
    const upload = appSendsTheDocumentsFile();
    for (let i = 0; i < 300 && !mockFile.measuring; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    mockFile.release();

    const result = await upload;

    expect(result.ok).toBe(true);
    expect(toStorage().map(request => [request.method, request.path, request.headers.authorization])).toEqual([
      ['POST', '/storage/v1/object/project-documents/documents/project-1/document-9/site-plan.pdf', 'Bearer sign-in-of-a'],
    ]);
    expect(network.sent.filter(request => Object.keys(request.headers).some(name => name === HEADER || /vitruvius|sent-for/i.test(name)))).toEqual([]);
  });

  it('before the app knows who is signed in, the binding names no account and the call is made as it always was', () => {
    let fresh!: typeof import('../../services/ProjectDocumentUploadRetry');
    let binding!: typeof import('../../services/CloudOwnerBinding');
    jest.isolateModules(() => {
      binding = require('../../services/CloudOwnerBinding');
      fresh = require('../../services/ProjectDocumentUploadRetry');
    });
    expect(binding.currentCloudOwner().ownerId).toBeUndefined();
    const sameAccount = fresh.bindProjectDocumentUploadToAccount() as (() => boolean) & { asItsAccount?: <P, R>(call: (params: P) => R, params: P) => R };
    const toldToBeMadeAs = sameAccount.asItsAccount ? sameAccount.asItsAccount((given: string) => `${given}:${binding.cloudOwnerExpectedForThisCall()}`, 'the file') : null;
    expect(toldToBeMadeAs).toBe('the file:null');
    expect(sameAccount()).toBe(true);
  });
});
