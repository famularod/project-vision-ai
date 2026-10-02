/**
 * Browser-only Supabase session storage.
 *
 * The native SecureStore adapter must never be bundled into web. Browser
 * sessions are deliberately scoped to the current tab through sessionStorage:
 * refreshes and same-tab navigation survive, and other tabs do not share it.
 * Closing the tab does not end the sign-in for good: the browser's Reopen
 * Closed Tab (and restoring a session) brings the tab back with its
 * sessionStorage, still signed in (whole-app audit A12 pass 7). Tokens are
 * never copied into AsyncStorage or localStorage. Server-side RLS remains
 * the authorization boundary.
 */

export const SUPABASE_AUTH_STORAGE_LABEL = 'Browser session adapter' as const;

const KEY_PREFIX = 'dave.web.auth.';

function browserSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.sessionStorage;
    const probeKey = `${KEY_PREFIX}availability`;
    storage.setItem(probeKey, 'ok');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function browserAuthKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/**
 * Maintains the shared service contract. On web this means the reviewed,
 * tab-scoped browser store is available; it does not claim hardware-backed
 * encryption against script execution in the page.
 */
export async function isAuthStorageSecure(): Promise<boolean> {
  return browserSessionStorage() !== null;
}

export const supabaseSecureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    return browserSessionStorage()?.getItem(browserAuthKey(key)) ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const storage = browserSessionStorage();
    if (!storage) {
      throw new Error('Browser session storage is unavailable; the session was not persisted.');
    }
    storage.setItem(browserAuthKey(key), value);
  },

  async removeItem(key: string): Promise<void> {
    browserSessionStorage()?.removeItem(browserAuthKey(key));
  },
};

/** Every entry this adapter keeps in this tab's storage. */
function storedAuthKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

/**
 * Which sign-in this tab holds: whose, and which session (A12 pass 9); the
 * session is null when its access token does not say.
 */
export type BrowserTabStoredSignIn = Readonly<{ userId: string; sessionId: string | null }>;

/**
 * A text claim of a Supabase access token, read from its payload only
 * (base64url JSON): the signature is not checked, as this only tells apart
 * sign-ins this tab already holds, and the server still checks every
 * request. Null when the token is not a JWT or has no such claim. The token
 * is never logged.
 */
function accessTokenClaim(accessToken: string, claim: 'session_id' | 'sub'): string | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3 || typeof atob !== 'function') return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as unknown;
    if (!claims || typeof claims !== 'object') return null;
    const value = (claims as Record<string, unknown>)[claim];
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/**
 * The `session_id` claim of a Supabase access token: which sign-in it
 * belongs to. Every sign-in starts a new session, and its refreshes keep it
 * while its tokens change. Null when the token does not say.
 */
function accessTokenSessionId(accessToken: string): string | null {
  return accessTokenClaim(accessToken, 'session_id');
}

/** The account a stored Supabase session belongs to, and its session. */
function storedSession(raw: string | null): BrowserTabStoredSignIn | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as unknown;
    if (!session || typeof session !== 'object') return null;
    const { access_token: accessToken, user } = session as {
      access_token?: unknown;
      user?: unknown;
    };
    if (typeof accessToken !== 'string' || !user || typeof user !== 'object') return null;
    const id = (user as { id?: unknown }).id;
    if (typeof id !== 'string' || !id.trim()) return null;
    return { userId: id, sessionId: accessTokenSessionId(accessToken) };
  } catch {
    return null;
  }
}

/**
 * This tab's own stored sign-in, read from this tab's storage without asking
 * the cloud; null when it holds none. Its session tells one sign-in of an
 * account from a later one, and stays the same through its refreshes
 * (whole-app audit A12 pass 9; its refresh token had, A12 pass 7 L1).
 */
export function browserTabStoredSignIn(): BrowserTabStoredSignIn | null {
  const storage = browserSessionStorage();
  if (!storage) return null;
  for (const key of storedAuthKeys(storage)) {
    const signIn = storedSession(storage.getItem(key));
    if (signIn) return signIn;
  }
  return null;
}

/**
 * The account this tab's own stored sign-in belongs to, read from this tab's
 * storage without asking the cloud; null when it holds none. Other tabs
 * keep their own sign-ins, so a sign-out in another tab is acted on only
 * when it was this same account's (whole-app audit A12 pass 5 L2).
 */
export function browserTabSignInUserId(): string | null {
  return browserTabStoredSignIn()?.userId ?? null;
}

/**
 * Whether an access token is for the account this tab's own stored sign-in
 * belongs to (owner answer Q26, 2 Oct 2026): its `sub` claim, read as the
 * session is above. False when this tab holds no sign-in, or the token does
 * not say whose it is. auth-js passes this tab every other tab's refresh and
 * sign-in, with that tab's tokens; this tells his own from another
 * account's.
 */
export function accessTokenIsForBrowserTabSignIn(accessToken: string): boolean {
  const ownUserId = browserTabSignInUserId();
  return ownUserId !== null && accessTokenClaim(accessToken, 'sub') === ownUserId;
}

/**
 * Removes this tab's stored sign-in when the cloud could not be told
 * (A12 pass 5 L2): the sign-in still leaves this tab.
 */
export function forgetBrowserTabSignIn(): void {
  const storage = browserSessionStorage();
  if (!storage) return;
  storedAuthKeys(storage).forEach(key => storage.removeItem(key));
}

/** Test-only parity with the native adapter. */
export function resetAuthStorageAvailabilityForTests(): void {
  // Availability is checked for every operation so browser privacy-mode changes
  // fail closed without a cached result.
}
