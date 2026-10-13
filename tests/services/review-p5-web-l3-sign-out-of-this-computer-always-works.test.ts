/**
 * @jest-environment node
 */
import { DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS } from '../../services/DAVEWebSignInRefreshGuard';
import { DAVEWebSignOutNeedsConnectionError } from '../../services/DAVEWebSupabaseClient';
import { TAB_ACCOUNTS, TAB_TEST_PASSWORD, createTabStorage, storeTabSignIn, tabHoldsSignIn, tabSignIn, type TabCloud } from '../fixtures/browser-tabs';
import {
  WEB_SIGN_IN_PERIOD_KEY,
  createWebSignInBrowser,
  useBrowserGlobals,
  type WebSignInBrowser,
  type WebSignInTab,
} from '../fixtures/web-sign-in-browser';

// Review pass 1 of the web area, L3 (6 Oct 2026; caused by open item W1-3).
//
// Since batch W1 a tab that is answered "too many requests" on a refresh keeps its sign-in and waits as long
// as the server asked (up to ten minutes). During that wait Sign Out of This Computer was REFUSED in the tab:
// auth-js refreshes a run-out hourly token before it signs out, the refresh was answered "wait" without
// reaching the server, auth-js tried for half a minute and gave up, and "The desktop session could not be
// closed." was shown with the sign-in still in the tab. The same when the sign-in server could not be
// reached at all (that one is as old as the web's sign-out).
//
// Now Sign Out of This Computer always signs this tab out, at once: the server is asked first, for five
// seconds at most and once only, and whatever comes of that the sign-in leaves this tab, with the account's
// report periods and the Duplicate Tab note. Sign Out of All Devices still needs the server (owner answer
// Q21); its own refresh is no longer held back by the wait.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(60_000);
useBrowserGlobals();

type ServerState = {
  /** What the sign-in server does with a refresh. */
  refresh: 'ok' | 'too-many-requests' | 503 | 'dropped' | 'never-answers';
  /** …and with a sign-out. */
  logout: 'ok' | 503 | 'dropped' | 'never-answers';
  refreshesAsked: number;
  logoutsAsked: number;
};
let server: ServerState;
let browser: WebSignInBrowser;
const owner = TAB_ACCOUNTS['owner-1'];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01', ...headers },
});
const never = () => new Promise<Response>(() => undefined);

/** The sign-in server, in front of the stand-in cloud. */
function withServer(cloud: TabCloud): TabCloud {
  const fetch = (async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      server.refreshesAsked += 1;
      if (server.refresh === 'too-many-requests') {
        return json(429, { code: 'over_request_rate_limit', message: 'Request rate limit reached' }, { 'retry-after': '600' });
      }
      if (server.refresh === 503) return json(503, { message: 'Service Unavailable' });
      if (server.refresh === 'dropped') throw new TypeError('Failed to fetch');
      if (server.refresh === 'never-answers') return never();
    }
    if (url.pathname === '/auth/v1/logout') {
      server.logoutsAsked += 1;
      if (server.logout === 503) return json(503, { message: 'Service Unavailable' });
      if (server.logout === 'dropped') throw new TypeError('Failed to fetch');
      if (server.logout === 'never-answers') return never();
    }
    return cloud.fetch(input, init);
  }) as TabCloud['fetch'];
  return { ...cloud, fetch };
}

beforeEach(() => {
  server = { refresh: 'ok', logout: 'ok', refreshesAsked: 0, logoutsAsked: 0 };
  browser = createWebSignInBrowser(withServer);
  // auth-js tries a refresh that could not be answered again for up to 30 s: the test's clock moves instead.
  jest.useFakeTimers({ advanceTimers: true });
});
afterEach(async () => {
  // Nothing auth-js still has under way runs on after the test.
  await jest.advanceTimersByTimeAsync(3 * 60_000);
  await browser.closeEveryTab();
  jest.useRealTimers();
});

/** The machine's own timer, taken before the test's clock is put in. */
const realSetTimeout = setTimeout;
/**
 * Lets everything that needs no time finish. Some of the work is done off the test's clock (a fingerprint is
 * computed by the machine, however busy it is), so it is given real time, up to a twentieth of a second, and
 * the test's clock is not moved meanwhile: "at once" below does not depend on how busy the machine is.
 */
