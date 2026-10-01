/**
 * Whole-app audit A12 pass 7 L1 (30 Sep 2026), at the gateway, with a real
 * supabase-js client over this tab's storage (tests/fixtures/browser-tabs.ts).
 * When this tab's sign-in ends because another tab signed out
 * (signOutThisTabToo) and auth-js cannot finish it (a refresh it threw away,
 * /logout answering 503), the gateway takes the stored sign-in out itself.
 * It had taken out whatever this tab held by then: a sign-in David made here
 * meanwhile was deleted with no SIGNED_OUT, and the workspace stayed with no
 * sign-in behind it ("Sign in is required…" on the next read).
 *
 * Now it keeps a sign-in made here meanwhile. The provider's wait makes such
 * a sign-in rare; this keeps it if one happens. Since A12 pass 8 H1 it keeps
 * only one that SUCCEEDED, and waits for one still awaiting an answer
 * (tests/services/audit-r2-a12p8-web-ending-failed-sign-in.test.ts).
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

beforeEach(async () => {
  tab.storage = createTabStorage();
  cloud = createTabCloud();
  client = createTabClient(supabaseSecureAuthStorage, cloud);
  gateway = createDAVEWebSupabaseGateway(client);
});
afterEach(() => {
  closeTabClient(client);
});

/** This tab's sign-in, as the owner; `expired` as after an hour hidden. */
async function signedInHere({ expired = false }: { expired?: boolean } = {}) {
  storeTabSignIn(tab.storage, 'owner-1', { expired });
  await client.auth.initialize();
}

describe('signOutThisTabToo keeps a sign-in made here while it ran (A12 pass 7 L1)', () => {
  test('a slow refresh, then a sign-in here: auth-js throws the refresh away, and the new sign-in is kept', async () => {
    await signedInHere({ expired: true });
    const refresh = cloud.hold('refresh');
    const ending = gateway.signOutThisTabToo('owner-1');
    await refresh.reached;

    const signIn = await gateway.signIn('owner@example.com', TAB_TEST_PASSWORD);
    expect(signIn.ok).toBe(true);
    const newSignIn = tabSignIn(tab.storage);
    expect(newSignIn?.refreshToken).not.toBe('refresh:owner-1:1');

    refresh.release();
    await ending;

    expect(tabSignIn(tab.storage)).toEqual(newSignIn);
    // Nothing more went out: the refresh was thrown away, so no /logout.
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(0);
  });

  test('a slow /logout that answers 503, with a sign-in here meanwhile: the new sign-in is kept', async () => {
    await signedInHere();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;

    await gateway.signIn('owner@example.com', TAB_TEST_PASSWORD);
    const newSignIn = tabSignIn(tab.storage);

    logout.release();
    await ending;

    expect(tabSignIn(tab.storage)).toEqual(newSignIn);
    expect(newSignIn?.refreshToken).not.toBe('refresh:owner-1:1');
  });

  test('a mistyped sign-in meanwhile stores nothing: the ended sign-in still leaves this tab on a 503', async () => {
    await signedInHere();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;

    expect((await gateway.signIn('owner@example.com', 'mistyped-test-password')).ok).toBe(false);
    logout.release();
    await ending;

    expect(tabSignIn(tab.storage)).toBeNull();
  });

  test('a sign-in here that has stored its sign-in but not finished yet is kept too', async () => {
    await signedInHere();
    cloud.state.logout = 503;
    // Something else in this tab is slow to hear SIGNED_IN, so the sign-in
    // is still under way after auth-js has stored it.
    let storedNewSignIn: () => void = () => undefined;
    const newSignInStored = new Promise<void>(resolve => { storedNewSignIn = resolve; });
    let letSignInFinish: () => void = () => undefined;
    const signInMayFinish = new Promise<void>(resolve => { letSignInFinish = resolve; });
    const slowListener = client.auth.onAuthStateChange(async event => {
      if (event !== 'SIGNED_IN') return;
      storedNewSignIn();
      await signInMayFinish;
    });
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;

    const signIn = gateway.signIn('owner@example.com', TAB_TEST_PASSWORD);
    await newSignInStored;
    const newSignIn = tabSignIn(tab.storage);
    expect(newSignIn?.refreshToken).not.toBe('refresh:owner-1:1');
    logout.release();

    // Re-pinned for A12 pass 8 H1: the ending now waits for a sign-in still
    // under way to answer before it decides (one that then fails must not
    // keep anything), so it settles after this sign-in finishes. Meanwhile
    // it takes nothing out, and the successful sign-in is kept.
    let ended = false;
    void ending.then(() => { ended = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(ended).toBe(false);
    expect(tabSignIn(tab.storage)).toEqual(newSignIn);
    letSignInFinish();
    expect((await signIn).ok).toBe(true);
    await ending;

    expect(tabSignIn(tab.storage)).toEqual(newSignIn);
    slowListener.data.subscription.unsubscribe();
  });

  test('the ended sign-in still leaves on a 503 after auth-js refreshed it first (its token rotated)', async () => {
    await signedInHere({ expired: true });
    cloud.state.logout = 503;

    await gateway.signOutThisTabToo('owner-1');

    expect(cloud.callsFor('/auth/v1/token?grant_type=refresh_token')).toHaveLength(1);
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
    expect(tabSignIn(tab.storage)).toBeNull();
  });
});
