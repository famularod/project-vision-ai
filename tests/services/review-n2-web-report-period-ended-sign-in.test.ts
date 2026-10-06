/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildDAVEReportSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { reportSenderId, saveDAVEReportSnapshot } from '../../services/DAVEReportSnapshotStore';
import {
  DAVE_WEB_NO_KEYCHAIN,
  daveWebOwnReportSends,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  loadDAVEWebReportPeriod,
} from '../../services/DAVEWebReportSend';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_ACCOUNTS,
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  storeTabSignIn,
  tabAuthStorage,
  tabHoldsSignIn,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

// Review N2 (5 Oct 2026; caused by 46e3332 and its sign-out fix b1281f0).
// When the SERVER ended this tab's sign-in (the phone's "Sign Out of All
// Devices": the web tab drops to the sign-in page once its hourly token has
// run out and its refresh is refused), the account's report periods (the
// last sent report's project, task and owner names) stayed in this browser
// profile's storage. Only "Sign Out of This Computer" and another tab's
// sign-out of the same account removed them. They now leave with a sign-in
// the server ended too. A server that cannot be reached, or a refresh that
// is slow, removes nothing; nor does another tab's sign-out (owner answer
// Q26). The gateway and supabase-js are real; the network is the tab
// fixture's, which here can also end a sign-in or lose its connection.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;
const originalError = console.error;

type Server = { signedOutOfAllDevices: boolean; connection: 'ok' | 'dropped' | 503 };
let server: Server;
let cloud: TabCloud;
let tabStorage: TabStorage;
let profile: TabStorage;
let client: SupabaseClient;
let otherTab: SupabaseClient | null = null;
let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
let heard: string[] = [];
let stopListening: () => void = () => undefined;

beforeAll(() => {
  root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
  // auth-js logs each refused or dropped request before answering it as an error.
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = String(args[0]);
    if (text.includes('Failed to fetch') || text.includes('Invalid Refresh Token') || text.includes('AuthRetryableFetchError')) return;
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

/**
 * The fixture's cloud, which can also: end every sign-in of the account
 * (another device's "Sign Out of All Devices": the refresh token is no longer
 * known, and the session a still-valid token names no longer exists), lose
 * its connection, or answer 503.
 */
function createServer(): TabCloud {
  const base = createTabCloud();
  server = { signedOutOfAllDevices: false, connection: 'ok' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
  const fetch = async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    const auth = url.pathname.startsWith('/auth/v1/');
    if (auth && server.connection === 'dropped') throw new TypeError('Failed to fetch');
    if (auth && server.connection === 503) return json(503, { message: 'Service Unavailable' });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      // A refresh a test holds waits here; what it is answered follows the server as it is by then.
      const refreshed = await base.fetch(input, init);
      return server.signedOutOfAllDevices
        ? json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' })
        : refreshed;
    }
    if (server.signedOutOfAllDevices && url.pathname === '/auth/v1/user') {
      return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' });
    }
    return base.fetch(input, init);
  };
  return { ...base, fetch };
}

/** This tab's page starts to listen, as the web page does when it opens. */
function thePageListens() {
  heard = [];
  stopListening = gateway.subscribeToAuthStateChange(event => { if (event !== 'INITIAL_SESSION') heard.push(event); });
}

/**
 * This tab signed in as `userId`, over the browser profile's storage, its
 * page listening. `asLeft`: the tab as it was left an hour or more ago
 * (its token run out), opened again now; `listening: false` leaves the page
 * not listening yet.
 */
async function openTab(
  userId: string | null,
  { asLeft = false, listening = true }: { asLeft?: boolean; listening?: boolean } = {},
) {
  tabStorage = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: tabStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  if (userId) storeTabSignIn(tabStorage, userId, { expired: asLeft });
  client = createTabClient(supabaseSecureAuthStorage, cloud);
  gateway = createDAVEWebSupabaseGateway(client);
  await client.auth.initialize();
  if (listening) thePageListens();
  await settle();
}

/** Another tab of this browser, signed in as `userId`. */
async function openAnotherTab(userId: string) {
  const storage = createTabStorage();
  storeTabSignIn(storage, userId);
  otherTab = createTabClient(tabAuthStorage(storage), cloud);
  await otherTab.auth.initialize();
  await settle();
  return otherTab;
}

beforeEach(() => {
  profile = createTabStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  cloud = createServer();
  forgetDAVEWebOwnReportSends();
});
afterEach(() => {
  jest.useRealTimers();
  stopListening();
  closeTabClient(client);
  if (otherTab) closeTabClient(otherTab);
  otherTab = null;
  // This tab's own copies, whatever a test left.
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportPeriods('owner-2');
});

const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const CLOUD_OFF = { read: async () => null, write: async () => undefined };
/** A sent report with the names a period keeps. */
const sentReport = (sentAt: string, taskName = 'Frame walls', owner = 'Dana') => ({
  ...buildDAVEReportSnapshot({ truths: [], scopeKey: 'tower', sourceFingerprint: 'facts', capturedAt: '2026-10-01T12:00:00.000Z', reportFormat: 'project_manager' }),
  tasks: [{ taskId: 't1', projectName: 'Tower', taskName, areaName: 'Level 2', owner, status: 'In Progress', percentComplete: 40, finishDate: null, urgency: 'normal', approvalStatus: null, estimatedScheduleImpactDays: null }],
  deliveredAt: sentAt,
}) as unknown as DAVEReportSnapshot;
/** Another account's period in the same browser profile, kept under its own id. */
const anotherAccountsReport = () => saveDAVEReportSnapshot(
  sentReport('2026-10-01T09:00:00.000Z', 'Pour slab', 'Lee'), daveWebReportStorage(async () => 'owner-2'), CLOUD_OFF,
);
const profileText = () => [...profile.values.values()].join('\n');
const keysOf = (ownerId: string) => [...profile.values.keys()].filter(key => key.startsWith(`@vitruvius/web/${ownerId}/`));

/** The signed-in account has sent a report from this browser; another account's period is in the profile too. */
async function aReportSentFromHere() {
  const storage = daveWebReportStorage(() => gateway.authorizedOwnerId());
  await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), storage, CLOUD_OFF);
  await loadDAVEWebReportPeriod({ storage, cloud: CLOUD_OFF }, 'tower', 'project_manager');
  const senderId = await reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN);
  await anotherAccountsReport();
  expect(keysOf('owner-1').length).toBeGreaterThanOrEqual(2);
  expect(keysOf('owner-2')).toHaveLength(1);
  expect(profileText()).toContain('Frame walls');
  expect(daveWebOwnReportSends().has('2026-10-01T13:00:00.000Z')).toBe(true);
  return { senderId, keys: keysOf('owner-1').length };
}

