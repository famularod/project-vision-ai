/**
 * One browser profile with web tabs, for tests of the web's sign-in guard
 * (review pass 1 of the web area, 6 Oct 2026). Built on the tab fixture
 * (tests/fixtures/browser-tabs.ts): every tab is a real supabase-js client
 * over its own tab storage, its requests going through the app's sign-in
 * guard to the stand-in cloud, which keeps Supabase's rule for refresh
 * tokens. Nothing reaches the network.
 *
 * - `profile` is the browser profile's shared storage (localStorage).
 * - A tab's `storage` is its own (sessionStorage). Chrome's Duplicate Tab
 *   starts the new tab with a copy of it: `duplicateOf`.
 * - `openAppTab` is the tab whose page and gateway are the web app's own: the
 *   app reads its sign-in from the global sessionStorage, so only one such
 *   tab is "this tab" at a time.
 *
 * A test file that uses it mocks AsyncStorage, calls `useBrowserGlobals()`
 * once (it sets up and restores `document` and the two storages), and
 * `closeEveryTab()` after each test.
 */
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
import { createBrowserLocks, type BrowserPage } from './browser-locks';
import {
  TAB_STORAGE_KEY,
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  tabAuthStorage,
  withRefreshTokenRule,
  type TabCloud,
  type TabStorage,
} from './browser-tabs';

export const WEB_SIGN_IN_PERIOD_KEY = '@vitruvius/web/owner-1/@vitruvius/report-snapshots/v1/probe';
const SESSION_KEY = `dave.web.auth.${TAB_STORAGE_KEY}`;

export type WebSignInTab = {
  storage: TabStorage;
  client: SupabaseClient;
  guard: DAVEWebSignInRefreshGuard;
  /** The auth events the tab heard, after its start-up one. */
  heard: string[];
  /** The app's gateway, in the app's own tab. */
  gateway: ReturnType<typeof createDAVEWebSupabaseGateway> | null;
  stopListening: () => void;
  /** The tab's page, as the browser's Web Locks know it. */
  page: BrowserPage;
};

/** `document` and the two storages a browser gives a page; restored after the file's tests. */
export function useBrowserGlobals() {
  const root = globalThis as unknown as Record<string, unknown>;
  const originalDocument = root.document;
  const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalWarn = console.warn;
  const originalError = console.error;
  beforeAll(() => {
    root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
    root.addEventListener = jest.fn();
    root.removeEventListener = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
      originalWarn(...args);
    });
    // auth-js logs each refused refresh, and each request that could not be sent, before answering it as an error.
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const text = String(args[0]);
      if (text.includes('Invalid Refresh Token') || text.includes('AuthApiError') || text.includes('Failed to fetch')) return;
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
}

export const settleTabs = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

