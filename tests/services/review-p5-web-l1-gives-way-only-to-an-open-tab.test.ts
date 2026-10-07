/**
 * @jest-environment node
 */
import { TAB_ACCOUNTS, TAB_STORAGE_KEY, TAB_TEST_PASSWORD, createTabStorage, storeTabSignIn, tabHoldsSignIn, tabSignIn } from '../fixtures/browser-tabs';
import {
  WEB_SIGN_IN_PERIOD_KEY,
  createWebSignInBrowser,
  settleTabs,
  useBrowserGlobals,
  type WebSignInBrowser,
  type WebSignInTab,
} from '../fixtures/web-sign-in-browser';

// Review pass 1 of the web area, L1 (6 Oct 2026; caused by open item W1-1, the Duplicate Tab fix).
//
// A tab whose sign-in token had been replaced twice "gave way": it did not present the token, and its page
// left the account's report periods in the browser, because the account was taken to be still signed in in
// the working tab. It did so on the note alone. So it also gave way to a tab that had been closed, and after
// the phone's "Sign Out of All Devices" nobody asked the server: the periods stayed for good, where the last
// build removed them.
//
// Now:
// - a tab gives way only to a tab that is OPEN NOW and holds a token of that sign-in the server would take;
//   with no such tab it presents its token and the server answers, as on the last build;
// - giving way is not the server's answer: the periods stay only while the newest hourly token of that
//   sign-in has not run out, the tab given way to is still there, and the sign-in has not ended. When any of
//   that stops, the tab that gave way removes them.
//
// Second review of the web area, F2 (7 Oct 2026): the second rule made the tab that gave way DELETE the periods
// although nobody had signed out and the server had ended nothing (the working tab reloaded, out of sight to
// the end of its hour, or its hour already over). A tab that only gave way now removes nothing: the periods
// leave only when that sign-in really ended in this browser. Five tests below pinned the old rule (the tab
// given way to closed, twice; two tabs waiting; the hour running out; the hour already over) and now hold the
// new one; each says so. The rest is in
// tests/services/review-p5-web-pass2-f2-a-tab-that-gave-way-removes-nothing.test.ts.
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

const owner = TAB_ACCOUNTS['owner-1'];
const visitor = TAB_ACCOUNTS['visitor-1'];
const minutesLater = (minutes: number) => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + minutes * 60_000);
};

/**
 * He is signed in, duplicates the tab, and works in the COPY for two hours. The first tab, left alone, is
 * the app's own (its page keeps the report periods); `left` is not opened yet when `leftOpen` is false.
 */
async function firstTabLeftBehindACopyHeWorksIn() {
  const firstStorage = createTabStorage();
  storeTabSignIn(firstStorage, 'owner-1');
  const left = browser.openAppTab(firstStorage);
  await left.client.auth.initialize();
  const copy = browser.openTab(browser.duplicateOf(firstStorage));
  await copy.client.auth.initialize();
  expect(await browser.refreshes(copy)).toBe('refreshed');
  expect(await browser.refreshes(copy)).toBe('refreshed');
  return { left, copy };
}

/** He comes back to the tab he had left: its hourly token ran out long ago. */
async function comesBackTo(tab: WebSignInTab) {
  browser.hourlyTokenRunsOut(tab.storage);
  return browser.looksAtItsSignIn(tab);
}

