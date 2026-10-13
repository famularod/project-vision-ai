/**
 * @jest-environment node
 */
import {
  NOTE_KEY,
  createEveryTabBrowser,
  settle,
  useEveryTabGlobals,
  type EveryTabBrowser,
  type RigTab,
} from '../fixtures/web-every-tab-gateway';

// Web review pass 3, P3-2 (12 Oct 2026; caused by the fix for the second review's F2).
//
// An old copy of a tab that gave way sits on the sign-in page and holds no sign-in. Since the F2 fix it looked
// in the browser's note for the sign-in it had given way to at EVERY later sign-out it heard, from any tab of
// any account, and deleted that account's report periods when the note no longer listed it. In three orders
// that deleted the owner's CURRENT periods while he was signed in and working in another tab:
//   (a) a second sign-in of his, and a Sign Out of This Computer the server did not take;
//   (b) eight newer sign-ins pushing the old one out of the note (it keeps eight);
//   (c) a window of milliseconds in one tab's sign-out that the server did not take.
//
// The coordinator's decision: a tab that holds no sign-in removes report periods ONLY when it is established
// that the very sign-in it gave way to has ended, by that sign-in's own identity as the browser already keeps
// it, never because some sign-out was heard. A sign-out heard from a tab of another account, or of another
// sign-in of the same account, is never a reason to remove anything.
//
// Now the copy looks only when a tab that holds a token of that very sign-in lets go of it (it follows that
// sign-in from refresh to refresh), and takes it for ended only when the browser's note then holds no sign-in
// at all: the last sign-in to end takes the note with it. While the note lists any sign-in, his own may only
// have been pushed out, or another sign-in of his may be at work here, and nothing is removed. A sign-out it
// hears changes nothing.
//
// Every tab runs the web app's own gateway (tests/fixtures/web-every-tab-gateway.ts), so the tab whose sign-in
// ends removes the periods itself, as in the app. Nothing reaches the network.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(120_000);
useEveryTabGlobals();

let browser: EveryTabBrowser;
beforeEach(() => { browser = createEveryTabBrowser(); });
afterEach(async () => { await browser.closeEveryTab(); });

const who = (tab: RigTab) => browser.holds(tab)?.userId ?? 'no sign-in';
const APPROVED = JSON.stringify({ scopeKey: 'approved, not sent yet' });

/** He is signed in in W, duplicates it (C), works in W; the copy, looked at after its hour, gives way and shows the sign-in page. */
async function copyGaveWay() {
  const working = browser.open(undefined, 'W');
  expect((await browser.signIn(working, 'owner-1')).ok).toBe(true);
  browser.keepsPeriod('owner-1', 'first');
  const copy = browser.duplicate(working, 'C');
  await browser.inTab(copy, () => copy.client.auth.initialize());
  expect(await browser.refreshes(working)).toBe('refreshed');
  expect(await browser.refreshes(working)).toBe('refreshed');
  browser.hourlyTokenRunsOut(copy);
  expect(await browser.looksAt(copy)).toBe('no sign-in');
  await settle();
  expect(copy.guard.gaveWay()).toBe(true);
  expect(browser.periodsOf('owner-1')).not.toBeNull();
  return { working, copy };
}
/** Somebody who is not the owner signs in on another tab and is signed out of this browser by its page: every open tab hears a sign-out. */
async function aVisitorsTabIsSignedOut() {
  const visitor = browser.open(undefined, 'V');
  expect((await browser.signIn(visitor, 'visitor-1')).ok).toBe(true);
  await browser.signOutNotOwnerQuietly(visitor);
  await settle(40);
  return visitor;
}

