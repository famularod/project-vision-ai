/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { forgetDAVEWebOwnReportSends, forgetDAVEWebReportTabMemory } from '../../services/DAVEWebReportSend';
import { createDAVEWebSignInRefreshGuard } from '../../services/DAVEWebSignInRefreshGuard';
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
  storeTabSignIn,
  tabAuthStorage,
  tabHoldsSignIn,
  withRefreshTokenRule,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

// Batch W1, item 2 (6 Oct 2026). After the server ends a web tab's sign-in
// the tab shows the sign-in page, but the gateway went on holding the rows it
// had loaded, in memory, until the page was reloaded. Nothing showed them.
// They are now dropped with the sign-in, as "Sign Out of This Computer"
// already drops them; and so when a duplicated tab gives way (item 1).
//
// The gateway holds rows only to answer a later targeted refresh without
// reading every table again. So "dropped" is seen here from outside: after
// the sign-in has ended and he has signed in again, a refresh of one table
// reads all the tables again (it holds nothing to fill the rest from).
// Another tab's sign-out, and his own token refresh, drop nothing (Q26).

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(30_000);

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;
const originalError = console.error;

let cloud: ReturnType<typeof withRefreshTokenRule>;
let tabStorage: TabStorage;
let profile: TabStorage;
let client: SupabaseClient;
let others: SupabaseClient[] = [];
let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
let heard: string[] = [];
let stopListening: () => void = () => undefined;

beforeAll(() => {
  root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
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

beforeEach(() => {
  profile = createTabStorage();
  cloud = withRefreshTokenRule(createTabCloud());
  others = [];
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
});
afterEach(async () => {
  stopListening();
  closeTabClient(client);
  others.forEach(closeTabClient);
  await settle();
});

/** This tab, signed in as the owner, its page listening, with everything loaded once. */
async function tabWithEverythingLoaded(storage: TabStorage = (() => { const made = createTabStorage(); storeTabSignIn(made, 'owner-1'); return made; })()) {
  tabStorage = storage;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: tabStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  const guard = createDAVEWebSignInRefreshGuard({ fetch: cloud.fetch as never, shared: () => profile });
  client = createTabClient(supabaseSecureAuthStorage, { ...cloud, fetch: guard.fetch } as unknown as TabCloud);
  gateway = createDAVEWebSupabaseGateway(client, guard);
  await client.auth.initialize();
  heard = [];
  stopListening = gateway.subscribeToAuthStateChange(event => { if (event !== 'INITIAL_SESSION') heard.push(event); });
  await settle();
  await gateway.loadAuthorizedRows();
}

/** Another tab of this browser over its own storage. */
async function openAnotherTab(storage: TabStorage) {
  const guard = createDAVEWebSignInRefreshGuard({ fetch: cloud.fetch as never, shared: () => profile });
  const tab = createTabClient(tabAuthStorage(storage), { ...cloud, fetch: guard.fetch } as unknown as TabCloud);
  others.push(tab);
  await tab.auth.initialize();
  return tab;
}

function hourlyTokenRunsOut(storage: TabStorage) {
  const key = `dave.web.auth.${TAB_STORAGE_KEY}`;
  const session = JSON.parse(String(storage.getItem(key))) as { expires_at: number };
  storage.setItem(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
}

/**
 * Whether the gateway still holds the rows it loaded: a refresh of the tasks
 * alone then reads only the tasks; holding nothing, it reads every table.
 */
async function tablesReadByARefreshOfTheTasksAlone(): Promise<string[]> {
  cloud.calls.length = 0;
  await gateway.loadAuthorizedRows(['schedule_items']);
  return [...new Set(cloud.calls
    .filter(call => call.path.startsWith('/rest/v1/') && !call.path.startsWith('/rest/v1/rpc/'))
    .map(call => call.path.split('?')[0].replace('/rest/v1/', '')))].sort();
}
const signsInAgain = async () => {
  expect((await gateway.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD)).ok).toBe(true);
  await settle();
};
const ONLY_THE_TASKS = ['schedule_items'];

describe('the rows a tab holds in memory', () => {
  it('guard: while he stays signed in they are held, and a refresh of the tasks alone reads only the tasks', async () => {
    await tabWithEverythingLoaded();
    expect(await tablesReadByARefreshOfTheTasksAlone()).toEqual(ONLY_THE_TASKS);
  });

  it('the server ends the sign-in (Sign Out of All Devices on the phone): they are dropped with it', async () => {
    await tabWithEverythingLoaded();
    // Another device ends every sign-in of the account; this tab's hourly token then runs out.
    const phone = await openAnotherTab((() => { const made = createTabStorage(); made.setItem(`dave.web.auth.${TAB_STORAGE_KEY}`, String(tabStorage.getItem(`dave.web.auth.${TAB_STORAGE_KEY}`))); return made; })());
    await phone.auth.signOut({ scope: 'global' });
    await settle();
    // (That is another tab's sign-out to this tab: nothing changes yet, its own sign-in is still stored.)
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    hourlyTokenRunsOut(tabStorage);
    heard.length = 0;

    expect((await gateway.getSessionStatus()).session).toBeNull();
    await settle();
    expect(heard).toEqual(['SIGNED_OUT']);
    expect(tabHoldsSignIn(tabStorage)).toBe(false);

    await signsInAgain();
    expect((await tablesReadByARefreshOfTheTasksAlone()).length).toBeGreaterThan(1);
    expect(await tablesReadByARefreshOfTheTasksAlone()).toEqual(ONLY_THE_TASKS);
  });

  it('a duplicated tab that gives way (item 1): they are dropped too', async () => {
    const first = createTabStorage();
    storeTabSignIn(first, 'owner-1');
    const working = await openAnotherTab(first);
    const copyStorage = createTabStorage();
    first.values.forEach((value, key) => copyStorage.setItem(key, value));
    await tabWithEverythingLoaded(copyStorage);
    await working.auth.refreshSession();
    await working.auth.refreshSession();
    // (The copy is told of the other tab's refreshes, as every tab is; it takes nothing from them.)
    await settle();
    hourlyTokenRunsOut(copyStorage);
    heard.length = 0;

    expect((await gateway.getSessionStatus()).session).toBeNull();
    await settle();
    expect(heard).toEqual(['SIGNED_OUT']);
    expect(cloud.refreshes.map(refresh => refresh.outcome)).toEqual(['replaced', 'replaced']);

    await signsInAgain();
    expect((await tablesReadByARefreshOfTheTasksAlone()).length).toBeGreaterThan(1);
  });

  it('guard (Q26): another account’s tab signing out, and another tab of his own account ending, drop nothing while this tab holds its sign-in', async () => {
    await tabWithEverythingLoaded();
    const visitorStorage = createTabStorage();
    storeTabSignIn(visitorStorage, 'visitor-1');
    const visitor = await openAnotherTab(visitorStorage);
    await visitor.auth.signOut({ scope: 'local' });
    await settle();
    expect(heard).toContain('SIGNED_OUT');
    expect(tabHoldsSignIn(tabStorage)).toBe(true);

    expect(await tablesReadByARefreshOfTheTasksAlone()).toEqual(ONLY_THE_TASKS);
  });

  it('guard: his own token refresh drops nothing', async () => {
    await tabWithEverythingLoaded();
    await client.auth.refreshSession();
    await settle();
    expect(heard).toContain('TOKEN_REFRESHED');

    expect(await tablesReadByARefreshOfTheTasksAlone()).toEqual(ONLY_THE_TASKS);
  });
});
