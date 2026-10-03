import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
} from '@supabase/supabase-js';

import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Whole-app audit A12 pass 3 L1 (30 Sep 2026). With an expired access token
// and no network, auth-js 2.108.2 answers getSession() with an error and no
// session but keeps the stored sign-in (GoTrueClient #__loadSession and
// _callRefreshToken). The gateway threw for every error, and the page showed
// the password form. The check now says which case it is: the sign-in is
// kept and the check could not finish (it throws, and the page tries again),
// or auth-js ended the sign-in because the server refused the refresh (no
// session, as when nobody is signed in).

function gatewayWhoseGetSessionAnswers(answer: () => Promise<unknown>) {
  const auth = {
    getUser: jest.fn(),
    getSession: jest.fn(answer),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
  };
  return createDAVEWebSupabaseGateway({ auth, from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() } } as never);
}

describe('the session check (A12 pass 3 L1)', () => {
  test('a refresh that could not reach the server: the sign-in is kept and the check did not finish', async () => {
    const gateway = gatewayWhoseGetSessionAnswers(async () => ({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    }));

    await expect(gateway.getSessionStatus()).rejects.toThrow('The desktop session could not be checked.');
  });

  test('a refresh discarded because another tab changed the sign-in did not finish either', async () => {
    const gateway = gatewayWhoseGetSessionAnswers(async () => ({
      data: { session: null },
      error: new AuthRefreshDiscardedError(),
    }));

    await expect(gateway.getSessionStatus()).rejects.toThrow('The desktop session could not be checked.');
  });

  test('a getSession that throws did not finish', async () => {
    const gateway = gatewayWhoseGetSessionAnswers(async () => {
      throw new Error('storage unavailable');
    });

    await expect(gateway.getSessionStatus()).rejects.toThrow();
  });

  test('a refresh the server refused ended the sign-in: no session', async () => {
    const gateway = gatewayWhoseGetSessionAnswers(async () => ({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'),
    }));

    await expect(gateway.getSessionStatus()).resolves.toEqual({ configured: true, session: null });
  });
});