describe('web review pass 3, P3-2: the reviewer’s three orders: the owner’s current report periods stay', () => {
  it('(a) a second sign-in of his in another tab; Sign Out of This Computer there with no connection; he signs in again and approves a report; the old working tab is closed; later a visitor’s tab is signed out', async () => {
    const { working, copy } = await copyGaveWay();
    // The working tab refreshes once more (its ordinary hourly refresh).
    expect(await browser.refreshes(working)).toBe('refreshed');
    const other = browser.open(undefined, 'T1');
    expect((await browser.signIn(other, 'owner-1')).ok).toBe(true);
    await settle();

    browser.mode.logout = 'dropped';
    const clicked = await browser.signOut(other);
    await settle(40);
    // Right so far: the account signed out of this computer, in both of its tabs, and its periods went then.
    expect(clicked.notConfirmed).toBe(true);
    expect(who(working)).toBe('no sign-in');
    expect(browser.periodsOf('owner-1')).toBeNull();

    browser.mode.logout = 'ok';
    expect((await browser.signIn(other, 'owner-1')).ok).toBe(true);
    browser.keepsPeriod('owner-1', 'approved, not sent yet');
    browser.close(working);
    await settle();
    await aVisitorsTabIsSignedOut();

    expect(who(other)).toBe('owner-1');
    expect(copy.heard.filter(event => event === 'SIGNED_OUT').length).toBeGreaterThan(1);
    expect(browser.periodsOf('owner-1')).toBe(APPROVED);
    expect(browser.strays()).toBe(0);
  });

  it('(b) the working tab is closed without a sign-out; eight newer sign-ins push its sign-in out of the note; then another sign-in leaves the note', async () => {
    const { working } = await copyGaveWay();
    browser.close(working);
    await settle();
    let last = browser.open(undefined, 'N1');
    for (let index = 1; index <= 8; index += 1) {
      if (index > 1) { browser.close(last); last = browser.open(undefined, `N${index}`); }
      expect((await browser.signIn(last, 'owner-1')).ok).toBe(true);
      await settle(5);
    }
    browser.keepsPeriod('owner-1', 'approved, not sent yet');
    expect(browser.noteNames()).toHaveLength(8);

    await aVisitorsTabIsSignedOut();

    expect(browser.noteNames()).toHaveLength(7);
    expect(who(last)).toBe('owner-1');
    expect(browser.periodsOf('owner-1')).toBe(APPROVED);
  });

  it('(b, the same through the tab itself) the working tab stays open and idle while eight newer sign-ins push its sign-in out of the note and one of them leaves; then the working tab is closed', async () => {
    const { working } = await copyGaveWay();
    let last = browser.open(undefined, 'N1');
    for (let index = 1; index <= 8; index += 1) {
      if (index > 1) { browser.close(last); last = browser.open(undefined, `N${index}`); }
      expect((await browser.signIn(last, 'owner-1')).ok).toBe(true);
      await settle(5);
    }
    browser.keepsPeriod('owner-1', 'approved, not sent yet');
    await aVisitorsTabIsSignedOut();
    expect(browser.noteNames()).toHaveLength(7);
    expect(browser.periodsOf('owner-1')).toBe(APPROVED);

    // Closed, never signed out: its sign-in is still good on the server.
    browser.close(working);
    await settle(40);

    expect(who(last)).toBe('owner-1');
    expect(browser.periodsOf('owner-1')).toBe(APPROVED);
  });

  it('(c) the working tab itself signs out of this computer with no connection, after it had refreshed, and the note loses its sign-in 30 ms after the other tabs were told; he signs in again; later a visitor’s tab is signed out', async () => {
    const { working } = await copyGaveWay();
    expect(await browser.refreshes(working)).toBe('refreshed');
    await settle();
    browser.mode.logout = 'dropped';
    // The window: the tab's sign-out tells the other tabs and only then takes its sign-in out of the note; the
    // fingerprint in between is worked out by the browser's crypto, held back here.
    const subtle = globalThis.crypto.subtle;
    const realSign = subtle.sign.bind(subtle);
    let slow = true;
    const spy = jest.spyOn(subtle, 'sign').mockImplementation(async (...args: Parameters<typeof realSign>) => {
      if (slow) await settle(30);
      return realSign(...args);
    });
    await browser.signOut(working);
    slow = false;
    await settle(60);
    spy.mockRestore();
    browser.mode.logout = 'ok';
    // The account signed out of this computer: its periods went then, as its warning said.
    expect(browser.periodsOf('owner-1')).toBeNull();

    expect((await browser.signIn(working, 'owner-1')).ok).toBe(true);
    browser.keepsPeriod('owner-1', 'approved, not sent yet');
    await aVisitorsTabIsSignedOut();

    expect(who(working)).toBe('owner-1');
    expect(browser.periodsOf('owner-1')).toBe(APPROVED);
  });
});

