/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import * as guardModule from '../../services/DAVEWebSignInRefreshGuard';
import {
  createEveryTabBrowser,
  settle,
  useEveryTabGlobals,
  type EveryTabBrowser,
  type RigTab,
} from '../fixtures/web-every-tab-gateway';

// Web review pass 3, P3-1 (12 Oct 2026; caused earlier in this round, by the fixes for review pass 1's L2 and L3).
//
// When the sign-in server answers one hourly refresh with an error of ITS OWN (500, or the 520 a proxy gives
// when the server behind it is down), the sign-in library keeps him signed in and tries again a moment later.
// The Duplicate Tab guard agreed only for 502, 503 and 504; any other failed answer it took for "the server
// ended this sign-in". So on a 500 it threw away its note of that sign-in while the tab stayed signed in:
//   (a) an old copy made before that answer, clicked two hours later, presented its old token, and the server
//       ended the sign-in for both tabs (the Duplicate Tab fault, back on this path);
//   (b) with a copy sitting on the sign-in page, that one answer made the copy delete this computer's report
//       periods though nobody had signed out;
//   (c) Sign Out of This Computer with the hourly token run out took 27 seconds and eight requests, and the
//       sign-in page did not say that the cloud had not confirmed it (that face is held in
//       tests/services/review-p5-web-pass2-f5-sign-out-and-the-cloud.test.ts).
//
// The coordinator's decision: the guard agrees with the app about which answers mean "the sign-in ended" and
// which mean "the server could not say". One list of status numbers, used in both places in the guard, and
// held here against the sign-in library's own list so that the two cannot drift apart again.
//
// Every tab runs the web app's own gateway (tests/fixtures/web-every-tab-gateway.ts). Nothing reaches the network.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(120_000);
useEveryTabGlobals();

/** The answers the sign-in library keeps a sign-in on (auth-js 2.108.2): the server's own errors, and the proxy's. */
const SERVER_COULD_NOT_SAY = [500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530];
/** Failed answers that are not on that list: the library ends the sign-in in the tab on each of these. */
const NOT_ON_THE_LIST = [400, 401, 403, 404, 405, 408, 409, 410, 418, 422, 499, 505, 507, 511, 519, 531, 599];

let browser: EveryTabBrowser;
beforeEach(() => { browser = createEveryTabBrowser(); });
afterEach(async () => { await browser.closeEveryTab(); });
const who = (tab: RigTab) => browser.holds(tab)?.userId ?? 'no sign-in';

/** His hourly refresh in a tab: the server answers the first request with `status`, and normally after that. */
async function refreshAnsweredOnce(tab: RigTab, status: number) {
  const asked = browser.counts.refreshes;
  browser.mode.refresh = status;
  const refreshing = browser.refreshes(tab);
  for (let turn = 0; turn < 200 && browser.counts.refreshes === asked; turn += 1) await settle(2);
  browser.mode.refresh = 'ok';
  const outcome = await refreshing;
  await settle();
  return { outcome, requests: browser.counts.refreshes - asked };
}