async function withoutTimePassing(isDone: () => boolean) {
  for (let turn = 0; turn < 50 && !isDone(); turn += 1) {
    await jest.advanceTimersByTimeAsync(0);
    await new Promise<void>(resolve => realSetTimeout(resolve, 1));
  }
}
/** Lets time pass, a second at a time, until `work` settles; says how many seconds of the test's clock that took. */
async function whileTimePasses<T>(work: Promise<T>, seconds = 120): Promise<{ value: T; seconds: number }> {
  let done = false;
  const outcome = work
    .then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
    .finally(() => { done = true; });
  let passed = 0;
  await withoutTimePassing(() => done);
  for (; passed < seconds && !done; passed += 1) {
    await jest.advanceTimersByTimeAsync(1_000);
    await withoutTimePassing(() => done);
  }
  const result = await outcome;
  if (!result.ok) throw result.error;
  return { value: result.value, seconds: passed };
}

/** He is signed in on the app's own tab; its page is listening. */
async function signedInTab() {
  const storage = createTabStorage();
  const tab = browser.openAppTab(storage);
  expect((await tab.gateway!.signIn(owner.email, TAB_TEST_PASSWORD)).ok).toBe(true);
  expect(browser.noteText()).not.toBeNull();
  tab.heard.length = 0;
  return tab;
}

/** The tab was left for over an hour and its refresh was answered "too many requests, wait ten minutes". */
async function tabToldToWait() {
  const tab = await signedInTab();
  browser.hourlyTokenRunsOut(tab.storage);
  server.refresh = 'too-many-requests';
  await whileTimePasses(tab.gateway!.getSessionStatus().catch(() => 'still signed in'));
  expect(tabHoldsSignIn(tab.storage)).toBe(true);
  expect(server.refreshesAsked).toBe(1);
  // Three minutes on: past auth-js's own minute of answering from the failed refresh, well inside the ten.
  await jest.advanceTimersByTimeAsync(3 * 60_000);
  return tab;
}

/** Everything Sign Out of This Computer says it removes is gone from this browser. */
function expectSignedOutOfThisComputer(tab: WebSignInTab) {
  expect(tabHoldsSignIn(tab.storage)).toBe(false);
  expect(browser.periodKeys()).toEqual([]);
  expect(browser.noteText()).toBeNull();
  expect(browser.tabItem(tab.storage)).toBeNull();
  expect(tab.heard).toContain('SIGNED_OUT');
}

describe('Sign Out of This Computer during the wait after "too many requests"', () => {
  it('the server is answering again: he is signed out at once, and the server was told (the sign-out’s own refresh went out, once)', async () => {
    const tab = await tabToldToWait();
    const accessTokenThen = browser.accessTokenOf(tab.storage);
    server.refresh = 'ok';

    const signOut = await whileTimePasses(tab.gateway!.signOut('local'));

    expect(signOut.seconds).toBeLessThanOrEqual(1);
    expectSignedOutOfThisComputer(tab);
    expect(server.refreshesAsked).toBe(2);
    expect(server.logoutsAsked).toBe(1);
    expect(browser.cloud.signInEnded(accessTokenThen)).toBe(true);
  });

  it('the server still says "too many requests": he is signed out of this computer at once all the same; the server was asked once, not seven times', async () => {
    const tab = await tabToldToWait();

    const signOut = await whileTimePasses(tab.gateway!.signOut('local'));

    expect(signOut.seconds).toBeLessThanOrEqual(1);
    expectSignedOutOfThisComputer(tab);
    expect(server.refreshesAsked).toBe(2);
    // It could not be told: a sign-out needs a refreshed token.
    expect(server.logoutsAsked).toBe(0);
  });

  it('…and he can sign in again in that tab straight away', async () => {
    const tab = await tabToldToWait();
    await whileTimePasses(tab.gateway!.signOut('local'));
    server.refresh = 'ok';

    expect((await tab.gateway!.signIn(owner.email, TAB_TEST_PASSWORD)).ok).toBe(true);

    expect(tabHoldsSignIn(tab.storage)).toBe(true);
    expect(await tab.gateway!.authorizedOwnerId()).toBe('owner-1');
  });
});

