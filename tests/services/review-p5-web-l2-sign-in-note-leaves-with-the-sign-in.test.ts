/**
 * @jest-environment node
 */
import { createHash, createHmac } from 'crypto';

import { createDAVEWebSignInRefreshGuard } from '../../services/DAVEWebSignInRefreshGuard';
import { TAB_ACCOUNTS, TAB_TEST_PASSWORD, createTabStorage, storeTabSignIn, tabHoldsSignIn, tabSignIn } from '../fixtures/browser-tabs';
import {
  WEB_SIGN_IN_PERIOD_KEY,
  createWebSignInBrowser,
  settleTabs,
  useBrowserGlobals,
  type WebSignInBrowser,
} from '../fixtures/web-sign-in-browser';

// Review pass 1 of the web area, L2 (6 Oct 2026; caused by open item W1-1, the Duplicate Tab fix).
//
// To tell that a tab's sign-in token has been replaced twice, every tab leaves a note in the browser
// profile's shared storage. The note was never removed: not by Sign Out of This Computer, not when the
// server ended the sign-in, not when the tab was closed. It named each sign-in by its session id, and its
// fingerprints were plain SHA-256 prefixes of the tokens, the first one of the token the tab held just then:
// anyone with a copy of that storage could test guesses of the token against it.
//
// Now:
// - the note for a sign-in is removed when that sign-in ends in this browser: Sign Out of This Computer,
//   Sign Out of All Devices (made here, or heard from another tab of the account), and a sign-in the
//   server ended;
// - a sign-in nobody refreshed for a week is dropped from it;
// - it holds nothing the guard does not read: no session id;
// - its fingerprints are made with a random key that is kept only in the tab's own storage, where the
//   sign-in itself is. Without that key nothing in the shared storage can be tested against a guess,
//   whatever the token's length; whoever has the tab's own storage has the token itself.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(30_000);
useBrowserGlobals();

const FORMER_NOTE_KEY = 'vitruvius.web.sign-in-turns.v1';
const DAY_MS = 24 * 60 * 60_000;
const HEX16 = /^[0-9a-f]{16}$/;

let browser: WebSignInBrowser;
beforeEach(() => { browser = createWebSignInBrowser(); });
afterEach(async () => {
  jest.spyOn(Date, 'now').mockRestore();
  await browser.closeEveryTab();
});

const owner = TAB_ACCOUNTS['owner-1'];
const visitor = TAB_ACCOUNTS['visitor-1'];
const plainFingerprint = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);
const keyedFingerprint = (key: string, token: string) =>
  createHmac('sha256', Buffer.from(key, 'base64url')).update(`token:${token}`).digest('hex').slice(0, 16);

/** He signs in on the app's own tab and works for two hours: the tokens his sign-in was given, oldest first. */
async function signedInAndRefreshedTwice() {
  const storage = createTabStorage();
  const tab = browser.openAppTab(storage);
  expect((await tab.gateway!.signIn(owner.email, TAB_TEST_PASSWORD)).ok).toBe(true);
  const tokens = [tabSignIn(storage)!.refreshToken];
  for (let hour = 0; hour < 2; hour += 1) {
    expect(await browser.refreshes(tab)).toBe('refreshed');
    tokens.push(tabSignIn(storage)!.refreshToken);
  }
  return { tab, storage, tokens, sessionId: String(tabSignIn(storage)!.sessionId) };
}

