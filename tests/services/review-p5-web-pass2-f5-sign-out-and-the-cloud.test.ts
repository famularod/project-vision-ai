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

// Second review of the web area, F5 (7 Oct 2026; caused by the fix for review pass 1, L3). Sign Out of This
// Computer now always signs this browser tab out, and asks the sign-in server once, for five seconds at most.
//
// (a) Nothing said when the server could NOT be told. The web client now notes whether the cloud confirmed a
//     Sign Out of This Computer: it took the sign-out, or said that sign-in is not there, or had already ended
//     it. The sign-in page says so when it did not
//     (tests/components/review-p5-web-pass2-f5-sign-in-page-says-so.test.tsx).
// (b) With a server that takes the request and never answers, a second open tab of the account, hearing the
//     sign-out, showed the sign-in page and KEPT its sign-in: its own sign-out waited on the server for ever.
//     A sign-out heard from another tab now has the same limits as one made in the tab: one request, and five
//     seconds at most; then the sign-in leaves the tab.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(60_000);
useBrowserGlobals();

type ServerState = {
  /** What the sign-in server does with a refresh. */
  refresh: 'ok' | 'too-many-requests' | 503 | 'dropped' | 'never-answers';
  /** …and with a sign-out (a number: it answers with that status). */
  logout: 'ok' | 'dropped' | 'never-answers' | number;
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
      if (server.logout === 'dropped') throw new TypeError('Failed to fetch');
      if (server.logout === 'never-answers') return never();
      if (typeof server.logout === 'number') {
        return json(server.logout, server.logout === 404
          ? { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' }
          : { message: 'The sign-in server did not do it.' });
      }
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
/** Lets everything that needs no time finish, without moving the test's clock. */
async function withoutTimePassing(isDone: () => boolean) {
  for (let turn = 0; turn < 50 && !isDone(); turn += 1) {
    await jest.advanceTimersByTimeAsync(0);
    await new Promise<void>(resolve => realSetTimeout(resolve, 1));
  }
}
/** Lets time pass, a second at a time, until `work` settles; says how many seconds of the test's clock that took. */
async function whileTimePasses<T>(work: Promise<T>, seconds = 120): Promise<{ value: T | 'NOT FINISHED'; seconds: number }> {
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
  if (!done) return { value: 'NOT FINISHED', seconds: passed };
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

/** Everything a sign-out of this computer removes is gone from this tab and this browser. */
function expectNothingLeftHere(tab: WebSignInTab) {
  expect(tabHoldsSignIn(tab.storage)).toBe(false);
  expect(browser.periodKeys()).toEqual([]);
  expect(browser.noteText()).toBeNull();
  expect(browser.tabItem(tab.storage)).toBeNull();
}
/** …and the tab's page was told, as after a sign-out made in the tab. */
function expectSignedOutOfThisComputer(tab: WebSignInTab) {
  expectNothingLeftHere(tab);
  expect(tab.heard).toContain('SIGNED_OUT');
}

describe('second review, web F5 (a): after Sign Out of This Computer the web client knows whether the cloud confirmed it', () => {
  it('the server takes the sign-out: confirmed', async () => {
    const tab = await signedInTab();

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
    expectSignedOutOfThisComputer(tab);
  });

  it('the hourly token had run out and the server answers both the refresh and the sign-out: confirmed', async () => {
    const tab = await signedInTab();
    browser.hourlyTokenRunsOut(tab.storage);

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
    expect(server.logoutsAsked).toBe(1);
  });

  it.each<[string, Partial<ServerState>, boolean]>([
    ['no connection, the hourly token still good (the sign-out request cannot be sent)', { logout: 'dropped' }, false],
    ['no connection, the hourly token run out (the refresh cannot be sent)', { refresh: 'dropped' }, true],
    ['the server answers the sign-out "unavailable"', { logout: 503 }, false],
    ['the server answers the refresh "unavailable"', { refresh: 503 }, true],
    ['the server answers the refresh "too many requests"', { refresh: 'too-many-requests' }, true],
    ['the server never answers the sign-out', { logout: 'never-answers' }, false],
    ['the server never answers the refresh', { refresh: 'never-answers' }, true],
    ['the server answers the sign-out with an error of its own (500)', { logout: 500 }, false],
    ['the server answers the sign-out "too many requests" (429)', { logout: 429 }, false],
  ])('%s: NOT confirmed, and this tab is signed out all the same', async (_what, state, tokenRanOut) => {
    const tab = await signedInTab();
    const accessTokenThen = browser.accessTokenOf(tab.storage);
    if (tokenRanOut) browser.hourlyTokenRunsOut(tab.storage);
    Object.assign(server, state);

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(true);
    expectSignedOutOfThisComputer(tab);
    // And it is true: the server has not ended that sign-in.
    expect(browser.cloud.signInEnded(accessTokenThen)).toBe(false);
  });

  it('the cloud had already ended this sign-in (the phone’s Sign Out of All Devices), and refuses its refresh: nothing is left to tell, confirmed', async () => {
    const tab = await signedInTab();
    await browser.serverEndsSignInOf(browser.accessTokenOf(tab.storage));
    browser.hourlyTokenRunsOut(tab.storage);
    server.logoutsAsked = 0;

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
    expect(tabHoldsSignIn(tab.storage)).toBe(false);
    // The server refused the refresh; no sign-out request followed it.
    expect(browser.outcomes()).toContain('refused');
    expect(server.logoutsAsked).toBe(0);
  });

  it.each([401, 403, 404])('the server answers the sign-out %i (that sign-in is not there): confirmed', async status => {
    const tab = await signedInTab();
    server.logout = status;

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
    expectSignedOutOfThisComputer(tab);
  });

  it('a tab that holds no sign-in signs out of nothing: nothing to say', async () => {
    const tab = browser.openAppTab(createTabStorage());

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
    expect(server.logoutsAsked + server.refreshesAsked).toBe(0);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('a second sign-out of this computer, confirmed, after one that was not: each answers for itself', async () => {
    const tab = await signedInTab();
    server.logout = 'dropped';
    await whileTimePasses(tab.gateway!.signOut('local'));
    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(true);
    server.logout = 'ok';
    expect((await tab.gateway!.signIn(owner.email, TAB_TEST_PASSWORD)).ok).toBe(true);

    await whileTimePasses(tab.gateway!.signOut('local'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
    // …and the other way round.
    server.logout = 'dropped';
    expect((await tab.gateway!.signIn(owner.email, TAB_TEST_PASSWORD)).ok).toBe(true);
    await whileTimePasses(tab.gateway!.signOut('local'));
    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(true);
  });

  it('a Sign Out of All Devices that is refused (no connection) after a Sign Out of This Computer the cloud did not confirm: nothing was signed out, and nothing is noted of it', async () => {
    const tab = await signedInTab();
    server.logout = 'dropped';
    await whileTimePasses(tab.gateway!.signOut('local'));
    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(true);
    expect((await tab.gateway!.signIn(owner.email, TAB_TEST_PASSWORD)).ok).toBe(true);

    const refused = await whileTimePasses(tab.gateway!.signOut('global').then(() => null, (error: unknown) => error));

    expect(refused.value).toBeInstanceOf(DAVEWebSignOutNeedsConnectionError);
    expect(tabHoldsSignIn(tab.storage)).toBe(true);
    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
  });

  it('guard: Sign Out of All Devices that went through is confirmed by definition (it is refused otherwise)', async () => {
    const tab = await signedInTab();

    await whileTimePasses(tab.gateway!.signOut('global'));

    expect(tab.gateway!.signedOutWithoutCloudConfirmation()).toBe(false);
    expectSignedOutOfThisComputer(tab);
  });
});

describe('second review, web F5 (b): a second open tab of the account, hearing the sign-out, is signed out too when the server never answers', () => {
  it('the server takes the sign-out request and never answers: after the five seconds it is given, this tab holds no sign-in', async () => {
    const tab = await signedInTab();
    server.logout = 'never-answers';

    const ended = await whileTimePasses(tab.gateway!.signOutThisTabToo('owner-1'), 110);

    expect(ended.value).toBe('ended');
    expect(ended.seconds).toBeGreaterThanOrEqual(DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS / 1_000 - 1);
    expect(ended.seconds).toBeLessThanOrEqual(DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS / 1_000 + 1);
    expectNothingLeftHere(tab);
    expect(server.logoutsAsked).toBe(1);
  });

  it('its hourly token had run out and the server never answers the refresh: the same', async () => {
    const tab = await signedInTab();
    browser.hourlyTokenRunsOut(tab.storage);
    server.refresh = 'never-answers';

    const ended = await whileTimePasses(tab.gateway!.signOutThisTabToo('owner-1'), 110);

    expect(ended.value).toBe('ended');
    expect(ended.seconds).toBeLessThanOrEqual(DAVE_WEB_SIGN_OUT_HERE_LIMIT_MS / 1_000 + 1);
    expectNothingLeftHere(tab);
    expect(server.refreshesAsked).toBe(1);
  });

  it.each<[string, Partial<ServerState>]>([
    ['no connection', { refresh: 'dropped' }],
    ['the server "unavailable"', { refresh: 503 }],
    ['"too many requests"', { refresh: 'too-many-requests' }],
  ])('its hourly token had run out, %s: it is signed out at once with one request (it was eight requests over half a minute)', async (_what, state) => {
    const tab = await signedInTab();
    browser.hourlyTokenRunsOut(tab.storage);
    Object.assign(server, state);

    const ended = await whileTimePasses(tab.gateway!.signOutThisTabToo('owner-1'), 110);

    expect(ended.value).toBe('ended');
    expect(ended.seconds).toBeLessThanOrEqual(1);
    expectNothingLeftHere(tab);
    expect(server.refreshesAsked + server.logoutsAsked).toBe(1);
  });

  it('guard: with the server answering, the server ends the sign-in and the tab is signed out at once, as before', async () => {
    const tab = await signedInTab();
    const accessTokenThen = browser.accessTokenOf(tab.storage);

    const ended = await whileTimePasses(tab.gateway!.signOutThisTabToo('owner-1'));

    expect(ended.value).toBe('ended');
    expect(ended.seconds).toBeLessThanOrEqual(1);
    expectNothingLeftHere(tab);
    expect(server.logoutsAsked).toBe(1);
    expect(browser.cloud.signInEnded(accessTokenThen)).toBe(true);
  });

  it('guard: another account’s sign-out heard here leaves this tab as it is, and asks the server nothing (owner answer Q26)', async () => {
    const tab = await signedInTab();
    server.logout = 'never-answers';

    const ended = await whileTimePasses(tab.gateway!.signOutThisTabToo('visitor-1'));

    expect(ended.value).toBe('kept');
    expect(tabSignIn(tab.storage)?.userId).toBe('owner-1');
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    expect(server.logoutsAsked + server.refreshesAsked).toBe(0);
  });

  it('a sign-in made in this tab while the server is not answering the heard sign-out is kept (another session)', async () => {
    const tab = await signedInTab();
    server.logout = 'never-answers';
    const ending = whileTimePasses(tab.gateway!.signOutThisTabToo('owner-1'), 110);
    await withoutTimePassing(() => server.logoutsAsked === 1);
    // He signs in again here in that moment: a new session lands in the tab's storage.
    storeTabSignIn(tab.storage, 'owner-1', { sessionId: '5e55101d-0001-4000-8000-000000000777' });

    expect((await ending).value).toBe('kept');
    expect(tabSignIn(tab.storage)?.sessionId).toBe('5e55101d-0001-4000-8000-000000000777');
  });
});
