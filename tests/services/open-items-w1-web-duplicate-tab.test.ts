/**
 * @jest-environment node
 */
import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { forgetDAVEWebOwnReportSends, forgetDAVEWebReportTabMemory } from '../../services/DAVEWebReportSend';
import {
  DAVE_WEB_SIGN_IN_TAB_KEY,
  DAVE_WEB_SIGN_IN_TURNS_KEY,
  createDAVEWebSignInRefreshGuard,
  type DAVEWebSignInRefreshGuard,
} from '../../services/DAVEWebSignInRefreshGuard';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import { createBrowserLocks, type BrowserLocks } from '../fixtures/browser-locks';
import {
  TAB_ACCOUNTS,
  TAB_STORAGE_KEY,
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  storeTabSignIn,
  tabAuthStorage,
  tabHoldsSignIn,
  tabSignIn,
  withRefreshTokenRule,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

// Batch W1, item 1 (6 Oct 2026; already in Build 229): Chrome's "Duplicate Tab".
//
// The copy carries the first tab's stored sign-in. Supabase replaces the
// refresh token at every refresh, forgives a tab that presents the one just
// before the newest, and ENDS THE SIGN-IN FOR EVERY TAB when one presents a
// token two or more behind. A copy left untouched for two hours while he
// worked in the first tab did exactly that when he opened it: the copy
// showed the sign-in page at once and the working tab followed within the
// hour.
//
// Now a tab never presents a refresh token that tabs of this browser have
// replaced twice or more: the stale copy gives way in its own tab, the
// server is never told, and the working tab stays signed in. Each tab still
// keeps its own sign-in, and another account's tab is still ignored
// completely (owner answer Q26).
//
// Real supabase-js clients as tabs (tests/fixtures/browser-tabs.ts), each
// with the guard over the stand-in cloud, which here also keeps Supabase's
// rule for refresh tokens (withRefreshTokenRule). Nothing reaches the network.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(30_000);

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;
const originalError = console.error;

type Cloud = ReturnType<typeof withRefreshTokenRule>;
type Tab = { storage: TabStorage; client: SupabaseClient; guard: DAVEWebSignInRefreshGuard; heard: string[] };
let cloud: Cloud;
/** The browser profile's storage, shared by its tabs (localStorage). */
let profile: TabStorage;
/** Whether the profile's storage can be used at all. */
let profileStorageWorks = true;
/** The browser's Web Locks: how a tab tells that another tab is open now (review pass 1, web L1). */
let browserLocks: BrowserLocks;
let tabs: Tab[] = [];
let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
let stopListening: () => void = () => undefined;

beforeAll(() => {
  root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
  // auth-js logs each refused refresh before answering it as an error.
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = String(args[0]);
    if (text.includes('Invalid Refresh Token') || text.includes('AuthApiError')) return;
    originalError(...args);
  });
});
afterAll(() => {
  root.document = originalDocument;
  if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  else delete root.sessionStorage;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
  jest.restoreAllMocks();
});

const settle = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
const PERIOD_KEY = '@vitruvius/web/owner-1/@vitruvius/report-snapshots/v1/probe';
const periodKeys = () => [...profile.values.keys()].filter(key => key.startsWith('@vitruvius/web/'));

beforeEach(() => {
  profile = createTabStorage();
  profileStorageWorks = true;
  browserLocks = createBrowserLocks();
  profile.setItem(PERIOD_KEY, '{"scopeKey":"x"}');
  cloud = withRefreshTokenRule(createTabCloud());
  tabs = [];
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
});
afterEach(async () => {
  stopListening();
  stopListening = () => undefined;
  tabs.forEach(tab => closeTabClient(tab.client));
  await settle();
});

/** A tab of the browser over its own storage: a real client, its requests going through the guard. */
function openTab(storage: TabStorage): Tab {
  const page = browserLocks.page();
  const guard = createDAVEWebSignInRefreshGuard({
    fetch: cloud.fetch as never,
    shared: () => (profileStorageWorks ? profile : null),
    // The tab's own storage, where the key of its fingerprints is kept (review pass 1, web L2).
    tab: () => storage,
    // Every tab here stays open to the end of its test.
    locks: () => page.locks,
  });
  const heard: string[] = [];
  const client = createTabClient(tabAuthStorage(storage), { ...cloud, fetch: guard.fetch } as unknown as TabCloud);
  client.auth.onAuthStateChange(event => { if (event !== 'INITIAL_SESSION') heard.push(event); });
  const tab = { storage, client, guard, heard };
  tabs.push(tab);
  return tab;
}

