/**
 * Whole-app audit A12 pass 9 (30 Sep 2026), at the gateway, with a real
 * supabase-js client over this tab's storage (tests/fixtures/browser-tabs.ts).
 * auth-js 2.108.2 has no lock between a sign-in and a sign-out, and no
 * request timeout.
 *
 * L1: David chose Sign Out of This Computer in another tab, and this tab's
 * /logout hung. He signed in here with a mistyped password, and that request
 * hung too. /logout then failed, and he reloaded: his projects opened with
 * no password. The ending (signOutThisTabToo) waited for every sign-in still
 * awaiting an answer before deciding, even though the stored sign-in was
 * still exactly the one it was ending; a sign-in that never answered kept
 * the old sign-in in the tab, refreshed by auth-js, for good.
 *
 * L2: /logout hung, he signed in, and auth-js refreshed the new sign-in
 * (its refresh token rotated) before /logout failed. The ending knew only
 * the new sign-in's first refresh token, so it deleted the new sign-in,
 * with no SIGNED_OUT.
 *
 * Now the ending decides by session, which a refresh keeps: Supabase puts
 * it in the access token's `session_id` claim. When it settles, a stored
 * sign-in of the session it was ending is removed at once, with no
 * waiting; one of another session (or account) is kept, since in this tab
 * only a sign-in that succeeded writes a new session; a token without the
 * claim is removed.
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
  tabSessionId,
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
/** Held requests a test leaves out; released after it either way. */
let stillHeld: Array<() => void> = [];
const originalWarn = console.warn;

