/**
 * Owner answer Q26 (2 Oct 2026), from whole-app audit A12 pass 6 (a Low),
 * with two real supabase-js clients as two tabs of one browser
 * (tests/fixtures/browser-tabs.ts). Nothing connects: the live-update
 * channel here is made but never joined, and what it would join with is
 * read from it.
 *
 * supabase-js gives a tab's live-update (realtime) connection the access
 * token of every refresh and sign-in its auth client hears, and auth-js
 * passes each tab every other tab's, with that tab's tokens. Another
 * account's tab refreshing had made David's tab's live updates sign in as
 * that account until that tab signed out or he clicked back into his tab.
 * The cloud's owner check kept every row from it, so nothing reached the
 * wrong account, but he missed live updates meanwhile. His email and the
 * "confirmed by" name already kept his own sign-in (A12 pass 6 L1).
 *
 * Now his tab's live updates keep his own sign-in too: another account's
 * refresh or sign-in is left out, his own refreshes still update it, and
 * signing out and in again here behaves as before. Another tab of his own
 * account refreshing is still taken, as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_ACCOUNTS,
  TAB_STORAGE_KEY,
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  recordTabAuthEvents,
  storeTabSignIn,
  tabAuthStorage,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalWarn = console.warn;

/** The key the fixture's clients send when no one is signed in. */
const ANON_KEY = 'browser-tabs-anon-key-not-a-secret';

let thisTabStorage: TabStorage;
let otherTabStorage: TabStorage;
let cloud: TabCloud;
let thisTab: SupabaseClient;
let otherTab: SupabaseClient;
let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
let heardHere: ReturnType<typeof recordTabAuthEvents>;
let liveUpdates: ReturnType<SupabaseClient['channel']>;

beforeAll(() => {
  // A browser page: auth-js opens its tab channel only when there is one.
  root.document = {
    visibilityState: 'visible',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  // Two clients on one storage key is what two tabs are; auth-js says so.
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
});
afterAll(() => {
  root.document = originalDocument;
  if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  else delete root.sessionStorage;
  jest.restoreAllMocks();
});

/**
 * This tab's storage is the page's own sessionStorage (the web adapter and
 * its stored-sign-in check read it); the other tab has its own. This tab's
 * client is the one its gateway runs on, as the web page's is.
 */
async function openTabs({ here, there }: { here: string | null; there: string | null }) {
  thisTabStorage = createTabStorage();
  otherTabStorage = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    writable: true,
    value: thisTabStorage,
  });
  if (here) storeTabSignIn(thisTabStorage, here);
  if (there) storeTabSignIn(otherTabStorage, there);
  cloud = createTabCloud();
  thisTab = createTabClient(supabaseSecureAuthStorage, cloud);
  gateway = createDAVEWebSupabaseGateway(thisTab);
  otherTab = createTabClient(tabAuthStorage(otherTabStorage), cloud);
  await Promise.all([thisTab.auth.initialize(), otherTab.auth.initialize()]);
  // The live-update channel, made but never joined: it holds the token it
  // would join with. auth-js starts up with INITIAL_SESSION, which
  // supabase-js does not pass on; the connection takes this tab's own
  // sign-in as it opens, as here.
  liveUpdates = thisTab.channel('owner-answer-q26-live-updates');
  await thisTab.realtime.setAuth();
  heardHere = recordTabAuthEvents(thisTab);
  await settle();
}

afterEach(() => {
  heardHere?.stop();
  known.clear();
  thisTab.realtime.channels.length = 0;
  closeTabClient(thisTab);
  closeTabClient(otherTab);
});

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

async function until(check: () => boolean) {
  for (let tries = 0; tries < 100 && !check(); tries += 1) await settle();
  expect(check()).toBe(true);
}

/** The access token a tab's storage holds, or null. */
function storedToken(storage: TabStorage): string | null {
  const raw = storage.getItem(`dave.web.auth.${TAB_STORAGE_KEY}`);
  return raw ? (JSON.parse(raw) as { access_token: string }).access_token : null;
}

