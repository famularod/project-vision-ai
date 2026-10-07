/**
 * @jest-environment node
 */
import { DAVE_WEB_SIGN_IN_TURNS_KEY } from '../../services/DAVEWebSignInRefreshGuard';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_ACCOUNTS,
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabStorage,
  storeTabSignIn,
  tabHoldsSignIn,
  type TabCloud,
} from '../fixtures/browser-tabs';
import {
  WEB_SIGN_IN_PERIOD_KEY,
  createWebSignInBrowser,
  settleTabs,
  useBrowserGlobals,
  type WebSignInBrowser,
} from '../fixtures/web-sign-in-browser';

// Second review of the web area, F2 (7 Oct 2026; caused by the fix for review pass 1, L1).
//
// A stale copy of a tab gives way to the tab he works in: it does not present its old token, and shows the
// sign-in page. While it sat there it DELETED this computer's report periods although nobody had signed out
// and the server had ended nothing: when the working tab was reloaded, when the working tab stayed out of
// sight to the end of its hour, and at once when that hour had already run out. The working tab stayed signed
// in, and lost this computer's record of the last report sent and any approval not yet sent.
//
// Now a tab that only gave way removes nothing. An account's report periods leave this browser only when that
// account's sign-in really ended here: Sign Out of This Computer, Sign Out of All Devices made or heard here,
// or the server refusing its sign-in. The tab whose sign-in ends removes them, as always. The tab that gave
// way drops what it kept too, as soon as it can tell that the sign-in it gave way for really ended in this
// browser (the Duplicate Tab note no longer lists it), and not before.
//
// Tabs are real supabase-js clients over the stand-in cloud with Supabase's rule for refresh tokens; the
// browser's Web Locks are the stand-in of tests/fixtures/browser-locks.ts. Nothing reaches the network.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(30_000);
useBrowserGlobals();

let browser: WebSignInBrowser;
beforeEach(() => { browser = createWebSignInBrowser(); });
afterEach(async () => {
  jest.spyOn(Date, 'now').mockRestore();
  await browser.closeEveryTab();
});

const visitor = TAB_ACCOUNTS['visitor-1'];
const minutesLater = (minutes: number) => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + minutes * 60_000);
};
const serverEndedNothing = () => !browser.outcomes().includes('ended-the-sign-in') && !browser.outcomes().includes('refused');

/**
 * He is signed in, duplicates the tab, and works in the first tab. The COPY, left alone, is the app's own
 * tab (its page keeps the report periods). `hourOver`: the working tab was then left out of sight for over
 * an hour before he looked at the copy. The copy gives way and shows the sign-in page.
 */
async function copyGaveWayToTheOpenWorkingTab({ hourOver = false }: { hourOver?: boolean } = {}) {
  const first = createTabStorage();
  storeTabSignIn(first, 'owner-1');
  const working = browser.openTab(first);
  await working.client.auth.initialize();
  const copy = browser.openAppTab(browser.duplicateOf(first));
  await copy.client.auth.initialize();
  expect(await browser.refreshes(working)).toBe('refreshed');
  expect(await browser.refreshes(working)).toBe('refreshed');
  if (hourOver) minutesLater(61);
  browser.hourlyTokenRunsOut(copy.storage);
  expect(await browser.looksAtItsSignIn(copy)).toBe('no sign-in');
  expect(copy.guard.gaveWay()).toBe(true);
  expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  return { working, copy, first };
}
/** F5 in the working tab: its page goes, and a new page loads over the same tab storage. */
async function reloads(tab: Awaited<ReturnType<typeof copyGaveWayToTheOpenWorkingTab>>['working'], storage: ReturnType<typeof createTabStorage>) {
  browser.closeTab(tab);
  await settleTabs(40);
  const again = browser.openTab(storage);
  await again.client.auth.initialize();
  await settleTabs(40);
  return again;
}

