/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { reportPeriodSentAt, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import {
  approveDAVEWebReportPeriod,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
  loadDAVEWebReportPeriod,
  recordDAVEWebReportSend,
  shareDAVEWebReportSendsBeforeSignOut,
} from '../../services/DAVEWebReportSend';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  storeTabSignIn,
  tabHoldsSignIn,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

// R5 item 7: A FINDING PINNED, NOT A FIX (it sits on the sign-in boundary; the coordinator's decision is asked).
//
// On the web, a report sent while the shared record cannot be reached is kept in this browser, and the page says
// "Your other devices count from it once this computer reaches the shared record again". It is carried up the
// next time Reports is opened, and "Sign Out of This Computer" carries it up first (review N2). When the SERVER
// ends the sign-in (the phone's "Sign Out of All Devices"; the tab's hourly token runs out and its refresh is
// refused), the account's report periods leave this browser at once (review N2, owner answer Q26's privacy
// rule), and nothing is carried up first: by then this tab holds no sign-in to write the shared record with. The
// send is then in no place at all, and every device's next report counts from the report before it.
//
// This file says what happens today, so that a change to it is made on purpose. The gateway and supabase-js are
// real; the network is the tab fixture's; the shared record is an in-memory report_snapshots row. Synthetic data.

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
  // This tab's own copies, whatever a test left.
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportTabMemory();
});

const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const profileText = () => [...profile.values.values()].join('\n');
const keysOf = (ownerId: string) => [...profile.values.keys()].filter(key => key.startsWith(`@vitruvius/web/${ownerId}/`));

/** An hour on: the access token this tab holds has run out. */
function theHourlyTokenRunsOut() {
  storeTabSignIn(tabStorage, 'owner-1', { expired: true });
}

const PERIOD = { scopeKey: 'tower', reportFormat: 'project_manager' as const };
const report = (capturedAt: string, sourceFingerprint: string, more: Partial<DAVEReportSnapshot> = {}) => ({
  version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt, sourceFingerprint, reportFormat: 'project_manager',
  tasks: [{ taskId: 't1', projectName: 'Tower', taskName: 'Frame walls', areaName: 'Level 2', owner: 'Dana', status: 'In Progress', percentComplete: 40, finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null }],
  ...more,
}) as unknown as DAVEReportSnapshot;
const PHONE_AT_10 = '2026-10-01T10:00:00.000Z';
const WEB_AT_13 = '2026-10-01T13:00:00.000Z';
/** The shared record (report_snapshots): one row, which can be out of reach; every read and write asked of it is counted. */
let record: { row: DAVEReportSnapshot | null; reachable: boolean; reads: number; writes: number };
const sharedCloud = () => daveWebReportSnapshotCloud(
  async () => {
    record.reads += 1;
    if (!record.reachable) throw new Error('The shared report period could not be read.');
    return { ownerId: 'owner-1', snapshot: record.row };
  },
  async row => {
    record.writes += 1;
    if (!record.reachable) throw new Error('The shared report period could not be saved.');
    record.row = JSON.parse(JSON.stringify(row.snapshot)) as DAVEReportSnapshot;
    return 'saved' as const;
  },
);
/** The phone sent at 10:00; this computer approves and sends the next report at 13:00 while the shared record is out of reach. */
async function sentFromHereWhileTheRecordWasOutOfReach() {
  record = { row: report(PHONE_AT_10, 'facts-at-10', { deliveredAt: PHONE_AT_10, sentBy: 'phone-install' }), reachable: true, reads: 0, writes: 0 };
  const store = { storage: daveWebReportStorage(() => gateway.authorizedOwnerId()), cloud: sharedCloud() };
  expect(reportPeriodSentAt((await loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot)).toBe(PHONE_AT_10);
  record.reachable = false;
  expect((await approveDAVEWebReportPeriod(store, report('2026-10-01T12:55:00.000Z', 'facts-at-13'), PHONE_AT_10)).status).toBe('saved');
  expect((await recordDAVEWebReportSend(store, PERIOD, 'facts-at-13', WEB_AT_13))?.status).toBe('saved');
  // Recorded on this computer only: the shared record still runs from the phone's report.
  expect(record.row?.deliveredAt).toBe(PHONE_AT_10);
  expect(profileText()).toContain(WEB_AT_13);
  // The shared record can be reached again; Reports has not been opened since.
  record.reachable = true;
  record.reads = 0;
  record.writes = 0;
  return store;
}

describe('R5 item 7 (a finding, pinned as it is today): the server ends the sign-in while a send has not reached the shared record', () => {
  it('the account\'s periods leave this browser at once; nothing is read from or written to the shared record first; the send is in no place at all', async () => {
    await openTab('owner-1');
    await sentFromHereWhileTheRecordWasOutOfReach();

    server.signedOutOfAllDevices = true;
    theHourlyTokenRunsOut();
    await expect(gateway.getSessionStatus()).resolves.toEqual({ configured: true, session: null });
    await settle();

    expect(heard).toEqual(['SIGNED_OUT']);
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    // TODAY: gone from this browser, and never offered to the shared record.
    expect(keysOf('owner-1')).toEqual([]);
    expect(profileText()).not.toContain(WEB_AT_13);
    expect({ reads: record.reads, writes: record.writes }).toEqual({ reads: 0, writes: 0 });
    expect(record.row?.deliveredAt).toBe(PHONE_AT_10);

    // He signs in again on this computer: the next report counts from the phone's 10:00 report, as on every other
    // device. What the 13:00 report covered will be said again, and nothing tells him.
    stopListening();
    closeTabClient(client);
    server.signedOutOfAllDevices = false; // a new sign-in, which the server knows
    await openTab('owner-1');
    const again = { storage: daveWebReportStorage(() => gateway.authorizedOwnerId()), cloud: sharedCloud() };
    const period = (await loadDAVEWebReportPeriod(again, 'tower', 'project_manager')).snapshot;
    expect(reportPeriodSentAt(period)).toBe(PHONE_AT_10);
    expect(period?.sentBy).toBe('phone-install');
  });

  it('for comparison, "Sign Out of This Computer" carries the same send up before the periods leave (review N2, unchanged)', async () => {
    await openTab('owner-1');
    await sentFromHereWhileTheRecordWasOutOfReach();
    const notShared = await shareDAVEWebReportSendsBeforeSignOut(() => gateway.authorizedOwnerId(), sharedCloud());
    expect(notShared).toEqual([]);
    expect(record.writes).toBeGreaterThan(0);
    expect(record.row?.deliveredAt).toBe(WEB_AT_13);
    await gateway.signOut('local');
    expect(keysOf('owner-1')).toEqual([]);
    // Every device's next report counts from the 13:00 report.
    expect(record.row).toMatchObject({ deliveredAt: WEB_AT_13, sourceFingerprint: 'facts-at-13' });
  });
});
