/**
 * Tabs of one browser for the web's sign-in, each with a real supabase-js
 * client (auth-js 2.108.2) over its own tab storage, as a browser keeps
 * sessionStorage per tab. The tabs share auth-js's BroadcastChannel (named
 * after the storage key), so each tab's SIGNED_IN, TOKEN_REFRESHED and
 * SIGNED_OUT reach the others with the sending tab's session attached.
 *
 * The cloud is a captured fetch: the account a request is for comes from
 * its own access token, so a request shows whose sign-in it carried. Only
 * 'owner-1' passes the owner check. Nothing reaches the network. Access
 * tokens are shaped as Supabase's: a JWT whose payload carries `sub` and
 * `session_id` (the signature is a stand-in). Each password sign-in starts
 * a new session; a refresh keeps its session id while its tokens change,
 * as Supabase Auth does (A12 pass 9). A password
 * sign-in works with TAB_TEST_PASSWORD (a synthetic test value), and a test
 * can hold the next /logout, refresh or password sign-in to make it slow
 * (A12 pass 7 L1). /logout and a password sign-in can also fail as when the
 * network drops (`'dropped'`: the fetch rejects, A12 pass 8 H1).
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
/** The password every test account signs in with; synthetic, not a secret. */
export const TAB_TEST_PASSWORD = 'synthetic-test-password';

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

const base64Url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

/**
 * The session id of the sign-in an account made at a generation of the
 * cloud, shaped as Supabase's (a UUID). A sign-in stored by storeTabSignIn
 * is generation 1.
 */
export function tabSessionId(userId: string, signInGeneration: number): string {
  const account = String(Object.keys(TAB_ACCOUNTS).indexOf(userId) + 1).padStart(4, '0');
  return `5e55101d-${account}-4000-8000-${String(signInGeneration).padStart(12, '0')}`;
}

/** An access token shaped as Supabase's; no `session_id` claim when null. */
function accessTokenFor(userId: string, sessionId: string | null, expiresAt: number) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    aud: 'authenticated',
    exp: expiresAt,
    iat: expiresAt - 3600,
    sub: userId,
    email: TAB_ACCOUNTS[userId].email,
    role: 'authenticated',
    aal: 'aal1',
    ...(sessionId === null ? {} : { session_id: sessionId }),
  }));
  return `${header}.${payload}.${base64Url('browser-tabs-stand-in-signature')}`;
}