/** An hour on: the access token this tab holds has run out. */
function theHourlyTokenRunsOut() {
  storeTabSignIn(tabStorage, 'owner-1', { expired: true });
}

/** Lets auth-js's own retries (up to 30 s) run without the test waiting for them. */
async function whileTimePasses<T>(work: Promise<T>): Promise<T> {
  let done = false;
  const outcome = work
    .then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
    .finally(() => { done = true; });
  for (let seconds = 0; seconds < 90 && !done; seconds += 1) await jest.advanceTimersByTimeAsync(1_000);
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}

describe('review N2 (Low): a sign-in the server ended takes the account\'s report periods out of this browser', () => {
  it('the phone\'s Sign Out of All Devices, then this tab\'s hourly token runs out: its refresh is refused and the periods are gone; another account\'s and the sender id stay', async () => {
    await openTab('owner-1');
    const { senderId } = await aReportSentFromHere();

    server.signedOutOfAllDevices = true;
    // Nothing leaves while this tab's token still works and it has not asked the server.
    await settle();
    expect(keysOf('owner-1').length).toBeGreaterThanOrEqual(2);

    theHourlyTokenRunsOut();
    await expect(gateway.getSessionStatus()).resolves.toEqual({ configured: true, session: null });
    await settle();

    expect(heard).toEqual(['SIGNED_OUT']);
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    expect(keysOf('owner-1')).toEqual([]);
    expect(profileText()).not.toContain('Frame walls');
    expect(profileText()).not.toContain('Dana');
    expect(profileText()).toContain('Pour slab');
    expect(daveWebOwnReportSends().size).toBe(0);
    // What is left: this browser's sender id (it names the browser, not an account) and the other account's own period.
    expect(profile.getItem('@vitruvius/report-sender-id/v1')).toBe(senderId);
    expect([...profile.values.keys()].sort()).toEqual(['@vitruvius/report-sender-id/v1', ...keysOf('owner-2')].sort());
  });

  it('the server says the sign-in no longer exists while its token has not run out: the owner check ends it, and the periods are gone', async () => {
    await openTab('owner-1');
    await aReportSentFromHere();
    server.signedOutOfAllDevices = true;
    // Six minutes on (the owner check is kept for five), the page's next read asks the server who is signed in.
    const sixMinutesOn = Date.now() + 6 * 60_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => sixMinutesOn);
    await expect(gateway.loadAuthorizedRows()).rejects.toThrow('Sign in is required for the Vitruvius desktop pilot.');
    clock.mockRestore();
    await settle();
    expect(heard).toContain('SIGNED_OUT');
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    expect(keysOf('owner-1')).toEqual([]);
    expect(keysOf('owner-2')).toHaveLength(1);
  });

  it('the tab opened again after its hourly token ran out: the first thing its page hears is the refused refresh, and the periods are gone', async () => {
    // What the account left in this browser when the tab was last used.
    await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), daveWebReportStorage(async () => 'owner-1'), CLOUD_OFF);
    await anotherAccountsReport();
    server.signedOutOfAllDevices = true;
    await openTab('owner-1', { asLeft: true });
    await settle(60);
    expect(heard).toEqual(['SIGNED_OUT']);
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    expect(keysOf('owner-1')).toEqual([]);
    expect(keysOf('owner-2')).toHaveLength(1);
  });

  it('the refusal arrives before the page has started to listen: the periods are gone once it does', async () => {
    await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), daveWebReportStorage(async () => 'owner-1'), CLOUD_OFF);
    await anotherAccountsReport();
    server.signedOutOfAllDevices = true;
    await openTab('owner-1', { asLeft: true, listening: false });
    // auth-js refreshes as the tab starts; the server refuses it before the page listens.
    await client.auth.getSession();
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    expect(keysOf('owner-1')).toHaveLength(1);
    thePageListens();
    await settle();
    expect(keysOf('owner-1')).toEqual([]);
    expect(keysOf('owner-2')).toHaveLength(1);
  });

  it('with no connection as the tab starts, the page starting to listen removes nothing', async () => {
    await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), daveWebReportStorage(async () => 'owner-1'), CLOUD_OFF);
    server.signedOutOfAllDevices = true;
    server.connection = 'dropped';
    await openTab('owner-1', { asLeft: true, listening: false });
    jest.useFakeTimers({ advanceTimers: true });
    await whileTimePasses(client.auth.getSession());
    jest.useRealTimers();
    thePageListens();
    await settle();
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(keysOf('owner-1')).toHaveLength(1);
  });

  it.each<[string, Server['connection']]>([
    ['no connection', 'dropped'],
    ['the server answering 503', 503],
  ])('%s when the hourly token runs out: the sign-in is kept, and so are the report periods', async (_label, connection) => {
    await openTab('owner-1');
    const { keys } = await aReportSentFromHere();
    // Even with the sign-in ended on the server: this tab has not been told, and cannot be.
    server.signedOutOfAllDevices = true;
    server.connection = connection;
    theHourlyTokenRunsOut();
    jest.useFakeTimers({ advanceTimers: true });
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow('The desktop session could not be checked.');
    jest.useRealTimers();
    await settle();

    expect(heard).toEqual([]);
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(keysOf('owner-1')).toHaveLength(keys);
    expect(profileText()).toContain('Frame walls');
    expect(daveWebOwnReportSends().has('2026-10-01T13:00:00.000Z')).toBe(true);
  });

  it('a slow refresh: nothing is removed while it is on its way, nor when it is answered', async () => {
    await openTab('owner-1');
    const { keys } = await aReportSentFromHere();
    theHourlyTokenRunsOut();
    const refresh = cloud.hold('refresh');
    const checking = gateway.getSessionStatus();
    await refresh.reached;
    await settle(60);
    expect(keysOf('owner-1')).toHaveLength(keys);
    refresh.release();
    await expect(checking).resolves.toMatchObject({ configured: true, session: { user: { id: 'owner-1' } } });
    await settle();
    expect(heard).toEqual(['TOKEN_REFRESHED']);
    expect(keysOf('owner-1')).toHaveLength(keys);
  });

  it('a slow refresh the server then refuses: removed when it is refused, not before', async () => {
    await openTab('owner-1');
    const { keys } = await aReportSentFromHere();
    theHourlyTokenRunsOut();
    const refresh = cloud.hold('refresh');
    const checking = gateway.getSessionStatus();
    await refresh.reached;
    // The other device signs out of all devices while this tab's refresh is still on its way.
    server.signedOutOfAllDevices = true;
    await settle(60);
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(keysOf('owner-1')).toHaveLength(keys);
    refresh.release();
    await expect(checking).resolves.toEqual({ configured: true, session: null });
    await settle();
    expect(heard).toEqual(['SIGNED_OUT']);
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    expect(keysOf('owner-1')).toEqual([]);
    expect(keysOf('owner-2')).toHaveLength(1);
  });
});

