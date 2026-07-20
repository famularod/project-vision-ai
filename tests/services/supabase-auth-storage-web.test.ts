const sessionState = new Map<string, string>();

const sessionStorage = {
  getItem: jest.fn((key: string) => sessionState.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => { sessionState.set(key, value); }),
  removeItem: jest.fn((key: string) => { sessionState.delete(key); }),
  clear: jest.fn(() => { sessionState.clear(); }),
  key: jest.fn(() => null),
  get length() { return sessionState.size; },
};

Object.defineProperty(global, 'window', {
  configurable: true,
  value: { sessionStorage },
});

import {
  isAuthStorageSecure,
  supabaseSecureAuthStorage,
} from '../../services/SupabaseAuthStorage.web';

describe('browser Supabase auth storage', () => {
  beforeEach(() => {
    sessionState.clear();
    jest.clearAllMocks();
  });

  test('keeps a session in tab-scoped storage under the DAVE namespace', async () => {
    await supabaseSecureAuthStorage.setItem('supabase-token', 'session-json');

    expect(await supabaseSecureAuthStorage.getItem('supabase-token')).toBe('session-json');
    expect([...sessionState.keys()]).toEqual(['dave.web.auth.supabase-token']);
    expect(await isAuthStorageSecure()).toBe(true);
  });

  test('removes the scoped session on sign-out', async () => {
    await supabaseSecureAuthStorage.setItem('supabase-token', 'session-json');
    await supabaseSecureAuthStorage.removeItem('supabase-token');

    expect(await supabaseSecureAuthStorage.getItem('supabase-token')).toBeNull();
  });

  test('fails closed when browser session storage is unavailable', async () => {
    sessionStorage.setItem.mockImplementationOnce(() => { throw new Error('blocked'); });

    await expect(supabaseSecureAuthStorage.setItem('supabase-token', 'session-json'))
      .rejects.toThrow('Browser session storage is unavailable');
  });
});
