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

/** Test-only parity with the native adapter. */
export function resetAuthStorageAvailabilityForTests(): void {
  // Availability is checked for every operation so browser privacy-mode changes
  // fail closed without a cached result.
}