describe('review N2: another tab\'s sign-out still removes nothing here (owner answer Q26)', () => {
  it('another account\'s tab signs out: this tab keeps its sign-in and its report periods', async () => {
    await openTab('owner-1');
    const { keys } = await aReportSentFromHere();
    const visitor = await openAnotherTab('visitor-1');
    await visitor.auth.signOut({ scope: 'local' });
    await settle(60);
    // auth-js told this tab of it, without saying whose it was.
    expect(heard).toContain('SIGNED_OUT');
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(keysOf('owner-1')).toHaveLength(keys);
    expect(keysOf('owner-2')).toHaveLength(1);
  });

  it('another account\'s tab has its sign-in ended by the server: this tab\'s periods stay', async () => {
    await openTab('owner-1');
    const { keys } = await aReportSentFromHere();
    const storage = createTabStorage();
    storeTabSignIn(storage, 'visitor-1', { expired: true });
    server.signedOutOfAllDevices = true;
    otherTab = createTabClient(tabAuthStorage(storage), cloud);
    await otherTab.auth.initialize();
    await otherTab.auth.getSession();
    await settle(60);
    expect(tabHoldsSignIn(storage)).toBe(false);
    expect(heard).toContain('SIGNED_OUT');
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(keysOf('owner-1')).toHaveLength(keys);
  });

  it('this tab cannot read its own storage for a moment while another tab refreshes: nothing is removed, then or at a later sign-out elsewhere', async () => {
    await openTab('owner-1');
    const { keys } = await aReportSentFromHere();
    const visitor = await openAnotherTab('visitor-1');
    // The browser blocks this tab's site storage for a moment (a read of it throws).
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('Site storage is blocked.'); } });
    await visitor.auth.refreshSession();
    await settle(60);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: tabStorage });
    expect(heard).toContain('TOKEN_REFRESHED');
    expect(keysOf('owner-1')).toHaveLength(keys);
    await visitor.auth.signOut({ scope: 'local' });
    await settle(60);
    expect(heard).toContain('SIGNED_OUT');
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(keysOf('owner-1')).toHaveLength(keys);
  });

  it('a tab holding no sign-in hears another tab\'s sign-out: nobody\'s report periods are removed', async () => {
    await openTab(null);
    // Periods two accounts left in this browser profile (each still signed in in another tab).
    await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), daveWebReportStorage(async () => 'owner-1'), CLOUD_OFF);
    await anotherAccountsReport();
    const owner = await openAnotherTab('owner-1');
    await owner.auth.signOut({ scope: 'local' });
    await settle(60);
    expect(heard).toContain('SIGNED_OUT');
    expect(keysOf('owner-1')).toHaveLength(1);
    expect(keysOf('owner-2')).toHaveLength(1);
  });

  it('a sign-in made here after the server ended the last one: its own later ending removes its own periods only', async () => {
    await openTab('owner-1');
    await aReportSentFromHere();
    server.signedOutOfAllDevices = true;
    theHourlyTokenRunsOut();
    await gateway.getSessionStatus();
    await settle();
    expect(keysOf('owner-1')).toEqual([]);

    // He signs in again here and sends another report.
    server.signedOutOfAllDevices = false;
    const again = await gateway.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD);
    expect(again.ok).toBe(true);
    const storage = daveWebReportStorage(() => gateway.authorizedOwnerId());
    await saveDAVEReportSnapshot(sentReport('2026-10-02T13:00:00.000Z'), storage, CLOUD_OFF);
    expect(keysOf('owner-1')).toHaveLength(1);
    // The other account's tab signing out meanwhile changes nothing here.
    const visitor = await openAnotherTab('visitor-1');
    await visitor.auth.signOut({ scope: 'local' });
    await settle(60);
    expect(keysOf('owner-1')).toHaveLength(1);
    expect(keysOf('owner-2')).toHaveLength(1);
  });
});