describe('web review pass 3, P3-2: a sign-out heard is never a reason to remove anything', () => {
  it('the copy that gave way hears sign-outs from another account’s tab and from another sign-in of the owner’s, whatever the note says by then: it removes nothing', async () => {
    const { working, copy } = await copyGaveWay();
    browser.close(working);
    await settle();
    // The note is gone altogether (what a real end of every sign-in leaves), without the copy having seen any
    // tab of its own sign-in let go since.
    browser.profile.removeItem(NOTE_KEY);
    browser.keepsPeriod('owner-1', 'approved, not sent yet');

    const visitor = await aVisitorsTabIsSignedOut();
    browser.close(visitor);
    // Another sign-in of the owner's, in a tab whose own page is not listening (so that nothing but hearing it
    // is in play: a listening page removes its own account's periods at its own sign-out, as it always has).
    const another = browser.open(undefined, 'T1');
    expect((await browser.signIn(another, 'owner-1')).ok).toBe(true);
    another.stop();
    browser.profile.removeItem(NOTE_KEY);
    await browser.inTab(another, () => another.client.auth.signOut({ scope: 'local' }));
    await settle(40);

    expect(copy.heard.filter(event => event === 'SIGNED_OUT').length).toBeGreaterThan(1);
    expect(browser.periodsOf('owner-1')).toBe(APPROVED);
  });
});

describe('web review pass 3, P3-2: what stays as it was', () => {
  it('guard: a real end of that very sign-in still removes the periods, at that moment: the working tab, after it had refreshed, is refused by the server (the phone’s Sign Out of All Devices)', async () => {
    const { working } = await copyGaveWay();
    expect(await browser.refreshes(working)).toBe('refreshed');
    browser.phoneSignsOutAllDevices('owner-1');
    browser.hourlyTokenRunsOut(working);

    expect(await browser.looksAt(working)).toBe('no sign-in');
    await settle(40);

    expect(browser.periodsOf('owner-1')).toBeNull();
    expect(browser.note()).toBeNull();
  });

  it('guard: the working tab was reloaded, then signs out of this computer: its own page removes the periods', async () => {
    const { working } = await copyGaveWay();
    const again = browser.reload(working);
    await browser.inTab(again, () => again.client.auth.initialize());
    await settle(40);
    expect(browser.periodsOf('owner-1')).not.toBeNull();

    await browser.signOut(again);
    await settle(40);

    expect(browser.periodsOf('owner-1')).toBeNull();
  });

  it('guard: the working tab was reloaded, then the server refuses it: its own page removes the periods', async () => {
    const { working } = await copyGaveWay();
    const again = browser.reload(working);
    await browser.inTab(again, () => again.client.auth.initialize());
    await settle(40);
    browser.phoneSignsOutAllDevices('owner-1');
    browser.hourlyTokenRunsOut(again);

    expect(await browser.looksAt(again)).toBe('no sign-in');
    await settle(40);

    expect(browser.periodsOf('owner-1')).toBeNull();
  });

  it('guard, the case the coordinator decided to keep (P3-3): after the phone’s Sign Out of All Devices, with the working tab closed without being looked at, the periods stay', async () => {
    const { working } = await copyGaveWay();
    browser.phoneSignsOutAllDevices('owner-1');

    browser.close(working);
    await settle(60);

    expect(browser.periodsOf('owner-1')).toBe(JSON.stringify({ scopeKey: 'first' }));
    expect(browser.noteNames()).toHaveLength(1);
  });

  it('guard: nobody signed out: the working tab reloaded, and later closed: the periods stay', async () => {
    const { working } = await copyGaveWay();
    const again = browser.reload(working);
    await browser.inTab(again, () => again.client.auth.initialize());
    await settle(40);
    expect(await browser.looksAt(again)).toBe('signed in');

    browser.close(again);
    await settle(40);

    expect(browser.periodsOf('owner-1')).toBe(JSON.stringify({ scopeKey: 'first' }));
  });
});
