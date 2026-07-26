/**
 * Audit P0-14 / P1-30: Supabase auth tokens must live in SecureStore,
 * chunked past platform value limits, with legacy AsyncStorage sessions
 * migrated on first read and never left behind insecurely.
 */

import fs from 'fs';
import path from 'path';

const mockSecureState = new Map<string, string>();
let mockSecureAvailable = true;
let mockSecureSetCount = 0;
let mockFailSecureSetAt: number | null = null;

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => mockSecureAvailable),
  getItemAsync: jest.fn(async (key: string) => mockSecureState.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureSetCount += 1;
    if (mockSecureSetCount === mockFailSecureSetAt) {
      throw new Error('injected secure write failure');
    }
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
  mockSecureSetCount = 0;
  mockFailSecureSetAt = null;
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
    const someChunk = [...mockSecureState.keys()].find((k) => k.endsWith('.1'));
    mockSecureState.delete(someChunk as string);

    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the prior complete token when replacement chunk writing is interrupted', async () => {
    const prior = `prior-${'a'.repeat(4000)}`;
    const replacement = `replacement-${'b'.repeat(4000)}`;
    await supabaseSecureAuthStorage.setItem(KEY, prior);
    mockFailSecureSetAt = mockSecureSetCount + 2;

    await expect(supabaseSecureAuthStorage.setItem(KEY, replacement))
      .rejects.toThrow('injected secure write failure');

    mockFailSecureSetAt = null;
    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe(prior);
  });

  it('keeps the prior complete token when replacement manifest publication fails', async () => {
    const prior = `prior-${'a'.repeat(4000)}`;
    const replacement = `replacement-${'b'.repeat(4000)}`;
    await supabaseSecureAuthStorage.setItem(KEY, prior);
    const replacementChunkCount = Math.ceil(replacement.length / 1800);
    mockFailSecureSetAt = mockSecureSetCount + replacementChunkCount + 1;

    await expect(supabaseSecureAuthStorage.setItem(KEY, replacement))
      .rejects.toThrow('injected secure write failure');

    mockFailSecureSetAt = null;
    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBe(prior);
  });

  it('fails closed without reading or writing plaintext when SecureStore is unavailable', async () => {
    mockSecureAvailable = false;
    mockAsyncState.set(KEY, 'legacy-plaintext-session');
    resetAuthStorageAvailabilityForTests();

    expect(await isAuthStorageSecure()).toBe(false);
    expect(await supabaseSecureAuthStorage.getItem(KEY)).toBeNull();
    expect(mockAsyncState.has(KEY)).toBe(false);
    await expect(supabaseSecureAuthStorage.setItem(KEY, 'must-not-persist'))
      .rejects.toThrow('Secure auth storage is unavailable');
    expect(mockAsyncState.has(KEY)).toBe(false);
    expect(mockSecureState.size).toBe(0);
  });

  it('removes legacy plaintext during sign-out even when SecureStore is unavailable', async () => {
    mockSecureAvailable = false;
    mockAsyncState.set(KEY, 'legacy-plaintext-session');
    resetAuthStorageAvailabilityForTests();

    await supabaseSecureAuthStorage.removeItem(KEY);

    expect(mockAsyncState.has(KEY)).toBe(false);
    expect(mockSecureState.size).toBe(0);
  });

  it('reports secure when SecureStore is available', async () => {
    expect(await isAuthStorageSecure()).toBe(true);
  });

  it('makes session token lookup depend on verified secure storage', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../services/SupabaseService.ts'),
      'utf8',
    );
    const secureCheck = source.indexOf('if (!(await isAuthStorageSecure())) return false;');
    const probeWrite = source.indexOf(
      "await supabaseAuthStorage.setItem(AUTH_STORAGE_PROBE_KEY, 'ok')",
    );

    expect(secureCheck).toBeGreaterThan(0);
    expect(secureCheck).toBeLessThan(probeWrite);
    expect(source).toContain("missingReason: 'storage_unavailable'");
  });
});
