/**
 * Browser-only Supabase session storage.
 *
 * The native SecureStore adapter must never be bundled into web. Browser
 * sessions are deliberately scoped to the current tab through sessionStorage:
 * refreshes and same-tab navigation survive, while closing the tab removes the
 * durable session boundary. Tokens are never copied into AsyncStorage or
 * localStorage. Server-side RLS remains the authorization boundary.
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

/** The account a stored Supabase session belongs to, or null. */
function storedSessionUserId(raw: string | null): string | null {
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
    return typeof id === 'string' && id.trim() ? id : null;
  } catch {
    return null;
  }
}

/**
 * The account this tab's own stored sign-in belongs to, read from this tab's
 * storage without asking the cloud; null when it holds none. Other tabs
 * keep their own sign-ins, so a sign-out in another tab is acted on only
 * when it was this same account's (whole-app audit A12 pass 5 L2).
 */
export function browserTabSignInUserId(): string | null {
  const storage = browserSessionStorage();
  if (!storage) return null;
  for (const key of storedAuthKeys(storage)) {
    const userId = storedSessionUserId(storage.getItem(key));
    if (userId) return userId;
  }
  return null;
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
