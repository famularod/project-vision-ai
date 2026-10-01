/**
 * Whole-app audit A12 pass 5 L2 (30 Sep 2026), through a real supabase-js
 * client that keeps its sign-in in the web's tab storage (the reviewed
 * sessionStorage adapter) and whose fetch is captured. When the same account
 * signs out of this computer in another tab, this tab's own stored sign-in
 * ends too: on the server when it can be reached, and from this tab's
 * storage either way. Another account's sign-in is never touched, and a tab
 * holding no sign-in sends nothing (so tabs never answer each other's
 * sign-outs back and forth).
 */
const sessionState = new Map<string, string>();
const sessionStorage = {
  getItem: (key: string) => sessionState.get(key) ?? null,
  setItem: (key: string, value: string) => { sessionState.set(key, value); },
  removeItem: (key: string) => { sessionState.delete(key); },
  clear: () => { sessionState.clear(); },
  key: (index: number) => [...sessionState.keys()][index] ?? null,
  get length() { return sessionState.size; },
};
Object.defineProperty(global, 'window', {
  configurable: true,
  value: { sessionStorage },
});

import { createClient } from '@supabase/supabase-js';

import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import {
  browserTabSignInUserId,
  forgetBrowserTabSignIn,
  supabaseSecureAuthStorage,
} from '../../services/SupabaseAuthStorage.web';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const PROJECT_URL = 'https://a12p5-web.supabase.co';
const STORAGE_KEY = 'sb-a12p5-web-auth-token';
const STORED_KEY = `dave.web.auth.${STORAGE_KEY}`;

const cloud = { calls: [] as string[], logout: 'ok' as 'ok' | 'network' };
const capturedFetch = jest.fn(async (input: unknown, init?: { method?: string }) => {
  const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
  cloud.calls.push(`${init?.method || 'GET'} ${url.pathname}${url.search}`);
  if (url.pathname === '/auth/v1/logout') {
    if (cloud.logout === 'network') throw new TypeError('Failed to fetch');
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify({ message: 'not emulated' }), {
    status: 404, headers: { 'content-type': 'application/json' },
  });
});
const logoutCalls = () => cloud.calls.filter(call => call.startsWith('POST /auth/v1/logout'));

function storeSignIn(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  sessionState.set(STORED_KEY, JSON.stringify({
    access_token: `access-${userId}`, refresh_token: `refresh-${userId}`, token_type: 'bearer',
    expires_in: 3600, expires_at: now + 3600,
    user: { id: userId, aud: 'authenticated', email: `${userId}@example.com` },
  }));
}

function tabGateway() {
  const client = createClient(PROJECT_URL, 'a12p5-anon-key-not-a-secret', {
    auth: {
      storage: supabaseSecureAuthStorage,
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: capturedFetch as unknown as typeof fetch },
  });
  return createDAVEWebSupabaseGateway(client);
}

beforeEach(() => {
  sessionState.clear();
  cloud.calls = [];
  cloud.logout = 'ok';
});

describe('this tab’s stored sign-in', () => {
  test('the account it belongs to is read from this tab’s storage, without asking the cloud', () => {
    expect(browserTabSignInUserId()).toBeNull();
    storeSignIn('owner-1');
    expect(browserTabSignInUserId()).toBe('owner-1');
    expect(tabGateway().storedSignInUserId()).toBe('owner-1');
    expect(cloud.calls).toEqual([]);
  });

  test('anything else in the tab’s storage is not a sign-in', () => {
    sessionState.set('dave.web.auth.sb-a12p5-web-auth-token-code-verifier', 'verifier');
    sessionState.set('other.app.key', JSON.stringify({ access_token: 'x', user: { id: 'someone' } }));
    sessionState.set('dave.web.auth.broken', '{not json');
    expect(browserTabSignInUserId()).toBeNull();

    forgetBrowserTabSignIn();
    expect([...sessionState.keys()]).toEqual(['other.app.key']);
  });
});

describe('signOutThisTabToo (A12 pass 5 L2)', () => {
  test('the same account: this tab’s sign-in ends on the server and in this tab', async () => {
    storeSignIn('owner-1');
    await tabGateway().signOutThisTabToo('owner-1');
    expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=local']);
    expect(sessionState.has(STORED_KEY)).toBe(false);
    expect(browserTabSignInUserId()).toBeNull();
  });

  test('the server cannot be reached: the sign-in still leaves this tab, and nothing throws', async () => {
    storeSignIn('owner-1');
    cloud.logout = 'network';
    // It says what it left (A12 pass 10 L1): no sign-in here.
    await expect(tabGateway().signOutThisTabToo('owner-1')).resolves.toBe('ended');
    expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=local']);
    expect(sessionState.has(STORED_KEY)).toBe(false);
  });

  test('another account’s sign-in in this tab is kept, and nothing is sent', async () => {
    storeSignIn('owner-1');
    await tabGateway().signOutThisTabToo('visitor-1');
    expect(cloud.calls).toEqual([]);
    expect(browserTabSignInUserId()).toBe('owner-1');
  });

  test('a tab holding no sign-in sends nothing', async () => {
    await tabGateway().signOutThisTabToo('owner-1');
    expect(cloud.calls).toEqual([]);
  });
});