/**
 * The tab whose page and gateway are the web app's own: it reads its sign-in
 * from this tab's sessionStorage, as the app does. `listening: false` leaves
 * its page not listening yet (the tab is still loading).
 */
function openTheAppsTab(storage: TabStorage, { listening = true }: { listening?: boolean } = {}): Tab {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: storage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  const page = browserLocks.page();
  const guard = createDAVEWebSignInRefreshGuard({
    fetch: cloud.fetch as never,
    shared: () => (profileStorageWorks ? profile : null),
    // The tab's own storage, where the key of its fingerprints is kept (review pass 1, web L2).
    tab: () => storage,
    // Every tab here stays open to the end of its test.
    locks: () => page.locks,
  });
  const heard: string[] = [];
  const client = createTabClient(supabaseSecureAuthStorage, { ...cloud, fetch: guard.fetch } as unknown as TabCloud);
  gateway = createDAVEWebSupabaseGateway(client, guard);
  const tab = { storage, client, guard, heard };
  tabs.push(tab);
  if (listening) thePageListens(tab);
  return tab;
}
function thePageListens(tab: Tab) {
  stopListening = gateway.subscribeToAuthStateChange(event => { if (event !== 'INITIAL_SESSION') tab.heard.push(event); });
}

/** Chrome's Duplicate Tab: the new tab starts with a copy of the first tab's sessionStorage. */
function duplicateOf(storage: TabStorage): TabStorage {
  const copy = createTabStorage();
  storage.values.forEach((value, key) => copy.setItem(key, value));
  return copy;
}

/** An hour goes by for a tab that was not looked at: its access token has run out. */
function hourlyTokenRunsOut(storage: TabStorage) {
  const key = `dave.web.auth.${TAB_STORAGE_KEY}`;
  const session = JSON.parse(String(storage.getItem(key))) as { expires_at: number };
  storage.setItem(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
}

/** The tab is looked at again (or does anything that needs its sign-in): a run-out token is refreshed first. */
async function looksAtItsSignIn(tab: Tab): Promise<'signed in' | 'no sign-in'> {
  const { data } = await tab.client.auth.getSession();
  await settle();
  return data.session ? 'signed in' : 'no sign-in';
}

/** His hourly refresh in a tab he is working in. */
async function refreshes(tab: Tab) {
  const { error } = await tab.client.auth.refreshSession();
  await settle(5);
  return error ? 'refused' : 'refreshed';
}

const accessTokenOf = (storage: TabStorage) =>
  (JSON.parse(String(storage.getItem(`dave.web.auth.${TAB_STORAGE_KEY}`) ?? 'null')) as { access_token?: string } | null)?.access_token ?? null;
const outcomes = () => cloud.refreshes.map(refresh => refresh.outcome);
const note = () => JSON.parse(String(profile.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY) ?? '{}')) as Record<string, { tokens: string[] }>;
/** The name a tab's sign-in has in the note: made with the tab's own key, never the session id itself (review pass 1, web L2). */
const nameInNote = (storage: TabStorage) => {
  const key = (JSON.parse(String(storage.getItem(DAVE_WEB_SIGN_IN_TAB_KEY))) as { key: string }).key;
  return createHmac('sha256', Buffer.from(key, 'base64url')).update(`sign-in:${tabSignIn(storage)?.sessionId}`).digest('hex').slice(0, 16);
};

/** He is signed in, in a tab he works in, and has just duplicated it. */
async function workingTabAndItsCopy() {
  const first = createTabStorage();
  storeTabSignIn(first, 'owner-1');
  const working = openTab(first);
  await working.client.auth.initialize();
  return { working, copyStorage: duplicateOf(first) };
}

