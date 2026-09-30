/**
 * Owner answer Q21 (30 Sep 2026) on the web, through a real supabase-js client
 * whose fetch is captured (the request auth-js sends is what is checked):
 * - Sign out is this computer only ('local') unless All Devices ('global') is
 *   chosen; All Devices with no connection signs nothing out and says so.
 * - Audit A12 F2: the owner check signs the web out only on a definite answer
 *   (false, 401/403, or a missing sign-in). A check that could not finish
 *   (timeout 57014, 5xx, no network) is a plain Error, so the workspace stays.
 */
import { createClient } from '@supabase/supabase-js';

import {
  createDAVEWebSupabaseGateway,
  DAVEWebAuthorizationError,
  DAVEWebSignOutNeedsConnectionError,
} from '../../services/DAVEWebSupabaseClient';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const PROJECT_URL = 'https://q21-web.supabase.co';
const STORAGE_KEY = 'sb-q21-web-auth-token';
const OWNER_CHECK_INCOMPLETE = 'The owner check could not be completed. Try again shortly.';

type Reply = 'ok' | 'network' | { status: number; body?: unknown };
const cloud = {
  calls: [] as string[],
  user: 'ok' as Reply,
  owner: true as boolean | Reply,
  logout: 'ok' as Reply,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
});

function reply(value: Reply, ok: () => Response): Response {
  if (value === 'network') throw new TypeError('Failed to fetch');
  if (value === 'ok') return ok();
  return json(value.status, value.body ?? { message: `status ${value.status}` });
}

const capturedFetch = jest.fn(async (input: unknown, init?: { method?: string }) => {
  const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
  cloud.calls.push(`${init?.method || 'GET'} ${url.pathname}${url.search}`);
  if (url.pathname === '/auth/v1/user') {
    return reply(cloud.user, () => json(200, { id: 'owner-1', aud: 'authenticated', email: 'owner@example.com' }));
  }
  if (url.pathname === '/auth/v1/logout') return reply(cloud.logout, () => new Response(null, { status: 204 }));
  if (url.pathname === '/rest/v1/rpc/dave_is_app_owner') {
    const owner = cloud.owner;
    return typeof owner === 'boolean' ? json(200, owner) : reply(owner, () => json(200, true));
  }
  if (url.pathname.startsWith('/rest/v1/')) return json(200, []);
  return json(404, { message: `not emulated: ${url.pathname}` });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
}

async function signedInGateway({ signedIn = true } = {}) {
  const storage = memoryStorage();
  if (signedIn) {
    const now = Math.floor(Date.now() / 1000);
    storage.values.set(STORAGE_KEY, JSON.stringify({
      access_token: 'access-owner-1', refresh_token: 'refresh-owner-1', token_type: 'bearer',
      expires_in: 3600, expires_at: now + 3600,
      user: { id: 'owner-1', aud: 'authenticated', email: 'owner@example.com' },
    }));
  }
  const client = createClient(PROJECT_URL, 'q21-anon-key-not-a-secret', {
    auth: { storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: capturedFetch as unknown as typeof fetch },
  });
  return { gateway: createDAVEWebSupabaseGateway(client), storage };
}

const logoutCalls = () => cloud.calls.filter(call => call.startsWith('POST /auth/v1/logout'));
const tableReads = () => cloud.calls.filter(call =>
  call.startsWith('GET /rest/v1/') || call.startsWith('POST /rest/v1/rpc/dave_list'));

beforeEach(() => {
  cloud.calls = [];
  cloud.user = 'ok';
  cloud.owner = true;
  cloud.logout = 'ok';
});

describe('web Sign out: this computer or all devices (owner answer Q21)', () => {
  test('Sign out of this computer sends scope=local, and is the default', async () => {
    const { gateway, storage } = await signedInGateway();
    await gateway.signOut('local');
    expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=local']);
    expect(storage.values.has(STORAGE_KEY)).toBe(false);

    const second = await signedInGateway();
    cloud.calls = [];
    await second.gateway.signOut();
    expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=local']);
  });

  test('Sign out of all devices sends scope=global', async () => {
    const { gateway, storage } = await signedInGateway();
    await gateway.signOut('global');
    expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=global']);
    expect(storage.values.has(STORAGE_KEY)).toBe(false);
  });

  test('all devices with no connection signs nothing out and says it needs a connection', async () => {
    const { gateway, storage } = await signedInGateway();
    cloud.logout = 'network';
    const failure = await gateway.signOut('global').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DAVEWebSignOutNeedsConnectionError);
    expect((failure as Error).message).toBe(
      'Signing out your other devices needs an internet connection, and Vitruvius could not reach the cloud just now. Nothing was signed out.',
    );
    expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=global']);
    // Still signed in on this computer too: nothing was quietly signed out.
    expect(storage.values.has(STORAGE_KEY)).toBe(true);
  });
});

