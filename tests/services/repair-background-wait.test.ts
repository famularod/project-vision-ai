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



it('own background refresh429 then immediate first global signout explains actual cached wait',async()=>{
 const t=await signedInTab();browser.hourlyTokenRunsOut(t.storage);server.refresh='too-many-requests';
 await whileTimePasses(t.gateway!.getSessionStatus().catch(e=>e));expect(server.refreshesAsked).toBe(1);
 const result=await whileTimePasses(t.gateway!.signOut('global').catch(e=>e));
 console.log('BACKGROUND_WAIT',JSON.stringify({error:result.value.name,refreshes:server.refreshesAsked,retained:tabHoldsSignIn(t.storage)}));
 expect(result.value.name).toBe('DAVEWebSignOutWaitError');expect(tabHoldsSignIn(t.storage)).toBe(true);
});

it.each(['dropped', 503] as const)('cached background429 then fresh %s is unavailable and recovers', async failure => {
 const t = await signedInTab(); browser.hourlyTokenRunsOut(t.storage); server.refresh = 'too-many-requests';
 const checked = await whileTimePasses(t.gateway!.getSessionStatus().catch(e => e));
 expect(checked.value.message).toBe('The desktop session could not be checked.');
 expect((await whileTimePasses(t.gateway!.signOut('global').catch(e => e))).value.name).toBe('DAVEWebSignOutWaitError');
 await jest.advanceTimersByTimeAsync(180000); server.refresh = failure;
 expect((await whileTimePasses(t.gateway!.signOut('global').catch(e => e))).value).toBeInstanceOf(DAVEWebSignOutNeedsConnectionError);
 expect(server.refreshesAsked).toBe(2); expect(tabHoldsSignIn(t.storage)).toBe(true);
 await jest.advanceTimersByTimeAsync(180000); server.refresh = 'ok';
 await whileTimePasses(t.gateway!.signOut('global')); expectSignedOutOfThisComputer(t);
});
it.each(['owner-1', 'visitor-1'])('cached429 provenance does not follow a new %s sign-in or token', async user => {
 const t = await signedInTab(); browser.hourlyTokenRunsOut(t.storage); server.refresh = 'too-many-requests';
 const failed = await whileTimePasses(t.client.auth.getSession());
 expect(failed.value.error).not.toBeNull();
 expect(t.guard.serverRequestedWait!(failed.value.error!)).toBe(true);
 expect((await t.gateway!.signIn(TAB_ACCOUNTS[user].email, TAB_TEST_PASSWORD)).ok).toBe(true);
 expect(t.guard.serverRequestedWait!(failed.value.error!)).toBe(false);
 browser.hourlyTokenRunsOut(t.storage); server.refresh = 503;
 expect((await whileTimePasses(t.gateway!.signOut('global').catch(e => e))).value).toBeInstanceOf(DAVEWebSignOutNeedsConnectionError);
 expect(tabHoldsSignIn(t.storage)).toBe(true);
});
it('actual automatic refresh429 supplies cached first-signout provenance', async () => {
 const t = await signedInTab(); browser.hourlyTokenRunsOut(t.storage); server.refresh = 'too-many-requests';
 await t.client.auth.startAutoRefresh();
 try {
   await jest.advanceTimersByTimeAsync(45000);
   await withoutTimePassing(() => server.refreshesAsked > 0);
   expect(server.refreshesAsked).toBe(1);
   expect((await whileTimePasses(t.gateway!.signOut('global').catch(e => e))).value.name).toBe('DAVEWebSignOutWaitError');
   expect(server.refreshesAsked).toBe(1); expect(tabHoldsSignIn(t.storage)).toBe(true);
 } finally { await t.client.auth.stopAutoRefresh(); }
});

it('a successful same-session token rotation invalidates the earlier marker', async () => {
 const t = await signedInTab(); browser.hourlyTokenRunsOut(t.storage); server.refresh = 'too-many-requests';
 const failed = await whileTimePasses(t.client.auth.getSession());
 expect(t.guard.serverRequestedWait!(failed.value.error!)).toBe(true);
 expect([...t.storage.values.values()].join(' ')).not.toContain('rate limited');
 expect(browser.noteText()).not.toContain('rate limited');
 await jest.advanceTimersByTimeAsync(660000); server.refresh = 'ok';
 const refreshed = await whileTimePasses(t.client.auth.refreshSession()); expect(refreshed.value.error).toBeNull();
 expect(t.guard.serverRequestedWait!(failed.value.error!)).toBe(false);
 browser.hourlyTokenRunsOut(t.storage); server.refresh = 503;
 expect((await whileTimePasses(t.gateway!.signOut('global').catch(e => e))).value).toBeInstanceOf(DAVEWebSignOutNeedsConnectionError);
 expect(tabHoldsSignIn(t.storage)).toBe(true);
});