describe('second review, web F2: while the copy sits on the sign-in page, nobody signed out and the server ended nothing: the report periods stay', () => {
  it('he reloads the working tab: it stays signed in, and this computer’s report periods are still there', async () => {
    const { working, first } = await copyGaveWayToTheOpenWorkingTab();

    const again = await reloads(working, first);

    expect(await browser.looksAtItsSignIn(again)).toBe('signed in');
    expect(serverEndedNothing()).toBe(true);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('the working tab stays out of sight to the end of its hour, and long after: they are still there, and it is still signed in when he looks at it', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const { working } = await copyGaveWayToTheOpenWorkingTab();

      await jest.advanceTimersByTimeAsync(61 * 60_000);
      expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
      await jest.advanceTimersByTimeAsync(5 * 60 * 60_000);

      expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
      expect(serverEndedNothing()).toBe(true);
      expect(tabHoldsSignIn(working.storage)).toBe(true);
      expect(await browser.refreshes(working)).toBe('refreshed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('the working tab’s hour had already run out when he clicked the copy first (both left overnight): they are still there, and the working tab is not signed out', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab({ hourOver: true });
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    expect(serverEndedNothing()).toBe(true);
    expect(tabHoldsSignIn(working.storage)).toBe(true);
    expect(await browser.refreshes(working)).toBe('refreshed');
  });

  it('he closes the working tab: nobody signed out, so nothing is removed (as when a signed-in tab is closed with no copy open)', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();

    browser.closeTab(working);
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    expect(serverEndedNothing()).toBe(true);
  });

  it('the copy’s own word for it: a tab that gave way is watching for the real end of that sign-in, whether or not the hour has run out; a tab that did not give way has nothing to watch', async () => {
    const { copy } = await copyGaveWayToTheOpenWorkingTab({ hourOver: true });
    let told = 0;

    expect(copy.guard.vouchedFor(() => { told += 1; })).toBe(true);
    await settleTabs(40);
    expect(told).toBe(0);

    const other = browser.openTab(createTabStorage());
    expect(other.guard.vouchedFor(() => { told += 1; })).toBe(false);
    expect(told).toBe(0);
  });
});

describe('second review, web F2: when that sign-in really ends here, the periods leave, and the tab that gave way drops what it kept too', () => {
  it('guard: the working tab is refused by the server (the phone’s Sign Out of All Devices): they leave at once', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();
    await browser.serverEndsSignInOf(browser.accessTokenOf(working.storage));
    browser.hourlyTokenRunsOut(working.storage);

    expect(await browser.looksAtItsSignIn(working)).toBe('no sign-in');
    await settleTabs();

    expect(browser.outcomes()).toContain('refused');
    expect(browser.periodKeys()).toEqual([]);
  });

  it('guard: the working tab signs out: they leave', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();

    await working.client.auth.signOut({ scope: 'local' });
    await settleTabs();

    expect(browser.periodKeys()).toEqual([]);
  });

  it('a second open tab of that sign-in still holds its token when the working tab signs out: they leave at once, not only when the second tab lets go', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();
    const second = browser.openTab(browser.duplicateOf(working.storage));
    await second.client.auth.initialize();
    await settleTabs();

    await working.client.auth.signOut({ scope: 'local' });
    await settleTabs(40);

    expect(tabHoldsSignIn(second.storage)).toBe(true);
    expect(browser.periodKeys()).toEqual([]);
  });

  it('the working tab was RELOADED first, then the server refuses it (the phone’s Sign Out of All Devices): they leave then', async () => {
    const { working, first } = await copyGaveWayToTheOpenWorkingTab();
    const again = await reloads(working, first);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    await browser.serverEndsSignInOf(browser.accessTokenOf(first));
    browser.hourlyTokenRunsOut(first);

    expect(await browser.looksAtItsSignIn(again)).toBe('no sign-in');
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([]);
  });

  it('the working tab was reloaded first, then signs out of this computer: they leave then', async () => {
    const { working, first } = await copyGaveWayToTheOpenWorkingTab();
    const again = await reloads(working, first);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);

    await again.client.auth.signOut({ scope: 'local' });
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([]);
  });

  it('the working tab stayed out of sight past its hour, then he looks at it and the server refuses it: they leave then, not at the end of the hour', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const { working } = await copyGaveWayToTheOpenWorkingTab();
      await browser.serverEndsSignInOf(browser.accessTokenOf(working.storage));
      await jest.advanceTimersByTimeAsync(2 * 60 * 60_000);
      expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
      browser.hourlyTokenRunsOut(working.storage);

      const looked = working.client.auth.getSession();
      await jest.advanceTimersByTimeAsync(1_000);
      expect((await looked).data.session).toBeNull();
      await jest.advanceTimersByTimeAsync(1_000);

      expect(browser.periodKeys()).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the working tab’s hour had already run out when the copy gave way, then the server refuses the working tab: they leave then', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab({ hourOver: true });
    await browser.serverEndsSignInOf(browser.accessTokenOf(working.storage));
    browser.hourlyTokenRunsOut(working.storage);

    expect(await browser.looksAtItsSignIn(working)).toBe('no sign-in');
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([]);
  });

  it('the working tab refreshed (the server said the sign-in is good) and only later is refused: the tab that gave way drops them then too', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();
    expect(await browser.refreshes(working)).toBe('refreshed');
    await settleTabs();
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    await browser.serverEndsSignInOf(browser.accessTokenOf(working.storage));
    browser.hourlyTokenRunsOut(working.storage);

    expect(await browser.looksAtItsSignIn(working)).toBe('no sign-in');
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([]);
  });
});