beforeAll(() => {
  // A reload is a second client over this tab's storage.
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(() => {
  tab.storage = createTabStorage();
  cloud = createTabCloud();
  client = createTabClient(supabaseSecureAuthStorage, cloud);
  gateway = createDAVEWebSupabaseGateway(client);
  stillHeld = [];
});
afterEach(async () => {
  stillHeld.forEach(release => release());
  await flush();
  closeTabClient(client);
});

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

/** This tab's sign-in, as the owner; `expired` as after an hour hidden. */
async function signedInHere({ expired = false, sessionId }: {
  expired?: boolean;
  sessionId?: string | null;
} = {}) {
  storeTabSignIn(tab.storage, 'owner-1', { expired, ...(sessionId === undefined ? {} : { sessionId }) });
  await client.auth.initialize();
}

/** Whether the ending has settled within a moment. */
async function settlesNow(ending: Promise<void>) {
  return Promise.race([
    ending.then(() => 'settled' as const),
    new Promise<'still waiting'>(resolve => setTimeout(() => resolve('still waiting'), 100)),
  ]);
}

/** Nothing stored, and a reload (a fresh client over this tab) has no session. */
async function expectSignedOut() {
  expect(tabSignIn(tab.storage)).toBeNull();
  const reloaded = createTabClient(supabaseSecureAuthStorage, cloud);
  try {
    const { data } = await reloaded.auth.getSession();
    expect(data.session).toBeNull();
  } finally {
    closeTabClient(reloaded);
  }
}

/** A reload (a fresh client over this tab) opens this sign-in. */
async function expectReloadKeeps(signIn: ReturnType<typeof tabSignIn>) {
  expect(tabSignIn(tab.storage)).toEqual(signIn);
  const reloaded = createTabClient(supabaseSecureAuthStorage, cloud);
  try {
    const { data } = await reloaded.auth.getSession();
    expect(data.session?.refresh_token).toBe(signIn?.refreshToken);
  } finally {
    closeTabClient(reloaded);
  }
}

describe('the fixture’s tokens carry a session like Supabase’s (A12 pass 9)', () => {
  test('a refresh keeps the session id while the tokens change; each sign-in starts a new one', async () => {
    await signedInHere();
    const stored = tabSignIn(tab.storage);
    expect(stored?.sessionId).toBe(tabSessionId('owner-1', 1));

    await client.auth.refreshSession();
    const refreshed = tabSignIn(tab.storage);
    expect(refreshed?.refreshToken).not.toBe(stored?.refreshToken);
    expect(refreshed?.sessionId).toBe(stored?.sessionId);

    expect((await gateway.signIn('owner@example.com', TAB_TEST_PASSWORD)).ok).toBe(true);
    const signedInAgain = tabSignIn(tab.storage);
    expect(signedInAgain?.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(signedInAgain?.sessionId).not.toBe(stored?.sessionId);

    await client.auth.refreshSession();
    expect(tabSignIn(tab.storage)?.sessionId).toBe(signedInAgain?.sessionId);
  });
});

describe.each([
  ['not expired', false],
  ['expired (an hour hidden)', true],
])('L1: /logout fails while a mistyped sign-in here still awaits an answer; the sign-in is %s (A12 pass 9)', (_label, expired) => {
  test('the ending removes the sign-in it was ending at once, without waiting for his sign-in', async () => {
    await signedInHere({ expired });
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;
    // An expired sign-in was refreshed first: new tokens, the same session.
    const ended = tabSignIn(tab.storage);
    expect(ended?.sessionId).toBe(tabSessionId('owner-1', 1));
    if (expired) expect(ended?.refreshToken).not.toBe('refresh:owner-1:1');

    const passwordSignIn = cloud.hold('password');
    stillHeld.push(passwordSignIn.release);
    const signIn = gateway.signIn('owner@example.com', 'mistyped-test-password');
    await passwordSignIn.reached;
    logout.release();

    // His sign-in has not answered (and may never): the ending settles anyway.
    expect(await settlesNow(ending)).toBe('settled');
    await expectSignedOut();

    // When it does answer, it fails, and the tab stays signed out.
    passwordSignIn.release();
    expect((await signIn).ok).toBe(false);
    await expectSignedOut();
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
  });
});

describe('L2: a sign-in here that succeeded, then refreshed, before /logout failed (A12 pass 9)', () => {
  test.each([
    ['not expired', false],
    ['expired (an hour hidden)', true],
  ])('the ended sign-in was %s: his new sign-in, its token rotated, is kept', async (_label, expired) => {
    await signedInHere({ expired });
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;
    const ended = tabSignIn(tab.storage);

    const signIn = await gateway.signIn('owner@example.com', TAB_TEST_PASSWORD);
    expect(signIn.ok).toBe(true);
    const newSignIn = tabSignIn(tab.storage);
    expect(newSignIn?.sessionId).not.toBe(ended?.sessionId);

    // auth-js refreshes the new sign-in: its refresh token rotates.
    const { error } = await client.auth.refreshSession();
    expect(error).toBeNull();
    const rotated = tabSignIn(tab.storage);
    expect(rotated?.refreshToken).not.toBe(newSignIn?.refreshToken);
    expect(rotated?.refreshToken).not.toBe(signIn.session?.refresh_token);
    expect(rotated?.sessionId).toBe(newSignIn?.sessionId);

    const events: string[] = [];
    const listener = client.auth.onAuthStateChange(event => { events.push(event); });
    logout.release();
    await ending;
    listener.data.subscription.unsubscribe();

    await expectReloadKeeps(rotated);
    expect(events).not.toContain('SIGNED_OUT');
  });
});

describe('which stored sign-in the ending keeps (A12 pass 9)', () => {
  test('H1: refreshed by the ending, then a mistyped sign-in: the refreshed old sign-in (same session) is removed', async () => {
    await signedInHere({ expired: true });
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;
    const refreshed = tabSignIn(tab.storage);
    expect(refreshed?.refreshToken).not.toBe('refresh:owner-1:1');
    expect(refreshed?.sessionId).toBe(tabSessionId('owner-1', 1));

    expect((await gateway.signIn('owner@example.com', 'mistyped-test-password')).ok).toBe(false);
    logout.release();
    await ending;
    await expectSignedOut();
  });

  test('another account’s sign-in made here during the ending is kept', async () => {
    await signedInHere();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;

    expect((await gateway.signIn('visitor@example.com', TAB_TEST_PASSWORD)).ok).toBe(true);
    const visitor = tabSignIn(tab.storage);
    expect(visitor?.userId).toBe('visitor-1');

    logout.release();
    await ending;
    await expectReloadKeeps(visitor);
  });

  test('a stored sign-in whose token has no session_id is removed when /logout fails', async () => {
    await signedInHere({ sessionId: null });
    expect(tabSignIn(tab.storage)?.sessionId).toBeNull();
    cloud.state.logout = 503;

    await gateway.signOutThisTabToo('owner-1');

    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
    await expectSignedOut();
  });

  test('a sign-in made here whose token has no session_id is removed too (it cannot be told apart)', async () => {
    await signedInHere();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    const ending = gateway.signOutThisTabToo('owner-1');
    await logout.reached;

    cloud.state.sessionIdClaim = false;
    expect((await gateway.signIn('owner@example.com', TAB_TEST_PASSWORD)).ok).toBe(true);
    expect(tabSignIn(tab.storage)?.sessionId).toBeNull();

    logout.release();
    await ending;
    await expectSignedOut();
  });
});