describe('Sign Out of This Computer when the sign-in server cannot be told', () => {
  it.each<[string, Partial<ServerState>, boolean]>([
    ['the hourly token ran out and the refresh cannot be sent (no connection)', { refresh: 'dropped' }, true],
    ['the hourly token ran out and the server answers the refresh "unavailable"', { refresh: 503 }, true],
    ['the sign-out request cannot be sent (no connection)', { logout: 'dropped' }, false],
    ['the server answers the sign-out "unavailable"', { logout: 503 }, false],
  ])('%s: he is signed out of this computer at once, with one request and no retries', async (_what, state, tokenRanOut) => {
    const tab = await signedInTab();
    if (tokenRanOut) browser.hourlyTokenRunsOut(tab.storage);
    Object.assign(server, state);

    const signOut = await whileTimePasses(tab.gateway!.signOut('local'));

    expect(signOut.seconds).toBeLessThanOrEqual(1);
    expectSignedOutOfThisComputer(tab);
    expect(server.refreshesAsked + server.logoutsAsked).toBe(1);
  });

  it.each<[string, Partial<ServerState>, boolean]>([
    ['the server never answers the refresh', { refresh: 'never-answers' }, true],
    ['the server never answers the sign-out', { logout: 'never-answers' }, false],
  ])('%s: he is signed out when the five seconds it is given are over, not later', async (_what, state, tokenRanOut) => {
    const tab = await signedInTab();
    if (tokenRanOut) browser.hourlyTokenRunsOut(tab.storage);
    Object.assign(server, state);

    const signOut = await whileTimePasses(tab.gateway!.signOut('local'));

    expect(signOut.seconds).toBeGreaterThanOrEqual(DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS / 1_000 - 1);
    expect(signOut.seconds).toBeLessThanOrEqual(DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS / 1_000 + 1);
    expectSignedOutOfThisComputer(tab);
  });

  it('guard: with the server answering, nothing changed: the server ends the sign-in, then it leaves the tab', async () => {
    const tab = await signedInTab();
    const accessTokenThen = browser.accessTokenOf(tab.storage);

    const signOut = await whileTimePasses(tab.gateway!.signOut('local'));

    expect(signOut.seconds).toBeLessThanOrEqual(1);
    expectSignedOutOfThisComputer(tab);
    expect(server.logoutsAsked).toBe(1);
    expect(server.refreshesAsked).toBe(0);
    expect(browser.cloud.signInEnded(accessTokenThen)).toBe(true);
  });

  it('guard: a tab that holds no sign-in signs out of nothing, and asks the server nothing', async () => {
    const tab = browser.openAppTab(createTabStorage());

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(server.logoutsAsked + server.refreshesAsked).toBe(0);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });
});

describe('a sign-out takes out only the sign-in it was asked about', () => {
  it('a tab that held no sign-in when the sign-out began: a sign-in that lands in it while the sign-out finishes is not removed', async () => {
    const storage = createTabStorage();
    const tab = browser.openAppTab(storage);
    const askAuth = tab.client.auth.signOut.bind(tab.client.auth);
    jest.spyOn(tab.client.auth, 'signOut').mockImplementationOnce(async (...args: Parameters<typeof askAuth>) => {
      const answer = await askAuth(...args);
      // He signed in here in that moment (the sign-in is in the tab's storage as auth-js answers).
      storeTabSignIn(storage, 'owner-1');
      return answer;
    });

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tabSignIn(storage)?.userId).toBe('owner-1');
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });
});

describe('Sign Out of All Devices still needs the server (owner answer Q21)', () => {
  it('during the wait, with the server answering again: its own refresh goes out and every device is signed out', async () => {
    const tab = await tabToldToWait();
    const accessTokenThen = browser.accessTokenOf(tab.storage);
    server.refresh = 'ok';

    await whileTimePasses(tab.gateway!.signOut('global'));

    expectSignedOutOfThisComputer(tab);
    expect(server.refreshesAsked).toBe(2);
    expect(browser.cloud.callsFor('/auth/v1/logout?scope=global')).toHaveLength(1);
    expect(browser.cloud.signInEnded(accessTokenThen)).toBe(true);
  });

  it('during the wait, with the server still saying "too many requests": nothing is signed out, he is told it needs the server, and the server was asked once more, not again and again', async () => {
    const tab = await tabToldToWait();

    const refused = await whileTimePasses(tab.gateway!.signOut('global').then(() => null, (error: unknown) => error));

    expect(refused.value).toBeInstanceOf(DAVEWebSignOutNeedsConnectionError);
    expect(tabHoldsSignIn(tab.storage)).toBe(true);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    expect(tab.heard).not.toContain('SIGNED_OUT');
    expect(server.refreshesAsked).toBe(2);
  });

  it('guard: with no connection nothing is signed out and he is told, as before', async () => {
    const tab = await signedInTab();
    server.logout = 'dropped';

    const refused = await whileTimePasses(tab.gateway!.signOut('global').then(() => null, (error: unknown) => error));

    expect(refused.value).toBeInstanceOf(DAVEWebSignOutNeedsConnectionError);
    expect(tabHoldsSignIn(tab.storage)).toBe(true);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    expect(browser.noteText()).not.toBeNull();
  });
});
