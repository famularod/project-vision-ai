/**
 * Tabs of one browser for the web's sign-in, each with a real supabase-js
 * client (auth-js 2.108.2) over its own tab storage, as a browser keeps
 * sessionStorage per tab. The tabs share auth-js's BroadcastChannel (named
 * after the storage key), so each tab's SIGNED_IN, TOKEN_REFRESHED and
 * SIGNED_OUT reach the others with the sending tab's session attached.
 *
 * The cloud is a captured fetch: the account a request is for comes from
 * its own access token, so a request shows whose sign-in it carried. Only
 * 'owner-1' passes the owner check. Nothing reaches the network.
 *
 * A test needs `document` defined (auth-js opens the channel only in a
 * browser) and Node's BroadcastChannel, and must call closeTabClient on
 * each client it made.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TAB_STORAGE_KEY = 'sb-browser-tabs-auth-token';
const PROJECT_URL = 'https://browser-tabs.supabase.co';
const WEB_KEY_PREFIX = 'dave.web.auth.';

export const TAB_ACCOUNTS: Readonly<Record<string, Readonly<{ email: string; owner: boolean }>>> = {
  'owner-1': { email: 'owner@example.com', owner: true },
  'visitor-1': { email: 'visitor@example.com', owner: false },
};

/** A tab's sessionStorage. */
export function createTabStorage() {
  const values = new Map<string, string>();
  const storage = {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  return storage;
}
export type TabStorage = ReturnType<typeof createTabStorage>;

/** auth-js's view of a tab storage, under the web adapter's key prefix. */
export function tabAuthStorage(storage: TabStorage) {
  return {
    getItem: async (key: string) => storage.getItem(`${WEB_KEY_PREFIX}${key}`),
    setItem: async (key: string, value: string) => { storage.setItem(`${WEB_KEY_PREFIX}${key}`, value); },
    removeItem: async (key: string) => { storage.removeItem(`${WEB_KEY_PREFIX}${key}`); },
  };
}

function sessionFor(userId: string, generation: number, expiresAt: number) {
  return {
    access_token: `access:${userId}:${generation}`,
    refresh_token: `refresh:${userId}:${generation}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: userId, aud: 'authenticated', email: TAB_ACCOUNTS[userId].email },
  };
}

/** Puts a sign-in in a tab's storage; `expired` as after an hour hidden. */
export function storeTabSignIn(
  storage: TabStorage,
  userId: string,
  { expired = false }: { expired?: boolean } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  storage.setItem(
    `${WEB_KEY_PREFIX}${TAB_STORAGE_KEY}`,
    JSON.stringify(sessionFor(userId, 1, expired ? now - 60 : now + 3600)),
  );
}

export function tabHoldsSignIn(storage: TabStorage): boolean {
  return storage.getItem(`${WEB_KEY_PREFIX}${TAB_STORAGE_KEY}`) !== null;
}

type CloudCall = Readonly<{ method: string; path: string; userId: string | null }>;

export function createTabCloud() {
  const calls: CloudCall[] = [];
  let generation = 1;
  const state = { logout: 'ok' as 'ok' | 503 };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
  const tokenUser = (token: string | null | undefined) => {
    const [kind, userId] = String(token ?? '').split(':');
    return (kind === 'access' || kind === 'refresh') && TAB_ACCOUNTS[userId] ? userId : null;
  };

  const fetch = async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    const method = init?.method || 'GET';
    const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string };
      const userId = tokenUser(body.refresh_token);
      calls.push({ method, path: '/auth/v1/token?grant_type=refresh_token', userId });
      if (!userId) return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' });
      generation += 1;
      return json(200, sessionFor(userId, generation, Math.floor(Date.now() / 1000) + 3600));
    }
    const userId = tokenUser(bearer);
    calls.push({ method, path: `${url.pathname}${url.search}`, userId });
    if (url.pathname === '/auth/v1/user') {
      return userId
        ? json(200, { id: userId, aud: 'authenticated', email: TAB_ACCOUNTS[userId].email })
        : json(401, { code: 'bad_jwt', message: 'invalid JWT' });
    }
    if (url.pathname === '/auth/v1/logout') {
      if (state.logout === 503) return json(503, { message: 'Service Unavailable' });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/rpc/dave_is_app_owner') {
      return json(200, Boolean(userId && TAB_ACCOUNTS[userId].owner));
    }
    if (url.pathname.startsWith('/rest/v1/')) return json(200, []);
    return json(404, { message: `not emulated: ${url.pathname}` });
  };

  return {
    calls,
    state,
    fetch,
    /** Every call that went out with a sign-in, by path. */
    callsFor: (path: string) => calls.filter(call => call.path.startsWith(path)),
  };
}
export type TabCloud = ReturnType<typeof createTabCloud>;

export function createTabClient(
  storage: ReturnType<typeof tabAuthStorage> | Readonly<{
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  }>,
  cloud: TabCloud,
): SupabaseClient {
  return createClient(PROJECT_URL, 'browser-tabs-anon-key-not-a-secret', {
    auth: {
      storage,
      storageKey: TAB_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: cloud.fetch as unknown as typeof fetch },
  });
}

/** Closes the tab's end of auth-js's channel so the test can finish. */
export function closeTabClient(client: SupabaseClient) {
  const auth = client.auth as unknown as { broadcastChannel?: BroadcastChannel | null };
  auth.broadcastChannel?.close();
  auth.broadcastChannel = null;
}

/** Records the auth events a tab's client hears, after its start-up one. */
export function recordTabAuthEvents(client: SupabaseClient) {
  const events: string[] = [];
  const { data } = client.auth.onAuthStateChange(event => {
    if (event !== 'INITIAL_SESSION') events.push(event);
  });
  return { events, stop: () => data.subscription.unsubscribe() };
}
