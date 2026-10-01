/**
 * Whole-app audit A12 pass 8 H1 (30 Sep 2026), at the gateway, with a real
 * supabase-js client over this tab's storage (tests/fixtures/browser-tabs.ts).
 *
 * This tab's sign-in had expired (an hour hidden). David chose Sign Out of
 * This Computer in another tab, so this tab's ending (signOutThisTabToo)
 * refreshed it first: the refresh token changed. Its refresh or /logout was
 * slow, and he signed in here meanwhile. /logout then failed (503, or the
 * network dropped) while his sign-in was still awaiting an answer, and the
 * sign-in failed too (a mistyped password, or the same drop). The ending
 * took any sign-in still under way as a newer one and kept the refreshed old
 * sign-in: still valid on the server, so a reload opened his projects with
 * no password, and auth-js's automatic refresh would have opened them too.
 *
 * Now the refreshed old sign-in never outlives the ending: a sign-in here
 * that failed, or threw, stores no new session. Since A12 pass 9 the ending
 * decides by session (the access token's `session_id`, which the refresh
 * keeps) without waiting for a sign-in still awaiting an answer
 * (tests/services/audit-r2-a12p9-web-ending-by-session.test.ts).
 */
import { createTabStorage, type TabStorage } from '../fixtures/browser-tabs';

const tab: { storage: TabStorage } = { storage: createTabStorage() };
Object.defineProperty(global, 'window', {
  configurable: true,
  value: {
    get sessionStorage() { return tab.storage; },
  },
});

import type { SupabaseClient } from '@supabase/supabase-js';

import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabCloud,
  storeTabSignIn,
  tabSignIn,
  type TabCloud,
} from '../fixtures/browser-tabs';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

let cloud: TabCloud;
let client: SupabaseClient;
let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
const originalError = console.error;

beforeAll(() => {
  // auth-js logs each dropped request before answering it as an error.
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Failed to fetch')) return;
    originalError(...args);
  });
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(async () => {
  tab.storage = createTabStorage();
  cloud = createTabCloud();
  client = createTabClient(supabaseSecureAuthStorage, cloud);
  gateway = createDAVEWebSupabaseGateway(client);
});
afterEach(() => {
  closeTabClient(client);
});

/** This tab's sign-in, as the owner, expired as after an hour hidden. */
async function expiredSignInHere() {
  storeTabSignIn(tab.storage, 'owner-1', { expired: true });
  await client.auth.initialize();
}

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

type Failure = 'mistyped' | 'dropped';

/** /logout and his sign-in both fail: a 503 and a mistyped password, or a drop. */
function failuresAre(failure: Failure) {
  cloud.state.logout = failure === 'mistyped' ? 503 : 'dropped';
}
function davidSignsIn(failure: Failure) {
  if (failure === 'dropped') cloud.state.password = 'dropped';
  return gateway.signIn(
    'owner@example.com',
    failure === 'mistyped' ? 'mistyped-test-password' : TAB_TEST_PASSWORD,
  );
}

/** Ended for good: nothing stored, no session, no refresh can bring it back. */
async function expectSignedOutForGood() {
  expect(tabSignIn(tab.storage)).toBeNull();
  const { data } = await client.auth.getSession();
  expect(data.session).toBeNull();
  const refreshesBefore = cloud.callsFor('/auth/v1/token?grant_type=refresh_token').length;
  const { data: refreshed } = await client.auth.refreshSession();
  expect(refreshed.session).toBeNull();
  expect(cloud.callsFor('/auth/v1/token?grant_type=refresh_token')).toHaveLength(refreshesBefore);
}

describe.each<Failure>(['mistyped', 'dropped'])(
  'the ending fails while his sign-in awaits an answer, then the sign-in fails (%s) (A12 pass 8 H1)',
  failure => {
    test('a slow /logout: the refreshed old sign-in does not stay in this tab', async () => {
      await expiredSignInHere();
      failuresAre(failure);
      const logout = cloud.hold('logout');
      const ending = gateway.signOutThisTabToo('owner-1');
      await logout.reached;
      // auth-js refreshed the expired sign-in first: its token changed.
      const refreshed = tabSignIn(tab.storage);
      expect(refreshed?.userId).toBe('owner-1');
      expect(refreshed?.refreshToken).not.toBe('refresh:owner-1:1');

      const passwordSignIn = cloud.hold('password');
      const signIn = davidSignsIn(failure);
      await passwordSignIn.reached;
      logout.release();
      await flush();
      passwordSignIn.release();

      expect((await signIn).ok).toBe(false);
      await ending;
      await expectSignedOutForGood();
      expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
    });

    test('a slow refresh: the refreshed old sign-in does not stay in this tab', async () => {
      await expiredSignInHere();
      failuresAre(failure);
      const refresh = cloud.hold('refresh');
      const ending = gateway.signOutThisTabToo('owner-1');
      await refresh.reached;

      const passwordSignIn = cloud.hold('password');
      const signIn = davidSignsIn(failure);
      await passwordSignIn.reached;
      // The refresh answers (nothing new was stored, so auth-js keeps it),
      // and /logout then fails while his sign-in is still out.
      refresh.release();
      await flush();
      expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
      passwordSignIn.release();

      expect((await signIn).ok).toBe(false);
      await ending;
      await expectSignedOutForGood();
    });
  },
);

describe('what a sign-in here must have done to keep the stored sign-in (A12 pass 8 H1)', () => {
  test('a sign-in that threw before storing anything does not count as stored', async () => {
    await expiredSignInHere();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;

    // This tab's storage refuses writes for a moment (full, or blocked):
    // auth-js throws instead of answering, with nothing stored.
    const setItem = tab.storage.setItem;
    tab.storage.setItem = () => { throw new Error('QuotaExceededError'); };
    await expect(gateway.signIn('owner@example.com', TAB_TEST_PASSWORD)).rejects.toThrow();
    tab.storage.setItem = setItem;

    logout.release();
    await ending;
    await expectSignedOutForGood();
  });

  test('a sign-in that succeeded while /logout hung is kept, with the refreshed old one gone', async () => {
    await expiredSignInHere();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;
    const refreshed = tabSignIn(tab.storage);

    const signIn = await gateway.signIn('owner@example.com', TAB_TEST_PASSWORD);
    expect(signIn.ok).toBe(true);
    const newSignIn = tabSignIn(tab.storage);
    expect(newSignIn?.refreshToken).not.toBe(refreshed?.refreshToken);

    logout.release();
    await ending;
    expect(tabSignIn(tab.storage)).toEqual(newSignIn);
    expect(newSignIn?.refreshToken).toBe(signIn.session?.refresh_token);
  });
});