describe('Duplicate Tab: the copy left untouched while he works in the first tab', () => {
  it('the first tab refreshed twice, then the copy is opened (reloaded by Chrome): its token is never presented, only the copy shows the sign-in page, and the working tab stays signed in', async () => {
    const { working, copyStorage } = await workingTabAndItsCopy();
    expect(await refreshes(working)).toBe('refreshed');
    expect(await refreshes(working)).toBe('refreshed');
    hourlyTokenRunsOut(copyStorage);

    const copy = openTheAppsTab(copyStorage, { listening: false });
    await copy.client.auth.initialize();
    thePageListens(copy);
    expect(await looksAtItsSignIn(copy)).toBe('no sign-in');

    // The server was asked nothing by the copy, and ended nothing.
    expect(outcomes()).toEqual(['replaced', 'replaced']);
    expect(copy.guard.gaveWay()).toBe(true);
    expect(tabHoldsSignIn(copyStorage)).toBe(false);
    expect((await gateway.getSessionStatus()).session).toBeNull();
    // The working tab: still signed in, on the server too, hour after hour.
    expect(tabHoldsSignIn(working.storage)).toBe(true);
    expect(cloud.signInEnded(accessTokenOf(working.storage))).toBe(false);
    expect(await refreshes(working)).toBe('refreshed');
    expect(await refreshes(working)).toBe('refreshed');
    // (auth-js tells every tab of any tab's sign-out, without saying whose; the page acts on it only
    // when its own stored sign-in is gone, which the lines above show it is not: A1 pass 5, Q26.)
    expect(outcomes()).toEqual(['replaced', 'replaced', 'replaced', 'replaced']);
    // The account is still signed in in this browser: its report periods stay.
    expect(periodKeys()).toEqual([PERIOD_KEY]);
  });

  it('the same with the copy still loaded and only looked at again: it hears its own sign-in end, and the working tab is untouched', async () => {
    const { working, copyStorage } = await workingTabAndItsCopy();
    const copy = openTheAppsTab(copyStorage);
    await copy.client.auth.initialize();
    await settle();
    expect(await refreshes(working)).toBe('refreshed');
    expect(await refreshes(working)).toBe('refreshed');
    hourlyTokenRunsOut(copyStorage);
    copy.heard.length = 0;

    expect(await looksAtItsSignIn(copy)).toBe('no sign-in');

    expect(copy.heard).toEqual(['SIGNED_OUT']);
    expect(outcomes()).toEqual(['replaced', 'replaced']);
    expect(tabHoldsSignIn(copyStorage)).toBe(false);
    expect(tabHoldsSignIn(working.storage)).toBe(true);
    expect(await refreshes(working)).toBe('refreshed');
    expect(cloud.signInEnded(accessTokenOf(working.storage))).toBe(false);
    expect(periodKeys()).toEqual([PERIOD_KEY]);
  });

  it('one refresh behind: the copy presents its token, the server forgives it, and both tabs stay signed in', async () => {
    const { working, copyStorage } = await workingTabAndItsCopy();
    expect(await refreshes(working)).toBe('refreshed');
    hourlyTokenRunsOut(copyStorage);

    const copy = openTheAppsTab(copyStorage);
    expect(await looksAtItsSignIn(copy)).toBe('signed in');

    expect(outcomes()).toEqual(['replaced', 'forgiven']);
    expect(copy.guard.gaveWay()).toBe(false);
    expect(tabSignIn(copyStorage)?.refreshToken).toBe(tabSignIn(working.storage)?.refreshToken);
    expect(await refreshes(working)).toBe('refreshed');
    expect(await refreshes(copy)).toBe('refreshed');
    expect(outcomes()).not.toContain('ended-the-sign-in');
  });

  it('both tabs in use, taking turns for a day: nobody gives way and the server ends nothing', async () => {
    const { working, copyStorage } = await workingTabAndItsCopy();
    const copy = openTab(copyStorage);
    await copy.client.auth.initialize();

    for (let hour = 0; hour < 24; hour += 1) {
      const [first, second] = hour % 3 === 0 ? [copy, working] : [working, copy];
      expect(await refreshes(first)).toBe('refreshed');
      expect(await refreshes(second)).toBe('refreshed');
    }

    expect(outcomes()).not.toContain('ended-the-sign-in');
    expect(outcomes()).not.toContain('refused');
    expect(working.guard.gaveWay()).toBe(false);
    expect(copy.guard.gaveWay()).toBe(false);
    expect(tabHoldsSignIn(working.storage)).toBe(true);
    expect(tabHoldsSignIn(copyStorage)).toBe(true);
  });

  it('the copy that gave way signs in again: a sign-in of its own, and both tabs then refresh without end', async () => {
    const { working, copyStorage } = await workingTabAndItsCopy();
    await refreshes(working);
    await refreshes(working);
    hourlyTokenRunsOut(copyStorage);
    const copy = openTheAppsTab(copyStorage);
    expect(await looksAtItsSignIn(copy)).toBe('no sign-in');
    expect(copy.guard.gaveWay()).toBe(true);

    expect((await gateway.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD)).ok).toBe(true);

    expect(copy.guard.gaveWay()).toBe(false);
    expect(tabSignIn(copyStorage)?.sessionId).not.toBe(tabSignIn(working.storage)?.sessionId);
    for (let hour = 0; hour < 3; hour += 1) {
      expect(await refreshes(copy)).toBe('refreshed');
      expect(await refreshes(working)).toBe('refreshed');
    }
    expect(outcomes()).not.toContain('ended-the-sign-in');
    expect(await gateway.authorizedOwnerId()).toBe('owner-1');
  });

  it('…and a sign-in of that tab that the SERVER ends later is an ended sign-in again: the report periods leave the browser', async () => {
    const { working, copyStorage } = await workingTabAndItsCopy();
    await refreshes(working);
    await refreshes(working);
    hourlyTokenRunsOut(copyStorage);
    const copy = openTheAppsTab(copyStorage);
    await looksAtItsSignIn(copy);
    await gateway.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD);
    expect(periodKeys()).toEqual([PERIOD_KEY]);

    // "Sign Out of All Devices" on the phone: this tab's sign-in no longer exists on the server.
    await copy.client.auth.signOut({ scope: 'global' }).catch(() => undefined);

    expect(tabHoldsSignIn(copyStorage)).toBe(false);
    expect(periodKeys()).toEqual([]);
  });

  it('a note that fell behind (a write that was lost) does not let a tab two behind present its token', async () => {
    const { working, copyStorage } = await workingTabAndItsCopy();
    const copy = openTab(copyStorage);
    await copy.client.auth.initialize();
    await refreshes(working);
    // The copy keeps in step once (forgiven), then is left untouched.
    await refreshes(copy);
    const noteThen = String(profile.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY));
    await refreshes(working);
    // That refresh's note is lost: the profile's storage shows the older note again.
    profile.setItem(DAVE_WEB_SIGN_IN_TURNS_KEY, noteThen);
    // The working tab holds a token the note does not list: it is sent as before, and noted again.
    expect(await refreshes(working)).toBe('refreshed');
    hourlyTokenRunsOut(copyStorage);

    expect(await looksAtItsSignIn(copy)).toBe('no sign-in');

    expect(copy.guard.gaveWay()).toBe(true);
    expect(outcomes()).not.toContain('ended-the-sign-in');
    expect(await refreshes(working)).toBe('refreshed');
  });

  it('with the profile’s storage blocked nothing is noted and everything is as before: the copy presents its token and the server ends the sign-in', async () => {
    profileStorageWorks = false;
    const { working, copyStorage } = await workingTabAndItsCopy();
    await refreshes(working);
    await refreshes(working);
    hourlyTokenRunsOut(copyStorage);

    const copy = openTab(copyStorage);
    expect(await looksAtItsSignIn(copy)).toBe('no sign-in');

    expect(outcomes()).toEqual(['replaced', 'replaced', 'ended-the-sign-in']);
    expect(copy.guard.gaveWay()).toBe(false);
    expect(await refreshes(working)).toBe('refused');
  });
});