describe('a tab gives way only to a tab that is open now', () => {
  it('the copy was closed and the phone signed out of all devices: the first tab asks the server, is refused, and the report periods leave the browser as on the last build', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();
    const copysAccessToken = browser.accessTokenOf(copy.storage);
    browser.closeTab(copy);
    await browser.serverEndsSignInOf(copysAccessToken);

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'refused']);
    expect(left.guard.gaveWay()).toBe(false);
    expect(tabHoldsSignIn(left.storage)).toBe(false);
    expect(browser.periodKeys()).toEqual([]);
  });

  it('the copy was closed and nothing ended on the server: the first tab presents its old token and the server ends the sign-in, as on the last build. Nothing is kept on the strength of a tab that is gone', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();
    browser.closeTab(copy);

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'ended-the-sign-in']);
    expect(left.guard.gaveWay()).toBe(false);
    expect(browser.periodKeys()).toEqual([]);
    expect(browser.noteText()).toBeNull();
  });

  it('the copy is open: the first tab gives way, the server is not asked, and the copy goes on working', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced']);
    expect(left.guard.gaveWay()).toBe(true);
    expect(await browser.refreshes(copy)).toBe('refreshed');
    expect(browser.cloud.signInEnded(browser.accessTokenOf(copy.storage))).toBe(false);
  });

  it('the copy’s page was reloaded (Chrome’s Memory Saver bringing it back): it is open again and still holds the newest token, so the first tab gives way', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();
    browser.closeTab(copy);
    const reloaded = browser.openTab(copy.storage);
    await reloaded.client.auth.initialize();

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced']);
    expect(left.guard.gaveWay()).toBe(true);
    expect(await browser.refreshes(reloaded)).toBe('refreshed');
  });

  it('an open tab that holds the token just before the newest counts too (the server would take it): it is not signed out by the stale tab', async () => {
    const storage = createTabStorage();
    storeTabSignIn(storage, 'owner-1');
    const working = browser.openTab(storage);
    await working.client.auth.initialize();
    const oneBehind = browser.openTab(browser.duplicateOf(storage));
    await oneBehind.client.auth.initialize();
    const stale = browser.openAppTab(browser.duplicateOf(storage));
    await stale.client.auth.initialize();
    await browser.refreshes(working);
    await browser.refreshes(oneBehind); // forgiven: it now holds the same token as the working tab
    await browser.refreshes(working);
    browser.closeTab(working);

    expect(await comesBackTo(stale)).toBe('no sign-in');

    expect(stale.guard.gaveWay()).toBe(true);
    expect(browser.outcomes()).toEqual(['replaced', 'forgiven', 'replaced']);
    // The tab one refresh behind is forgiven, as always.
    expect(await browser.refreshes(oneBehind)).toBe('refreshed');
    expect(browser.outcomes().slice(-1)).toEqual(['forgiven']);
  });

  it('two tabs that are both two refreshes behind do not stand in for the one that is gone: the first one looked at asks the server', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();
    const alsoStale = browser.openTab(browser.duplicateOf(left.storage));
    await alsoStale.client.auth.initialize();
    browser.closeTab(copy);

    expect(await comesBackTo(alsoStale)).toBe('no sign-in');
    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'ended-the-sign-in', 'refused']);
    expect(alsoStale.guard.gaveWay()).toBe(false);
    expect(left.guard.gaveWay()).toBe(false);
    expect(browser.periodKeys()).toEqual([]);
  });

  it('a tab that gave way is not then taken for a tab that holds the sign-in: the next stale tab asks the server once the working tab has gone', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();
    const alsoStale = browser.openTab(browser.duplicateOf(left.storage));
    await alsoStale.client.auth.initialize();
    expect(await comesBackTo(alsoStale)).toBe('no sign-in');
    expect(alsoStale.guard.gaveWay()).toBe(true);
    browser.closeTab(copy);
    await settleTabs();

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'ended-the-sign-in']);
    expect(left.guard.gaveWay()).toBe(false);
  });

  it('a browser without Web Locks cannot tell who is open: the stale tab presents its token, as on the last build', async () => {
    browser.state.webLocksWork = false;
    const { left } = await firstTabLeftBehindACopyHeWorksIn();

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'ended-the-sign-in']);
    expect(left.guard.gaveWay()).toBe(false);
    expect(browser.periodKeys()).toEqual([]);
  });

  it('owner answer Q26: another account’s open tab is no reason to give way, and is not touched', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();
    browser.closeTab(copy);
    const visitorsTab = browser.openTab(createTabStorage());
    await visitorsTab.client.auth.signInWithPassword({ email: visitor.email, password: TAB_TEST_PASSWORD });
    await browser.refreshes(visitorsTab);
    await browser.refreshes(visitorsTab);

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(left.guard.gaveWay()).toBe(false);
    expect(browser.outcomes().slice(-1)).toEqual(['ended-the-sign-in']);
    expect(tabSignIn(visitorsTab.storage)?.userId).toBe('visitor-1');
    expect(await browser.refreshes(visitorsTab)).toBe('refreshed');
    // The visitor's own note is still there; the owner's went with his ended sign-in.
    expect(Object.keys(browser.note())).toHaveLength(1);
  });
});