describe('web review pass 3, P3-1: one list of answers by which the server did not speak about the sign-in', () => {
  it('the guard’s list is the sign-in library’s own list, number for number', () => {
    const library = readFileSync(join(__dirname, '..', '..', 'node_modules', '@supabase', 'auth-js', 'dist', 'main', 'lib', 'fetch.js'), 'utf8');
    const written = /const NETWORK_ERROR_CODES = \[([^\]]+)\]/.exec(library);
    expect(written).not.toBeNull();
    const libraryList = String(written?.[1]).split(',').map(text => text.trim()).filter(Boolean).map(Number);

    expect(libraryList).toEqual(SERVER_COULD_NOT_SAY);
    expect((guardModule as Record<string, unknown>).DAVE_WEB_SERVER_COULD_NOT_SAY_STATUSES).toEqual(libraryList);
  });

  it('the guard holds those numbers in one place only: no second list of its own', () => {
    const guard = readFileSync(join(__dirname, '..', '..', 'services', 'DAVEWebSignInRefreshGuard.ts'), 'utf8');
    const code = guard.split('\n').filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');

    expect(code).not.toMatch(/\[\s*502\s*,\s*503\s*,\s*504\s*\]/);
    expect(code.match(/DAVE_WEB_SERVER_COULD_NOT_SAY_STATUSES\.includes\(/g)).toHaveLength(2);
  });

  it.each(SERVER_COULD_NOT_SAY)('a refresh answered %i once: the tab stays signed in, and the guard keeps its note of that sign-in and the tab’s key', async status => {
    const working = browser.open(undefined, 'W');
    expect((await browser.signIn(working, 'owner-1')).ok).toBe(true);
    await settle();
    const itemBefore = browser.tabItem(working);
    const namesBefore = browser.noteNames();
    expect(namesBefore).toHaveLength(1);

    const blip = await refreshAnsweredOnce(working, status);

    expect(blip.outcome).toBe('refreshed');
    expect(who(working)).toBe('owner-1');
    expect(browser.noteNames()).toEqual(namesBefore);
    expect(JSON.parse(String(browser.tabItem(working))).key).toBe(JSON.parse(String(itemBefore)).key);
  });

  it.each(NOT_ON_THE_LIST)('guard, the other way round: a refresh answered %i: the library ends the sign-in in the tab, and the guard’s note of it goes too', async status => {
    const working = browser.open(undefined, 'W');
    expect((await browser.signIn(working, 'owner-1')).ok).toBe(true);
    await settle();
    expect(browser.noteNames()).toHaveLength(1);
    const asked = browser.counts.refreshes;

    // He looks at the tab after its hour: its run-out token is refreshed first.
    browser.hourlyTokenRunsOut(working);
    browser.mode.refresh = status;
    const says = await browser.looksAt(working);
    browser.mode.refresh = 'ok';
    await settle();

    expect(says).toBe('no sign-in');
    expect(browser.counts.refreshes - asked).toBe(1);
    expect(who(working)).toBe('no sign-in');
    expect(browser.note()).toBeNull();
  });
});

describe.each([500, 501, 520, 530, 503])('web review pass 3, P3-1: the working tab’s hourly refresh is answered %i once, then the server is back', status => {
  it('(a) a duplicate made before that, clicked two hours later, gives way: the working tab is still signed in afterwards', async () => {
    const working = browser.open(undefined, 'W');
    expect((await browser.signIn(working, 'owner-1')).ok).toBe(true);
    browser.keepsPeriod('owner-1', 'kept');
    const copy = browser.duplicate(working, 'C');
    await browser.inTab(copy, () => copy.client.auth.initialize());
    await settle();

    await refreshAnsweredOnce(working, status);
    expect(who(working)).toBe('owner-1');
    // He goes on working: two more hourly refreshes. Then he clicks the old copy.
    expect(await browser.refreshes(working)).toBe('refreshed');
    expect(await browser.refreshes(working)).toBe('refreshed');
    browser.hourlyTokenRunsOut(copy);
    expect(await browser.looksAt(copy)).toBe('no sign-in');
    await settle();

    expect(copy.guard.gaveWay()).toBe(true);
    expect(browser.log).not.toContain('ended-the-sign-in');
    browser.hourlyTokenRunsOut(working);
    expect(await browser.looksAt(working)).toBe('signed in');
    expect(browser.periodsOf('owner-1')).not.toBeNull();
  });

  it('(b) the copy is on the sign-in page when that refresh is answered: nobody signed out, and this computer’s report periods are still there', async () => {
    const working = browser.open(undefined, 'W');
    expect((await browser.signIn(working, 'owner-1')).ok).toBe(true);
    browser.keepsPeriod('owner-1', 'approved, not sent yet');
    const copy = browser.duplicate(working, 'C');
    await browser.inTab(copy, () => copy.client.auth.initialize());
    expect(await browser.refreshes(working)).toBe('refreshed');
    expect(await browser.refreshes(working)).toBe('refreshed');
    browser.hourlyTokenRunsOut(copy);
    expect(await browser.looksAt(copy)).toBe('no sign-in');
    await settle();
    expect(copy.guard.gaveWay()).toBe(true);

    const blip = await refreshAnsweredOnce(working, status);
    await settle(40);

    expect(blip.outcome).toBe('refreshed');
    expect(who(working)).toBe('owner-1');
    expect(browser.log.includes('ended-the-sign-in') || browser.log.includes('refused')).toBe(false);
    expect(browser.periodsOf('owner-1')).toBe(JSON.stringify({ scopeKey: 'approved, not sent yet' }));
  });
});
