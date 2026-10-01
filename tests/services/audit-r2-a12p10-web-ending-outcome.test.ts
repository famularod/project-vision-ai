/**
 * Whole-app audit A12 pass 10 L1 (30 Sep 2026), at the gateway, with a real
 * supabase-js client over this tab's storage (tests/fixtures/browser-tabs.ts).
 * A second Sign Out of This Computer came while David's sign-in here was
 * out, so this tab ran two endings of the same old sign-in. His sign-in
 * worked, and the second ending's /logout then failed (503): the gateway
 * kept his new sign-in, but said nothing, and the page showed the sign-in
 * form while the tab held his working sign-in.
 *
 * Now signOutThisTabToo says what it left: 'ended' (no sign-in here) or
 * 'kept' (a sign-in of another session or account, left as it is).
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
beforeEach(() => {
  tab.storage = createTabStorage();
  cloud = createTabCloud();
  client = createTabClient(supabaseSecureAuthStorage, cloud);
  gateway = createDAVEWebSupabaseGateway(client);
  stillHeld = [];
});
afterEach(async () => {
  stillHeld.forEach(release => release());
  await new Promise(resolve => setTimeout(resolve, 20));
  closeTabClient(client);
});

async function ownerSignedInHere() {
  storeTabSignIn(tab.storage, 'owner-1');
  await client.auth.initialize();
}

describe('signOutThisTabToo says what it left (A12 pass 10 L1)', () => {
  test.each([
    ['answers', 'ok'],
    ['fails (503)', 503],
    ['cannot be reached', 'dropped'],
  ] as const)('the sign-in it ends leaves when /logout %s: ended', async (_label, logout) => {
    await ownerSignedInHere();
    cloud.state.logout = logout;
    await expect(gateway.signOutThisTabToo('owner-1')).resolves.toBe('ended');
    expect(tabSignIn(tab.storage)).toBeNull();
  });

  test('nothing held here: ended; another account’s sign-in: kept, and nothing is sent', async () => {
    await expect(gateway.signOutThisTabToo('owner-1')).resolves.toBe('ended');
    storeTabSignIn(tab.storage, 'visitor-1');
    await expect(gateway.signOutThisTabToo('owner-1')).resolves.toBe('kept');
    expect(tabSignIn(tab.storage)?.userId).toBe('visitor-1');
    expect(cloud.calls).toEqual([]);
  });

  test('two endings hang, his sign-in here works, then both /logouts fail (503): both kept his new sign-in', async () => {
    await ownerSignedInHere();
    cloud.state.logout = 503;
    const firstLogout = cloud.hold('logout');
    const first = gateway.signOutThisTabToo('owner-1');
    await firstLogout.reached;
    stillHeld.push(firstLogout.release);
    const secondLogout = cloud.hold('logout');
    const second = gateway.signOutThisTabToo('owner-1');
    await secondLogout.reached;
    stillHeld.push(secondLogout.release);

    expect((await gateway.signIn('owner@example.com', TAB_TEST_PASSWORD)).ok).toBe(true);
    const newSignIn = tabSignIn(tab.storage);
    expect(newSignIn?.sessionId).not.toBe(tabSessionId('owner-1', 1));

    secondLogout.release();
    await expect(second).resolves.toBe('kept');
    firstLogout.release();
    await expect(first).resolves.toBe('kept');
    expect(tabSignIn(tab.storage)).toEqual(newSignIn);
  });
});