export function createWebSignInBrowser(
  /** The stand-in cloud's fetch, when a test puts something in front of it. */
  wrapCloud: (cloud: TabCloud) => TabCloud = cloud => cloud,
) {
  const profile = createTabStorage();
  profile.setItem(WEB_SIGN_IN_PERIOD_KEY, '{"scopeKey":"x"}');
  const cloud = withRefreshTokenRule(wrapCloud(createTabCloud()));
  const tabs: WebSignInTab[] = [];
  /** The browser's Web Locks, shared by its tabs. */
  const locks = createBrowserLocks();
  const state = { profileStorageWorks: true, tabStorageWorks: true, webLocksWork: true };
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();

  function guardFor(storage: TabStorage, page: BrowserPage) {
    return createDAVEWebSignInRefreshGuard({
      fetch: cloud.fetch as never,
      shared: () => (state.profileStorageWorks ? profile : null),
      tab: () => (state.tabStorageWorks ? storage : null),
      locks: () => (state.webLocksWork ? page.locks : null),
    });
  }

  /** A tab of the browser over its own storage: a real client, its requests going through the guard. */
  function openTab(storage: TabStorage): WebSignInTab {
    const page = locks.page();
    const guard = guardFor(storage, page);
    const heard: string[] = [];
    const client = createTabClient(tabAuthStorage(storage), { ...cloud, fetch: guard.fetch } as unknown as TabCloud);
    client.auth.onAuthStateChange(event => { if (event !== 'INITIAL_SESSION') heard.push(event); });
    const tab: WebSignInTab = { storage, client, guard, heard, gateway: null, stopListening: () => undefined, page };
    tabs.push(tab);
    return tab;
  }

  /**
   * The tab whose page and gateway are the web app's own. `listening: false`
   * leaves its page not listening yet (the tab is still loading).
   */
  function openAppTab(storage: TabStorage, { listening = true }: { listening?: boolean } = {}): WebSignInTab {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: storage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
    const page = locks.page();
    const guard = guardFor(storage, page);
    const client = createTabClient(supabaseSecureAuthStorage, { ...cloud, fetch: guard.fetch } as unknown as TabCloud);
    const gateway = createDAVEWebSupabaseGateway(client, guard);
    const tab: WebSignInTab = { storage, client, guard, heard: [], gateway, stopListening: () => undefined, page };
    tabs.push(tab);
    if (listening) pageListens(tab);
    return tab;
  }

  function pageListens(tab: WebSignInTab) {
    tab.stopListening = tab.gateway!.subscribeToAuthStateChange(event => {
      if (event !== 'INITIAL_SESSION') tab.heard.push(event);
    });
  }

  /**
   * The tab is closed (or its page reloaded): nothing of its page runs on, and the browser lets go of the
   * locks it held. Its storage is the test's to reuse (Reopen Closed Tab, or the page that loads next).
   */
  function closeTab(tab: WebSignInTab) {
    tab.stopListening();
    tab.stopListening = () => undefined;
    closeTabClient(tab.client);
    tab.page.gone();
    const index = tabs.indexOf(tab);
    if (index >= 0) tabs.splice(index, 1);
  }

  return {
    profile,
    cloud,
    state,
    locks,
    openTab,
    openAppTab,
    pageListens,
    closeTab,
    async closeEveryTab() {
      [...tabs].forEach(closeTab);
      await settleTabs();
    },
    /** Chrome's Duplicate Tab: the new tab starts with a copy of the first tab's sessionStorage. */
    duplicateOf(storage: TabStorage): TabStorage {
      const copy = createTabStorage();
      storage.values.forEach((value, key) => copy.setItem(key, value));
      return copy;
    },
    /** An hour goes by for a tab that was not looked at: its access token has run out. */
    hourlyTokenRunsOut(storage: TabStorage) {
      const session = JSON.parse(String(storage.getItem(SESSION_KEY))) as { expires_at: number };
      storage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
    },
    /** The tab is looked at again (or does anything that needs its sign-in): a run-out token is refreshed first. */
    async looksAtItsSignIn(tab: WebSignInTab): Promise<'signed in' | 'no sign-in'> {
      const { data } = await tab.client.auth.getSession();
      await settleTabs();
      return data.session ? 'signed in' : 'no sign-in';
    },
    /** His hourly refresh in a tab he is working in. */
    async refreshes(tab: WebSignInTab): Promise<'refreshed' | 'refused'> {
      const { error } = await tab.client.auth.refreshSession();
      await settleTabs(5);
      return error ? 'refused' : 'refreshed';
    },
    accessTokenOf: (storage: TabStorage) =>
      (JSON.parse(String(storage.getItem(SESSION_KEY) ?? 'null')) as { access_token?: string } | null)?.access_token ?? null,
    /** What each refresh the server saw was given. */
    outcomes: () => cloud.refreshes.map(refresh => refresh.outcome),
    /** The account's report periods still in the browser. */
    periodKeys: () => [...profile.values.keys()].filter(key => key.startsWith('@vitruvius/web/')),
    /** The note in the profile's shared storage, as written; null when there is none. */
    noteText: () => profile.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY),
    note: () => JSON.parse(String(profile.getItem(DAVE_WEB_SIGN_IN_TURNS_KEY) ?? '{}')) as Record<string, { until: number; tokens: string[] }>,
    /** What the guard keeps in a tab's own storage; null when nothing. */
    tabItem: (storage: TabStorage) =>
      JSON.parse(String(storage.getItem(DAVE_WEB_SIGN_IN_TAB_KEY) ?? 'null')) as { key?: string; signIn?: string; holds?: string } | null,
    /** The phone's "Sign Out of All Devices": the server ends the sign-in this access token belongs to. */
    async serverEndsSignInOf(accessToken: string | null) {
      await cloud.fetch('https://browser-tabs.supabase.co/auth/v1/logout?scope=global', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    },
  };
}
export type WebSignInBrowser = ReturnType<typeof createWebSignInBrowser>;