function sessionFor(userId: string, generation: number, expiresAt: number, sessionId: string | null) {
  return {
    access_token: accessTokenFor(userId, sessionId, expiresAt),
    refresh_token: `refresh:${userId}:${generation}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: userId, aud: 'authenticated', email: TAB_ACCOUNTS[userId].email },
  };
}

/**
 * Puts a sign-in in a tab's storage; `expired` as after an hour hidden.
 * `sessionId: null` stores an access token without the `session_id` claim
 * (an old or malformed token).
 */
export function storeTabSignIn(
  storage: TabStorage,
  userId: string,
  { expired = false, sessionId = tabSessionId(userId, 1) }: {
    expired?: boolean;
    sessionId?: string | null;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  storage.setItem(
    `${WEB_KEY_PREFIX}${TAB_STORAGE_KEY}`,
    JSON.stringify(sessionFor(userId, 1, expired ? now - 60 : now + 3600, sessionId)),
  );
}

export function tabHoldsSignIn(storage: TabStorage): boolean {
  return storage.getItem(`${WEB_KEY_PREFIX}${TAB_STORAGE_KEY}`) !== null;
}

/** The claims of an access token shaped as Supabase's, or null. */
function accessTokenClaims(token: string | null | undefined): Record<string, unknown> | null {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Which sign-in a tab holds: its account, refresh token and session id (null
 * when its access token has no `session_id` claim), or null.
 */
export function tabSignIn(storage: TabStorage): Readonly<{
  userId: string;
  refreshToken: string;
  sessionId: string | null;
}> | null {
  const raw = storage.getItem(`${WEB_KEY_PREFIX}${TAB_STORAGE_KEY}`);
  if (!raw) return null;
  const session = JSON.parse(raw) as { access_token: string; refresh_token: string; user: { id: string } };
  const sessionId = accessTokenClaims(session.access_token)?.session_id;
  return {
    userId: session.user.id,
    refreshToken: session.refresh_token,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
  };
}

type CloudCall = Readonly<{ method: string; path: string; userId: string | null }>;
type HeldCall = 'logout' | 'refresh' | 'password';

export function createTabCloud() {
  const calls: CloudCall[] = [];
  let generation = 1;
  const state = {
    logout: 'ok' as 'ok' | 503 | 'dropped',
    password: 'ok' as 'ok' | 'dropped',
    /** false: the tokens it issues carry no `session_id` claim. */
    sessionIdClaim: true,
  };
  /** The session each refresh token it issued belongs to. */
  const sessionOfRefreshToken = new Map<string, string | null>();
  /** A new sign-in's session, or a refreshed one's (same id, new tokens). */
  const issue = (userId: string, sessionId: string | null) => {
    generation += 1;
    const claim = state.sessionIdClaim ? sessionId : null;
    const session = sessionFor(userId, generation, Math.floor(Date.now() / 1000) + 3600, claim);
    sessionOfRefreshToken.set(session.refresh_token, claim);
    return session;
  };
  const dropped = () => new TypeError('Failed to fetch');
  const holds = new Map<HeldCall, Readonly<{ arrived: () => void; released: Promise<void> }>>();
  /** A held call waits here until the test releases it. */
  const waitIfHeld = async (kind: HeldCall) => {
    const held = holds.get(kind);
    if (!held) return;
    holds.delete(kind);
    held.arrived();
    await held.released;
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
  const tokenUser = (token: string | null | undefined) => {
    const sub = accessTokenClaims(token)?.sub;
    if (typeof sub === 'string') return TAB_ACCOUNTS[sub] ? sub : null;
    const [kind, userId] = String(token ?? '').split(':');
    return kind === 'refresh' && TAB_ACCOUNTS[userId] ? userId : null;
  };

  const fetch = async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    const method = init?.method || 'GET';
    const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string };
      const userId = tokenUser(body.refresh_token);
      calls.push({ method, path: '/auth/v1/token?grant_type=refresh_token', userId });
      await waitIfHeld('refresh');
      if (!userId) return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' });
      // The same session, with new tokens. A sign-in stored by
      // storeTabSignIn (generation 1) is tabSessionId(userId, 1); one stored
      // without the claim gets it here, as Supabase Auth adds it to an old
      // token's refresh.
      const refreshToken = String(body.refresh_token);
      const sessionId = sessionOfRefreshToken.has(refreshToken)
        ? sessionOfRefreshToken.get(refreshToken) ?? null
        : tabSessionId(userId, 1);
      return json(200, issue(userId, sessionId));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { email?: string; password?: string };
      const userId = Object.keys(TAB_ACCOUNTS).find(id => TAB_ACCOUNTS[id].email === body.email) ?? null;
      calls.push({ method, path: '/auth/v1/token?grant_type=password', userId });
      await waitIfHeld('password');
      if (state.password === 'dropped') throw dropped();
      if (!userId || body.password !== TAB_TEST_PASSWORD) {
        return json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
      }
      // A new session for every sign-in.
      return json(200, issue(userId, tabSessionId(userId, generation + 1)));
    }
    const userId = tokenUser(bearer);
    calls.push({ method, path: `${url.pathname}${url.search}`, userId });
    if (url.pathname === '/auth/v1/user') {
      return userId
        ? json(200, { id: userId, aud: 'authenticated', email: TAB_ACCOUNTS[userId].email })
        : json(401, { code: 'bad_jwt', message: 'invalid JWT' });
    }
    if (url.pathname === '/auth/v1/logout') {
      await waitIfHeld('logout');
      if (state.logout === 'dropped') throw dropped();
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
    /**
     * The next /logout, refresh or password sign-in is slow: once it has
     * arrived it waits until `release` (what it then answers follows
     * `state` at that time).
     */
    hold(kind: HeldCall) {
      let arrived: () => void = () => undefined;
      let release: () => void = () => undefined;
      const reached = new Promise<void>(resolve => { arrived = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      holds.set(kind, { arrived, released });
      return { reached, release };
    },
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

/**
 * Supabase Auth's rule for refresh tokens, added to the stand-in cloud
 * (batch W1, 6 Oct 2026; the cloud above takes any refresh token it ever
 * issued). Every refresh REPLACES the session's refresh token. A tab that
 * presents the token just before the newest one is forgiven and handed the
 * newest again (its last answer was lost). A token two or more behind is
 * "reuse": the server then ends that sign-in for every tab holding it
 * (gotrue, token_refresh.go). An ended sign-in refuses every refresh, and
 * /user says the session no longer exists. A sign-out ends its session too.
 *
 * `refreshes` lists what each refresh was given: 'replaced', 'forgiven',
 * 'ended-the-sign-in' or 'refused'.
 */
export function withRefreshTokenRule(cloud: TabCloud) {
  type Family = { active: string; parent: string | null; ended: boolean };
  const families = new Map<string, Family>();
  const sessionOfToken = new Map<string, string>();
  const refreshes: Array<Readonly<{ userId: string | null; outcome: 'replaced' | 'forgiven' | 'ended-the-sign-in' | 'refused' }>> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
  const sessionIdOf = (accessToken: unknown) => {
    const claims = accessTokenClaims(typeof accessToken === 'string' ? accessToken : null);
    return typeof claims?.session_id === 'string' ? claims.session_id : `no-session-id:${String(claims?.sub ?? '')}`;
  };
  const userOf = (refreshToken: string) => refreshToken.split(':')[1] ?? null;
  const alreadyUsed = () => json(400, { code: 'refresh_token_already_used', message: 'Invalid Refresh Token: Already Used' });

  const fetch: TabCloud['fetch'] = async (input, init) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const presented = String((JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string }).refresh_token ?? '');
      const known = sessionOfToken.get(presented);
      const family = known ? families.get(known) : undefined;
      if (family?.ended) {
        refreshes.push({ userId: userOf(presented), outcome: 'refused' });
        return alreadyUsed();
      }
      if (family && presented !== family.active && presented !== family.parent) {
        family.ended = true;
        refreshes.push({ userId: userOf(presented), outcome: 'ended-the-sign-in' });
        return alreadyUsed();
      }
      const answer = await cloud.fetch(input, init);
      if (!answer.ok) return answer;
      const issued = await answer.clone().json() as { access_token: string; refresh_token: string };
      if (family && presented === family.parent) {
        // Forgiven: the newest token again, with a new access token.
        refreshes.push({ userId: userOf(presented), outcome: 'forgiven' });
        return json(200, { ...issued, refresh_token: family.active });
      }
      // The newest token (or the first this cloud sees of a stored sign-in): replaced.
      const sessionId = known ?? sessionIdOf(issued.access_token);
      if (families.get(sessionId)?.ended) {
        // A stored sign-in whose session was ended before this cloud saw any of its tokens.
        refreshes.push({ userId: userOf(presented), outcome: 'refused' });
        return alreadyUsed();
      }
      families.set(sessionId, { active: issued.refresh_token, parent: presented, ended: false });
      sessionOfToken.set(presented, sessionId);
      sessionOfToken.set(issued.refresh_token, sessionId);
      refreshes.push({ userId: userOf(presented), outcome: 'replaced' });
      return answer;
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const answer = await cloud.fetch(input, init);
      if (!answer.ok) return answer;
      const issued = await answer.clone().json() as { access_token: string; refresh_token: string };
      const sessionId = sessionIdOf(issued.access_token);
      families.set(sessionId, { active: issued.refresh_token, parent: null, ended: false });
      sessionOfToken.set(issued.refresh_token, sessionId);
      return answer;
    }
    const ended = families.get(sessionIdOf(bearer))?.ended === true;
    if (url.pathname === '/auth/v1/user' && ended) {
      return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' });
    }
    const answer = await cloud.fetch(input, init);
    if (url.pathname === '/auth/v1/logout' && answer.ok) {
      const sessionId = sessionIdOf(bearer);
      families.set(sessionId, { active: '', parent: null, ...families.get(sessionId), ended: true });
    }
    return answer;
  };

  return {
    ...cloud,
    fetch,
    refreshes,
    /** Whether the server has ended the sign-in an access token belongs to. */
    signInEnded: (accessToken: string | null | undefined) => families.get(sessionIdOf(accessToken))?.ended === true,
  };
}