describe('what the note in the shared storage is', () => {
  it('fingerprints only: no refresh token, no access token, nothing of an account', async () => {
    const { working } = await workingTabAndItsCopy();
    await refreshes(working);
    await refreshes(working);

    const written = String(profile.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY));
    expect(written).not.toContain('refresh:');
    expect(written).not.toContain(String(accessTokenOf(working.storage)));
    expect(written).not.toContain('owner-1');
    expect(written).not.toContain(TAB_ACCOUNTS['owner-1'].email);
    // Review pass 1, web L2: the sign-in is named by a keyed fingerprint too, not by its session id.
    expect(written).not.toContain(String(tabSignIn(working.storage)?.sessionId));
    const [name] = Object.keys(note());
    expect(name).toBe(nameInNote(working.storage));
    expect(note()[name].tokens).toHaveLength(3);
    note()[name].tokens.forEach(token => expect(token).toMatch(/^[0-9a-f]{16}$/));
    // And it is not among the account's report periods.
    expect(periodKeys()).toEqual([PERIOD_KEY]);
  });

  it('it stays small: the last 200 tokens of a sign-in, and the last 8 sign-ins', async () => {
    const storage = createTabStorage();
    const tab = openTab(storage);
    for (let signIn = 0; signIn < 10; signIn += 1) {
      await tab.client.auth.signInWithPassword({ email: TAB_ACCOUNTS['owner-1'].email, password: TAB_TEST_PASSWORD });
    }
    expect(Object.keys(note())).toHaveLength(8);
    expect(Object.keys(note())).toContain(nameInNote(storage));

    for (let hour = 0; hour < 205; hour += 1) await tab.client.auth.refreshSession();
    expect(note()[nameInNote(storage)].tokens).toHaveLength(200);
    expect(outcomes()).not.toContain('ended-the-sign-in');
  });
});