describe('what a tab says it holds is put right by what it actually presents', () => {
  const SESSION_KEY = `dave.web.auth.${TAB_STORAGE_KEY}`;

  it('a tab that was given the newest token but whose own storage shows a twice-replaced one again does not give way to itself: it asks the server', async () => {
    const storage = createTabStorage();
    storeTabSignIn(storage, 'owner-1');
    const tab = browser.openAppTab(storage);
    await tab.client.auth.initialize();
    const asItWas = String(storage.getItem(SESSION_KEY));
    await browser.refreshes(tab);
    await browser.refreshes(tab);
    // What it was given since did not stay in its storage (the browser brought an older copy of it back).
    storage.setItem(SESSION_KEY, asItWas);

    expect(await comesBackTo(tab)).toBe('no sign-in');

    expect(tab.guard.gaveWay()).toBe(false);
    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'ended-the-sign-in']);
    expect(browser.periodKeys()).toEqual([]);
  });

  it('…and once such a tab has given way to an open tab, it no longer counts as holding anything: after that tab closes, the next stale tab asks the server', async () => {
    const storage = createTabStorage();
    storeTabSignIn(storage, 'owner-1');
    const first = browser.openTab(storage);
    await first.client.auth.initialize();
    const asItWas = String(storage.getItem(SESSION_KEY));
    const stale = browser.openAppTab(browser.duplicateOf(storage));
    await stale.client.auth.initialize();
    await browser.refreshes(first);
    await browser.refreshes(first);
    const working = browser.openTab(browser.duplicateOf(storage));
    await working.client.auth.initialize();
    await browser.refreshes(working);
    // The first tab's storage shows its first token again; the browser still has it down as holding the one before the newest.
    storage.setItem(SESSION_KEY, asItWas);
    expect(await comesBackTo(first)).toBe('no sign-in');
    expect(first.guard.gaveWay()).toBe(true);
    browser.closeTab(working);
    await settleTabs();

    expect(await comesBackTo(stale)).toBe('no sign-in');

    expect(stale.guard.gaveWay()).toBe(false);
    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'replaced', 'ended-the-sign-in']);
  });
});

