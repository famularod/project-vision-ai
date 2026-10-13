/**
 * One browser in which EVERY tab runs the web app's own gateway (web review
 * pass 3, 12 Oct 2026; adapted from the reviewer's rig for that pass).
 *
 * The other fixture (tests/fixtures/web-sign-in-browser.ts) gives one tab the
 * app's gateway and makes the others bare clients, because the app reads its
 * sign-in from the global sessionStorage. A bare tab has no page: when its
 * sign-in ends, nothing of the app runs in it. Here every tab has the gateway
 * and the Duplicate Tab guard over its own storage and the browser's Web
 * Locks: `sessionStorage` is answered per tab, by the tab on whose behalf the
 * code is running (Node's AsyncLocalStorage follows each tab's promises,
 * timers and channel messages). A read made on nobody's behalf is counted
 * (`strays`) and sees an empty storage, never another tab's.
 *
 * The cloud is the tab fixture's stand-in behind a copy of Supabase's rule
 * for refresh tokens (replace, forgive one back, end the sign-in for an older
 * one), with switches for a server that cannot be reached, is "unavailable",
 * says "too many requests", fails with an error of its own, or never answers.
 *
 * A test file that uses it mocks AsyncStorage, calls `useEveryTabGlobals()`
 * once and `closeEveryTab()` after each test. Nothing reaches the network.
 */
import { AsyncLocalStorage } from 'async_hooks';
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
import {
  TAB_ACCOUNTS,
  TAB_STORAGE_KEY,
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  tabSignIn,
  type TabCloud,
  type TabStorage,
} from './browser-tabs';
import { createBrowserLocks, type BrowserPage } from './browser-locks';

export const NOTE_KEY = DAVE_WEB_SIGN_IN_TURNS_KEY;
export const TAB_ITEM_KEY = DAVE_WEB_SIGN_IN_TAB_KEY;
export const SESSION_KEY = `dave.web.auth.${TAB_STORAGE_KEY}`;
export const PERIOD = (userId: string) => `@vitruvius/web/${userId}/@vitruvius/report-snapshots/v1/probe`;

export type Answer = 'ok' | 'dropped' | 'never' | number;
export type Gateway = ReturnType<typeof createDAVEWebSupabaseGateway>;
export type RigTab = {
  name: string;
  storage: TabStorage;
  client: SupabaseClient;
  gateway: Gateway;
  guard: DAVEWebSignInRefreshGuard;
  page: BrowserPage;
  /** The auth events its page heard, after its start-up one. */
  heard: string[];
  stop: () => void;
  closed: boolean;
};

const claimsOf = (token: string | null | undefined): Record<string, unknown> | null => {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01', ...headers },
});

const tabOfCode = new AsyncLocalStorage<TabStorage>();
const nowhere = createTabStorage();
let profileNow: TabStorage = createTabStorage();
let strays = 0;

/** Puts the per-tab `sessionStorage`, the shared `localStorage` and a `document` in place; restores them after the file. */
export function useEveryTabGlobals() {
  const root = globalThis as unknown as Record<string, unknown>;
  const originalDocument = root.document;
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  beforeAll(() => {
    root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
    root.addEventListener = jest.fn();
    root.removeEventListener = jest.fn();
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        const mine = tabOfCode.getStore();
        if (mine) return mine;
        strays += 1;
        nowhere.clear();
        return nowhere;
      },
    });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => profileNow });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => {
    root.document = originalDocument;
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession);
    else delete root.sessionStorage;
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal);
    else delete root.localStorage;
    jest.restoreAllMocks();
  });
}

export const settle = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));