describe('owner answer Q26 stands: another account’s tab is another sign-in', () => {
  it('a visitor’s tab refreshing any number of times never makes the owner’s tab give way, and the owner’s refreshes never touch the visitor’s', async () => {
    const ownerStorage = createTabStorage();
    storeTabSignIn(ownerStorage, 'owner-1');
    const owner = openTheAppsTab(ownerStorage);
    await owner.client.auth.initialize();
    const visitorStorage = createTabStorage();
    storeTabSignIn(visitorStorage, 'visitor-1');
    const visitor = openTab(visitorStorage);
    await visitor.client.auth.initialize();

    for (let hour = 0; hour < 4; hour += 1) expect(await refreshes(visitor)).toBe('refreshed');
    hourlyTokenRunsOut(ownerStorage);
    expect(await looksAtItsSignIn(owner)).toBe('signed in');
    for (let hour = 0; hour < 4; hour += 1) expect(await refreshes(owner)).toBe('refreshed');
    hourlyTokenRunsOut(visitorStorage);
    expect(await looksAtItsSignIn(visitor)).toBe('signed in');

    expect(owner.guard.gaveWay()).toBe(false);
    expect(visitor.guard.gaveWay()).toBe(false);
    expect(outcomes().every(outcome => outcome === 'replaced')).toBe(true);
    // Each tab still holds its own account's sign-in, and the note keeps them apart by session.
    expect(tabSignIn(ownerStorage)?.userId).toBe('owner-1');
    expect(tabSignIn(visitorStorage)?.userId).toBe('visitor-1');
    expect(Object.keys(note()).sort()).toEqual([nameInNote(ownerStorage), nameInNote(visitorStorage)].sort());
    expect(gateway.storedSignInUserId()).toBe('owner-1');
    expect(await gateway.authorizedOwnerId()).toBe('owner-1');
    expect(periodKeys()).toEqual([PERIOD_KEY]);
  });
});

describe('unchanged: a sign-in that really ended', () => {
  it('he signs out of this computer in the working tab: the copy’s next refresh is presented and refused by the server, as before', async () => {
    const first = createTabStorage();
    storeTabSignIn(first, 'owner-1');
    const working = openTheAppsTab(first);
    await working.client.auth.initialize();
    const copy = openTab(duplicateOf(first));
    await copy.client.auth.initialize();
    await refreshes(working);

    await gateway.signOut('local');
    expect(periodKeys()).toEqual([]);
    hourlyTokenRunsOut(copy.storage);

    expect(await looksAtItsSignIn(copy)).toBe('no sign-in');
    expect(outcomes()).toEqual(['replaced', 'refused']);
    expect(copy.guard.gaveWay()).toBe(false);
  });
});