describe('what is kept', () => {
  it('in the shared storage, for a sign-in: a keyed name, when its newest hourly token runs out, and keyed fingerprints. No session id, no plain digest of a token, no token, nothing of the account', async () => {
    const { storage, tokens, sessionId } = await signedInAndRefreshedTwice();

    const written = String(browser.noteText());
    const note = browser.note();
    expect(Object.keys(note)).toHaveLength(1);
    const [name] = Object.keys(note);
    expect(name).toMatch(HEX16);
    expect(Object.keys(note[name]).sort()).toEqual(['tokens', 'until']);
    expect(note[name].tokens).toHaveLength(3);
    note[name].tokens.forEach(token => expect(token).toMatch(HEX16));
    // The newest hourly token of the stand-in cloud lasts an hour.
    expect(note[name].until).toBeGreaterThan(Date.now() + 55 * 60_000);
    expect(note[name].until).toBeLessThanOrEqual(Date.now() + 60 * 60_000);

    expect(written).not.toContain(sessionId);
    expect(written).not.toContain('refresh:');
    expect(written).not.toContain(String(browser.accessTokenOf(storage)));
    expect(written).not.toContain('owner-1');
    expect(written).not.toContain(owner.email);
    tokens.forEach(token => expect(written).not.toContain(plainFingerprint(token)));
    // It is not among the account's report periods.
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });

  it('the fingerprints are made with a random key that is only in the tab’s own storage: with it they can be made again, without it nothing in the shared storage answers a guess', async () => {
    const { storage, tokens } = await signedInAndRefreshedTwice();
    const [entry] = Object.values(browser.note());

    const key = String(browser.tabItem(storage)?.key);
    expect(Buffer.from(key, 'base64url')).toHaveLength(32);
    // With the tab's key (which sits next to the token itself): newest first.
    expect(entry.tokens).toEqual([...tokens].reverse().map(token => keyedFingerprint(key, token)));

    // The key is nowhere in the profile's shared storage.
    const shared = [...browser.profile.values.entries()];
    shared.forEach(([name, value]) => {
      expect(name).not.toContain(key);
      expect(value).not.toContain(key);
    });
    // And nothing that IS there works as the key: every text in it, tried as the key, on the right token.
    const everyText = shared.flatMap(([name, value]) => [name, value, ...(value.match(/[A-Za-z0-9_-]{8,}/g) ?? [])]);
    everyText.forEach(text => {
      tokens.forEach(token => {
        expect(entry.tokens).not.toContain(createHmac('sha256', text).update(`token:${token}`).digest('hex').slice(0, 16));
        expect(entry.tokens).not.toContain(createHmac('sha256', Buffer.from(text, 'base64url')).update(`token:${token}`).digest('hex').slice(0, 16));
      });
    });
  });

  it('two tabs that are not copies of each other have different keys: one sign-in’s fingerprints say nothing in the other', async () => {
    const first = createTabStorage();
    const second = createTabStorage();
    browser.openTab(first);
    browser.openTab(second);
    const keys = [browser.tabItem(first)?.key, browser.tabItem(second)?.key];
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
    // A copy made by Duplicate Tab carries the first tab's key, as it carries its sign-in.
    expect(browser.tabItem(browser.duplicateOf(first))?.key).toBe(keys[0]);
  });

  it('with the tab’s own storage blocked nothing is noted at all, and the tab’s token is sent as on the last build', async () => {
    browser.state.tabStorageWorks = false;
    const storage = createTabStorage();
    storeTabSignIn(storage, 'owner-1');
    const tab = browser.openTab(storage);
    expect(await browser.refreshes(tab)).toBe('refreshed');
    expect(await browser.refreshes(tab)).toBe('refreshed');
    expect(browser.noteText()).toBeNull();
    expect(browser.tabItem(storage)).toBeNull();
    expect(browser.outcomes()).toEqual(['replaced', 'replaced']);
  });
});