/** The account a token is for (its `sub` claim), or null; never printed. */
function accountOf(token: string | null | undefined): string | null {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const sub = (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/** The token this tab's live updates use, and the one its channel would join with. */
const liveToken = () => thisTab.realtime.accessTokenValue;
const joinToken = () => (liveUpdates.joinPush.payload() as { access_token?: string }).access_token ?? null;

/**
 * Tokens are compared by name, so a failure never prints one (they are
 * synthetic, but no token value is printed).
 */
const known = new Map<string, string>();
function remember(token: string | null, name: string): string {
  if (!token) throw new Error(`no token to name ${name}`);
  known.set(token, name);
  return name;
}
function which(token: string | null | undefined): string {
  if (!token) return 'none';
  if (token === ANON_KEY) return 'no sign-in';
  return known.get(token) ?? `an unnamed ${accountOf(token) ?? 'unknown'} token`;
}

/** Waits until this tab has heard one more of the other tab's events. */
async function heardFromOtherTab(event: string, action: () => Promise<void>) {
  const before = heardHere.events.filter(value => value === event).length;
  await action();
  await until(() => heardHere.events.filter(value => value === event).length > before);
  await settle();
}

describe('another account’s tab (owner answer Q26)', () => {
  test('its refresh does not become this tab’s live-update sign-in', async () => {
    await openTabs({ here: 'owner-1', there: 'visitor-1' });
    remember(storedToken(thisTabStorage), 'his own');
    expect(which(liveToken())).toBe('his own');

    await heardFromOtherTab('TOKEN_REFRESHED', async () => {
      const { error } = await otherTab.auth.refreshSession();
      expect(error).toBeNull();
    });

    expect(accountOf(storedToken(otherTabStorage))).toBe('visitor-1');
    expect(which(liveToken())).toBe('his own');
    expect(which(joinToken())).toBe('his own');
    // This tab's own sign-in is untouched.
    expect(which(storedToken(thisTabStorage))).toBe('his own');
  });

  test('its sign-in does not become this tab’s live-update sign-in', async () => {
    await openTabs({ here: 'owner-1', there: null });
    remember(storedToken(thisTabStorage), 'his own');
    expect(which(liveToken())).toBe('his own');

    await heardFromOtherTab('SIGNED_IN', async () => {
      const { error } = await otherTab.auth.signInWithPassword({
        email: TAB_ACCOUNTS['visitor-1'].email,
        password: TAB_TEST_PASSWORD,
      });
      expect(error).toBeNull();
    });

    expect(accountOf(storedToken(otherTabStorage))).toBe('visitor-1');
    expect(which(liveToken())).toBe('his own');
    expect(which(joinToken())).toBe('his own');
  });

  test('its sign-out leaves this tab’s live updates on his own sign-in', async () => {
    await openTabs({ here: 'owner-1', there: 'visitor-1' });
    remember(storedToken(thisTabStorage), 'his own');
    await heardFromOtherTab('TOKEN_REFRESHED', async () => {
      await otherTab.auth.refreshSession();
    });
    expect(which(liveToken())).toBe('his own');

    await heardFromOtherTab('SIGNED_OUT', async () => {
      const { error } = await otherTab.auth.signOut({ scope: 'local' });
      expect(error).toBeNull();
    });

    // supabase-js then re-reads this tab's own sign-in for it, as before.
    expect(which(liveToken())).toBe('his own');
    expect(which(joinToken())).toBe('his own');
    expect(which(storedToken(thisTabStorage))).toBe('his own');
  });
});

describe('his own sign-in here (unchanged)', () => {
  test('his own refresh still updates this tab’s live updates', async () => {
    await openTabs({ here: 'owner-1', there: 'visitor-1' });
    remember(storedToken(thisTabStorage), 'his first');
    // A minute on, so the refreshed token differs from the first.
    const later = Date.now() + 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);

    try {
      const { error } = await thisTab.auth.refreshSession();
      expect(error).toBeNull();
      await settle();
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }

    const refreshed = storedToken(thisTabStorage);
    expect(which(refreshed)).toBe('an unnamed owner-1 token');
    remember(refreshed, 'his refreshed');
    expect(which(liveToken())).toBe('his refreshed');
    expect(which(joinToken())).toBe('his refreshed');
  });

  test('signing out here and in again: no sign-in, then his new one; another account’s refresh between is left out', async () => {
    await openTabs({ here: 'owner-1', there: 'visitor-1' });
    remember(storedToken(thisTabStorage), 'his first');

    await gateway.signOut('local');
    await until(() => which(liveToken()) === 'no sign-in');
    expect(storedToken(thisTabStorage)).toBeNull();

    // While this tab holds no sign-in, another account's refresh is left out.
    await heardFromOtherTab('TOKEN_REFRESHED', async () => {
      await otherTab.auth.refreshSession();
    });
    expect(which(liveToken())).toBe('no sign-in');
    expect(accountOf(joinToken())).toBeNull();

    const result = await gateway.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD);
    expect(result.ok).toBe(true);
    await settle();
    const signedInAgain = storedToken(thisTabStorage);
    expect(which(signedInAgain)).toBe('an unnamed owner-1 token');
    remember(signedInAgain, 'his new sign-in');
    expect(which(liveToken())).toBe('his new sign-in');
    expect(which(joinToken())).toBe('his new sign-in');

    // Another account's refresh after it still leaves it be.
    await heardFromOtherTab('TOKEN_REFRESHED', async () => {
      await otherTab.auth.refreshSession();
    });
    expect(which(liveToken())).toBe('his new sign-in');
    expect(which(joinToken())).toBe('his new sign-in');
  });

  test('another tab of his own account refreshing is still taken, as before', async () => {
    await openTabs({ here: 'owner-1', there: 'owner-1' });
    remember(storedToken(thisTabStorage), 'his own here');
    const later = Date.now() + 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);

    try {
      await heardFromOtherTab('TOKEN_REFRESHED', async () => {
        const { error } = await otherTab.auth.refreshSession();
        expect(error).toBeNull();
      });
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }

    remember(storedToken(otherTabStorage), 'his other tab’s');
    expect(accountOf(storedToken(otherTabStorage))).toBe('owner-1');
    expect(which(liveToken())).toBe('his other tab’s');
  });
});

describe('a signed-out tab (owner answer Q26)', () => {
  test('another tab’s refresh is not taken for its live updates', async () => {
    await openTabs({ here: null, there: 'owner-1' });
    const before = which(liveToken());
    expect(before).not.toMatch(/owner-1|visitor-1/);

    await heardFromOtherTab('TOKEN_REFRESHED', async () => {
      await otherTab.auth.refreshSession();
    });

    expect(which(liveToken())).toBe(before);
    expect(accountOf(joinToken())).toBeNull();
  });
});