describe('the owner check signs out only on a definite answer (audit A12 F2)', () => {
  const definite: [string, () => void, string][] = [
    ['the owner check says false', () => { cloud.owner = false; }, 'This account is not authorized for the Vitruvius desktop pilot.'],
    ['the owner check is refused 401', () => { cloud.owner = { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }; }, 'This account is not authorized for the Vitruvius desktop pilot.'],
    ['the owner check is refused 403', () => { cloud.owner = { status: 403, body: { code: '42501', message: 'permission denied' } }; }, 'This account is not authorized for the Vitruvius desktop pilot.'],
    ['the sign-in check says the session is gone (403 session_not_found)', () => { cloud.user = { status: 403, body: { code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' } }; }, 'Sign in is required for the Vitruvius desktop pilot.'],
    ['the sign-in check is refused 401', () => { cloud.user = { status: 401, body: { code: 'bad_jwt', msg: 'invalid JWT' } }; }, 'Sign in is required for the Vitruvius desktop pilot.'],
  ];
  test.each(definite)('%s: not authorized (the web signs out)', async (_name, arrange, message) => {
    const { gateway } = await signedInGateway();
    arrange();
    const failure = await gateway.loadAuthorizedRows().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DAVEWebAuthorizationError);
    expect((failure as Error).message).toBe(message);
    expect(tableReads()).toEqual([]);
  });

  test('no saved sign-in: not authorized, without asking the cloud', async () => {
    const { gateway } = await signedInGateway({ signedIn: false });
    const failure = await gateway.loadAuthorizedRows().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DAVEWebAuthorizationError);
    expect((failure as Error).message).toBe('Sign in is required for the Vitruvius desktop pilot.');
    expect(tableReads()).toEqual([]);
  });

  const incomplete: [string, () => void][] = [
    ['the owner check times out (57014)', () => { cloud.owner = { status: 500, body: { code: '57014', message: 'canceling statement due to statement timeout' } }; }],
    ['the owner check gets a 503', () => { cloud.owner = { status: 503, body: { message: 'Service Unavailable' } }; }],
    ['the owner check gets no network', () => { cloud.owner = 'network'; }],
    ['the sign-in check gets no network', () => { cloud.user = 'network'; }],
    ['the sign-in check gets a 503', () => { cloud.user = { status: 503, body: { message: 'Service Unavailable' } }; }],
  ];
  test.each(incomplete)('%s: a plain error, not a sign-out, and nothing is read', async (_name, arrange) => {
    const { gateway, storage } = await signedInGateway();
    arrange();
    const failure = await gateway.loadAuthorizedRows().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DAVEWebAuthorizationError);
    expect((failure as Error).message).toBe(OWNER_CHECK_INCOMPLETE);
    expect(tableReads()).toEqual([]);
    expect(storage.values.has(STORAGE_KEY)).toBe(true);
    expect(logoutCalls()).toEqual([]);

    // The next check that says true reads the workspace again.
    cloud.owner = true;
    cloud.user = 'ok';
    await expect(gateway.loadAuthorizedRows()).resolves.toBeTruthy();
    expect(tableReads().length).toBeGreaterThan(0);
  });
});