describe('the note for a sign-in is removed when that sign-in ends in this browser', () => {
  it('Sign Out of This Computer: nothing of it is left in the shared storage, and the tab’s key is gone', async () => {
    const { tab, storage } = await signedInAndRefreshedTwice();
    expect(browser.noteText()).not.toBeNull();

    await tab.gateway!.signOut('local');
    await settleTabs();

    expect(tabHoldsSignIn(storage)).toBe(false);
    expect(browser.noteText()).toBeNull();
    expect(browser.tabItem(storage)).toBeNull();
    expect(browser.periodKeys()).toEqual([]);
  });

  it('Sign Out of All Devices made here: the same', async () => {
    const { tab, storage } = await signedInAndRefreshedTwice();

    await tab.gateway!.signOut('global');
    await settleTabs();

    expect(tabHoldsSignIn(storage)).toBe(false);
    expect(browser.noteText()).toBeNull();
    expect(browser.tabItem(storage)).toBeNull();
  });

  it('only that sign-in’s: another account’s tab keeps its own note', async () => {
    const { tab } = await signedInAndRefreshedTwice();
    const other = browser.openTab(createTabStorage());
    await other.client.auth.signInWithPassword({ email: visitor.email, password: TAB_TEST_PASSWORD });
    await browser.refreshes(other);
    expect(Object.keys(browser.note())).toHaveLength(2);
    const visitorsKey = String(browser.tabItem(other.storage)?.key);
    const visitorsNewest = keyedFingerprint(visitorsKey, tabSignIn(other.storage)!.refreshToken);

    await tab.gateway!.signOut('local');
    await settleTabs();

    const left = Object.values(browser.note());
    expect(left).toHaveLength(1);
    expect(left[0].tokens[0]).toBe(visitorsNewest);
    expect(tabHoldsSignIn(other.storage)).toBe(true);
    expect(await browser.refreshes(other)).toBe('refreshed');
  });

  it('a sign-out heard from another tab of this account (This Computer or All Devices): this tab’s sign-in ends and its note goes too', async () => {
    const { tab, storage } = await signedInAndRefreshedTwice();

    expect(await tab.gateway!.signOutThisTabToo('owner-1')).toBe('ended');
    await settleTabs();

    expect(tabHoldsSignIn(storage)).toBe(false);
    expect(browser.noteText()).toBeNull();
    expect(browser.tabItem(storage)).toBeNull();
  });

  it('…also when the server could not be told of it', async () => {
    const { tab, storage } = await signedInAndRefreshedTwice();
    browser.cloud.state.logout = 'dropped';

    expect(await tab.gateway!.signOutThisTabToo('owner-1')).toBe('ended');
    await settleTabs();

    expect(tabHoldsSignIn(storage)).toBe(false);
    expect(browser.noteText()).toBeNull();
    expect(browser.tabItem(storage)).toBeNull();
  });

  it('a sign-out made in a tab the app’s page is not running in (the request itself is seen): removed as well', async () => {
    const storage = createTabStorage();
    const tab = browser.openTab(storage);
    await tab.client.auth.signInWithPassword({ email: owner.email, password: TAB_TEST_PASSWORD });
    await browser.refreshes(tab);
    expect(browser.noteText()).not.toBeNull();

    await tab.client.auth.signOut({ scope: 'local' });
    await settleTabs();

    expect(browser.noteText()).toBeNull();
    expect(browser.tabItem(storage)).toBeNull();
  });

  it('a sign-in the server ended (the phone’s Sign Out of All Devices): removed when this tab’s refresh is refused', async () => {
    const { tab, storage } = await signedInAndRefreshedTwice();
    await browser.serverEndsSignInOf(browser.accessTokenOf(storage));
    browser.hourlyTokenRunsOut(storage);

    expect(await browser.looksAtItsSignIn(tab)).toBe('no sign-in');

    expect(browser.outcomes().slice(-1)).toEqual(['refused']);
    expect(tab.guard.gaveWay()).toBe(false);
    expect(browser.noteText()).toBeNull();
    expect(browser.tabItem(storage)).toBeNull();
    expect(browser.periodKeys()).toEqual([]);
  });

  it('…and once one tab of a sign-in was refused, a tab of it that is two refreshes behind asks the server too: the report periods leave the browser, as on the last build', async () => {
    // His sign-in, a copy of the tab, and he works in the copy.
    const first = createTabStorage();
    storeTabSignIn(first, 'owner-1');
    const left = browser.openAppTab(first);
    await left.client.auth.initialize();
    const copy = browser.openTab(browser.duplicateOf(first));
    await copy.client.auth.initialize();
    expect(await browser.refreshes(copy)).toBe('refreshed');
    expect(await browser.refreshes(copy)).toBe('refreshed');
    // The phone signs out of all devices; the copy is the first to be told.
    await browser.serverEndsSignInOf(browser.accessTokenOf(copy.storage));
    expect(await browser.refreshes(copy)).toBe('refused');
    expect(browser.noteText()).toBeNull();

    browser.hourlyTokenRunsOut(first);
    expect(await browser.looksAtItsSignIn(left)).toBe('no sign-in');

    // It presented its token and the SERVER said no: an ended sign-in, not a tab giving way.
    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'refused', 'refused']);
    expect(left.guard.gaveWay()).toBe(false);
    expect(browser.periodKeys()).toEqual([]);
  });

  it('a tab that only GAVE WAY ended nothing: the working tab’s note stays, and the working tab goes on', async () => {
    const first = createTabStorage();
    storeTabSignIn(first, 'owner-1');
    const working = browser.openTab(first);
    await working.client.auth.initialize();
    const copyStorage = browser.duplicateOf(first);
    await browser.refreshes(working);
    await browser.refreshes(working);
    const before = browser.noteText();
    browser.hourlyTokenRunsOut(copyStorage);

    const copy = browser.openAppTab(copyStorage);
    expect(await browser.looksAtItsSignIn(copy)).toBe('no sign-in');

    expect(copy.guard.gaveWay()).toBe(true);
    expect(browser.noteText()).toBe(before);
    expect(await browser.refreshes(working)).toBe('refreshed');
    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'replaced']);
  });
});