describe('second review, web F2: the tab that gave way takes nothing else for the end of that sign-in', () => {
  it('owner answer Q26: another account’s tab signs in, refreshes, is refused by the server and signs out: the owner’s periods stay', async () => {
    await copyGaveWayToTheOpenWorkingTab();
    const other = browser.openTab(createTabStorage());
    await other.client.auth.initialize();

    await other.client.auth.signInWithPassword({ email: visitor.email, password: TAB_TEST_PASSWORD });
    await browser.refreshes(other);
    await browser.serverEndsSignInOf(browser.accessTokenOf(other.storage));
    await browser.refreshes(other);
    await settleTabs(40);
    await other.client.auth.signInWithPassword({ email: visitor.email, password: TAB_TEST_PASSWORD });
    await other.client.auth.signOut({ scope: 'local' });
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('the shared storage cannot be read when a sign-out is heard: it cannot be told that the sign-in ended, and nothing is removed', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();
    const other = browser.openTab(createTabStorage());
    await other.client.auth.initialize();
    await other.client.auth.signInWithPassword({ email: visitor.email, password: TAB_TEST_PASSWORD });
    browser.state.profileStorageWorks = false;

    browser.closeTab(working);
    await other.client.auth.signOut({ scope: 'local' });
    await settleTabs(40);
    browser.state.profileStorageWorks = true;

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('eight newer sign-ins pushed that sign-in out of the note (only eight are remembered): that is not its end, and nothing is removed', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();
    const until = Date.now() + 2 * 60 * 60_000;
    browser.profile.setItem(DAVE_WEB_SIGN_IN_TURNS_KEY, JSON.stringify(Object.fromEntries(
      Array.from({ length: 8 }, (_unused, index) => [`${index}`.repeat(16), { until: until + index, tokens: ['f'.repeat(16)] }]),
    )));

    browser.closeTab(working);
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('more than a week later the note has forgotten that sign-in by itself: that is not its end either', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();
    minutesLater(8 * 24 * 60 + 61);
    // A tab opening the app takes the expired sign-in out of the note.
    const other = browser.openTab(createTabStorage());
    await other.client.auth.initialize();
    expect(browser.noteText()).toBeNull();

    browser.closeTab(working);
    await other.client.auth.signInWithPassword({ email: visitor.email, password: TAB_TEST_PASSWORD });
    await other.client.auth.signOut({ scope: 'local' });
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('it drops them once: after that sign-in ended, the owner signs in again in another tab and has new periods; a sign-out heard later (another account’s) does not remove those', async () => {
    const { working } = await copyGaveWayToTheOpenWorkingTab();
    await working.client.auth.signOut({ scope: 'local' });
    await settleTabs(40);
    expect(browser.periodKeys()).toEqual([]);
    // He signs in again in the working tab, and this computer keeps a new report period for him.
    await working.client.auth.signInWithPassword({ email: TAB_ACCOUNTS['owner-1'].email, password: TAB_TEST_PASSWORD });
    browser.profile.setItem(WEB_SIGN_IN_PERIOD_KEY, '{"scopeKey":"new"}');
    const other = browser.openTab(createTabStorage());
    await other.client.auth.initialize();

    await other.client.auth.signInWithPassword({ email: visitor.email, password: TAB_TEST_PASSWORD });
    await other.client.auth.signOut({ scope: 'local' });
    await settleTabs(40);

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('a guard that cannot watch for the end of that sign-in (it has no such part): nothing is kept on its strength, as before', async () => {
    const storage = createTabStorage();
    storeTabSignIn(storage, 'owner-1', { expired: true });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: storage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: browser.profile });
    /** Answers this tab's refresh as the guard does when it gives way, and says it gave way; it cannot watch. */
    let gaveWay = false;
    const cloud = {
      ...browser.cloud,
      fetch: (async (input: unknown, init?: unknown) => {
        if (String(typeof input === 'string' ? input : (input as { url: string }).url).includes('grant_type=refresh_token')) {
          gaveWay = true;
          return new Response(JSON.stringify({ code: 'refresh_token_replaced_in_another_tab', message: 'replaced in another tab' }), {
            status: 400, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
          });
        }
        return (browser.cloud.fetch as (input: unknown, init?: unknown) => Promise<Response>)(input, init);
      }) as TabCloud['fetch'],
    } as unknown as TabCloud;
    const client = createTabClient(supabaseSecureAuthStorage, cloud);
    const gateway = createDAVEWebSupabaseGateway(client, { gaveWay: () => gaveWay });
    const stopListening = gateway.subscribeToAuthStateChange(() => undefined);
    try {
      expect((await client.auth.getSession()).data.session).toBeNull();
      await settleTabs();

      expect(gaveWay).toBe(true);
      expect(browser.periodKeys()).toEqual([]);
    } finally {
      stopListening();
      closeTabClient(client);
    }
  });

  it('guard: someone signs in on the copy: it is a signed-in tab of its own from then on, and the working tab closing later removes nothing', async () => {
    const { working, copy } = await copyGaveWayToTheOpenWorkingTab();

    expect((await copy.gateway!.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD)).ok).toBe(true);
    browser.closeTab(working);
    await settleTabs();

    expect(copy.guard.gaveWay()).toBe(false);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });
});