describe('giving way is not the server’s answer: what happens to the account’s report periods', () => {
  /** The first tab gave way to the open copy a moment ago; the copy's hourly token is 0 minutes old. */
  async function firstTabGaveWayToTheOpenCopy() {
    const tabs = await firstTabLeftBehindACopyHeWorksIn();
    expect(await comesBackTo(tabs.left)).toBe('no sign-in');
    expect(tabs.left.guard.gaveWay()).toBe(true);
    expect(browser.outcomes()).toEqual(['replaced', 'replaced']);
    return tabs;
  }

  it('while the tab given way to is open and its newest hourly token has not run out, they stay: the account is signed in here', async () => {
    await firstTabGaveWayToTheOpenCopy();
    await settleTabs(50);

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('that tab is then refused by the server (the phone’s Sign Out of All Devices): they leave the browser at once, though only the tab that gave way has a page to remove them', async () => {
    const { copy } = await firstTabGaveWayToTheOpenCopy();
    await browser.serverEndsSignInOf(browser.accessTokenOf(copy.storage));

    expect(await comesBackTo(copy)).toBe('no sign-in');
    await settleTabs();

    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'refused']);
    expect(browser.periodKeys()).toEqual([]);
  });

  // Changed for the second review, F2: this expected them to leave at once ("nobody open holds the sign-in").
  // Closing a tab ends no sign-in, and a reload looks the same to the tab that gave way.
  it('that tab is closed before it asked the server again: nobody signed out, and they stay', async () => {
    const { copy } = await firstTabGaveWayToTheOpenCopy();

    browser.closeTab(copy);
    await settleTabs();

    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    // Nothing was sent to the server for it.
    expect(browser.outcomes()).toEqual(['replaced', 'replaced']);
  });

  it('that tab signs out: they leave', async () => {
    const { copy } = await firstTabGaveWayToTheOpenCopy();

    await copy.client.auth.signOut({ scope: 'local' });
    await settleTabs();

    expect(browser.periodKeys()).toEqual([]);
  });

  it('that tab refreshes and the server says the sign-in is good: they stay, and from then on that tab carries the sign-in like any signed-in tab (closing it later removes nothing, as on the last build)', async () => {
    const { copy } = await firstTabGaveWayToTheOpenCopy();

    expect(await browser.refreshes(copy)).toBe('refreshed');
    await settleTabs();
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);

    browser.closeTab(copy);
    await settleTabs();
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  // Changed for the second review, F2: this expected them to leave once both had been closed.
  it('a second open tab holds the same newest token: they stay when one is closed, and they leave when the other signs out', async () => {
    const { copy } = await firstTabGaveWayToTheOpenCopy();
    const second = browser.openTab(browser.duplicateOf(copy.storage));
    await second.client.auth.initialize();
    await settleTabs();

    browser.closeTab(copy);
    await settleTabs();
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);

    await second.client.auth.signOut({ scope: 'local' });
    await settleTabs();
    expect(browser.periodKeys()).toEqual([]);
  });

  // Changed for the second review, F2: this ended with the second holder being closed, and expected both
  // waiting tabs to be told then. A closed tab ends nothing; the second holder now signs out instead.
  it('two tabs gave way and both wait, and a second open tab holds the same newest token: neither removes anything when one holder is closed, and both are told when the other signs out', async () => {
    const firstStorage = createTabStorage();
    storeTabSignIn(firstStorage, 'owner-1');
    const left = browser.openAppTab(firstStorage);
    await left.client.auth.initialize();
    const alsoLeft = browser.openTab(browser.duplicateOf(firstStorage));
    await alsoLeft.client.auth.initialize();
    const copy = browser.openTab(browser.duplicateOf(firstStorage));
    await copy.client.auth.initialize();
    await browser.refreshes(copy);
    await browser.refreshes(copy);
    expect(await comesBackTo(left)).toBe('no sign-in');
    expect(await comesBackTo(alsoLeft)).toBe('no sign-in');
    // The second tab that gave way waits as the first does (its own page would ask it to, as the app's page does).
    let secondWaiterTold = false;
    expect(alsoLeft.guard.vouchedFor(() => { secondWaiterTold = true; })).toBe(true);
    // Both are waiting in line before the second holder opens: it then waits in line behind them.
    await settleTabs();
    const second = browser.openTab(browser.duplicateOf(copy.storage));
    await second.client.auth.initialize();
    await settleTabs();

    browser.closeTab(copy);
    await settleTabs();
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    expect(secondWaiterTold).toBe(false);

    await second.client.auth.signOut({ scope: 'local' });
    await settleTabs();
    expect(browser.periodKeys()).toEqual([]);
    expect(secondWaiterTold).toBe(true);
    expect(browser.outcomes()).toEqual(['replaced', 'replaced']);
  });

  // Changed for the second review, F2: this expected them to leave when the hour ran out.
  it('that tab stays open but does not ask the server again (hidden): they stay when its hourly token runs out; an hour passing ends no sign-in', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const { copy } = await firstTabGaveWayToTheOpenCopy();

      await jest.advanceTimersByTimeAsync(59 * 60_000);
      expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);

      await jest.advanceTimersByTimeAsync(90_000);
      expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
      // Nothing was sent for it, and the hidden tab still holds its own sign-in, for the server to judge when it is looked at.
      expect(browser.outcomes()).toEqual(['replaced', 'replaced']);
      expect(tabHoldsSignIn(copy.storage)).toBe(true);
      expect(await browser.refreshes(copy)).toBe('refreshed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('…and not when it did ask in that hour and the server said good', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const { copy } = await firstTabGaveWayToTheOpenCopy();
      await jest.advanceTimersByTimeAsync(58 * 60_000);
      expect(await browser.refreshes(copy)).toBe('refreshed');

      await jest.advanceTimersByTimeAsync(3 * 60 * 60_000);

      expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    } finally {
      jest.useRealTimers();
    }
  });

  // Changed for the second review, F2: this expected the periods to leave at once.
  it('the tab given way to is open but its newest hourly token had ALREADY run out (hidden for over an hour): the stale tab still does not present its token, so that tab is not signed out, and the periods stay: nobody signed out', async () => {
    const { left, copy } = await firstTabLeftBehindACopyHeWorksIn();
    minutesLater(61);

    expect(await comesBackTo(left)).toBe('no sign-in');

    expect(left.guard.gaveWay()).toBe(true);
    // The stale token was not presented: the server ended nothing and refused nothing. (auth-js tells every tab
    // of this tab's ended sign-in, and the hidden tab, its own hourly token run out, may ask the server then.)
    expect(browser.outcomes().every(outcome => outcome === 'replaced')).toBe(true);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    // The hidden tab is as it was: its own token is the newest, and the server takes it.
    expect(tabHoldsSignIn(copy.storage)).toBe(true);
    expect(await browser.refreshes(copy)).toBe('refreshed');
    expect(browser.cloud.signInEnded(browser.accessTokenOf(copy.storage))).toBe(false);
  });

  it('the tab that gave way signs in again: it is a signed-in tab of the account itself, and nothing is removed later on the other tab’s account', async () => {
    const { left, copy } = await firstTabGaveWayToTheOpenCopy();

    expect((await left.gateway!.signIn(owner.email, TAB_TEST_PASSWORD)).ok).toBe(true);
    browser.closeTab(copy);
    await settleTabs();

    expect(left.guard.gaveWay()).toBe(false);
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
    expect(await left.gateway!.authorizedOwnerId()).toBe('owner-1');
  });
});
