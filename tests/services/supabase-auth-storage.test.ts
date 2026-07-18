/**
 * Audit P0-14 / P1-30: Supabase auth tokens must live in SecureStore,
 * chunked past platform value limits, with legacy AsyncStorage sessions
 * migrated on first read and never left behind insecurely.
 */

const mockSecureState = new Map<string, string>();
let mockSecureAvailable = true;

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => mockSecureAvailable),
  getItemAsync: jest.fn(async (key: string) => mockSecureState.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureState.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureState.delete(key);
  }),
}));

const mockAsyncState = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockAsyncState.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockAsyncState.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockAsyncState.delete(key);
    }),
  },
}));

import {
  isAuthStorageSecure,
  resetAuthStorageAvailabilityForTests,
  supabaseSecureAuthStorage,
} from '../../services/SupabaseAuthStorage';

const KEY = 'sb-project-auth-token';

beforeEach(() => {
  mockSecureState.clear();
  mockAsyncState.clear();
  mockSecureAvailable = true;
  resetAuthStorageAvailabilityForTests();
});

describe('supabaseSecureAuthStorage', () => {
  it('round-trips a small value through SecureStore, not AsyncStorage', async () => {
    await supabaseSecureAuthStorage.setItem(KEY, 'session-json');

    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe('session-json');
    expect(mockAsyncState.has(KEY)).toBe(false);
    expect(mockSecureState.size).toBeGreaterThan(0);
  });

  it('chunks values beyond the SecureStore size limit and reassembles them', async () => {
    const large = 'x'.repeat(5000) + JSON.stringify({ refresh_token: 'r'.repeat(500) });

    await supabaseSecureAuthStorage.setItem(KEY, large);

    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe(large);
    const chunkEntries = [...mockSecureState.keys()].filter((k) => k.includes('.chunk.'));
    expect(chunkEntries.length).toBeGreaterThan(1);
    for (const chunk of chunkEntries) {
      expect((mockSecureState.get(chunk) as string).length).toBeLessThanOrEqual(1800);
    }
  });

  it('shrinks stored chunk count when a shorter value replaces a longer one', async () => {
    await supabaseSecureAuthStorage.setItem(KEY, 'y'.repeat(6000));
    await supabaseSecureAuthStorage.setItem(KEY, 'short');

    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe('short');
    const chunkEntries = [...mockSecureState.keys()].filter((k) => k.includes('.chunk.'));
    expect(chunkEntries).toHaveLength(1);
  });

  it('migrates a legacy AsyncStorage session to SecureStore and removes the insecure copy', async () => {
    mockAsyncState.set(KEY, 'legacy-session');

    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe('legacy-session');
    expect(mockAsyncState.has(KEY)).toBe(false);
    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe('legacy-session');
  });

  it('removeItem clears secure chunks, meta, and any legacy copy', async () => {
    mockAsyncState.set(KEY, 'legacy');
    await supabaseSecureAuthStorage.setItem(KEY, 'z'.repeat(4000));

    await supabaseSecureAuthStorage.removeItem(KEY);

    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBeNull();
    expect(mockSecureState.size).toBe(0);
    expect(mockAsyncState.has(KEY)).toBe(false);
  });

  it('treats a torn write (missing chunk) as absent, never as a truncated session', async () => {
    await supabaseSecureAuthStorage.setItem(KEY, 'a'.repeat(4000));
    const someChunk = [...mockSecureState.keys()].find((k) => k.includes('.chunk.1'));
    mockSecureState.delete(someChunk as string);

    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBeNull();
  });

  it('falls back to AsyncStorage and reports insecure when SecureStore is unavailable', async () => {
    mockSecureAvailable = false;
    resetAuthStorageAvailabilityForTests();

    await supabaseSecureAuthStorage.setItem(KEY, 'fallback-session');

    expect(await isAuthStorageSecure()).toBe(false);
    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe('fallback-session');
    expect(mockAsyncState.get(KEY)).toBe('fallback-session');
    expect(mockSecureState.size).toBe(0);
  });

  it('reports secure when SecureStore is available', async () => {
    expect(await isAuthStorageSecure()).toBe(true);
  });
});