describe('a tab that is closed without a sign-out: its note expires', () => {
  /** A sign-in whose tab was then closed; its note is left in the profile's storage. */
  async function signInThenCloseTheTab() {
    const { tab } = await signedInAndRefreshedTwice();
    browser.closeTab(tab);
    expect(Object.keys(browser.note())).toHaveLength(1);
  }
  const daysLater = (days: number) => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + days * DAY_MS);
  };

  it('six days after its last refresh it is still there', async () => {
    await signInThenCloseTheTab();
    daysLater(6);

    browser.openTab(createTabStorage());

    expect(Object.keys(browser.note())).toHaveLength(1);
  });

  it('a week and a day after its last refresh it is gone as soon as any tab of this browser opens the app, and nothing at all is left under the note’s name', async () => {
    await signInThenCloseTheTab();
    daysLater(8);

    browser.openTab(createTabStorage());

    expect(browser.noteText()).toBeNull();
  });

  it('…while a sign-in still in use that day keeps its own', async () => {
    await signInThenCloseTheTab();
    daysLater(8);
    const storage = createTabStorage();
    const tab = browser.openTab(storage);
    await tab.client.auth.signInWithPassword({ email: owner.email, password: TAB_TEST_PASSWORD });

    const left = Object.values(browser.note());
    expect(left).toHaveLength(1);
    expect(left[0].tokens).toEqual([keyedFingerprint(String(browser.tabItem(storage)?.key), tabSignIn(storage)!.refreshToken)]);
  });

  it('forgetting is safe for Duplicate Tab: after it the working tab’s token is still sent and taken, and its list starts again', async () => {
    const first = createTabStorage();
    storeTabSignIn(first, 'owner-1');
    const working = browser.openTab(first);
    await working.client.auth.initialize();
    await browser.refreshes(working);
    await browser.refreshes(working);
    browser.closeTab(working);
    daysLater(8);

    // The tab is brought back (Reopen Closed Tab) over its own storage.
    const back = browser.openTab(first);
    expect(browser.noteText()).toBeNull();
    // Its hourly token ran out long ago: it is refreshed as the page starts, and again an hour later.
    await back.client.auth.initialize();
    expect(await browser.refreshes(back)).toBe('refreshed');

    expect(browser.outcomes()).toEqual(['replaced', 'replaced', 'replaced', 'replaced']);
    expect(Object.values(browser.note())[0].tokens).toHaveLength(3);
  });
});

describe('the note the Duplicate Tab fix first wrote', () => {
  it('is removed when a tab opens the app', () => {
    browser.profile.setItem(FORMER_NOTE_KEY, JSON.stringify({ '5e55101d-0001-4000-8000-000000000001': { at: 1, tokens: ['aa1704cc6ab5a03b'] } }));

    createDAVEWebSignInRefreshGuard({ fetch: browser.cloud.fetch as never, shared: () => browser.profile, tab: () => createTabStorage() });

    expect(browser.profile.getItem(FORMER_NOTE_KEY)).toBeNull();
    expect(browser.periodKeys()).toEqual([WEB_SIGN_IN_PERIOD_KEY]);
  });
});