export function createEveryTabBrowser() {
  const profile = createTabStorage();
  profileNow = profile;
  strays = 0;
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  const base = createTabCloud();
  const mode: { refresh: Answer; logout: Answer; password: Answer } = { refresh: 'ok', logout: 'ok', password: 'ok' };
  const counts = { refreshes: 0, logouts: 0, passwords: 0 };
  type Family = { userId: string; active: string; parent: string | null; ended: boolean };
  const families = new Map<string, Family>();
  const sessionOfToken = new Map<string, string>();
  /** What each refresh that reached the server was given. */
  const log: string[] = [];
  const sidOf = (accessToken: unknown) => {
    const claims = claimsOf(typeof accessToken === 'string' ? accessToken : null);
    return typeof claims?.session_id === 'string' ? claims.session_id : `no-session-id:${String(claims?.sub ?? '')}`;
  };
  const used = () => json(400, { code: 'refresh_token_already_used', message: 'Invalid Refresh Token: Already Used' });
  const failing = (how: Answer): Promise<Response> | Response | null => {
    if (how === 'dropped') throw new TypeError('Failed to fetch');
    if (how === 'never') return new Promise<Response>(() => undefined);
    if (how === 429) return json(429, { code: 'over_request_rate_limit', message: 'Request rate limit reached' }, { 'retry-after': '600' });
    if (typeof how === 'number') return json(how, { message: `HTTP ${how}` });
    return null;
  };
  /** What the server would do with this refresh token if it were presented now. */
  const verdict = (token: string | null | undefined): 'replace' | 'forgive' | 'kill' | 'refused' | 'unknown' | 'none' => {
    if (!token) return 'none';
    const known = sessionOfToken.get(token);
    if (!known) return 'unknown';
    const family = families.get(known)!;
    if (family.ended) return 'refused';
    if (token === family.active) return 'replace';
    if (token === family.parent) return 'forgive';
    return 'kill';
  };
  const serverFetch = (async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      counts.refreshes += 1;
      const failed = failing(mode.refresh);
      if (failed) return failed;
      const presented = String((JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string }).refresh_token ?? '');
      const what = verdict(presented);
      if (what === 'refused' || what === 'unknown') { log.push('refused'); return used(); }
      if (what === 'kill') {
        families.get(sessionOfToken.get(presented)!)!.ended = true;
        log.push('ended-the-sign-in');
        return used();
      }
      const answer = await base.fetch(input, init);
      if (!answer.ok) return answer;
      const issued = await answer.clone().json() as { access_token: string; refresh_token: string };
      const sid = sessionOfToken.get(presented)!;
      if (what === 'forgive') {
        log.push('forgiven');
        return json(200, { ...issued, refresh_token: families.get(sid)!.active });
      }
      families.set(sid, { ...families.get(sid)!, active: issued.refresh_token, parent: presented });
      sessionOfToken.set(issued.refresh_token, sid);
      log.push('replaced');
      return answer;
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      counts.passwords += 1;
      const failed = failing(mode.password);
      if (failed) return failed;
      const answer = await base.fetch(input, init);
      if (!answer.ok) return answer;
      const issued = await answer.clone().json() as { access_token: string; refresh_token: string; user: { id: string } };
      const sid = sidOf(issued.access_token);
      families.set(sid, { userId: issued.user.id, active: issued.refresh_token, parent: null, ended: false });
      sessionOfToken.set(issued.refresh_token, sid);
      return answer;
    }
    if (url.pathname === '/auth/v1/logout') {
      counts.logouts += 1;
      const failed = failing(mode.logout);
      if (failed) return failed;
      const sid = sidOf(bearer);
      const family = families.get(sid);
      if (!family || family.ended) return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' });
      if (url.searchParams.get('scope') === 'global') families.forEach(each => { if (each.userId === family.userId) each.ended = true; });
      family.ended = true;
      return new Response(null, { status: 204 });
    }
    const sid = sidOf(bearer);
    if (url.pathname === '/auth/v1/user' && families.get(sid)?.ended) {
      return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' });
    }
    return base.fetch(input, init);
  }) as TabCloud['fetch'];

  const locks = createBrowserLocks();
  const state = { sharedWorks: true };
  const tabs: RigTab[] = [];
  let names = 0;

  /** Runs `work` as that tab's own code. */
  const inTab = <T,>(tab: RigTab, work: () => T): T => tabOfCode.run(tab.storage, work);

  /** A tab opens the web app over this storage (a new tab, a reload, Reopen Closed Tab, Duplicate Tab's copy). */
  function open(storage: TabStorage = createTabStorage(), name?: string): RigTab {
    return tabOfCode.run(storage, () => {
      const page = locks.page();
      const guard = createDAVEWebSignInRefreshGuard({
        fetch: serverFetch as never,
        shared: () => (state.sharedWorks ? profile : null),
        tab: () => storage,
        locks: () => page.locks,
      });
      const client = createTabClient(supabaseSecureAuthStorage, { ...base, fetch: guard.fetch } as unknown as TabCloud);
      const gateway = createDAVEWebSupabaseGateway(client, guard);
      const heard: string[] = [];
      const tab: RigTab = { name: name ?? `tab${++names}`, storage, client, gateway, guard, page, heard, stop: () => undefined, closed: false };
      tab.stop = gateway.subscribeToAuthStateChange(event => { if (event !== 'INITIAL_SESSION') heard.push(event); });
      tabs.push(tab);
      return tab;
    });
  }

  /** The tab is closed, or its page is reloaded or discarded: nothing of its page runs on; the browser lets go of its locks. */
  function close(tab: RigTab) {
    if (tab.closed) return;
    tab.closed = true;
    inTab(tab, () => {
      tab.stop();
      closeTabClient(tab.client);
    });
    tab.page.gone();
  }

  const live = () => tabs.filter(tab => !tab.closed);
  const holds = (tab: RigTab) => tabSignIn(tab.storage);

  /** His click on Sign Out of This Computer (or of All Devices) in a tab, as the page does it: the tab, then the other open tabs of that account are told. */
  async function signOut(
    tab: RigTab,
    scope: 'local' | 'global' = 'local',
    /** Runs after this tab's own sign-out and before the other tabs are told (the connection drops in between, say). */
    between: () => void = () => undefined,
  ): Promise<{ result: string; notConfirmed: boolean | null }> {
    const userId = inTab(tab, () => tab.gateway.storedSignInUserId());
    let result = 'signed out';
    try {
      await inTab(tab, () => tab.gateway.signOut(scope));
    } catch (error) {
      result = `REFUSED (${(error as Error).message})`;
      return { result, notConfirmed: null };
    }
    const notConfirmed = scope === 'local' ? inTab(tab, () => tab.gateway.signedOutWithoutCloudConfirmation()) : null;
    between();
    // The sign-out channel: every other tab running now hears whose sign-out it was.
    if (userId) {
      await Promise.all(live().filter(other => other !== tab).map(other => inTab(other, async () => {
        if (other.gateway.storedSignInUserId() !== userId) return;
        await other.gateway.signOutThisTabToo(userId).catch(() => 'ended');
      })));
    }
    return { result, notConfirmed };
  }

  return {
    profile,
    mode,
    counts,
    log,
    state,
    tabs,
    live,
    open,
    close,
    inTab,
    holds,
    signOut,
    verdict,
    strays: () => strays,
    signIn: (tab: RigTab, userId: string) => inTab(tab, () => tab.gateway.signIn(TAB_ACCOUNTS[userId].email, TAB_TEST_PASSWORD)),
    /** A sign-in that is not the owner's is signed out of this browser by its page at once, and no other tab is told. */
    signOutNotOwnerQuietly: (tab: RigTab) => inTab(tab, () => tab.gateway.signOut('local').then(() => 'signed out', (error: Error) => `REFUSED (${error.message})`)),
    /** Chrome's Duplicate Tab: the new tab starts with a copy of the first tab's own storage. */
    duplicate(tab: RigTab, name?: string): RigTab {
      const copy = createTabStorage();
      tab.storage.values.forEach((value, key) => copy.setItem(key, value));
      return open(copy, name);
    },
    /** The page is reloaded: a new page over the same tab storage. */
    reload(tab: RigTab): RigTab {
      close(tab);
      return open(tab.storage, `${tab.name}'`);
    },
    /** An hour goes by for the tab: its hourly token has run out. */
    hourlyTokenRunsOut(tab: RigTab) {
      const raw = tab.storage.getItem(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw) as { expires_at: number };
      tab.storage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
    },
    /** The tab is looked at (or does anything that needs its sign-in): a run-out token is refreshed first. */
    async looksAt(tab: RigTab): Promise<'signed in' | 'no sign-in'> {
      const { data } = await inTab(tab, () => tab.client.auth.getSession());
      return data.session ? 'signed in' : 'no sign-in';
    },
    async refreshes(tab: RigTab): Promise<'refreshed' | 'refused'> {
      const { error } = await inTab(tab, () => tab.client.auth.refreshSession());
      return error ? 'refused' : 'refreshed';
    },
    /** The phone's Sign Out of All Devices: every sign-in of the account ends on the server. */
    phoneSignsOutAllDevices(userId: string) {
      families.forEach(family => { if (family.userId === userId) family.ended = true; });
    },
    /** Whether the server has ended the sign-in the tab holds (or held, by `sessionId`). */
    serverEnded: (sessionId: string | null | undefined) => (sessionId ? families.get(sessionId)?.ended === true : false),
    periodKeys: () => [...profile.values.keys()].filter(key => key.startsWith('@vitruvius/web/')),
    periodsOf: (userId: string) => profile.getItem(PERIOD(userId)),
    /** He approves a report here: this computer keeps a period for the account (what a sign-out of the account removes). */
    keepsPeriod: (userId: string, what: string) => profile.setItem(PERIOD(userId), JSON.stringify({ scopeKey: what })),
    note: () => profile.getItem(NOTE_KEY),
    noteNames: () => Object.keys(JSON.parse(String(profile.getItem(NOTE_KEY) ?? '{}')) as Record<string, unknown>),
    tabItem: (tab: RigTab) => tab.storage.getItem(TAB_ITEM_KEY),
    /** Every key in the browser's shared storage, and in a tab's own. */
    sharedKeys: () => [...profile.values.keys()],
    tabKeys: (tab: RigTab) => [...tab.storage.values.keys()],
    async closeEveryTab() {
      [...tabs].forEach(close);
      await settle();
    },
  };
}
export type EveryTabBrowser = ReturnType<typeof createEveryTabBrowser>;
export { TAB_ACCOUNTS, tabSignIn };
